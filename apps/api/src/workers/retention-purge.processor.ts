import { Injectable, Logger } from '@nestjs/common';
import { nowUtc } from '@paysync/shared';

import { PrismaService } from '../common/prisma/prisma.service.js';

export interface PurgeReport {
  smsRedacted: number;
  webhookBodiesCleared: number;
  authAttemptsDeleted: number;
  matchAttemptsDeleted: number;
  deviceEventsDeleted: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Data retention (architecture §17.3). The important distinction: an SMS past
 * retention has its `raw_message` **redacted**, not its row deleted — the
 * extracted fields and the verification history must survive, because they are
 * the audit trail for money that moved. Only the personal content goes.
 */
@Injectable()
export class RetentionPurgeProcessor {
  private readonly log = new Logger(RetentionPurgeProcessor.name);

  constructor(private readonly prisma: PrismaService) {}

  async tick(now: Date = nowUtc()): Promise<PurgeReport> {
    const smsRedacted = await this.redactExpiredSmsBodies(now);

    // Webhook response bodies past 30 days: useful for debugging, not forever.
    const webhookBodiesCleared = await this.prisma.$executeRaw`
      UPDATE webhook_deliveries SET response_body = NULL
       WHERE attempted_at < ${new Date(now.getTime() - 30 * DAY_MS)}
         AND response_body IS NOT NULL`;

    const authAttemptsDeleted = await this.prisma.$executeRaw`
      DELETE FROM auth_attempts WHERE created_at < ${new Date(now.getTime() - 90 * DAY_MS)}`;

    const matchAttemptsDeleted = await this.prisma.$executeRaw`
      DELETE FROM match_attempts WHERE created_at < ${new Date(now.getTime() - 90 * DAY_MS)}`;

    const deviceEventsDeleted = await this.prisma.$executeRaw`
      DELETE FROM device_events WHERE created_at < ${new Date(now.getTime() - 30 * DAY_MS)}`;

    const report: PurgeReport = {
      smsRedacted,
      webhookBodiesCleared,
      authAttemptsDeleted,
      matchAttemptsDeleted,
      deviceEventsDeleted,
    };
    this.log.log(`retention purge: ${JSON.stringify(report)}`);
    return report;
  }

  /**
   * Per-company retention: each company's `sms_retention_days` decides when the
   * message text is redacted. The row, the parsed fields, and any verification
   * stay — only the personal content is removed.
   */
  private async redactExpiredSmsBodies(now: Date): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE sms_logs s
         SET raw_message = '[redacted]'
        FROM company_settings cs
       WHERE cs.company_id = s.company_id
         AND s.raw_message <> '[redacted]'
         AND s.created_at < ${now} - make_interval(days => cs.sms_retention_days)`;
  }
}
