package com.inovisolutions.paymentsync.domain.usecase

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import androidx.core.content.ContextCompat
import com.inovisolutions.paymentsync.data.local.EventLogDao
import com.inovisolutions.paymentsync.data.local.EventLogEntity
import com.inovisolutions.paymentsync.data.local.SmsMessageDao
import com.inovisolutions.paymentsync.data.remote.DeviceApi
import com.inovisolutions.paymentsync.data.remote.dto.HeartbeatRequest
import com.inovisolutions.paymentsync.data.secure.CredentialStore
import com.inovisolutions.paymentsync.data.sms.RuleRepository
import com.inovisolutions.paymentsync.domain.sync.DirectiveAction
import com.inovisolutions.paymentsync.domain.sync.DirectiveHandler
import com.inovisolutions.paymentsync.domain.sync.Directives
import dagger.hilt.android.qualifiers.ApplicationContext
import java.time.Instant
import javax.inject.Inject

data class HeartbeatOutcome(
    val actions: Set<DirectiveAction> = emptySet(),
    val messageForUser: String? = null,
    val nextIntervalSec: Long? = null,
    val clockSkewSeconds: Long = 0,
    val ok: Boolean = true,
)

/**
 * The platform's device liveness signal (architecture §15.3) — it runs even when
 * the upload queue is empty, so a silent device is always visible to the
 * operator. Reports full telemetry and applies the server's directives.
 */
class SendHeartbeat @Inject constructor(
    @ApplicationContext private val context: Context,
    private val api: DeviceApi,
    private val smsDao: SmsMessageDao,
    private val eventDao: EventLogDao,
    private val credentials: CredentialStore,
    private val rules: RuleRepository,
) {
    suspend fun send(appVersion: String = "1.0.0"): HeartbeatOutcome {
        if (credentials.deviceToken == null) return HeartbeatOutcome(ok = false)

        val deviceNow = System.currentTimeMillis()
        val request = HeartbeatRequest(
            appVersion = appVersion,
            androidVersion = Build.VERSION.RELEASE ?: "unknown",
            batteryPct = batteryPct(),
            isCharging = isCharging(),
            isIgnoringBatteryOpt = isIgnoringBatteryOptimisation(),
            hasSmsPermission = hasSmsPermission(),
            networkType = "unknown",
            pendingUploadCount = smsDao.pendingCount(),
            failedUploadCount = smsDao.failedCount(),
            deviceNow = Instant.ofEpochMilli(deviceNow).toString(),
            configVersion = 0,
        )

        val response = runCatching { api.heartbeat(request) }.getOrNull()
        if (response == null || !response.isSuccessful) {
            log("HEARTBEAT_FAILED", null)
            return HeartbeatOutcome(ok = false)
        }
        val body = response.body() ?: return HeartbeatOutcome(ok = false)
        val d = body.directives
        val directives = Directives(
            forceFullSync = d.forceFullSync,
            rotateToken = d.rotateToken,
            configChanged = d.configChanged,
            messageForUser = d.messageForUser,
            pauseUploads = d.pauseUploads,
            requestedHeartbeatIntervalSec = body.nextHeartbeatAfterSec,
            minSupportedAppVersion = d.minSupportedAppVersion,
        )
        val actions = DirectiveHandler.actionsFor(directives, appVersion)

        // Apply the directives this use case owns; the worker runs the rest.
        if (DirectiveAction.ROTATE_TOKEN in actions) rotateToken()
        if (DirectiveAction.RELOAD_CONFIG in actions) rules.load()

        log("HEARTBEAT_OK", "actions=${actions.joinToString(",")}")
        return HeartbeatOutcome(
            actions = actions,
            messageForUser = d.messageForUser,
            nextIntervalSec = body.nextHeartbeatAfterSec,
            clockSkewSeconds = body.clockSkewSeconds ?: 0,
            ok = true,
        )
    }

    /** Keeps the old token as `prev` until the next successful call confirms the new one. */
    private suspend fun rotateToken() {
        val response = runCatching { api.rotateToken() }.getOrNull() ?: return
        val token = response.body()?.deviceToken ?: return
        credentials.prevDeviceToken = credentials.deviceToken
        credentials.deviceToken = token
        credentials.tokenIssuedAt = System.currentTimeMillis()
        log("TOKEN_ROTATED", null)
    }

    private suspend fun log(type: String, detail: String?) {
        eventDao.insert(EventLogEntity(type = type, at = System.currentTimeMillis(), detail = detail))
        eventDao.trim()
    }

    fun hasSmsPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED

    fun isIgnoringBatteryOptimisation(): Boolean {
        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return false
        return pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    private fun batteryPct(): Int? {
        val bm = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager ?: return null
        return bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY).takeIf { it in 0..100 }
    }

    private fun isCharging(): Boolean {
        val bm = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager ?: return false
        return bm.isCharging
    }
}
