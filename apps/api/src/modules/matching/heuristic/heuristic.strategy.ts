import { Injectable } from '@nestjs/common';
import { Money } from '@paysync/shared';

import type { HeuristicPass } from '../core/heuristic-port.js';
import type { MatchDecision, MatchInput, ScoredCandidate } from '../core/types.js';

import { scoreCandidate, type ScoredCandidate as Scored } from './score.js';

/** The heuristic candidate query's safety bound (architecture §9.2). */
export const HEURISTIC_CANDIDATE_CAP = 50;
/** Minimum gap between the top and runner-up scores to auto-verify with >1 candidate. */
const MIN_GAP = 0.25;

/**
 * The real second pass (architecture §9.3), wired into the Task 08 core via the
 * HEURISTIC_PASS token. Pure: it scores the pre-fetched candidate set and applies
 * the threshold + 0.25-gap rules. The governing principle — a review queue is
 * cheaper than a false verification — means ambiguity always goes to REVIEW.
 */
@Injectable()
export class HeuristicStrategy implements HeuristicPass {
  run(input: MatchInput): MatchDecision {
    const { sms, settings } = input;
    if (!settings.heuristicEnabled) return { result: 'UNMATCHED' };

    const cands = input.heuristicCandidates;
    if (cands.length === 0) return { result: 'UNMATCHED' };

    const scored = cands
      .map((c) => scoreCandidate(c, sms, cands, settings))
      .sort((a, b) => b.score - a.score);

    // Hitting the query cap means the window/tolerance is too loose — never guess.
    if (cands.length >= HEURISTIC_CANDIDATE_CAP) {
      return {
        result: 'REVIEW',
        reason: 'AMBIGUOUS_CANDIDATES',
        candidates: scored.map((s) => toCandidate(s, sms)),
      };
    }

    // An SMS carrying a TrxID that reached the heuristic pass had no exact match —
    // often a mistyped TrxID on the wrong order. Flag any such verification.
    const flags = sms.trxId !== null ? ['VERIFIED_HEURISTIC_DESPITE_TRXID'] : [];
    const threshold = settings.autoVerifyMinConfidence;

    const top = scored[0];
    if (top === undefined) return { result: 'UNMATCHED' };

    const verify = (): MatchDecision => ({
      result: 'VERIFIED',
      pass: 'HEURISTIC',
      paymentRequestId: top.order.paymentRequestId,
      orderId: top.order.orderId,
      confidence: round2(top.score),
      amountDelta: (sms.amount ?? Money.zero()).subtract(top.order.expectedAmount),
      wasLate: false,
      flags,
    });
    const review = (): MatchDecision => ({
      result: 'REVIEW',
      reason: 'AMBIGUOUS_CANDIDATES',
      candidates: scored.map((s) => toCandidate(s, sms)),
    });

    if (scored.length === 1) {
      return top.score >= threshold ? verify() : review();
    }
    const runnerUp = scored[1];
    const gap = top.score - (runnerUp?.score ?? 0);
    return top.score >= threshold && gap >= MIN_GAP ? verify() : review();
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toCandidate(s: Scored, sms: { amount: Money | null }): ScoredCandidate {
  const received = sms.amount ?? Money.zero();
  return {
    paymentRequestId: s.order.paymentRequestId,
    orderId: s.order.orderId,
    expectedAmount: s.order.expectedAmount.toDecimalString(),
    receivedAmount: received.toDecimalString(),
    amountDelta: received.subtract(s.order.expectedAmount).toDecimalString(),
    note: s.why.join(' '),
    score: round2(s.score),
    signals: s.signals as unknown as Record<string, number>,
    why: s.why,
  };
}
