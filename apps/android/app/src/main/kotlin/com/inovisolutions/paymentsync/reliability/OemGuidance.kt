package com.inovisolutions.paymentsync.reliability

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings

/** A per-OEM autostart destination and the steps to follow once it opens. */
data class AutostartTarget(val packageName: String, val className: String)

/**
 * Per-OEM battery/autostart guidance (architecture §11.4, Task 15 §4.3).
 *
 * Every deep link is best-effort and wrapped: these intents differ per ROM
 * version, and throwing on an unknown one would crash exactly the devices that
 * need the feature most. Unknown manufacturer → generic app-settings fallback.
 */
object OemGuidance {

    /** Brands known to kill background apps aggressively in this market. */
    private val AGGRESSIVE = setOf("xiaomi", "redmi", "poco", "oppo", "realme", "vivo", "iqoo", "oneplus", "huawei", "honor", "meizu", "asus")

    fun isAggressiveOem(manufacturer: String = Build.MANUFACTURER): Boolean =
        manufacturer.lowercase() in AGGRESSIVE

    fun autostartTargetFor(manufacturer: String = Build.MANUFACTURER): AutostartTarget? =
        when (manufacturer.lowercase()) {
            "xiaomi", "redmi", "poco" -> AutostartTarget(
                "com.miui.securitycenter",
                "com.miui.permcenter.autostart.AutoStartManagementActivity",
            )
            "oppo", "realme" -> AutostartTarget(
                "com.coloros.safecenter",
                "com.coloros.safecenter.permission.startup.StartupAppListActivity",
            )
            "vivo", "iqoo" -> AutostartTarget(
                "com.vivo.permissionmanager",
                "com.vivo.permissionmanager.activity.BgStartUpManagerActivity",
            )
            "huawei", "honor" -> AutostartTarget(
                "com.huawei.systemmanager",
                "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
            )
            "samsung" -> AutostartTarget(
                "com.samsung.android.lool",
                "com.samsung.android.sm.ui.battery.BatteryActivity",
            )
            else -> null
        }

    /**
     * Opens the OEM autostart screen if we know one and it resolves; otherwise
     * falls back to this app's settings page. Returns false if nothing opened, so
     * the UI can show manual instructions instead of failing silently.
     */
    fun openAutostartSettings(context: Context): Boolean {
        val target = autostartTargetFor()
        if (target != null) {
            val intent = Intent().apply {
                component = ComponentName(target.packageName, target.className)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            // resolveActivity + try/catch: ROM variants differ, and a crash here is unacceptable.
            if (intent.resolveActivity(context.packageManager) != null) {
                val opened = runCatching { context.startActivity(intent) }.isSuccess
                if (opened) return true
            }
        }
        return openAppSettings(context)
    }

    fun openAppSettings(context: Context): Boolean = runCatching {
        context.startActivity(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }.isSuccess

    fun isIgnoringBatteryOptimisation(context: Context): Boolean {
        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return false
        return pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    /**
     * Requests the battery-optimisation exemption. Uses the documented action;
     * some ROMs reject it, so failure falls back to the battery settings list.
     */
    @Suppress("BatteryLife") // required for a background SMS-capture utility, disclosed to the merchant
    fun requestIgnoreBatteryOptimisation(context: Context): Boolean = runCatching {
        context.startActivity(
            Intent(
                Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:${context.packageName}"),
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        true
    }.getOrElse {
        runCatching {
            context.startActivity(
                Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }.isSuccess
    }
}
