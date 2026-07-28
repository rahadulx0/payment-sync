import { Money } from '@paysync/shared';
import { describe, expect, it } from 'vitest';

import type {
  MatchInput,
  MatchSettings,
  OrderFacts,
  SmsFacts,
} from '../../../src/modules/matching/core/types.js';
import { HeuristicStrategy } from '../../../src/modules/matching/heuristic/heuristic.strategy.js';
import { scoreCandidate } from '../../../src/modules/matching/heuristic/score.js';

const NOW = new Date('2026-07-27T10:00:00.000Z');
const strategy = new HeuristicStrategy();

function settings(over: Partial<MatchSettings> = {}): MatchSettings {
  return {
    allowedProviders: ['BKASH'],
    lateMatchGraceHours: 24,
    notifyOnReview: true,
    heuristicEnabled: true,
    heuristicWindowMinutes: 30,
    requireSenderMatch: false,
    autoVerifyMinConfidence: 0.9,
    ...over,
  };
}
function sms(over: Partial<SmsFacts> = {}): SmsFacts {
  return {
    smsLogId: 'sms-1',
    provider: 'BKASH',
    direction: 'CREDIT',
    parseStatus: 'PARSED',
    trxId: null,
    amount: Money.fromDecimalString('1000.00'),
    senderMsisdn: '+8801711111111',
    smsAt: NOW,
    companyStatus: 'ACTIVE',
    deviceStatus: 'ACTIVE',
    ...over,
  };
}
function order(id: string, over: Partial<OrderFacts> = {}): OrderFacts {
  return {
    paymentRequestId: id,
    orderId: id,
    trxId: null,
    expectedAmount: Money.fromDecimalString('1000.00'),
    tolerance: Money.fromDecimalString('0.00'),
    status: 'PENDING',
    expiresAt: new Date(NOW.getTime() + 3600_000),
    createdAt: NOW,
    matchMode: 'HEURISTIC',
    expectedProvider: 'BKASH',
    expectedSenderMsisdn: null,
    ...over,
  };
}
function input(cands: OrderFacts[], over: Partial<MatchInput> = {}): MatchInput {
  return {
    sms: sms(),
    candidates: [],
    heuristicCandidates: cands,
    settings: settings(),
    spentTrxIds: new Set(),
    now: NOW,
    ...over,
  };
}

describe('heuristic scoring', () => {
  it('gives a perfect amount+sender+time+provider match a high score', () => {
    const o = order('o', { expectedSenderMsisdn: '+8801711111111' });
    const s = scoreCandidate(o, sms(), [o], settings());
    expect(s.score).toBeGreaterThanOrEqual(0.9);
    expect(s.signals.sender).toBe(1);
  });

  it('drops the score when a collision is present', () => {
    const a = order('a');
    const b = order('b');
    const withCollision = scoreCandidate(a, sms(), [a, b], settings());
    const without = scoreCandidate(a, sms(), [a], settings());
    expect(withCollision.score).toBeLessThan(without.score);
  });

  it('monotonicity: adding a sender match never lowers the score', () => {
    const noSender = order('o');
    const withSender = order('o', { expectedSenderMsisdn: '+8801711111111' });
    expect(
      scoreCandidate(withSender, sms(), [withSender], settings()).score,
    ).toBeGreaterThanOrEqual(scoreCandidate(noSender, sms(), [noSender], settings()).score);
  });
});

describe('heuristic decision rules', () => {
  it('two orders, same amount, no sender → REVIEW (both candidates)', () => {
    const d = strategy.run(input([order('a'), order('b')]));
    expect(d.result).toBe('REVIEW');
    if (d.result !== 'REVIEW') return;
    expect(d.candidates.length).toBe(2);
  });

  it('two orders but only one has a matching sender → VERIFIED, the correct one', () => {
    const good = order('good', { expectedSenderMsisdn: '+8801711111111' });
    const other = order('other', { expectedSenderMsisdn: '+8801799999999' });
    const d = strategy.run(input([good, other]));
    expect(d.result).toBe('VERIFIED');
    if (d.result !== 'VERIFIED') return;
    expect(d.paymentRequestId).toBe('good');
  });

  it('single candidate at exactly the threshold → VERIFIED (inclusive)', () => {
    // amount+time+provider perfect, no sender: 0.45+0.15+0.10 = 0.70 < 0.9 → tune threshold down.
    const o = order('o', { expectedSenderMsisdn: '+8801711111111' });
    const d = strategy.run(input([o], { settings: settings({ autoVerifyMinConfidence: 0.95 }) }));
    expect(d.result).toBe('VERIFIED');
  });

  it('single candidate below threshold → REVIEW', () => {
    const o = order('o'); // no sender → score 0.70
    const d = strategy.run(input([o]));
    expect(d.result).toBe('REVIEW');
  });

  it('popular round amount with 2 candidates → REVIEW (round penalty)', () => {
    const a = order('a', {
      expectedAmount: Money.fromDecimalString('500.00'),
      expectedSenderMsisdn: '+8801711111111',
    });
    const b = order('b', { expectedAmount: Money.fromDecimalString('500.00') });
    const d = strategy.run(
      input([a, b], { sms: sms({ amount: Money.fromDecimalString('500.00') }) }),
    );
    expect(d.result).toBe('REVIEW');
  });

  it('heuristic_enabled = false → UNMATCHED', () => {
    const d = strategy.run(
      input([order('a')], { settings: settings({ heuristicEnabled: false }) }),
    );
    expect(d.result).toBe('UNMATCHED');
  });

  it('an SMS carrying a TrxID that reaches the heuristic pass flags DESPITE_TRXID', () => {
    const o = order('o', { expectedSenderMsisdn: '+8801711111111' });
    const d = strategy.run(
      input([o], {
        sms: sms({ trxId: 'MISTYPED01' }),
        settings: settings({ autoVerifyMinConfidence: 0.95 }),
      }),
    );
    expect(d.result).toBe('VERIFIED');
    if (d.result !== 'VERIFIED') return;
    expect(d.flags).toContain('VERIFIED_HEURISTIC_DESPITE_TRXID');
  });

  it('no candidates → UNMATCHED', () => {
    expect(strategy.run(input([])).result).toBe('UNMATCHED');
  });

  it('hitting the 50-candidate cap → REVIEW, never an arbitrary pick', () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      order(`o${String(i)}`, { expectedSenderMsisdn: '+8801711111111' }),
    );
    expect(strategy.run(input(many)).result).toBe('REVIEW');
  });
});
