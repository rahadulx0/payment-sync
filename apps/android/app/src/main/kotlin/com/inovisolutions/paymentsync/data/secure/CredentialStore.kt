package com.inovisolutions.paymentsync.data.secure

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.util.UUID

/**
 * Credentials in `EncryptedSharedPreferences` (AES-256-GCM, MasterKey in the
 * Android Keystore) — the APK is decompilable, so nothing sensitive is stored in
 * plaintext (architecture §11.5, ADR-4). The **enrollment key is used once and
 * never persisted** (asserted by test). On a Keystore-init failure the store
 * fails loudly rather than silently falling back to plaintext.
 */
class CredentialStore(context: Context) {

    private val prefs: SharedPreferences = run {
        val master = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        try {
            EncryptedSharedPreferences.create(
                context,
                "paysync_secure_prefs",
                master,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        } catch (e: Exception) {
            throw KeystoreUnavailableException(e)
        }
    }

    var deviceToken: String?
        get() = prefs.getString(KEY_TOKEN, null)
        set(value) = prefs.edit().putString(KEY_TOKEN, value).apply()

    var prevDeviceToken: String?
        get() = prefs.getString(KEY_PREV_TOKEN, null)
        set(value) = prefs.edit().putString(KEY_PREV_TOKEN, value).apply()

    var companyCode: String?
        get() = prefs.getString(KEY_COMPANY, null)
        set(value) = prefs.edit().putString(KEY_COMPANY, value).apply()

    var deviceId: String?
        get() = prefs.getString(KEY_DEVICE_ID, null)
        set(value) = prefs.edit().putString(KEY_DEVICE_ID, value).apply()

    var tokenIssuedAt: Long
        get() = prefs.getLong(KEY_TOKEN_AT, 0)
        set(value) = prefs.edit().putLong(KEY_TOKEN_AT, value).apply()

    /** Generated once and persisted; survives updates, regenerates on data-clear (→ re-enrollment). */
    val installId: String
        get() = prefs.getString(KEY_INSTALL_ID, null) ?: UUID.randomUUID().toString().also {
            prefs.edit().putString(KEY_INSTALL_ID, it).apply()
        }

    val isEnrolled: Boolean get() = deviceToken != null

    /** Task 15 revoke-and-wipe. */
    fun wipeAll() {
        prefs.edit().clear().apply()
    }

    private companion object {
        const val KEY_TOKEN = "device_token"
        const val KEY_PREV_TOKEN = "prev_device_token"
        const val KEY_COMPANY = "company_code"
        const val KEY_DEVICE_ID = "device_id"
        const val KEY_TOKEN_AT = "token_issued_at"
        const val KEY_INSTALL_ID = "install_id"
    }
}

class KeystoreUnavailableException(cause: Throwable) :
    RuntimeException("Secure storage could not initialise on this device.", cause)
