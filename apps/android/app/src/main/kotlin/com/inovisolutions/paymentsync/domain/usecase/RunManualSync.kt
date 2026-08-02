package com.inovisolutions.paymentsync.domain.usecase

import com.inovisolutions.paymentsync.data.local.SmsMessageDao
import com.inovisolutions.paymentsync.data.sms.InboxScanner
import com.inovisolutions.paymentsync.data.sms.MessageHash
import com.inovisolutions.paymentsync.data.secure.CredentialStore
import javax.inject.Inject

/**
 * The truthful summary of a Manual Sync (Task 14 §4.3 step 6). An app that says
 * "Sync complete ✓" while messages are stuck teaches merchants to distrust it —
 * and then they stop using the one feature that would have helped.
 */
data class ManualSyncSummary(
    val scanned: Int = 0,
    val alreadyKnown: Int = 0,
    val newlyFound: Int = 0,
    val uploaded: Int = 0,
    val duplicates: Int = 0,
    val rejected: Int = 0,
    val stillPending: Int = 0,
    val error: String? = null,
) {
    /** Only true when the queue is actually empty. */
    val fullySynced: Boolean get() = stillPending == 0 && error == null
}

/**
 * Manual Sync (architecture §5.3) — the recovery feature that covers every
 * real-world failure mode: a missed broadcast, a force-close, a reboot, a
 * reinstall. It re-scans the inbox, re-queues anything not `UPLOADED`, uploads
 * with `upload_source = MANUAL_SYNC` (which triggers the server-side rescan in
 * Task 08), and heals local state from `DUPLICATE` responses.
 */
class RunManualSync @Inject constructor(
    private val scanner: InboxScanner,
    private val smsDao: SmsMessageDao,
    private val capture: CaptureSms,
    private val uploadPending: UploadPending,
    private val credentials: CredentialStore,
) {
    suspend fun run(
        inboxScanDays: Int = 7,
        onProgress: (phase: String, done: Int, total: Int) -> Unit = { _, _, _ -> },
    ): ManualSyncSummary {
        val companyCode = credentials.companyCode
            ?: return ManualSyncSummary(error = "This phone is not connected to a business yet.")

        val since = System.currentTimeMillis() - inboxScanDays * 24L * 60 * 60 * 1000
        onProgress("scanning", 0, 0)
        val messages = scanner.scan(since)

        var alreadyKnown = 0
        var newlyFound = 0
        messages.forEachIndexed { index, m ->
            onProgress("scanning", index + 1, messages.size)
            val hash = MessageHash.clientMsgHash(companyCode, m.address, m.body, m.timestampMillis)
            if (smsDao.byHash(hash) != null) {
                alreadyKnown++
            } else {
                // Ignore-on-conflict insert; previously-missed messages become PENDING.
                capture.handle(m.address, m.body, m.timestampMillis, uploadSource = "MANUAL_SYNC")
                newlyFound++
            }
        }

        // Anything FAILED gets another chance — Manual Sync is the recovery path.
        smsDao.requeueFailed(System.currentTimeMillis())

        onProgress("uploading", 0, 0)
        val report = uploadPending.drain(uploadSource = "MANUAL_SYNC")

        return ManualSyncSummary(
            scanned = messages.size,
            alreadyKnown = alreadyKnown,
            newlyFound = newlyFound,
            uploaded = report.uploaded,
            duplicates = report.duplicates,
            rejected = report.rejected,
            stillPending = report.stillPending,
            error = when (report.outcome) {
                DrainOutcome.NEEDS_REENROLL -> "This device needs to be reconnected. Contact support."
                DrainOutcome.RETRY -> "Some messages could not be sent yet — they will retry automatically."
                DrainOutcome.DRAINED -> null
            },
        )
    }
}
