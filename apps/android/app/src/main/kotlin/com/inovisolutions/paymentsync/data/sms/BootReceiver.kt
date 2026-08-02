package com.inovisolutions.paymentsync.data.sms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.inovisolutions.paymentsync.work.WorkScheduler
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

/**
 * Re-registers periodic work after a reboot or an app update. WorkManager mostly
 * survives a reboot, but not on every OEM — and the boot gap is exactly when
 * messages get missed, so a reconcile pass runs immediately (Task 14 §4.6).
 */
@AndroidEntryPoint
class BootReceiver : BroadcastReceiver() {

    @Inject lateinit var scheduler: WorkScheduler

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> {
                scheduler.schedulePeriodicWork()
                scheduler.runManualSyncNow(scanDays = 2)
            }
        }
    }
}
