import { describe, expect, it } from 'vitest';

import { Money, MoneyParseError } from '../src/money.js';

describe('Money.fromDecimalString', () => {
  const ok: [string, number][] = [
    ['1,250.00', 125000],
    ['1250', 125000],
    ['1250.5', 125050],
    ['Tk 1,250.00', 125000],
    ['BDT 300.00', 30000],
    ['৳1250.50', 125050],
    ['১২৫০.৫০', 125050], // Bengali digits
    ['0.01', 1],
    ['0', 0],
    ['99999999999.99', 9999999999999],
  ];
  it.each(ok)('parses %s to %d paisa', (input, paisa) => {
    expect(Money.fromDecimalString(input).toPaisa()).toBe(paisa);
  });

  const bad = ['1.005', '', 'abc', '-5', '1e5', '12.', '.5', '1..2'];
  it.each(bad)('rejects %j', (input) => {
    expect(() => Money.fromDecimalString(input)).toThrow(MoneyParseError);
  });

  it('never silently returns zero on garbage', () => {
    expect(() => Money.fromDecimalString('abc')).toThrow();
  });
});

describe('Money round-trip and comparison', () => {
  it('toDecimalString always has two decimals', () => {
    expect(Money.fromPaisa(1).toDecimalString()).toBe('0.01');
    expect(Money.fromPaisa(125000).toDecimalString()).toBe('1250.00');
    expect(Money.fromPaisa(125050).toDecimalString()).toBe('1250.50');
  });

  it('property: fromDecimalString(toDecimalString(m)) === m', () => {
    for (let i = 0; i < 2000; i++) {
      const paisa = Math.floor(Math.random() * 9_999_999_999_999);
      const m = Money.fromPaisa(paisa);
      expect(Money.fromDecimalString(m.toDecimalString()).equals(m)).toBe(true);
    }
  });

  it('1250.00 == 1250 == 1,250.00 (paisa comparison)', () => {
    const a = Money.fromDecimalString('1250.00');
    const b = Money.fromDecimalString('1250');
    const c = Money.fromDecimalString('1,250.00');
    expect(a.equals(b)).toBe(true);
    expect(b.equals(c)).toBe(true);
  });

  it('compare / absDiff / isWithinTolerance', () => {
    const a = Money.fromDecimalString('1250.00');
    const b = Money.fromDecimalString('1200.00');
    expect(a.compare(b)).toBe(1);
    expect(b.compare(a)).toBe(-1);
    expect(a.compare(a)).toBe(0);
    expect(a.absDiff(b).toDecimalString()).toBe('50.00');
    expect(a.isWithinTolerance(b, Money.fromDecimalString('50.00'))).toBe(true);
    expect(a.isWithinTolerance(b, Money.fromDecimalString('49.99'))).toBe(false);
  });

  it('add / subtract keep integer paisa (delta may be negative)', () => {
    const expected = Money.fromDecimalString('1200.00');
    const received = Money.fromDecimalString('1250.00');
    expect(expected.subtract(received).toDecimalString()).toBe('-50.00');
    expect(received.subtract(expected).toDecimalString()).toBe('50.00');
  });

  it('rejects out-of-range and non-integer paisa', () => {
    expect(() => Money.fromPaisa(1.5)).toThrow(MoneyParseError);
    expect(() => Money.fromPaisa(100_000_000_000_000)).toThrow(MoneyParseError);
  });

  it('fromPrismaDecimal accepts strings, numbers, and Decimal-like objects', () => {
    expect(Money.fromPrismaDecimal('1250.00').toPaisa()).toBe(125000);
    expect(Money.fromPrismaDecimal(1250).toPaisa()).toBe(125000);
    expect(Money.fromPrismaDecimal({ toString: () => '1250.50' }).toPaisa()).toBe(125050);
  });

  it('zero / isPositive / add', () => {
    expect(Money.zero().toDecimalString()).toBe('0.00');
    expect(Money.zero().isPositive()).toBe(false);
    expect(Money.fromDecimalString('0.01').isPositive()).toBe(true);
    expect(
      Money.fromDecimalString('10.00').add(Money.fromDecimalString('5.50')).toDecimalString(),
    ).toBe('15.50');
  });
});
