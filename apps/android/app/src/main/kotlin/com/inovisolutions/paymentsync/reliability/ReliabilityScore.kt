package com.inovisolutions.paymentsync.reliability

/** The inputs that decide whether this phone will actually keep capturing. */
data class ReliabilityInputs(
    val hasSmsPermission: Boolean,
    val ignoringBatteryOptimisation: Boolean,
    val autostartAcknowledged: Boolean,
    val foregroundServiceEnabled: Boolean,
    val heartbeatWithinLastHour: Boolean,
    val isAggressiveOem: Boolean,
)

enum class ReliabilityLevel { GOOD, NEEDS_ATTENTION, AT_RISK }

data class ReliabilityItem(val ok: Boolean, val problem: String, val fix: String)

data class ReliabilityReport(
    val level: ReliabilityLevel,
    val summary: String,
    val items: List<ReliabilityItem>,
) {
    val unmet: List<ReliabilityItem> get() = items.filter { !it.ok }
}

/**
 * Plain-language reliability readout for the Diagnostics screen (Task 15 §4.3.4).
 * Written so a merchant can read it to a support agent verbatim — every unmet
 * item names the exact fix, not a diagnosis.
 */
object ReliabilityScore {

    fun evaluate(inputs: ReliabilityInputs): ReliabilityReport {
        val items = buildList {
            add(
                ReliabilityItem(
                    ok = inputs.hasSmsPermission,
                    problem = "SMS permission is off — payments cannot be captured at all.",
                    fix = "Open Settings → Apps → payment-sync → Permissions → allow SMS.",
                ),
            )
            add(
                ReliabilityItem(
                    ok = inputs.ignoringBatteryOptimisation,
                    problem = "Battery optimisation is on — this phone may stop the app in the background.",
                    fix = "Tap 'Allow background activity' on the Dashboard warning.",
                ),
            )
            if (inputs.isAggressiveOem) {
                add(
                    ReliabilityItem(
                        ok = inputs.autostartAcknowledged,
                        problem = "Autostart is not confirmed — this brand closes apps aggressively.",
                        fix = "Tap 'Open autostart settings' on the Dashboard and enable payment-sync.",
                    ),
                )
            }
            add(
                ReliabilityItem(
                    ok = inputs.heartbeatWithinLastHour,
                    problem = "The app has not contacted the server in over an hour.",
                    fix = "Check the internet connection, then tap 'Sync now'.",
                ),
            )
        }

        // SMS permission missing is fatal to capture; treat it as AT_RISK on its own.
        val permissionMissing = !inputs.hasSmsPermission
        val unmetCount = items.count { !it.ok }
        val level = when {
            permissionMissing || unmetCount >= 2 -> ReliabilityLevel.AT_RISK
            unmetCount == 1 -> ReliabilityLevel.NEEDS_ATTENTION
            else -> ReliabilityLevel.GOOD
        }
        val summary = when (level) {
            ReliabilityLevel.GOOD -> "Reliability: good — this phone is set up to capture payments."
            ReliabilityLevel.NEEDS_ATTENTION -> "Reliability: needs attention — one setting should be fixed."
            ReliabilityLevel.AT_RISK -> "Reliability: at risk — payments may be missed until this is fixed."
        }
        return ReliabilityReport(level, summary, items)
    }
}
