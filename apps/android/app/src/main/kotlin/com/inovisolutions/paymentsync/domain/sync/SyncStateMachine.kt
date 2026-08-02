package com.inovisolutions.paymentsync.domain.sync

/**
 * Per-message sync state (architecture §11.3). `NEEDS_REENROLL` is deliberately
 * NOT here — it is a device-level condition, not a property of one message.
 */
enum class SyncStatus { PENDING, UPLOADING, UPLOADED, REJECTED, FAILED }

/** Everything that can happen to a queued message. */
sealed interface SyncEvent {
    data object Enqueue : SyncEvent
    data object Claim : SyncEvent
    data class Accepted(val serverSmsLogId: String?, val serverMatchStatus: String?) : SyncEvent
    /** A duplicate is SUCCESS, not an error (architecture §7.2) — the server already has it. */
    data class Duplicate(val serverSmsLogId: String?, val serverMatchStatus: String?) : SyncEvent
    data class Rejected(val reason: String) : SyncEvent
    /** 401 — device-level; the row itself stays PENDING and loses nothing. */
    data object Unauthenticated : SyncEvent
    /** 403 blocked/suspended — back off, keep the row. */
    data object Forbidden : SyncEvent
    data class RateLimited(val retryAfterSeconds: Long?) : SyncEvent
    data class TransportFailure(val error: String) : SyncEvent
    /** A worker died mid-batch; the stale claim is reclaimed. */
    data object StaleClaimReclaimed : SyncEvent
}

/** The row fields the transition can change. Everything else is untouched. */
data class SyncState(
    val status: SyncStatus,
    val attemptCount: Int = 0,
    val nextAttemptAt: Long? = null,
    val lastError: String? = null,
    val serverSmsLogId: String? = null,
    val serverMatchStatus: String? = null,
)

/** Device-level side effect a transition can demand of the caller. */
enum class DeviceEffect { NONE, NEEDS_REENROLL, BACK_OFF_HOURLY, PAUSE_UNTIL_RETRY_AFTER }

data class Transition(val state: SyncState, val effect: DeviceEffect = DeviceEffect.NONE)

/**
 * The sync state machine as a PURE function of (state, event) — architecture
 * §11.3, Task 14 §4.1. Being pure is what lets the (state × event) table be
 * covered exhaustively by unit tests, which matters because this is the code
 * that decides whether a captured payment is ever seen by the server.
 *
 * Invariant: nothing here ever *drops* a message. `FAILED` still gets retried by
 * Manual Sync and Reconcile; only `UPLOADED`/`REJECTED` are terminal.
 */
object SyncStateMachine {

    const val MAX_ATTEMPTS = 10
    const val STALE_CLAIM_TIMEOUT_MS = 5 * 60 * 1000L

    fun transition(current: SyncState, event: SyncEvent, nowMs: Long): Transition = when (event) {
        is SyncEvent.Enqueue ->
            Transition(current.copy(status = SyncStatus.PENDING, nextAttemptAt = nowMs))

        is SyncEvent.Claim ->
            if (current.status == SyncStatus.PENDING) {
                Transition(current.copy(status = SyncStatus.UPLOADING))
            } else {
                Transition(current) // only a PENDING row can be claimed
            }

        is SyncEvent.Accepted -> Transition(
            current.copy(
                status = SyncStatus.UPLOADED,
                serverSmsLogId = event.serverSmsLogId,
                serverMatchStatus = event.serverMatchStatus,
                lastError = null,
                nextAttemptAt = null,
            ),
        )

        // Duplicate = the server already has it. Treated exactly like Accepted so a
        // reinstalled app heals its local state from the returned server id.
        is SyncEvent.Duplicate -> Transition(
            current.copy(
                status = SyncStatus.UPLOADED,
                serverSmsLogId = event.serverSmsLogId,
                serverMatchStatus = event.serverMatchStatus,
                lastError = null,
                nextAttemptAt = null,
            ),
        )

        is SyncEvent.Rejected -> Transition(
            current.copy(
                status = SyncStatus.REJECTED,
                lastError = event.reason,
                nextAttemptAt = null,
            ),
        )

        // 401: the row is untouched (stays PENDING, loses nothing); the DEVICE needs re-enrollment.
        is SyncEvent.Unauthenticated ->
            Transition(current.copy(status = SyncStatus.PENDING), DeviceEffect.NEEDS_REENROLL)

        is SyncEvent.Forbidden -> Transition(
            current.copy(status = SyncStatus.PENDING, nextAttemptAt = nowMs + 60 * 60 * 1000L),
            DeviceEffect.BACK_OFF_HOURLY,
        )

        is SyncEvent.RateLimited -> Transition(
            current.copy(
                status = SyncStatus.PENDING,
                nextAttemptAt = nowMs + BackoffCalculator.retryAfterMs(event.retryAfterSeconds),
            ),
            DeviceEffect.PAUSE_UNTIL_RETRY_AFTER,
        )

        is SyncEvent.TransportFailure -> {
            val attempts = current.attemptCount + 1
            val status = if (attempts > MAX_ATTEMPTS) SyncStatus.FAILED else SyncStatus.PENDING
            Transition(
                current.copy(
                    status = status,
                    attemptCount = attempts,
                    lastError = event.error,
                    nextAttemptAt = nowMs + BackoffCalculator.delayMs(attempts),
                ),
            )
        }

        is SyncEvent.StaleClaimReclaimed ->
            if (current.status == SyncStatus.UPLOADING) {
                Transition(current.copy(status = SyncStatus.PENDING, nextAttemptAt = nowMs))
            } else {
                Transition(current)
            }
    }
}
