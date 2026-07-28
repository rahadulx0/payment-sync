import { Money } from '@paysync/shared';
import { describe, expect, it } from 'vitest';

import { decide } from '../../../src/modules/matching/core/decide.js';
import type {
  MatchInput,
  MatchSettings,
  OrderFacts,
  SmsFacts,
} from '../../../src/modules/matching/core/types.js';

const NOW = new Date('2026-07-27T10:00:00.000Z');
const FUTURE = new Date('2026-07-27T12:00:00.000Z');

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
    trxId: 'ABC123',
    amount: Money.fromDecimalString('1000.00'),
    senderMsisdn: null,
    smsAt: null,
    companyStatus: 'ACTIVE',
    deviceStatus: 'ACTIVE',
    ...over,
  };
}

function order(over: Partial<OrderFacts> = {}): OrderFacts {
  return {
    paymentRequestId: 'pr-1',
    orderId: 'ORD-1',
    trxId: 'ABC123',
    expectedAmount: Money.fromDecimalString('1000.00'),
    tolerance: Money.fromDecimalString('0.00'),
    status: 'PENDING',
    expiresAt: FUTURE,
    createdAt: NOW,
    matchMode: 'EXACT',
    expectedProvider: 'BKASH',
    expectedSenderMsisdn: null,
    ...over,
  };
}

function input(over: Partial<MatchInput> = {}): MatchInput {
  return {
    sms: sms(),
    candidates: [order()],
    heuristicCandidates: [],
    settings: settings(),
    spentTrxIds: new Set<string>(),
    now: NOW,
    ...over,
  };
}

describe('decide — exact pass', () => {
  it('TrxID match, exact amount → VERIFIED confidence 1, delta 0', () => {
    const d = decide(input());
    expect(d.result).toBe('VERIFIED');
    if (d.result !== 'VERIFIED') return;
    expect(d.pass).toBe('EXACT');
    expect(d.confidence).toBe(1);
    expect(d.amountDelta.toDecimalString()).toBe('0.00');
    expect(d.wasLate).toBe(false);
  });

  it('within tolerance, underpay side → VERIFIED, delta recorded', () => {
    const d = decide(
      input({
        sms: sms({ amount: Money.fromDecimalString('995.00') }),
        candidates: [order({ tolerance: Money.fromDecimalString('5.00') })],
      }),
    );
    expect(d.result).toBe('VERIFIED');
    if (d.result !== 'VERIFIED') return;
    expect(d.amountDelta.toDecimalString()).toBe('-5.00');
    expect(d.flags).toEqual([]);
  });

  it('within tolerance, overpay side within tolerance → VERIFIED, no flag', () => {
    const d = decide(
      input({
        sms: sms({ amount: Money.fromDecimalString('1005.00') }),
        candidates: [order({ tolerance: Money.fromDecimalString('5.00') })],
      }),
    );
    expect(d.result).toBe('VERIFIED');
    if (d.result !== 'VERIFIED') return;
    expect(d.flags).toEqual([]);
  });

  it('overpay beyond tolerance → VERIFIED + AMOUNT_OVERPAID', () => {
    const d = decide(input({ sms: sms({ amount: Money.fromDecimalString('1100.00') }) }));
    expect(d.result).toBe('VERIFIED');
    if (d.result !== 'VERIFIED') return;
    expect(d.flags).toContain('AMOUNT_OVERPAID');
    expect(d.amountDelta.toDecimalString()).toBe('100.00');
  });

  it('underpay beyond tolerance → REVIEW AMOUNT_MISMATCH, never VERIFIED', () => {
    const d = decide(input({ sms: sms({ amount: Money.fromDecimalString('900.00') }) }));
    expect(d.result).toBe('REVIEW');
    if (d.result !== 'REVIEW') return;
    expect(d.reason).toBe('AMOUNT_MISMATCH');
  });

  it('EXPIRED order inside grace → VERIFIED, wasLate true', () => {
    const expiredInGrace = order({
      status: 'EXPIRED',
      expiresAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000),
    });
    const d = decide(input({ candidates: [expiredInGrace] }));
    expect(d.result).toBe('VERIFIED');
    if (d.result !== 'VERIFIED') return;
    expect(d.wasLate).toBe(true);
  });

  it('EXPIRED order outside grace → UNMATCHED (never revived)', () => {
    const expiredOld = order({
      status: 'EXPIRED',
      expiresAt: new Date(NOW.getTime() - 48 * 60 * 60 * 1000),
    });
    expect(decide(input({ candidates: [expiredOld] })).result).toBe('UNMATCHED');
  });

  it('TrxID already spent → DUPLICATE', () => {
    const d = decide(input({ candidates: [], spentTrxIds: new Set(['ABC123']) }));
    expect(d.result).toBe('DUPLICATE');
  });

  it('no candidate, unspent → UNMATCHED (awaits register)', () => {
    expect(decide(input({ candidates: [] })).result).toBe('UNMATCHED');
  });

  it('amounts 1000.00 vs 1000 vs 1,000.00 all compare equal (paisa)', () => {
    for (const a of ['1000.00', '1000', '1,000.00']) {
      const d = decide(input({ sms: sms({ amount: Money.fromDecimalString(a) }) }));
      expect(d.result).toBe('VERIFIED');
    }
  });

  it('tolerance boundary at exactly ±tolerance is inclusive → VERIFIED', () => {
    const under = decide(
      input({
        sms: sms({ amount: Money.fromDecimalString('990.00') }),
        candidates: [order({ tolerance: Money.fromDecimalString('10.00') })],
      }),
    );
    const over = decide(
      input({
        sms: sms({ amount: Money.fromDecimalString('1010.00') }),
        candidates: [order({ tolerance: Money.fromDecimalString('10.00') })],
      }),
    );
    expect(under.result).toBe('VERIFIED');
    expect(over.result).toBe('VERIFIED');
  });
});

