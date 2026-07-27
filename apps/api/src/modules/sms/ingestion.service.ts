import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { normalizeBody } from '@paysync/parsers';
import { nowUtc, type SmsUploadResponse, type SmsUploadResult } from '@paysync/shared';
import { Prisma } from '@prisma/client';

import { MetricsService } from '../../common/metrics/metrics.service.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { SmsUploadDto } from '../devices/dto.js';
import { ParserService } from '../parsing/parser.service.js';
import { RuleRepository } from '../parsing/rule.repository.js';

import { MATCHING_HOOK, type MatchingHook } from './matching.hook.js';

const HEX64 = /^[0-9a-fA-F]{64}$/;
const CONTENT_DEDUPE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type MessageInput = SmsUploadDto['messages'][number];

@Injectable()
export class IngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: ParserService,
    private readonly rules: RuleRepository,
    private readonly metrics: MetricsService,
    @Inject(MATCHING_HOOK) private readonly matching: MatchingHook,
  ) {}

  async ingest(companyId: string, deviceId: string, dto: SmsUploadDto): Promise<SmsUploadResponse> {
    const now = nowUtc();
    const seen = new Set<string>();
    const results: SmsUploadResult[] = [];
    let accepted = 0;
    let duplicates = 0;
    let rejected = 0;
    let matched = 0;

    for (const msg of dto.messages) {
      const res = await this.ingestOne(companyId, deviceId, dto.upload_source, msg, now, seen);
      results.push(res);
      if (res.status === 'ACCEPTED') accepted++;
      else if (res.status === 'DUPLICATE') duplicates++;
      else rejected++;
      if (res.match_status === 'MATCHED') matched++;
    }

    await this.prisma.device
      .update({ where: { id: deviceId }, data: { last_sms_at: now } })
      .catch(() => undefined);

    return {
      results,
      summary: { accepted, duplicates, rejected, matched },
      config_version: this.rules.getConfigVersion(),
    };
  }

  private async ingestOne(
    companyId: string,
    deviceId: string,
    uploadSource: SmsUploadDto['upload_source'],
    msg: MessageInput,
    now: Date,
    seen: Set<string>,
  ): Promise<SmsUploadResult> {
    if (!HEX64.test(msg.client_msg_hash)) {
      return { client_msg_hash: msg.client_msg_hash, status: 'REJECTED', reason: 'INVALID_HASH' };
    }
    if (seen.has(msg.client_msg_hash)) {
      return {
        client_msg_hash: msg.client_msg_hash,
        status: 'DUPLICATE',
        reason: 'BATCH_DUPLICATE',
      };
    }
    seen.add(msg.client_msg_hash);

    const contentHash = createHash('sha256')
      .update(`${companyId}|${msg.sms_address}|${normalizeBody(msg.raw_message)}`)
      .digest('hex');

    // Secondary dedupe: same content re-uploaded after a reinstall (new client hash).
    const contentDup = await this.prisma.smsLog.findFirst({
      where: {
        company_id: companyId,
        content_hash: contentHash,
        uploaded_at: { gte: new Date(now.getTime() - CONTENT_DEDUPE_WINDOW_MS) },
      },
    });
    if (contentDup !== null) {
      return {
        client_msg_hash: msg.client_msg_hash,
        status: 'DUPLICATE',
        reason: 'CONTENT_MATCH',
        sms_log_id: contentDup.id,
        parse_status: contentDup.parse_status,
        match_status: contentDup.match_status,
      };
    }

    let sms;
    try {
      sms = await this.prisma.smsLog.create({
        data: {
          company_id: companyId,
          device_id: deviceId,
          client_msg_hash: msg.client_msg_hash,
          content_hash: contentHash,
          sms_address: msg.sms_address,
          raw_message: msg.raw_message,
          device_received_at: new Date(msg.device_received_at),
          upload_source: uploadSource,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.prisma.smsLog.findUnique({
          where: {
            company_id_client_msg_hash: {
              company_id: companyId,
              client_msg_hash: msg.client_msg_hash,
            },
          },
        });
        return {
          client_msg_hash: msg.client_msg_hash,
          status: 'DUPLICATE',
          ...(existing !== null
            ? {
                sms_log_id: existing.id,
                parse_status: existing.parse_status,
                match_status: existing.match_status,
              }
            : {}),
        };
      }
      throw e;
    }

    const hint =
      msg.parsed_hint !== undefined
        ? { transaction_id: msg.parsed_hint.transaction_id, amount: msg.parsed_hint.amount }
        : undefined;
    const ext = this.parser.extract(msg.sms_address, msg.raw_message, now, hint);
    const parsed = await this.prisma.smsLog.update({ where: { id: sms.id }, data: ext.update });

    const outcome = await this.matching.onSmsIngested(sms.id);
    if (outcome.match_status !== 'UNMATCHED') {
      await this.prisma.smsLog.update({
        where: { id: sms.id },
        data: { match_status: outcome.match_status },
      });
    }

    this.metrics.smsUploads.inc({
      provider: ext.result.provider,
      source: uploadSource,
      status: 'accepted',
    });

    return {
      client_msg_hash: msg.client_msg_hash,
      status: 'ACCEPTED',
      sms_log_id: sms.id,
      parse_status: parsed.parse_status,
      match_status: outcome.match_status,
      server_extraction: {
        ...(parsed.transaction_id !== null ? { transaction_id: parsed.transaction_id } : {}),
        ...(parsed.amount !== null ? { amount: parsed.amount.toFixed(2) } : {}),
        provider: parsed.provider,
      },
    };
  }
}
