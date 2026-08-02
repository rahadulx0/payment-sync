package com.inovisolutions.paymentsync.domain.sync

import kotlin.math.min
import kotlin.math.pow

/**
 * Retry timing for the upload queue (Task 14 §4.1). Deterministic and pure so the
 * curve is testable; jitter is supplied by an injected RNG rather than
 * `Math.random()` for the same reason.
 *
 * Per-row `nextAttemptAt` is the source of truth — WorkManager's own backoff just
 * wakes the pump.
 */
object BackoffCalculator {

    private const val BASE_MS = 30_000L
    private const val MAX_MS = 60 * 60 * 1000L // cap at 1 hour
    private const val JITTER = 0.2
    private const val RETRY_AFTER_CAP_MS = 60 * 60 * 1000L

    /** Exponential: 30s, 60s, 2m, 4m … capped at 1h. `attempt` is 1-based. */
    fun delayMs(attempt: Int, rng: () -> Double = { 0.5 }): Long {
        val exp = BASE_MS * 2.0.pow((attempt - 1).coerceAtLeast(0))
        val capped = min(exp, MAX_MS.toDouble())
        val jittered = capped * (1 + (rng() * 2 - 1) * JITTER)
        return jittered.toLong().coerceAtLeast(0)
    }

    /** Honour a sane `Retry-After` (seconds), capped at 1h; fall back to the base delay. */
    fun retryAfterMs(retryAfterSeconds: Long?): Long {
        if (retryAfterSeconds == null || retryAfterSeconds < 0) return BASE_MS
        return min(retryAfterSeconds * 1000, RETRY_AFTER_CAP_MS)
    }
}