describe('decide — guards', () => {
  it('debit direction → GUARD_REJECTED DIRECTION_NOT_CREDIT', () => {
    const d = decide(input({ sms: sms({ direction: 'DEBIT' }) }));
    expect(d.result).toBe('GUARD_REJECTED');
    if (d.result !== 'GUARD_REJECTED') return;
    expect(d.guard).toBe('DIRECTION_NOT_CREDIT');
  });

  it('provider not allowed → GUARD_REJECTED PROVIDER_NOT_ALLOWED', () => {
    const d = decide(input({ sms: sms({ provider: 'NAGAD' }) }));
    expect(d.result).toBe('GUARD_REJECTED');
    if (d.result !== 'GUARD_REJECTED') return;
    expect(d.guard).toBe('PROVIDER_NOT_ALLOWED');
  });

  it('UNPARSED → GUARD_REJECTED PARSE_STATUS_UNUSABLE', () => {
    // direction CREDIT isolates this guard from the earlier direction guard.
    const d = decide(input({ sms: sms({ parseStatus: 'UNPARSED', direction: 'CREDIT' }) }));
    expect(d.result).toBe('GUARD_REJECTED');
    if (d.result !== 'GUARD_REJECTED') return;
    expect(d.guard).toBe('PARSE_STATUS_UNUSABLE');
  });

  it('zero amount → GUARD_REJECTED AMOUNT_MISSING_OR_ZERO', () => {
    const d = decide(input({ sms: sms({ amount: Money.zero() }) }));
    expect(d.result).toBe('GUARD_REJECTED');
    if (d.result !== 'GUARD_REJECTED') return;
    expect(d.guard).toBe('AMOUNT_MISSING_OR_ZERO');
  });

  it('DISABLED company → GUARD_REJECTED; SUSPENDED still matches', () => {
    expect(decide(input({ sms: sms({ companyStatus: 'DISABLED' }) })).result).toBe(
      'GUARD_REJECTED',
    );
    expect(decide(input({ sms: sms({ companyStatus: 'SUSPENDED' }) })).result).toBe('VERIFIED');
  });

  it('blocked device → GUARD_REJECTED DEVICE_NOT_ACTIVE', () => {
    const d = decide(input({ sms: sms({ deviceStatus: 'BLOCKED' }) }));
    expect(d.result).toBe('GUARD_REJECTED');
    if (d.result !== 'GUARD_REJECTED') return;
    expect(d.guard).toBe('DEVICE_NOT_ACTIVE');
  });

  it('timestamp 10 min in the future → REVIEW SUSPICIOUS_SMS', () => {
    const d = decide(input({ sms: sms({ smsAt: new Date(NOW.getTime() + 10 * 60 * 1000) }) }));
    expect(d.result).toBe('REVIEW');
    if (d.result !== 'REVIEW') return;
    expect(d.reason).toBe('SUSPICIOUS_SMS');
  });

  it('no TrxID on SMS → UNMATCHED via noop heuristic port', () => {
    expect(decide(input({ sms: sms({ trxId: null }) })).result).toBe('UNMATCHED');
  });
});

// Deterministic pseudo-randomness (no Math.random / Date.now — reproducible).
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

describe('decide — properties', () => {
  it('is deterministic and side-effect free (same input 1000× → identical)', () => {
    const inp = input({ sms: sms({ amount: Money.fromDecimalString('1234.56') }) });
    const first = JSON.stringify(serialize(decide(inp)));
    for (let i = 0; i < 1000; i++) {
      expect(JSON.stringify(serialize(decide(inp)))).toBe(first);
    }
  });

  it('never yields a VERIFIED underpayment beyond tolerance across random amounts', () => {
    const rand = lcg(42);
    for (let i = 0; i < 2000; i++) {
      const expected = Math.floor(rand() * 100000) + 1;
      const tolerance = Math.floor(rand() * 500);
      const received = Math.floor(rand() * 100000) + 1;
      const d = decide(
        input({
          sms: sms({ amount: Money.fromPaisa(received) }),
          candidates: [
            order({
              expectedAmount: Money.fromPaisa(expected),
              tolerance: Money.fromPaisa(tolerance),
            }),
          ],
        }),
      );
      if (d.result === 'VERIFIED') {
        // A VERIFIED decision must never be an underpayment beyond tolerance.
        expect(received).toBeGreaterThanOrEqual(expected - tolerance);
      }
    }
  });
});

function serialize(d: ReturnType<typeof decide>): unknown {
  return {
    ...d,
    amountDelta: d.result === 'VERIFIED' ? d.amountDelta.toDecimalString() : undefined,
  };
}
