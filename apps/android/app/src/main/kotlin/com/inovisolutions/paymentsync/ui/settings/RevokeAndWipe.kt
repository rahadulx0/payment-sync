package com.inovisolutions.paymentsync.ui.settings

import androidx.work.WorkManager
import android.content.Context
import com.inovisolutions.paymentsync.data.local.AppDatabase
import com.inovisolutions.paymentsync.data.local.SmsMessageDao
import com.inovisolutions.paymentsync.data.secure.CredentialStore
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject

data class WipePreview(val pendingMessages: Int, val warning: String)

/**
 * Revoke & wipe (architecture §17.2, Task 15 §4.6) — the merchant's off switch.
 *
 * It shows the count of messages that have NOT reached the server before doing
 * anything, and offers a Manual Sync first, because wiping is irreversible and
 * those payments would simply never be verified.
 */
class RevokeAndWipe @Inject constructor(
    @ApplicationContext private val context: Context,
    private val credentials: CredentialStore,
    private val smsDao: SmsMessageDao,
    private val db: AppDatabase,
) {

    suspend fun preview(): WipePreview {
        val pending = smsDao.pendingCount() + smsDao.failedCount()
        return WipePreview(
            pendingMessages = pending,
            warning = if (pending > 0) {
                "$pending payment message(s) have not been sent yet and will be lost. " +
                    "Run 'Sync now' first if you want them delivered."
            } else {
                "All captured payments have been sent. Nothing will be lost."
            },
        )
    }

    /** Cancels all work, clears credentials and local data, returns to onboarding. */
    suspend fun wipe() {
        WorkManager.getInstance(context).cancelAllWork()
        credentials.wipeAll()
        db.clearAllTables()
    }
}
