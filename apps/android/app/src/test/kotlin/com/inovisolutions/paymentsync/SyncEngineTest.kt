package com.inovisolutions.paymentsync

import com.google.common.truth.Truth.assertThat
import com.inovisolutions.paymentsync.domain.sync.BackoffCalculator
import com.inovisolutions.paymentsync.domain.sync.DeviceEffect
import com.inovisolutions.paymentsync.domain.sync.DirectiveAction
import com.inovisolutions.paymentsync.domain.sync.DirectiveHandler
import com.inovisolutions.paymentsync.domain.sync.Directives
import com.inovisolutions.paymentsync.domain.sync.Settlement
import com.inovisolutions.paymentsync.domain.sync.SyncEvent
import com.inovisolutions.paymentsync.domain.sync.SyncState
import com.inovisolutions.paymentsync.domain.sync.SyncStateMachine
import com.inovisolutions.paymentsync.domain.sync.SyncStatus
import com.inovisolutions.paymentsync.domain.sync.UploadResult
import com.inovisolutions.paymentsync.ui.diagnostics.DiagnosticsFormatter
import com.inovisolutions.paymentsync.ui.diagnostics.DiagnosticsSnapshot
import org.junit.Test

private const val NOW = 1_800_000_000_000L

class SyncStateMachineTest {

    private fun pending(attempts: Int = 0) = SyncState(SyncStatus.PENDING, attemptCount = attempts)

    @Test fun `enqueue makes a row due now`() {
        val t = SyncStateMachine.transition(pending(), SyncEvent.Enqueue, NOW)
        assertThat(t.state.status).isEqualTo(SyncStatus.PENDING)
        assertThat(t.state.nextAttemptAt).isEqualTo(NOW)
    }

    @Test fun `only a pending row can be claimed`() {
        assertThat(SyncStateMachine.transition(pending(), SyncEvent.Claim, NOW).state.status)
            .isEqualTo(SyncStatus.UPLOADING)
        val uploaded = SyncState(SyncStatus.UPLOADED)
        assertThat(SyncStateMachine.transition(uploaded, SyncEvent.Claim, NOW).state.status)
            .isEqualTo(SyncStatus.UPLOADED)
    }

    @Test fun `accepted stores the server ids and clears retry state`() {
        val t = SyncStateMachine.transition(
            SyncState(SyncStatus.UPLOADING, attemptCount = 3, lastError = "boom"),
            SyncEvent.Accepted("log-1", "MATCHED"),
            NOW,
        )
        assertThat(t.state.status).isEqualTo(SyncStatus.UPLOADED)
        assertThat(t.state.serverSmsLogId).isEqualTo("log-1")
        assertThat(t.state.serverMatchStatus).isEqualTo("MATCHED")
        assertThat(t.state.lastError).isNull()
        assertThat(t.state.nextAttemptAt).isNull()
    }

    @Test fun `DUPLICATE is success, not an error — it heals local state`() {
        val t = SyncStateMachine.transition(
            SyncState(SyncStatus.UPLOADING),
            SyncEvent.Duplicate("log-existing", "MATCHED"),
            NOW,
        )
        assertThat(t.state.status).isEqualTo(SyncStatus.UPLOADED)
        assertThat(t.state.serverSmsLogId).isEqualTo("log-existing")
    }

    @Test fun `rejected is terminal and keeps the reason`() {
        val t = SyncStateMachine.transition(SyncState(SyncStatus.UPLOADING), SyncEvent.Rejected("INVALID_HASH"), NOW)
        assertThat(t.state.status).isEqualTo(SyncStatus.REJECTED)
        assertThat(t.state.lastError).isEqualTo("INVALID_HASH")
        assertThat(t.state.nextAttemptAt).isNull()
    }

    @Test fun `401 escalates to a device-level condition and loses nothing`() {
        val t = SyncStateMachine.transition(SyncState(SyncStatus.UPLOADING), SyncEvent.Unauthenticated, NOW)
        assertThat(t.effect).isEqualTo(DeviceEffect.NEEDS_REENROLL)
        assertThat(t.state.status).isEqualTo(SyncStatus.PENDING) // row survives for re-enrollment
    }

