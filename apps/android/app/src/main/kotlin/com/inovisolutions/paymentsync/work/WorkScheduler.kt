package com.inovisolutions.paymentsync.work

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * All WorkManager scheduling in one place (Task 14 §4.2–§4.6). Every enqueue is
 * unique + idempotent so app start, boot, and package-replace can all call these
 * without stacking duplicate work.
 */
@Singleton
class WorkScheduler @Inject constructor(@ApplicationContext private val context: Context) {

    private val wm: WorkManager get() = WorkManager.getInstance(context)

    private val networkConstraint = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()

    /** The realtime path: expedited if quota allows, otherwise a normal queued run. */
    fun scheduleUpload() {
        val request = OneTimeWorkRequestBuilder<UploadWorker>()
            .setConstraints(networkConstraint)
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        // APPEND_OR_REPLACE keeps ONE drainer for the whole queue.
        wm.enqueueUniqueWork(UPLOAD_QUEUE, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
    }

    fun runManualSyncNow(scanDays: Int = 7) {
        val request = OneTimeWorkRequestBuilder<ManualSyncWorker>()
            .setConstraints(networkConstraint)
            .setInputData(workDataOf(ManualSyncWorker.KEY_SCAN_DAYS to scanDays))
            .build()
        // KEEP: a second tap attaches to the running sync instead of starting another.
        wm.enqueueUniqueWork(MANUAL_SYNC, ExistingWorkPolicy.KEEP, request)
    }

    fun schedulePeriodicWork() {
        wm.enqueueUniquePeriodicWork(
            HEARTBEAT,
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<HeartbeatWorker>(15, TimeUnit.MINUTES)
                .setConstraints(networkConstraint)
                .build(),
        )
        wm.enqueueUniquePeriodicWork(
            RECONCILE,
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<ReconcileWorker>(6, TimeUnit.HOURS)
                .setConstraints(networkConstraint)
                .build(),
        )
        wm.enqueueUniquePeriodicWork(
            PURGE,
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<PurgeWorker>(1, TimeUnit.DAYS).build(),
        )
    }

    fun rescheduleHeartbeat(intervalSeconds: Long) {
        val minutes = (intervalSeconds / 60).coerceAtLeast(15)
        wm.enqueueUniquePeriodicWork(
            HEARTBEAT,
            ExistingPeriodicWorkPolicy.UPDATE,
            PeriodicWorkRequestBuilder<HeartbeatWorker>(minutes, TimeUnit.MINUTES)
                .setConstraints(networkConstraint)
                .build(),
        )
    }

    fun cancelUploads() {
        wm.cancelUniqueWork(UPLOAD_QUEUE)
    }

    companion object {
        const val UPLOAD_QUEUE = "upload-queue"
        const val MANUAL_SYNC = "manual-sync"
        const val HEARTBEAT = "heartbeat"
        const val RECONCILE = "reconcile"
        const val PURGE = "purge"
    }
}
