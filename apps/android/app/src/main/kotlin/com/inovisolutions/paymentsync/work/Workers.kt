package com.inovisolutions.paymentsync.work

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.inovisolutions.paymentsync.data.local.EventLogDao
import com.inovisolutions.paymentsync.data.local.EventLogEntity
import com.inovisolutions.paymentsync.data.local.SmsMessageDao
import com.inovisolutions.paymentsync.domain.sync.DirectiveAction
import com.inovisolutions.paymentsync.domain.sync.SyncStateMachine
import com.inovisolutions.paymentsync.domain.usecase.DrainOutcome
import com.inovisolutions.paymentsync.domain.usecase.RunManualSync
import com.inovisolutions.paymentsync.domain.usecase.SendHeartbeat
import com.inovisolutions.paymentsync.domain.usecase.UploadPending
import com.inovisolutions.paymentsync.notifications.SyncNotifier
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject

/**
 * The single queue drainer (Task 14 §4.2). Unique work — one pump for the whole
 * queue, never a worker per message (that bursts requests and trips the rate
 * limit). `Result.failure()` is reserved for NEEDS_REENROLL so WorkManager stops
 * hammering an endpoint that will keep rejecting us.
 */
@HiltWorker
class UploadWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val uploadPending: UploadPending,
    private val notifier: SyncNotifier,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val report = uploadPending.drain()
        return when (report.outcome) {
            DrainOutcome.DRAINED -> Result.success(
                workDataOf("uploaded" to report.uploaded, "pending" to report.stillPending),
            )
            DrainOutcome.RETRY -> Result.retry()
            DrainOutcome.NEEDS_REENROLL -> {
                notifier.needsReenroll()
                Result.failure()
            }
        }
    }
}

/** Manual Sync — the merchant-triggered recovery path, with honest progress. */
@HiltWorker
class ManualSyncWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val manualSync: RunManualSync,
    private val notifier: SyncNotifier,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val summary = manualSync.run(
            inboxScanDays = inputData.getInt(KEY_SCAN_DAYS, 7),
            onProgress = { phase, done, total ->
                setProgressAsync(workDataOf("phase" to phase, "done" to done, "total" to total))
            },
        )
        if (!summary.fullySynced) notifier.syncIncomplete(summary.stillPending)
        return Result.success(
            workDataOf(
                "scanned" to summary.scanned,
                "newlyFound" to summary.newlyFound,
                "uploaded" to summary.uploaded,
                "duplicates" to summary.duplicates,
                "rejected" to summary.rejected,
                "stillPending" to summary.stillPending,
                "error" to summary.error,
            ),
        )
    }

    companion object {
        const val KEY_SCAN_DAYS = "scan_days"
    }
}

/**
 * The 6-hourly automatic version of Manual Sync (Task 14 §4.4). This is what
 * makes correctness independent of the broadcast. Silent unless it recovers
 * something — a recovery means the phone is dropping broadcasts, which is
 * actionable information for the merchant.
 */
@HiltWorker
class ReconcileWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val manualSync: RunManualSync,
    private val smsDao: SmsMessageDao,
    private val eventDao: EventLogDao,
    private val notifier: SyncNotifier,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val now = System.currentTimeMillis()
        // Reclaim rows a killed worker left mid-flight.
        smsDao.reclaimStaleUploading(now, now - SyncStateMachine.STALE_CLAIM_TIMEOUT_MS)

        val summary = manualSync.run(inboxScanDays = 2)
        if (summary.newlyFound > 0) {
            eventDao.insert(
                EventLogEntity(type = "RECONCILE_RECOVERED", at = now, detail = "found=${summary.newlyFound}"),
            )
            notifier.recoveredMissedMessages(summary.newlyFound)
        }
        return Result.success()
    }
}

/** Liveness + directives every 15 minutes; never skipped as an "optimisation". */
@HiltWorker
class HeartbeatWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val heartbeat: SendHeartbeat,
    private val scheduler: WorkScheduler,
    private val notifier: SyncNotifier,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val outcome = heartbeat.send()
        if (!outcome.ok) return Result.retry()

        if (DirectiveAction.RUN_MANUAL_SYNC in outcome.actions) scheduler.runManualSyncNow()
        if (DirectiveAction.SHOW_MESSAGE in outcome.actions) {
            outcome.messageForUser?.let { notifier.serverMessage(it) }
        }
        if (DirectiveAction.RESCHEDULE_HEARTBEAT in outcome.actions) {
            outcome.nextIntervalSec?.let { scheduler.rescheduleHeartbeat(it) }
        }
        if (!heartbeat.hasSmsPermission()) notifier.permissionLost()
        return Result.success()
    }
}

/** Retention purge — never touches a message that has not been uploaded. */
@HiltWorker
class PurgeWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val smsDao: SmsMessageDao,
    private val eventDao: EventLogDao,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val cutoff = System.currentTimeMillis() - RETENTION_DAYS * 24L * 60 * 60 * 1000
        val deleted = smsDao.purgeUploadedOlderThan(cutoff)
        eventDao.trim()
        if (deleted > 0) {
            eventDao.insert(
                EventLogEntity(type = "PURGED", at = System.currentTimeMillis(), detail = "rows=$deleted"),
            )
        }
        return Result.success()
    }

    private companion object {
        const val RETENTION_DAYS = 30
    }
}

/** Placeholder so a future foreground variant (Task 15) has a hook. */
internal fun CoroutineWorker.noForeground(): ForegroundInfo? = null
