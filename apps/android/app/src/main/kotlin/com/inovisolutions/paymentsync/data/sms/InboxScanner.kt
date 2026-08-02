package com.inovisolutions.paymentsync.data.sms

import android.content.Context
import android.provider.Telephony
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

data class InboxMessage(val address: String, val body: String, val timestampMillis: Long)

/**
 * Reads the SMS inbox directly — the mechanism that makes correctness independent
 * of the `SMS_RECEIVED` broadcast arriving (architecture §11.4.1). The broadcast
 * is an optimisation; THIS is the guarantee.
 *
 * Projects only address/body/date, and applies the allowlist so non-provider
 * messages are never even returned to the caller.
 */
@Singleton
class InboxScanner @Inject constructor(
    @ApplicationContext private val context: Context,
    private val rules: RuleRepository,
) {
    fun scan(sinceMillis: Long, limit: Int = 500): List<InboxMessage> {
        val allowlist = rules.currentAllowlist()
        val out = mutableListOf<InboxMessage>()
        val projection = arrayOf(Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE)
        val cursor = runCatching {
            context.contentResolver.query(
                Telephony.Sms.Inbox.CONTENT_URI,
                projection,
                "${Telephony.Sms.DATE} >= ?",
                arrayOf(sinceMillis.toString()),
                "${Telephony.Sms.DATE} DESC",
            )
        }.getOrNull() ?: return emptyList() // permission revoked → empty, never a crash

        cursor.use { c ->
            val addressIdx = c.getColumnIndex(Telephony.Sms.ADDRESS)
            val bodyIdx = c.getColumnIndex(Telephony.Sms.BODY)
            val dateIdx = c.getColumnIndex(Telephony.Sms.DATE)
            if (addressIdx < 0 || bodyIdx < 0 || dateIdx < 0) return emptyList()
            while (c.moveToNext() && out.size < limit) {
                val address = c.getString(addressIdx) ?: continue
                if (!allowlist.matches(address)) continue // privacy control
                out.add(InboxMessage(address, c.getString(bodyIdx) ?: "", c.getLong(dateIdx)))
            }
        }
        return out
    }
}
