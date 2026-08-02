package com.inovisolutions.paymentsync.data.remote.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Heartbeat telemetry (architecture §7.2) — the platform's device liveness signal. */
@Serializable
data class HeartbeatRequest(
    @SerialName("app_version") val appVersion: String,
    @SerialName("android_version") val androidVersion: String,
    @SerialName("battery_pct") val batteryPct: Int? = null,
    @SerialName("is_charging") val isCharging: Boolean? = null,
    @SerialName("is_ignoring_battery_opt") val isIgnoringBatteryOpt: Boolean? = null,
    @SerialName("has_sms_permission") val hasSmsPermission: Boolean? = null,
    @SerialName("network_type") val networkType: String? = null,
    @SerialName("pending_upload_count") val pendingUploadCount: Int = 0,
    @SerialName("failed_upload_count") val failedUploadCount: Int = 0,
    @SerialName("device_now") val deviceNow: String,
    @SerialName("config_version") val configVersion: Int = 0,
)

@Serializable
data class HeartbeatDirectives(
    @SerialName("force_full_sync") val forceFullSync: Boolean = false,
    @SerialName("rotate_token") val rotateToken: Boolean = false,
    @SerialName("config_changed") val configChanged: Boolean = false,
    @SerialName("message_for_user") val messageForUser: String? = null,
    @SerialName("pause_uploads") val pauseUploads: Boolean = false,
    @SerialName("min_supported_app_version") val minSupportedAppVersion: String? = null,
)

@Serializable
data class HeartbeatResponse(
    val directives: HeartbeatDirectives = HeartbeatDirectives(),
    @SerialName("server_now") val serverNow: String? = null,
    @SerialName("clock_skew_seconds") val clockSkewSeconds: Long? = null,
    @SerialName("next_heartbeat_after_sec") val nextHeartbeatAfterSec: Long? = null,
)

@Serializable
data class TokenRotateResponse(
    @SerialName("device_token") val deviceToken: String,
)

@Serializable
data class DeviceEventItem(
    val type: String,
    val at: String,
    val detail: String? = null,
)

@Serializable
data class DeviceEventsRequest(val events: List<DeviceEventItem>)
