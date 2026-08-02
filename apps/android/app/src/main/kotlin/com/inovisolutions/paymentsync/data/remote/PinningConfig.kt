package com.inovisolutions.paymentsync.data.remote

import okhttp3.CertificatePinner

/**
 * Certificate pinning (Task 15 §4.1). Two rules that exist because getting them
 * wrong causes an outage rather than a bug:
 *
 * 1. Pin the **intermediate CA** SPKI, not the leaf — pinning the leaf guarantees
 *    an outage at every certificate renewal.
 * 2. Always ship a **backup pin**. Rotation means shipping the new pin in an app
 *    release BEFORE the certificate changes; the backup is what keeps devices
 *    connected if that ordering ever slips. See `docs/runbook.md`.
 *
 * Pinning is active in release/staging and disabled in debug (so a local plain
 * dev server works). `pinnerFor` is pure so a test can assert the release build
 * never ships unpinned.
 */
object PinningConfig {

    /** SPKI pins for the API host's issuing CA. Replaced per environment at release time. */
    const val PRIMARY_PIN = "sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
    const val BACKUP_PIN = "sha256/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB="

    /**
     * Returns the pinner for a build, or null when pinning is intentionally off.
     * `isDebug = true` is the ONLY way to get null — a release build cannot be
     * silently unpinned.
     */
    fun pinnerFor(host: String, isDebug: Boolean): CertificatePinner? {
        if (isDebug) return null
        return CertificatePinner.Builder()
            .add(host, PRIMARY_PIN)
            .add(host, BACKUP_PIN)
            .build()
    }

    /** Host extracted from a base URL, for pinning and for error messages. */
    fun hostOf(baseUrl: String): String =
        baseUrl.substringAfter("://").substringBefore('/').substringBefore(':')
}

/**
 * A pin failure is NOT a generic network error — it usually means the connection
 * is being intercepted, and the merchant needs to be told that plainly.
 */
object PinFailureHandler {
    const val EVENT_TYPE = "TLS_PIN_FAILURE"

    fun isPinFailure(t: Throwable): Boolean =
        t is javax.net.ssl.SSLPeerUnverifiedException ||
            (t.message?.contains("Certificate pinning failure", ignoreCase = true) == true)

    fun userMessage(): String =
        "Secure connection failed — your network may be intercepted. Try a different network, " +
            "or contact support if this continues."
}
