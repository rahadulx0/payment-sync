import { Injectable, Logger } from '@nestjs/common';
import { nowUtc } from '@paysync/shared';

import { PrismaService } from '../../common/prisma/prisma.service.js';
import { RedisService } from '../../common/redis/redis.service.js';

import { MatchingService } from './matching.service.js';

const CHUNK = 200;
const DEDUPE_TTL_SEC = 60;

/**
 * Re-runs matching over a company's UNMATCHED SMS (manual sync, re-parse, admin
 * action, periodic safety sweep). Deduplicated by a short-lived Redis key so a
 * burst of manual syncs collapses to one rescan rather than stacking dozens
 * (Task 08 §4.3). Each SMS is matched in its own transaction via the runner.
 */
@Injectable()
export class RescanService {
  private readonly log = new Logger(RescanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
    private readonly redis: RedisService,
  ) {}

  /** Returns the number of SMS examined, or -1 if the rescan was deduplicated away. */
  async rescanCompany(companyId: string): Promise<number> {
    const key = `rescan:lock:${companyId}`;
    const acquired = await this.redis.set(key, '1', 'EX', DEDUPE_TTL_SEC, 'NX');
    if (acquired === null) return -1;

    let examined = 0;
    try {
      const retentionDays = (await this.retentionDays(companyId)) ?? 180;
      const floor = new Date(nowUtc().getTime() - retentionDays * 24 * 60 * 60 * 1000);
      let cursor: string | undefined;
      for (;;) {
        const rows = await this.prisma.smsLog.findMany({
          where: {
            company_id: companyId,
            match_status: 'UNMATCHED',
            uploaded_at: { gte: floor },
            ...(cursor !== undefined ? { id: { gt: cursor } } : {}),
          },
          orderBy: { id: 'asc' },
          take: CHUNK,
          select: { id: true },
        });
        if (rows.length === 0) break;
        for (const row of rows) {
          await this.matching.matchBySms(row.id, 'RESCAN');
          examined++;
        }
        cursor = rows[rows.length - 1]?.id;
        if (rows.length < CHUNK) break;
      }
    } catch (err) {
      this.log.warn(`rescan for ${companyId} failed partway: ${String(err)}`);
    } finally {
      await this.redis.del(key).catch(() => undefined);
    }
    return examined;
  }

  private async retentionDays(companyId: string): Promise<number | null> {
    const s = await this.prisma.companySettings.findUnique({
      where: { company_id: companyId },
      select: { sms_retention_days: true },
    });
    return s?.sms_retention_days ?? null;
  }
}
