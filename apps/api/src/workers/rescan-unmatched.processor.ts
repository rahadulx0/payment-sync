import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../common/prisma/prisma.service.js';
import { RescanService } from '../modules/matching/rescan.service.js';

/**
 * Periodic safety sweep (architecture §9.3, Task 08 §4.3). Task 16 schedules
 * `tick()` every 15 minutes; it rescans every active company that still has
 * UNMATCHED SMS. The RescanService's Redis dedupe means an overlapping
 * manual-sync-triggered rescan and this sweep collapse to one run per company.
 */
@Injectable()
export class RescanUnmatchedProcessor {
  private readonly log = new Logger(RescanUnmatchedProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rescan: RescanService,
  ) {}

  async tick(): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ company_id: string }[]>`
      SELECT DISTINCT company_id FROM sms_logs WHERE match_status = 'UNMATCHED'`;
    let swept = 0;
    for (const row of rows) {
      const examined = await this.rescan.rescanCompany(row.company_id);
      if (examined >= 0) swept++;
    }
    this.log.log(`rescan sweep touched ${swept}/${rows.length} companies`);
    return swept;
  }
}
