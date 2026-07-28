import { describe, expect, it } from 'vitest';

import { formatMoney, isOnline, relativeTime } from '../../lib/format';

describe('formatMoney', () => {
  it('groups thousands and always shows two decimals — never a float', () => {
    expect(formatMoney('1250.5')).toBe('BDT 1,250.50');
    expect(formatMoney('1000000')).toBe('BDT 1,000,000.00');
    expect(formatMoney('0')).toBe('BDT 0.00');
    expect(formatMoney('-5.5')).toBe('BDT -5.50');
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-07-28T12:00:00.000Z').getTime();
  it('renders coarse buckets', () => {
    expect(relativeTime('2026-07-28T11:59:40.000Z', now)).toBe('just now');
    expect(relativeTime('2026-07-28T11:57:00.000Z', now)).toBe('3 min ago');
    expect(relativeTime('2026-07-28T09:00:00.000Z', now)).toBe('3 h ago');
    expect(relativeTime('2026-07-25T12:00:00.000Z', now)).toBe('3 d ago');
  });
});

describe('isOnline', () => {
  const now = new Date('2026-07-28T12:00:00.000Z').getTime();
  it('is online within the threshold, offline beyond it, offline if never', () => {
    expect(isOnline('2026-07-28T11:45:00.000Z', now)).toBe(true);
    expect(isOnline('2026-07-28T11:00:00.000Z', now)).toBe(false);
    expect(isOnline(null, now)).toBe(false);
  });
});
