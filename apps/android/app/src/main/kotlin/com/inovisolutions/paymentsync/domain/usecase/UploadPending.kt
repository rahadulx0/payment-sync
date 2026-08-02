package com.inovisolutions.paymentsync.domain.usecase

import com.inovisolutions.paymentsync.data.local.EventLogDao
import com.inovisolutions.paymentsync.data.local.EventLogEntity
import com.inovisolutions.paymentsync.data.local.SmsMessageDao
import com.inovisolutions.paymentsync.data.local.SmsMessageEntity
import com.inovisolutions.paymentsync.data.remote.ApiError
import com.inovisolutions.paymentsync.data.remote.DeviceApi
import com.inovisolutions.paymentsync.data.remote.ErrorMapper
import com.inovisolutions.paymentsync.data.remote.dto.ParsedHint
import com.inovisolutions.paymentsync.data.remote.dto.UploadMessage
import com.inovisolutions.paymentsync.data.remote.dto.UploadRequest
import com.inovisolutions.paymentsync.data.secure.CredentialStore
import com.inovisolutions.paymentsync.domain.model.Money
import com.inovisolutions.paymentsync.domain.sync.DeviceEffect
import com.inovisolutions.paymentsync.domain.sync.Settlement
import com.inovisolutions.paymentsync.domain.sync.SyncEvent
import com.inovisolutions.paymentsync.domain.sync.SyncState
import com.inovisolutions.paymentsync.domain.sync.SyncStateMachine
import com.inovisolutions.paymentsync.domain.sync.SyncStatus
import com.inovisolutions.paymentsync.domain.sync.UploadResult
import java.time.Instant
import javax.inject.Inject

/** What the drainer tells the worker to do next. */
enum class DrainOutcome { DRAINED, RETRY, NEEDS_REENROLL }

data class DrainReport(
    val outcome: DrainOutcome,
    val uploaded: Int = 0,
    val duplicates: Int = 0,
    val rejected: Int = 0,
    val stillPending: Int = 0,
)

/**
 * The queue drainer (architecture §11.3, Task 14 §4.2). ONE drainer processes the
 * whole queue in batches — never one worker per message, which would burst
 * requests and trip the rate limit. Rows are the source of truth: each carries
 * its own `nextAttemptAt`, and the worker is just a pump.
 *
 * Oldest-first ordering is deliberate — Task 08's matching semantics depend on it.
 */
