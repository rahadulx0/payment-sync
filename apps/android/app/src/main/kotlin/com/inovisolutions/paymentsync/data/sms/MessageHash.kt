package com.inovisolutions.paymentsync.data.sms

import java.security.MessageDigest

/**
 * The device-side dedup key. Must be deterministic and stable across app
 * versions and reinstalls, or the server's dedupe breaks and every reinstall
 * re-uploads the inbox (architecture §11.3, Task 13 §4.7). The recipe and its
 * normalisation are fixed; a golden-vector test pins the digest.
 *
 * `clientMsgHash = SHA256("companyCode|address|normalisedBody|smsTimestampMillis")`.
 */
object MessageHash {

    fun clientMsgHash(companyCode: String, address: String, rawBody: String, smsTimestampMillis: Long): String {
        val normalisedBody = Normalize.normalizeBody(rawBody)
        return sha256Hex("$companyCode|$address|$normalisedBody|$smsTimestampMillis")
    }

    private fun sha256Hex(input: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
        val sb = StringBuilder(digest.size * 2)
        for (b in digest) {
            val v = b.toInt() and 0xFF
            sb.append("0123456789abcdef"[v ushr 4])
            sb.append("0123456789abcdef"[v and 0x0F])
        }
        return sb.toString()
    }
}
