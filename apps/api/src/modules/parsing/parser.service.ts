import { Injectable } from '@nestjs/common';
import { parse, type ParseResult } from '@paysync/parsers';
import { nowUtc, type Provider } from '@paysync/shared';
import type { Prisma } from '@prisma/client';

import { MetricsService } from '../../common/metrics/metrics.service.js';

import { RuleRepository } from './rule.repository.js';

export interface ParsedHint {
  transaction_id?: string | undefined;
  amount?: string | undefined;
}

export interface Extraction {
  update: Prisma.SmsLogUncheckedUpdateInput;
  flags: string[];
  hintMismatch: boolean;
  result: ParseResult;
}

/** Server-authoritative parsing: the device hint is compared for monitoring but never used (ADR-5). */
@Injectable()
export class ParserService {
  constructor(
    private readonly rules: RuleRepository,
    private readonly metrics: MetricsService,
  ) {}

  parse(smsAddress: string, body: string, now: Date = nowUtc()): ParseResult {
    return parse({ rules: this.rules.getRules(), smsAddress, body, now });
  }

  extract(smsAddress: string, body: string, now: Date = nowUtc(), hint?: ParsedHint): Extraction {
    const result = this.parse(smsAddress, body, now);

    let hintMismatch = false;
    if (hint !== undefined) {
      const trxMismatch =
        hint.transaction_id !== undefined &&
        result.fields.transactionId !== undefined &&
        hint.transaction_id.toUpperCase() !== result.fields.transactionId;
      const amtMismatch =
        hint.amount !== undefined &&
        result.fields.amount !== undefined &&
        hint.amount !== result.fields.amount;
      if (trxMismatch || amtMismatch) {
        hintMismatch = true;
        this.metrics.parserHintMismatch.inc({ provider: result.provider });
      }
    }
    if (result.status === 'UNPARSED') {
      this.metrics.smsParseFailures.inc({ provider: result.provider });
    }

    const update: Prisma.SmsLogUncheckedUpdateInput = {
      provider: result.provider as Provider,
      transaction_id: result.fields.transactionId ?? null,
      amount: result.fields.amount ?? null,
      sender_msisdn: result.fields.senderMsisdn ?? null,
      balance_after: result.fields.balanceAfter ?? null,
      fee: result.fields.fee ?? null,
      sms_timestamp:
        result.fields.timestamp !== undefined ? new Date(result.fields.timestamp) : null,
      parse_status: result.status,
      parse_confidence: result.confidence,
      parser_rule_version: result.ruleVersion,
      flags: this.flags(result, body, now),
    };
    return { update, flags: update.flags as string[], hintMismatch, result };
  }

  private flags(result: ParseResult, body: string, now: Date): string[] {
    const flags: string[] = [];
    if (result.provider === 'UNKNOWN') flags.push('SUSPICIOUS_ADDRESS', 'UNKNOWN_PROVIDER');
    if (result.ignoredReason === 'DEBIT_MESSAGE') flags.push('DEBIT_MESSAGE');
    if (
      result.fields.timestamp !== undefined &&
      new Date(result.fields.timestamp).getTime() > now.getTime() + 5 * 60 * 1000
    ) {
      flags.push('FUTURE_TIMESTAMP');
    }
    if (body.length >= 950) flags.push('TRUNCATED_MESSAGE');
    return flags;
  }
}