class UploadPending @Inject constructor(
    private val smsDao: SmsMessageDao,
    private val eventDao: EventLogDao,
    private val api: DeviceApi,
    private val credentials: CredentialStore,
) {

    suspend fun drain(maxBatch: Int = 50, uploadSource: String = "REALTIME"): DrainReport {
        if (credentials.deviceToken == null) return DrainReport(DrainOutcome.NEEDS_REENROLL)

        val now = System.currentTimeMillis()
        // Return any rows a killed worker left claimed.
        smsDao.reclaimStaleUploading(now, now - SyncStateMachine.STALE_CLAIM_TIMEOUT_MS)

        var uploaded = 0
        var duplicates = 0
        var rejected = 0

        while (true) {
            val batch = smsDao.claimBatch(System.currentTimeMillis(), maxBatch)
            if (batch.isEmpty()) break

            smsDao.markUploading(batch.map { it.clientMsgHash })
            val sent = batch.associate { it.clientMsgHash to it.toSyncState() }

            val response = runCatching {
                api.upload(UploadRequest(uploadSource = uploadSource, messages = batch.map { it.toWire() }))
            }.getOrElse { throwable ->
                failWholeBatch(batch, ErrorMapper.fromThrowable(throwable))
                return DrainReport(DrainOutcome.RETRY, uploaded, duplicates, rejected, smsDao.pendingCount())
            }

            if (!response.isSuccessful) {
                val error = ErrorMapper.fromResponse(response)
                val effect = failWholeBatch(batch, error)
                if (effect == DeviceEffect.NEEDS_REENROLL) {
                    logEvent("UPLOAD_UNAUTHENTICATED", null)
                    return DrainReport(DrainOutcome.NEEDS_REENROLL, uploaded, duplicates, rejected, smsDao.pendingCount())
                }
                return DrainReport(DrainOutcome.RETRY, uploaded, duplicates, rejected, smsDao.pendingCount())
            }

            val results = (response.body()?.results ?: emptyList()).map {
                UploadResult(it.clientMsgHash, it.status, it.smsLogId, it.matchStatus)
            }
            for (outcome in Settlement.settle(sent, results, System.currentTimeMillis())) {
                persist(outcome.clientMsgHash, outcome.transition.state)
                when (outcome.transition.state.status) {
                    SyncStatus.UPLOADED -> uploaded++
                    SyncStatus.REJECTED -> rejected++
                    else -> Unit
                }
            }
            duplicates += results.count { it.status.equals("DUPLICATE", ignoreCase = true) }

            // Anything the server didn't mention goes back to PENDING for the next pass.
            val missed = Settlement.unsettled(sent.keys, results)
            for (hash in missed) {
                sent[hash]?.let { persist(hash, it.copy(status = SyncStatus.PENDING)) }
            }
            // Counts and error classes only — never message bodies.
            logEvent("UPLOAD_BATCH", "sent=${batch.size} ok=$uploaded dup=$duplicates rej=$rejected")

            if (batch.size < maxBatch) break
        }
        return DrainReport(DrainOutcome.DRAINED, uploaded, duplicates, rejected, smsDao.pendingCount())
    }

    private suspend fun failWholeBatch(batch: List<SmsMessageEntity>, error: ApiError): DeviceEffect {
        val now = System.currentTimeMillis()
        val event = when (error) {
            is ApiError.Unauthenticated -> SyncEvent.Unauthenticated
            is ApiError.DeviceBlocked, is ApiError.DeviceRetired, is ApiError.CompanySuspended -> SyncEvent.Forbidden
            is ApiError.RateLimited -> SyncEvent.RateLimited(error.retryAfterSeconds)
            is ApiError.Network -> SyncEvent.TransportFailure(error.cause.javaClass.simpleName)
            else -> SyncEvent.TransportFailure(error.javaClass.simpleName)
        }
        var effect = DeviceEffect.NONE
        for (row in batch) {
            val transition = SyncStateMachine.transition(row.toSyncState(), event, now)
            persist(row.clientMsgHash, transition.state)
            effect = transition.effect
        }
        return effect
    }

    private suspend fun persist(hash: String, state: SyncState) {
        smsDao.settle(
            hash = hash,
            status = state.status.name,
            attempts = state.attemptCount,
            nextAttemptAt = state.nextAttemptAt,
            lastError = state.lastError,
            serverSmsLogId = state.serverSmsLogId,
            serverMatchStatus = state.serverMatchStatus,
        )
    }

    private suspend fun logEvent(type: String, detail: String?) {
        eventDao.insert(EventLogEntity(type = type, at = System.currentTimeMillis(), detail = detail))
        eventDao.trim()
    }
}

private fun SmsMessageEntity.toSyncState() = SyncState(
    status = runCatching { SyncStatus.valueOf(syncStatus) }.getOrDefault(SyncStatus.PENDING),
    attemptCount = attemptCount,
    nextAttemptAt = nextAttemptAt,
    lastError = lastError,
    serverSmsLogId = serverSmsLogId,
    serverMatchStatus = serverMatchStatus,
)

private fun SmsMessageEntity.toWire() = UploadMessage(
    clientMsgHash = clientMsgHash,
    smsAddress = address,
    rawMessage = body,
    deviceReceivedAt = Instant.ofEpochMilli(receivedAt).toString(),
    parsedHint = ParsedHint(
        transactionId = parsedTrxId,
        amount = parsedAmountMinor?.let { Money.fromPaisa(it).toDisplayString() },
    ),
)
