package com.inovisolutions.paymentsync.ui.diagnostics

/** Everything the Diagnostics screen shows, and nothing else (architecture §11.6). */
data class DiagnosticsSnapshot(
    val appVersion: String,
    val androidVersion: String,
    val deviceModel: String,
    val companyCode: String?,
    val installId: String,
    val enrolled: Boolean,
    val hasSmsPermission: Boolean,
    val ignoringBatteryOptimisation: Boolean,
    val networkType: String,
    val pendingCount: Int,
    val failedCount: Int,
    val uploadedCount: Int,
    val clockSkewSeconds: Long,
    val lastHeartbeatAt: Long?,
    val lastSyncAt: Long?,
    val configVersion: Int,
    val parserRuleVersions: Map<String, Int>,
    val recentEvents: List<String>,
)

/**
 * Produces the support-ready text block behind "Copy diagnostics" — the single
 * feature that makes remote support viable (Task 14 §4.7).
 *
 * It is safe to share **by construction**: the snapshot type carries no message
 * bodies, no device token, and no customer MSISDNs, so there is nothing to
 * remember to redact. The tests assert that property directly.
 */
object DiagnosticsFormatter {

    fun format(s: DiagnosticsSnapshot): String = buildString {
        appendLine("payment-sync diagnostics")
        appendLine("app: ${s.appVersion} · android ${s.androidVersion} · ${s.deviceModel}")
        appendLine("company: ${s.companyCode ?: "(not enrolled)"} · install: ${s.installId}")
        appendLine("enrolled: ${yesNo(s.enrolled)}")
        appendLine("sms permission: ${yesNo(s.hasSmsPermission)}")
        appendLine("battery optimisation exempt: ${yesNo(s.ignoringBatteryOptimisation)}")
        appendLine("network: ${s.networkType}")
        appendLine("queue: pending=${s.pendingCount} failed=${s.failedCount} uploaded=${s.uploadedCount}")
        appendLine("clock skew: ${s.clockSkewSeconds}s")
        appendLine("last heartbeat: ${s.lastHeartbeatAt?.toString() ?: "never"}")
        appendLine("last sync: ${s.lastSyncAt?.toString() ?: "never"}")
        appendLine("config version: ${s.configVersion}")
        appendLine("parser rules: ${s.parserRuleVersions.entries.joinToString { "${it.key}=v${it.value}" }}")
        appendLine("recent events:")
        for (e in s.recentEvents.take(50)) appendLine("  - $e")
    }

    private fun yesNo(b: Boolean) = if (b) "yes" else "NO"
}