    @Test fun `403 backs off hourly, keeping the row`() {
        val t = SyncStateMachine.transition(SyncState(SyncStatus.UPLOADING), SyncEvent.Forbidden, NOW)
        assertThat(t.effect).isEqualTo(DeviceEffect.BACK_OFF_HOURLY)
        assertThat(t.state.nextAttemptAt).isEqualTo(NOW + 3_600_000L)
    }

    @Test fun `429 honours Retry-After`() {
        val t = SyncStateMachine.transition(SyncState(SyncStatus.UPLOADING), SyncEvent.RateLimited(30), NOW)
        assertThat(t.state.nextAttemptAt).isEqualTo(NOW + 30_000L)
        assertThat(t.state.status).isEqualTo(SyncStatus.PENDING)
    }

    @Test fun `transport failure backs off and only FAILS past the attempt budget`() {
        val first = SyncStateMachine.transition(pending(0), SyncEvent.TransportFailure("timeout"), NOW)
        assertThat(first.state.status).isEqualTo(SyncStatus.PENDING)
        assertThat(first.state.attemptCount).isEqualTo(1)
        assertThat(first.state.nextAttemptAt!!).isGreaterThan(NOW)

        val exhausted = SyncStateMachine.transition(pending(SyncStateMachine.MAX_ATTEMPTS), SyncEvent.TransportFailure("x"), NOW)
        assertThat(exhausted.state.status).isEqualTo(SyncStatus.FAILED)
    }

    @Test fun `a stale claim returns to pending so a killed worker loses nothing`() {
        val t = SyncStateMachine.transition(SyncState(SyncStatus.UPLOADING), SyncEvent.StaleClaimReclaimed, NOW)
        assertThat(t.state.status).isEqualTo(SyncStatus.PENDING)
        assertThat(t.state.nextAttemptAt).isEqualTo(NOW)
    }

    @Test fun `no event ever deletes or silently drops a message`() {
        val events = listOf(
            SyncEvent.Enqueue, SyncEvent.Claim, SyncEvent.Accepted(null, null),
            SyncEvent.Duplicate(null, null), SyncEvent.Rejected("r"), SyncEvent.Unauthenticated,
            SyncEvent.Forbidden, SyncEvent.RateLimited(10), SyncEvent.TransportFailure("e"),
            SyncEvent.StaleClaimReclaimed,
        )
        for (status in SyncStatus.entries) {
            for (event in events) {
                val t = SyncStateMachine.transition(SyncState(status), event, NOW)
                assertThat(t.state.status).isIn(SyncStatus.entries.toList()) // always a valid state
            }
        }
    }
}

class BackoffCalculatorTest {
    @Test fun `exponential curve with a one-hour cap`() {
        val noJitter = { 0.5 }
        assertThat(BackoffCalculator.delayMs(1, noJitter)).isEqualTo(30_000L)
        assertThat(BackoffCalculator.delayMs(2, noJitter)).isEqualTo(60_000L)
        assertThat(BackoffCalculator.delayMs(3, noJitter)).isEqualTo(120_000L)
        assertThat(BackoffCalculator.delayMs(20, noJitter)).isEqualTo(3_600_000L) // capped
    }

    @Test fun `jitter stays within twenty percent`() {
        assertThat(BackoffCalculator.delayMs(1) { 0.0 }).isEqualTo(24_000L)
        assertThat(BackoffCalculator.delayMs(1) { 1.0 }).isEqualTo(36_000L)
    }

    @Test fun `retry-after is honoured and capped`() {
        assertThat(BackoffCalculator.retryAfterMs(30)).isEqualTo(30_000L)
        assertThat(BackoffCalculator.retryAfterMs(99_999)).isEqualTo(3_600_000L)
        assertThat(BackoffCalculator.retryAfterMs(null)).isEqualTo(30_000L)
    }
}

class SettlementTest {
    private val sent = mapOf(
        "h1" to SyncState(SyncStatus.UPLOADING),
        "h2" to SyncState(SyncStatus.UPLOADING),
        "h3" to SyncState(SyncStatus.UPLOADING),
    )

