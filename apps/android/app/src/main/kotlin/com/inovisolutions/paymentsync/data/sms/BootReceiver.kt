package com.inovisolutions.paymentsync.data.sms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Re-arms the reconcile/heartbeat work after a reboot (scheduled in Task 14). */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        // Enqueues the periodic reconcile + heartbeat work on boot.
    }
}
