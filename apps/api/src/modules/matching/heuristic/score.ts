import { Money } from '@paysync/shared';

import type { MatchSettings, OrderFacts, SmsFacts } from '../core/types.js';

const ROUND_AMOUNTS_PAISA = new Set([5000, 10000, 20000, 50000, 100000, 150000, 200000, 500000]);
const MINUTE_MS = 60 * 1000;

export interface ScoreSignals {
  amount: number;
  sender: number;
  time: number;
  provider: number;
  collision: number;
  roundAmount: number;
}

export interface ScoredCandidate {
  order: OrderFacts;
  score: number;
  signals: ScoreSignals;
  why: string[];
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Heuristic confidence score (architecture §9.3), pure. Returns the per-signal
 * breakdown and human-readable `why` strings shown verbatim in the review UI —
 * written for someone reading them six weeks later. A weight change here is a
 * deliberate, visible edit that the score unit matrix will catch.
 */
export function scoreCandidate(
  order: OrderFacts,
  sms: SmsFacts,
  allCandidates: OrderFacts[],
  settings: MatchSettings,
): ScoredCandidate {
  const received = sms.amount ?? Money.zero();
  const why: string[] = [];

  // Amount: 1.0 exact, linear decay to 0 across the tolerance band.
  const diffPaisa = Math.abs(received.toPaisa() - order.expectedAmount.toPaisa());
  const tolPaisa = order.tolerance.toPaisa();
  const amount = diffPaisa === 0 ? 1 : tolPaisa === 0 ? 0 : clamp01(1 - diffPaisa / tolPaisa);
  why.push(
    diffPaisa === 0
      ? `Amount matches exactly (${received.toDecimalString()}).`
      : `Amount off by ${Money.fromPaisa(diffPaisa).toDecimalString()} within tolerance ${order.tolerance.toDecimalString()}.`,
  );

  // Sender: 1 if the expected MSISDN matches, else 0.
  const sender =
    order.expectedSenderMsisdn !== null && order.expectedSenderMsisdn === sms.senderMsisdn ? 1 : 0;
  if (order.expectedSenderMsisdn === null) why.push('No sender was registered for this order.');
  else if (sender === 1)
    why.push(`Sender ${sms.senderMsisdn ?? ''} matches the registered number.`);
  else why.push(`Sender ${sms.senderMsisdn ?? '(none)'} does NOT match the registered number.`);

  // Time: linear decay across the window; 1.0 if the SMS predates the order.
  const windowMs = settings.heuristicWindowMinutes * MINUTE_MS;
  const ageMs = (sms.smsAt?.getTime() ?? order.createdAt.getTime()) - order.createdAt.getTime();
  const time = windowMs === 0 ? (ageMs <= 0 ? 1 : 0) : clamp01(1 - Math.max(0, ageMs) / windowMs);
  why.push(
    `SMS arrived ${Math.round(Math.max(0, ageMs) / MINUTE_MS)} min after the order was registered.`,
  );

  // Provider: 1 exact, 0.5 if the order left provider unspecified, else 0.
  const provider =
    order.expectedProvider === null ? 0.5 : order.expectedProvider === sms.provider ? 1 : 0;

  // Collision: another *sender-compatible* candidate shares this SMS amount. A
  // rival whose registered sender differs from the SMS is ruled out and does not
  // create ambiguity — that is exactly how a sender disambiguates a same-amount pair.
  const rivals = allCandidates.filter(
    (c) =>
      c.paymentRequestId !== order.paymentRequestId &&
      Math.abs(received.toPaisa() - c.expectedAmount.toPaisa()) <= c.tolerance.toPaisa() &&
      (c.expectedSenderMsisdn === null || c.expectedSenderMsisdn === sms.senderMsisdn),
  ).length;
  const collision = rivals > 0 ? 1 : 0;
  if (collision === 1)
    why.push(`${String(rivals + 1)} pending orders could match this amount — ambiguous.`);

  // Round amount with more than one candidate is extra-suspicious.
  const roundAmount =
    ROUND_AMOUNTS_PAISA.has(received.toPaisa()) && allCandidates.length > 1 ? 1 : 0;
  if (roundAmount === 1)
    why.push('Popular round amount with multiple candidates — treated cautiously.');

  const signals: ScoreSignals = { amount, sender, time, provider, collision, roundAmount };
  const score = clamp01(
    0.45 * amount +
      0.3 * sender +
      0.15 * time +
      0.1 * provider -
      0.3 * collision -
      0.1 * roundAmount,
  );
  return { order, score, signals, why };
}
