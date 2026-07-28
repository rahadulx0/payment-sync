/**
 * Retry schedule (architecture §10.2, Task 09 §4.3). Explicit delays derived
 * from `attempt_count`, persisted in `next_attempt_at` — NOT BullMQ's opaque
 * backoff — so the schedule is inspectable and survives a Redis flush. ±20%
 * jitter via an injected RNG keeps tests deterministic.
 */
const SCHEDULE_MS = [
  30_000, // after attempt 1
  120_000, // 2m
  600_000, // 10m
  1_800_000, // 30m
  7_200_000, // 2h
  21_600_000, // 6h
  43_200_000, // 12h
  86_400_000, // 24h
] as const;

const JITTER = 0.2;
const BREAKER_MIN_SPACING_MS = 3_600_000; // ≥1h when the endpoint circuit is open

/** Base delay (pre-jitter) after `attemptCount` completed attempts, or null past the schedule. */
export function baseDelayMs(attemptCount: number): number | null {
  if (attemptCount < 1) return SCHEDULE_MS[0];
  return SCHEDULE_MS[attemptCount - 1] ?? null;
}

/**
 * The next attempt time after `attemptCount` completed attempts, or null if the
 * budget is exhausted. When the breaker is open, spacing is floored at 1h.
 */
export function nextAttemptAt(
  attemptCount: number,
  maxAttempts: number,
  now: Date,
  rng: () => number,
  breakerOpen = false,
): Date | null {
  if (attemptCount >= maxAttempts) return null;
  const base = baseDelayMs(attemptCount);
  if (base === null) return null;
  const jittered = base * (1 + (rng() * 2 - 1) * JITTER);
  const spaced = breakerOpen ? Math.max(jittered, BREAKER_MIN_SPACING_MS) : jittered;
  return new Date(now.getTime() + Math.round(spaced));
}

/** Honour a sane `Retry-After` (seconds), capped at 1h. Returns null if absent/insane. */
export function retryAfterMs(header: string | null): number | null {
  if (header === null) return null;
  const secs = Number(header);
  if (!Number.isFinite(secs) || secs < 0 || secs > 3600) return null;
  return secs * 1000;
}
