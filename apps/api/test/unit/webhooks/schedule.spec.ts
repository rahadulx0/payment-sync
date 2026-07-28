import { describe, expect, it } from 'vitest';

import {
  baseDelayMs,
  nextAttemptAt,
  retryAfterMs,
} from '../../../src/modules/webhooks/delivery/schedule.js';

const NOW = new Date('2026-07-28T00:00:00.000Z');
const noJitter = () => 0.5; // rng 0.5 → jitter factor 1.0 (no change)

describe('baseDelayMs', () => {
  it('follows the documented schedule', () => {
    expect(baseDelayMs(1)).toBe(30_000);
    expect(baseDelayMs(2)).toBe(120_000);
    expect(baseDelayMs(8)).toBe(86_400_000);
    expect(baseDelayMs(9)).toBeNull();
  });
});

describe('nextAttemptAt', () => {
  it('schedules the next attempt at the base delay with no jitter', () => {
    const next = nextAttemptAt(1, 8, NOW, noJitter);
    expect(next?.getTime()).toBe(NOW.getTime() + 30_000);
  });
  it('returns null once the attempt budget is exhausted', () => {
    expect(nextAttemptAt(8, 8, NOW, noJitter)).toBeNull();
  });
  it('applies jitter within ±20%', () => {
    const lo = nextAttemptAt(1, 8, NOW, () => 0)?.getTime() ?? 0;
    const hi = nextAttemptAt(1, 8, NOW, () => 1)?.getTime() ?? 0;
    expect(lo - NOW.getTime()).toBe(24_000); // 30s - 20%
    expect(hi - NOW.getTime()).toBe(36_000); // 30s + 20%
  });
  it('floors spacing at 1h when the breaker is open', () => {
    const next = nextAttemptAt(1, 8, NOW, noJitter, true);
    expect(next?.getTime()).toBe(NOW.getTime() + 3_600_000);
  });
});

describe('retryAfterMs', () => {
  it('honours a sane Retry-After, rejects absent/insane', () => {
    expect(retryAfterMs('60')).toBe(60_000);
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs('99999')).toBeNull(); // > 1h cap
    expect(retryAfterMs('-1')).toBeNull();
  });
});
