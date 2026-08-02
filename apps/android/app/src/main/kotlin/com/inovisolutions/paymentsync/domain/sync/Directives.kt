package com.inovisolutions.paymentsync.domain.sync

/** Server directives from the heartbeat response (architecture §7.2). */
data class Directives(
    val forceFullSync: Boolean = false,
    val rotateToken: Boolean = false,
    val configChanged: Boolean = false,
    val messageForUser: String? = null,
    val pauseUploads: Boolean = false,
    val requestedHeartbeatIntervalSec: Long? = null,
    val minSupportedAppVersion: String? = null,
)

/** What the app must do in response. One action per directive, nothing implicit. */
enum class DirectiveAction {
    RUN_MANUAL_SYNC,
    ROTATE_TOKEN,
    RELOAD_CONFIG,
    SHOW_MESSAGE,
    PAUSE_UPLOADS,
    RESCHEDULE_HEARTBEAT,
    BLOCK_FOR_UPDATE,
}

/**
 * Pure directive → action mapping (Task 14 §4.5). Unknown directives simply
 * produce no action — forward compatibility means a newer server must never
 * break an older app.
 */
object DirectiveHandler {

    fun actionsFor(directives: Directives, currentAppVersion: String): Set<DirectiveAction> {
        val actions = mutableSetOf<DirectiveAction>()
        if (directives.forceFullSync) actions.add(DirectiveAction.RUN_MANUAL_SYNC)
        if (directives.rotateToken) actions.add(DirectiveAction.ROTATE_TOKEN)
        if (directives.configChanged) actions.add(DirectiveAction.RELOAD_CONFIG)
        if (!directives.messageForUser.isNullOrBlank()) actions.add(DirectiveAction.SHOW_MESSAGE)
        if (directives.pauseUploads) actions.add(DirectiveAction.PAUSE_UPLOADS)
        if (directives.requestedHeartbeatIntervalSec != null) actions.add(DirectiveAction.RESCHEDULE_HEARTBEAT)
        if (directives.minSupportedAppVersion != null &&
            isOlder(currentAppVersion, directives.minSupportedAppVersion)
        ) {
            actions.add(DirectiveAction.BLOCK_FOR_UPDATE)
        }
        return actions
    }

    /** Semver-ish compare over dot-separated numeric parts; unparseable parts count as 0. */
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

    /** server_now − device_now, in seconds. Positive ⇒ the device clock is behind. */
    fun clockSkewSeconds(serverNowMs: Long, deviceNowMs: Long): Long =
        Math.round((serverNowMs - deviceNowMs) / 1000.0)
}
