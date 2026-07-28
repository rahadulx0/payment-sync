package com.inovisolutions.paymentsync.data.sms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import com.inovisolutions.paymentsync.domain.usecase.CaptureSms
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Real-time capture (an OPTIMISATION — the reconcile scan/Manual Sync in Task 14
 * are the guarantee, architecture §11.4). `onReceive` does NO network and hands
 * off within milliseconds: it assembles the multipart body, applies the
 * **allowlist (the privacy control) BEFORE anything is stored or logged**, and
 * defers the durable work to a coroutine via `goAsync()`.
 */
@AndroidEntryPoint
class SmsReceiver : BroadcastReceiver() {

    @Inject lateinit var capture: CaptureSms
    @Inject lateinit var rules: RuleRepository

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        if (messages.isEmpty()) return

        val address = messages.first().originatingAddress ?: return
        // Privacy control: a non-provider address is dropped before any storage/log.
        if (!rules.currentAllowlist().matches(address)) return

        val body = messages.joinToString(separator = "") { it.messageBody ?: "" }
        val timestamp = messages.first().timestampMillis

        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                capture.handle(address, body, timestamp)
            } finally {
                pending.finish()
            }
        }
    }
}
