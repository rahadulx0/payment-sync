import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service.js';

export interface InvariantResult {
  check: string;
  count: number;
  sampleIds: string[];
}

/**
 * The correctness invariants that prove double-crediting is impossible
 * (architecture §14). The DB constraints make most of these unreachable; this
 * job is the tripwire that fires a P1 if one is ever violated anyway. Each check
 * returns offending row ids so a human can inspect (never auto-repair money).
 */
@Injectable()
export class InvariantsService {
  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<InvariantResult[]> {
    return Promise.all([
      this.run(
        'verified_order_without_verification',
        `SELECT id::text FROM payment_requests
          WHERE status = 'VERIFIED'
            AND id NOT IN (SELECT payment_request_id FROM verified_transactions)`,
      ),
      this.run(
        'verification_on_unverified_order',
        `SELECT vt.id::text FROM verified_transactions vt
           JOIN payment_requests pr ON pr.id = vt.payment_request_id
          WHERE pr.status <> 'VERIFIED'`,
      ),
      this.run(
        'matched_sms_without_verification',
        `SELECT id::text FROM sms_logs
          WHERE match_status = 'MATCHED'
            AND id NOT IN (SELECT sms_log_id FROM verified_transactions)`,
      ),
      this.run(
        'duplicate_live_trxid',
        `SELECT (array_agg(id::text))[1] FROM payment_requests
          WHERE transaction_id IS NOT NULL AND status IN ('PENDING','VERIFIED')
          GROUP BY company_id, transaction_id
         HAVING count(*) > 1`,
      ),
      this.run(
        'verification_amount_delta_null',
        `SELECT id::text FROM verified_transactions WHERE amount_delta IS NULL`,
      ),
    ]);
  }

  private async run(check: string, sql: string): Promise<InvariantResult> {
    const rows = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM (${sql}) AS q(id) LIMIT 50`,
    );
    return { check, count: rows.length, sampleIds: rows.slice(0, 5).map((r) => r.id) };
  }
}