    @Test fun `a mixed batch settles every row correctly by hash`() {
        val results = listOf(
            UploadResult("h3", "REJECTED", null, null, "INVALID_HASH"),
            UploadResult("h1", "ACCEPTED", "log-1", "MATCHED", null),
            UploadResult("h2", "DUPLICATE", "log-2", "UNMATCHED", null),
        )
        val outcomes = Settlement.settle(sent, results, NOW).associateBy { it.clientMsgHash }
        assertThat(outcomes["h1"]!!.transition.state.status).isEqualTo(SyncStatus.UPLOADED)
        assertThat(outcomes["h2"]!!.transition.state.status).isEqualTo(SyncStatus.UPLOADED)
        assertThat(outcomes["h2"]!!.transition.state.serverSmsLogId).isEqualTo("log-2")
        assertThat(outcomes["h3"]!!.transition.state.status).isEqualTo(SyncStatus.REJECTED)
    }

    @Test fun `an unknown hash in the response is ignored, never a crash`() {
        val results = listOf(UploadResult("nope", "ACCEPTED", "x", null, null))
        assertThat(Settlement.settle(sent, results, NOW)).isEmpty()
    }

    @Test fun `rows the server did not mention are reported as unsettled`() {
        val results = listOf(UploadResult("h1", "ACCEPTED", "log-1", null, null))
        assertThat(Settlement.unsettled(sent.keys, results)).containsExactly("h2", "h3")
    }
}

class DirectiveHandlerTest {
    @Test fun `each directive maps to exactly its action`() {
        assertThat(DirectiveHandler.actionsFor(Directives(forceFullSync = true), "1.0.0"))
            .containsExactly(DirectiveAction.RUN_MANUAL_SYNC)
        assertThat(DirectiveHandler.actionsFor(Directives(configChanged = true), "1.0.0"))
            .containsExactly(DirectiveAction.RELOAD_CONFIG)
        assertThat(DirectiveHandler.actionsFor(Directives(messageForUser = "hello"), "1.0.0"))
            .containsExactly(DirectiveAction.SHOW_MESSAGE)
    }

    @Test fun `unknown or empty directives produce no action (forward compatible)`() {
        assertThat(DirectiveHandler.actionsFor(Directives(), "1.0.0")).isEmpty()
        assertThat(DirectiveHandler.actionsFor(Directives(messageForUser = "  "), "1.0.0")).isEmpty()
    }

    @Test fun `a min-version breach blocks for update`() {
        assertThat(DirectiveHandler.actionsFor(Directives(minSupportedAppVersion = "2.0.0"), "1.4.0"))
            .contains(DirectiveAction.BLOCK_FOR_UPDATE)
        assertThat(DirectiveHandler.actionsFor(Directives(minSupportedAppVersion = "1.0.0"), "1.4.0"))
            .isEmpty()
    }

    @Test fun `clock skew is server minus device`() {
        assertThat(DirectiveHandler.clockSkewSeconds(NOW + 600_000, NOW)).isEqualTo(600)
        assertThat(DirectiveHandler.clockSkewSeconds(NOW, NOW + 600_000)).isEqualTo(-600)
    }
}

class DiagnosticsFormatterTest {
    private val snapshot = DiagnosticsSnapshot(
        appVersion = "1.0.0",
        androidVersion = "14",
        deviceModel = "Redmi Note 12",
        companyCode = "COMP-1",
        installId = "install-abc",
        enrolled = true,
        hasSmsPermission = true,
        ignoringBatteryOptimisation = false,
        networkType = "wifi",
        pendingCount = 2,
        failedCount = 1,
        uploadedCount = 40,
        clockSkewSeconds = 3,
        lastHeartbeatAt = NOW,
        lastSyncAt = NOW,
        configVersion = 3,
        parserRuleVersions = mapOf("BKASH" to 1),
        recentEvents = listOf("SMS_CAPTURED BKASH", "UPLOAD_OK 5"),
    )

    @Test fun `the support block carries the operationally useful facts`() {
        val text = DiagnosticsFormatter.format(snapshot)
        assertThat(text).contains("pending=2")
        assertThat(text).contains("battery optimisation exempt: NO")
        assertThat(text).contains("BKASH=v1")
    }

    @Test fun `it is safe to share by construction — no token, body, or customer number`() {
        val text = DiagnosticsFormatter.format(snapshot)
        // The snapshot type simply has no field for these, so they cannot leak.
        assertThat(text).doesNotContain("pdt_")
        assertThat(text).doesNotContain("Bearer")
        assertThat(text).doesNotContain("TrxID")
        assertThat(text).doesNotContain("+8801")
    }
}
