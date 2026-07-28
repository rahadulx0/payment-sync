import { Injectable, Logger } from '@nestjs/common';

import { MetricsService } from '../common/metrics/metrics.service.js';
import { AuditService } from '../modules/admin/audit/audit.service.js';
import { InvariantsService, type InvariantResult } from '../modules/matching/invariants.service.js';

/**
 * Periodic invariant tripwire (architecture §15.3). Task 16 schedules `tick()`
 * every 15 minutes. Any violation is a P1: it increments the metric, writes a
 * SYSTEM audit entry, and logs at error so the alert rule fires.
 */
@Injectable()
export class InvariantsProcessor {
  private readonly log = new Logger(InvariantsProcessor.name);

  constructor(
    private readonly invariants: InvariantsService,
    private readonly metrics: MetricsService,
    private readonly audit: AuditService,
  ) {}

  async tick(): Promise<InvariantResult[]> {
    const results = await this.invariants.check();
    for (const r of results) {
      if (r.count === 0) continue;
      this.metrics.invariantViolations.inc({ check: r.check }, r.count);
      this.log.error(
        `INVARIANT VIOLATION ${r.check}: ${r.count} row(s), sample ${r.sampleIds.join(',')}`,
      );
      await this.audit.record({
        actorType: 'SYSTEM',
        action: 'invariant.violation',
        entityType: 'invariant',
        entityId: r.check,
        after: { count: r.count, sample_ids: r.sampleIds },
      });
    }
    return results;
  }
}
