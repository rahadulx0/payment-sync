package com.inovisolutions.paymentsync.domain.sync

/** One per-message result from `POST /sms/upload`, reduced to what settlement needs. */
data class UploadResult(
    val clientMsgHash: String,
    val status: String, // ACCEPTED | DUPLICATE | REJECTED
    val serverSmsLogId: String?,
    val serverMatchStatus: String?,
    val reason: String? = null,
)

data class SettlementOutcome(
    val clientMsgHash: String,
    val transition: Transition,
)

/**
 * Maps a batch response back onto the rows that were sent (Task 14 §4.2). Pure so
 * the mixed-result case — accepted/duplicate/rejected interleaved, plus an
 * unknown hash the server volunteered — is exhaustively testable.
 *
 * Rows the server said nothing about are left alone (they stay `UPLOADING` and
 * the stale-claim reclaim returns them to `PENDING`); an unknown hash in the
 * response is ignored rather than crashing the drainer.
 */
object Settlement {

    fun settle(
        sent: Map<String, SyncState>,
        results: List<UploadResult>,
        nowMs: Long,
    ): List<SettlementOutcome> {
        val outcomes = mutableListOf<SettlementOutcome>()
        for (result in results) {
            val current = sent[result.clientMsgHash] ?: continue // unknown hash → ignore, never crash
            val event = when (result.status.uppercase()) {
                "ACCEPTED" -> SyncEvent.Accepted(result.serverSmsLogId, result.serverMatchStatus)
                "DUPLICATE" -> SyncEvent.Duplicate(result.serverSmsLogId, result.serverMatchStatus)
                "REJECTED" -> SyncEvent.Rejected(result.reason ?: "REJECTED")
                else -> continue // unknown status → leave the row for the next pass
            }
            outcomes.add(
                SettlementOutcome(result.clientMsgHash, SyncStateMachine.transition(current, event, nowMs)),
            )
        }
        return outcomes
    }

    /** Hashes that were sent but not mentioned in the response — returned to PENDING. */
    fun unsettled(sent: Set<String>, results: List<UploadResult>): Set<String> =
        sent - results.map { it.clientMsgHash }.toSet()
}
