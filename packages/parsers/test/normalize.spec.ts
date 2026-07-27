import { describe, expect, it } from 'vitest';

import {
  normalizeAmount,
  normalizeBody,
  normalizeMsisdn,
  normalizeTimestamp,
  normalizeTrxId,
} from '../src/normalize.js';

describe('normalizeAmount', () => {
  it.each([
    ['1,500.00', '1500.00'],
    ['1250', '1250.00'],
    ['Tk 300.00', '300.00'],
    ['0.00', '0.00'],
    ['7,656.00', '7656.00'],
  ])('%s -> %s', (input, output) => {
    expect(normalizeAmount(input)).toBe(output);
  });
  it('returns null on garbage', () => {
    expect(normalizeAmount('abc')).toBeNull();
  });
});

describe('normalizeMsisdn', () => {
  it.each([
    ['01759584276', '+8801759584276'],
    ['8801615009792', '+8801615009792'],
    ['+8801712345678', '+8801712345678'],
  ])('%s', (input, output) => {
    expect(normalizeMsisdn(input)).toBe(output);
  });
  it('rejects invalid operator prefixes and lengths', () => {
    expect(normalizeMsisdn('01259584276')).toBeNull(); // 012 not a valid prefix
    expect(normalizeMsisdn('0175')).toBeNull();
  });
});

describe('normalizeTrxId', () => {
  it('uppercases and validates', () => {
    expect(normalizeTrxId(' da56rp7n7c ')).toBe('DA56RP7N7C');
  });
  it('rejects short all-digit values', () => {
    expect(normalizeTrxId('12345')).toBeNull();
  });
});

describe('normalizeTimestamp', () => {
  const now = new Date('2026-08-01T00:00:00.000Z');
  it('parses Dhaka local to UTC', () => {
    expect(normalizeTimestamp('05/01/2026 16:55', ['dd/MM/yyyy HH:mm'], now)?.toISOString()).toBe(
      '2026-01-05T10:55:00.000Z',
    );
  });
  it('rejects a timestamp more than 24h in the future', () => {
    expect(normalizeTimestamp('01/01/2027 00:00', ['dd/MM/yyyy HH:mm'], now)).toBeNull();
  });
});

describe('normalizeBody', () => {
  it('collapses whitespace and preserves case', () => {
    expect(normalizeBody('  Cash   In\tTk 5 ')).toBe('Cash In Tk 5');
  });
});
