import { Injectable } from '@nestjs/common';
import { Money } from '@paysync/shared';
import type { Prisma } from '@prisma/client';

import type { MatchSettings, OrderFacts, ParseStatusValue, SmsFacts } from './core/types.js';

type Tx = Prisma.TransactionClient;

interface OrderRow {
  id: string;
  order_id: string;
  transaction_id: string | null;
  expected_amount: string;
  amount_tolerance: string;
  status: string;
  expires_at: Date;
  created_at: Date;
  match_mode: string;
  expected_provider: string | null;
  expected_sender_msisdn: string | null;
}

/**
 * Reads the facts the pure core needs, inside the caller's transaction. The
 * candidate query takes `FOR UPDATE` so a concurrent expiry/match on the same
 * rows serialises behind us (belt-and-suspenders alongside the advisory lock).
 */
@Injectable()
export class CandidateRepository {
  /** SMS facts + company/device status + settings. Returns null if the SMS is gone. */
  async loadSmsFacts(
    tx: Tx,
    smsLogId: string,
  ): Promise<{ sms: SmsFacts; settings: MatchSettings; companyId: string } | null> {
    const row = await tx.smsLog.findUnique({
      where: { id: smsLogId },
      include: { company: { include: { settings: true } }, device: true },
    });
    if (row === null) return null;
    const s = row.company.settings;
    if (s === null) return null;

    const parseStatus = row.parse_status as ParseStatusValue;
    const direction: SmsFacts['direction'] =
      parseStatus === 'PARSED' || parseStatus === 'PARTIAL'
        ? 'CREDIT'
        : row.flags.includes('DEBIT_MESSAGE')
          ? 'DEBIT'
          : 'INFO';

    const sms: SmsFacts = {
      smsLogId: row.id,
      provider: row.provider,
      direction,
      parseStatus,
      trxId: row.transaction_id,
      amount: row.amount === null ? null : Money.fromPrismaDecimal(row.amount),
      senderMsisdn: row.sender_msisdn,
      smsAt: row.sms_timestamp,
      companyStatus: row.company.status,
      deviceStatus: row.device?.status ?? null,
    };
    return { sms, settings: this.toSettings(s), companyId: row.company_id };
  }

  /** Live orders (PENDING or EXPIRED) claiming this TrxID, locked for update. */
  async loadExactCandidates(tx: Tx, companyId: string, trxId: string): Promise<OrderFacts[]> {
    const rows = await tx.$queryRaw<OrderRow[]>`
      SELECT id, order_id, transaction_id,
             expected_amount::text AS expected_amount,
             amount_tolerance::text AS amount_tolerance,
             status::text AS status, expires_at, created_at,
             match_mode::text AS match_mode,
             expected_provider::text AS expected_provider,
             expected_sender_msisdn
        FROM payment_requests
       WHERE company_id = ${companyId}::uuid
         AND transaction_id = ${trxId}
         AND status IN ('PENDING', 'EXPIRED')
       FOR UPDATE`;
    return rows.map((r) => this.toOrderFacts(r));
  }

  /**
   * Heuristic candidates (architecture §9.2): PENDING, EXACT-mode excluded
   * (`transaction_id IS NULL` is load-bearing — a mistyped TrxID must never
   * consume someone else's payment), amount within tolerance, SMS time inside
   * [created_at − 5m, created_at + window], provider/sender constrained.
   */
  async loadHeuristicCandidates(
    tx: Tx,
    companyId: string,
    q: {
      amount: string;
      smsTime: Date;
      provider: string;
      sender: string | null;
      windowMinutes: number;
      requireSender: boolean;
    },
  ): Promise<OrderFacts[]> {
    const rows = await tx.$queryRaw<OrderRow[]>`
      SELECT id, order_id, transaction_id,
             expected_amount::text AS expected_amount,
             amount_tolerance::text AS amount_tolerance,
             status::text AS status, expires_at, created_at,
             match_mode::text AS match_mode,
             expected_provider::text AS expected_provider,
             expected_sender_msisdn
        FROM payment_requests
       WHERE company_id = ${companyId}::uuid
         AND status = 'PENDING'
         AND transaction_id IS NULL
         AND ABS(expected_amount - ${q.amount}::numeric) <= amount_tolerance
         AND ${q.smsTime} BETWEEN created_at - INTERVAL '5 minutes'
                              AND created_at + make_interval(mins => ${q.windowMinutes}::int)
         AND (expected_provider IS NULL OR expected_provider = ${q.provider}::"Provider")
         AND (${q.requireSender} = false OR expected_sender_msisdn = ${q.sender})
       ORDER BY created_at DESC
       LIMIT 50
       FOR UPDATE`;
    return rows.map((r) => this.toOrderFacts(r));
  }

  /** True if a prior verification already consumed this TrxID for the company. */
  async findSpentVerification(tx: Tx, companyId: string, trxId: string): Promise<string | null> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT vt.id
        FROM verified_transactions vt
        JOIN sms_logs s ON s.id = vt.sms_log_id
       WHERE vt.company_id = ${companyId}::uuid
         AND s.transaction_id = ${trxId}
       LIMIT 1`;
    return rows[0]?.id ?? null;
  }

  private toSettings(s: {
    allowed_providers: string[];
    late_match_grace_hours: number;
    notify_on_review: boolean;
    heuristic_enabled: boolean;
    heuristic_window_minutes: number;
    require_sender_match: boolean;
    auto_verify_min_confidence: { toString(): string };
  }): MatchSettings {
    return {
      allowedProviders: s.allowed_providers,
      lateMatchGraceHours: s.late_match_grace_hours,
      notifyOnReview: s.notify_on_review,
      heuristicEnabled: s.heuristic_enabled,
      heuristicWindowMinutes: s.heuristic_window_minutes,
      requireSenderMatch: s.require_sender_match,
      autoVerifyMinConfidence: Number(s.auto_verify_min_confidence.toString()),
    };
  }

  private toOrderFacts(r: OrderRow): OrderFacts {
    return {
      paymentRequestId: r.id,
      orderId: r.order_id,
      trxId: r.transaction_id,
      expectedAmount: Money.fromPrismaDecimal(r.expected_amount),
      tolerance: Money.fromPrismaDecimal(r.amount_tolerance),
      status: r.status as OrderFacts['status'],
      expiresAt: r.expires_at,
      createdAt: r.created_at,
      matchMode: r.match_mode as OrderFacts['matchMode'],
      expectedProvider: r.expected_provider,
      expectedSenderMsisdn: r.expected_sender_msisdn,
    };
  }
}
