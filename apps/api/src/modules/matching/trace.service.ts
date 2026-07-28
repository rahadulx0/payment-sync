import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import type { MatchDecision } from './core/types.js';

type Tx = Prisma.TransactionClient;

export interface TraceInput {
  companyId: string;
  trigger: 'SMS_UPLOAD' | 'ORDER_REGISTER' | 'RESCAN' | 'REPARSE' | 'ADMIN';
  smsLogId: string | null;
  paymentRequestId: string | null;
  decision: MatchDecision;
  parserRuleVersion: number | null;
  durationMs: number;
}

/**
 * Writes exactly one `match_attempts` row per match run — including UNMATCHED
 * and GUARD_REJECTED — so Task 12's "why wasn't this verified?" screen can be
 * answered from one table. Trace writes MUST NEVER fail a match, so a write
 * error is logged, not thrown (architecture §9, Task 08 §4.4).
 */
@Injectable()
export class TraceService {
  private readonly log = new Logger(TraceService.name);

  async record(tx: Tx, input: TraceInput): Promise<void> {
    try {
      const d = input.decision;
      const candidates = candidatesJson(d);
      await tx.matchAttempt.create({
        data: {
          company_id: input.companyId,
          trigger: input.trigger,
          sms_log_id: input.smsLogId,
          payment_request_id: d.result === 'VERIFIED' ? d.paymentRequestId : input.paymentRequestId,
          result: d.result,
          pass: d.result === 'VERIFIED' ? d.pass : 'NONE',
          guard_failed: d.result === 'GUARD_REJECTED' ? d.guard : null,
          ...(candidates !== undefined ? { candidates } : {}),
          chosen_score: d.result === 'VERIFIED' ? d.confidence : null,
          parser_rule_version: input.parserRuleVersion,
          duration_ms: input.durationMs,
        },
      });
    } catch (err) {
      this.log.warn(`match_attempts write failed (non-fatal): ${String(err)}`);
    }
  }
}

function candidatesJson(d: MatchDecision): Prisma.InputJsonValue | undefined {
  if (d.result === 'REVIEW') return d.candidates as unknown as Prisma.InputJsonValue;
  if (d.result === 'VERIFIED') {
    return [
      { paymentRequestId: d.paymentRequestId, orderId: d.orderId },
    ] as unknown as Prisma.InputJsonValue;
  }
  if (d.result === 'DUPLICATE') return { trxId: d.trxId } as unknown as Prisma.InputJsonValue;
  return undefined;
}
