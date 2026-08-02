import { Injectable, Logger } from '@nestjs/common';
import { nowUtc } from '@paysync/shared';

import { PrismaService } from '../common/prisma/prisma.service.js';

export interface CleanupReport {
  keysRevoked: number;
  prevWebhookSecretsCleared: number;
  idempotencyKeysPurged: number;
}

const ROTATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Credential lifecycle chores (Task 16 §4.5). Each has a deadline that matters:
 * a rotated key's grace period must actually end, and the previous webhook
 * secret must stop being accepted after the documented 7-day dual-signing window
 * — otherwise "rotation" never really rotates anything.
 */
@Injectable()
export class CleanupCredentialsProcessor {
  private readonly log = new Logger(CleanupCredentialsProcessor.name);

  constructor(private readonly prisma: PrismaService) {}

  async tick(now: Date = nowUtc()): Promise<CleanupReport> {
    // Grace period over: a key scheduled for revocation is now actually revoked.
    const keysRevoked = await this.prisma.apiKey.updateMany({
      where: { revoke_at: { lte: now }, revoked_at: null },
      data: { revoked_at: now },
    });

    // Past the dual-signing window, the old webhook secret is dropped.
    const prevCleared = await this.prisma.company.updateMany({
      where: {
        webhook_secret_prev_enc: { not: null },
        webhook_secret_rotated_at: { lt: new Date(now.getTime() - ROTATION_WINDOW_MS) },
      },
      data: { webhook_secret_prev_enc: null },
    });

    const idempotencyPurged = await this.prisma.idempotencyKey.deleteMany({
      where: { expires_at: { lt: now } },
    });

    const report: CleanupReport = {
      keysRevoked: keysRevoked.count,
      prevWebhookSecretsCleared: prevCleared.count,
      idempotencyKeysPurged: idempotencyPurged.count,
    };
    this.log.log(`credential cleanup: ${JSON.stringify(report)}`);
    return report;
  }
}
