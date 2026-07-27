import { describe, expect, it } from 'vitest';

import { clockSkewSeconds, parseProviderTimestamp, toDhaka, TimeParseError } from '../src/time.js';

const FORMATS = ['dd/MM/yyyy HH:mm', 'dd/MM/yy HH:mm'] as const;

describe('parseProviderTimestamp', () => {
  it('parses Dhaka local time to the correct UTC instant (+06:00)', () => {
    // 27/07/2026 10:15 Dhaka == 04:15 UTC
    const d = parseProviderTimestamp('27/07/2026 10:15', FORMATS);
    expect(d.toISOString()).toBe('2026-07-27T04:15:00.000Z');
  });

  it('handles the 2-digit-year format', () => {
    const d = parseProviderTimestamp('27/07/26 10:15', FORMATS);
    expect(d.toISOString()).toBe('2026-07-27T04:15:00.000Z');
  });

  it('applies the 2-digit-year pivot at 70', () => {
    // Assert on the Dhaka-local rendering (midday, mid-year) to avoid UTC date-boundary confusion.
    expect(toDhaka(parseProviderTimestamp('15/06/69 12:00', FORMATS))).toMatch(/^2069-/);
    expect(toDhaka(parseProviderTimestamp('15/06/70 12:00', FORMATS))).toMatch(/^1970-/);
  });

  it('accepts Bengali digits', () => {
    const d = parseProviderTimestamp('২৭/০৭/২০২৬ ১০:১৫', FORMATS);
    expect(d.toISOString()).toBe('2026-07-27T04:15:00.000Z');
  });

  it('rejects an impossible date (31/02) and unmatched input', () => {
    expect(() => parseProviderTimestamp('31/02/2026 10:15', FORMATS)).toThrow(TimeParseError);
    expect(() => parseProviderTimestamp('not a date', FORMATS)).toThrow(TimeParseError);
  });
});

describe('toDhaka', () => {
  it('renders a UTC instant in +06:00', () => {
    expect(toDhaka(new Date('2026-07-27T04:15:00.000Z'))).toBe('2026-07-27T10:15:00+06:00');
  });
});

describe('clockSkewSeconds', () => {
  it('is positive when the device clock is behind the server (server − device)', () => {
    const server = new Date('2026-07-27T10:00:30.000Z');
    const device = new Date('2026-07-27T10:00:00.000Z');
    expect(clockSkewSeconds(server, device)).toBe(30);
    expect(clockSkewSeconds(device, server)).toBe(-30);
  });
});
