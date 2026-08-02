package com.inovisolutions.paymentsync.update

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.io.File
import java.security.MessageDigest

/** `latest.json` — the manifest that replaces the Play Store listing (Task 15 §4.4). */
@Serializable
data class LatestRelease(
    @SerialName("version_code") val versionCode: Int,
    @SerialName("version_name") val versionName: String,
    @SerialName("apk_url") val apkUrl: String,
    val sha256: String,
    val size: Long = 0,
    @SerialName("release_notes_en") val releaseNotesEn: String = "",
    @SerialName("release_notes_bn") val releaseNotesBn: String = "",
    @SerialName("min_android_sdk") val minAndroidSdk: Int = 26,
    val mandatory: Boolean = false,
)

sealed interface UpdateDecision {
    data object UpToDate : UpdateDecision
    data class Available(val release: LatestRelease, val mandatory: Boolean) : UpdateDecision
    /** The installed build is below `min_supported_app_version` — a hard block. */
    data class Blocked(val minVersion: String, val release: LatestRelease?) : UpdateDecision
    data class Unsupported(val reason: String) : UpdateDecision
}

/**
 * Decides whether to prompt, block, or do nothing. Pure so every branch is unit
 * tested — this is the kill switch for a breaking contract change, and it has to
 * behave predictably on a phone we cannot reach.
 */
object UpdateChecker {

    fun decide(
        installedVersionCode: Int,
        installedVersionName: String,
        deviceSdk: Int,
        latest: LatestRelease?,
        minSupportedAppVersion: String?,
    ): UpdateDecision {
        // A min-version breach blocks even when latest.json is unavailable.
        val blocked = minSupportedAppVersion != null && isOlder(installedVersionName, minSupportedAppVersion)
        if (blocked) return UpdateDecision.Blocked(minSupportedAppVersion, latest)
        if (latest == null) return UpdateDecision.UpToDate
        if (latest.versionCode <= installedVersionCode) return UpdateDecision.UpToDate
        if (deviceSdk < latest.minAndroidSdk) {
            return UpdateDecision.Unsupported("This update needs a newer Android version.")
        }
        return UpdateDecision.Available(latest, latest.mandatory)
    }

    internal fun isOlder(current: String, minimum: String): Boolean {
        val a = current.split('.').map { it.toIntOrNull() ?: 0 }
        val b = minimum.split('.').map { it.toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(a.size, b.size)) {
            val x = a.getOrElse(i) { 0 }
            val y = b.getOrElse(i) { 0 }
            if (x != y) return x < y
        }
        return false
    }
}

/**
 * SHA-256 verification before install (Task 15 §4.4.3). A downloaded APK is
 * NEVER handed to the installer unverified — a flipped byte or a swapped file
 * must be rejected, not installed.
 */
object ChecksumVerifier {

    fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { stream ->
            val buffer = ByteArray(8192)
            while (true) {
                val read = stream.read(buffer)
                if (read <= 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    /** Case-insensitive compare; any mismatch (or a blank expectation) fails closed. */
    fun matches(actual: String, expected: String): Boolean =
        expected.isNotBlank() && actual.equals(expected.removePrefix("sha256:").trim(), ignoreCase = true)
}
