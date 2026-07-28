import { compareAmount } from './amount-compare.js';
import type { MatchDecision, MatchInput, OrderFacts, ScoredCandidate } from './types.js';

const HOUR_MS = 60 * 60 * 1000;

function isEligible(order: OrderFacts, now: Date, graceHours: number): boolean {
  if (order.status === 'PENDING') return true;
  if (order.status === 'EXPIRED') {
    return order.expiresAt.getTime() > now.getTime() - graceHours * HOUR_MS;
  }
  return false;
}

function scored(order: OrderFacts, received: string, delta: string, note: string): ScoredCandidate {
  return {
    paymentRequestId: order.paymentRequestId,
    orderId: order.orderId,
    expectedAmount: order.expectedAmount.toDecimalString(),
    receivedAmount: received,
    amountDelta: delta,
    note,
  };
}

/**
 * Exact-TrxID pass (architecture §9.2). Returns `null` to fall through to the
 * heuristic port when there is no TrxID to match on. A returned decision is
 * final for this SMS.
 *
 * Correctness invariants enforced here (CLAUDE.md rules 5, 6):
 * - Underpayment beyond tolerance is NEVER verified — it goes to REVIEW.
 * - Overpayment beyond tolerance verifies, but carries an `AMOUNT_OVERPAID` flag.
 * - A TrxID already spent by a prior verification → DUPLICATE, never a 2nd verify.
 * - An EXPIRED order outside its grace window is never revived.
 */
export function exactPass(input: MatchInput): MatchDecision | null {
  const { sms, candidates, settings, spentTrxIds, now } = input;
  const trxId = sms.trxId;
  const amount = sms.amount;
  if (trxId === null || amount === null) return null;

  const withTrx = candidates.filter((c) => c.trxId === trxId);
  const eligible = withTrx.filter((c) => isEligible(c, now, settings.lateMatchGraceHours));

  if (eligible.length === 0) {
    // No live order for this TrxID. If some verification already consumed it,
    // this is a duplicate credit SMS (or a replay); otherwise wait for a register.
    if (spentTrxIds.has(trxId)) return { result: 'DUPLICATE', trxId };
    return { result: 'UNMATCHED' };
  }

  // A well-formed system has at most one live order per TrxID (partial unique
  // index). If two are somehow eligible, that itself is ambiguous → REVIEW.
  if (eligible.length > 1) {
    return {
      result: 'REVIEW',
      reason: 'AMBIGUOUS_CANDIDATES',
      candidates: eligible.map((c) =>
        scored(
          c,
          amount.toDecimalString(),
          amount.subtract(c.expectedAmount).toDecimalString(),
          'multiple live orders share this TrxID',
        ),
      ),
    };
  }

  const [order] = eligible;
  if (order === undefined) return { result: 'UNMATCHED' };

  const cmp = compareAmount(order.expectedAmount, amount, order.tolerance);
  const wasLate = order.status === 'EXPIRED';

  if (cmp.relation === 'UNDERPAID') {
    return {
      result: 'REVIEW',
      reason: 'AMOUNT_MISMATCH',
      candidates: [
        scored(
          order,
          amount.toDecimalString(),
          cmp.delta.toDecimalString(),
          'underpaid beyond tolerance',
        ),
      ],
    };
  }

  const flags = cmp.relation === 'OVERPAID' ? ['AMOUNT_OVERPAID'] : [];
  return {
    result: 'VERIFIED',
    pass: 'EXACT',
    paymentRequestId: order.paymentRequestId,
    orderId: order.orderId,
    confidence: 1,
    amountDelta: cmp.delta,
    wasLate,
    flags,
  };
}
