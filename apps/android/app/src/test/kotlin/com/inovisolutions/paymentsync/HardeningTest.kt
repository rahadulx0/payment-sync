package com.inovisolutions.paymentsync

import com.google.common.truth.Truth.assertThat
import com.inovisolutions.paymentsync.data.remote.PinFailureHandler
import com.inovisolutions.paymentsync.data.remote.PinningConfig
import com.inovisolutions.paymentsync.reliability.OemGuidance
import com.inovisolutions.paymentsync.reliability.ReliabilityInputs
import com.inovisolutions.paymentsync.reliability.ReliabilityLevel
import com.inovisolutions.paymentsync.reliability.ReliabilityScore
import com.inovisolutions.paymentsync.update.ChecksumVerifier
import com.inovisolutions.paymentsync.update.LatestRelease
import com.inovisolutions.paymentsync.update.UpdateChecker
import com.inovisolutions.paymentsync.update.UpdateDecision
import org.junit.Test

class PinningConfigTest {

    @Test fun `a release build can never ship unpinned`() {
        val pinner = PinningConfig.pinnerFor("api.example.com", isDebug = false)
        assertThat(pinner).isNotNull()
        // Both the primary and the backup pin must be present — pinning a single
        // key means an outage the moment that key rotates.
        val pins = pinner!!.pins.map { it.hash.base64() }
        assertThat(pins).hasSize(2)
    }

    @Test fun `pinning is disabled only in debug`() {
        assertThat(PinningConfig.pinnerFor("api.example.com", isDebug = true)).isNull()
    }

    @Test fun `host extraction handles scheme, path and port`() {
        assertThat(PinningConfig.hostOf("https://api.example.com/api/v1/")).isEqualTo("api.example.com")
        assertThat(PinningConfig.hostOf("http://10.0.2.2:3000")).isEqualTo("10.0.2.2")
    }

    @Test fun `a pin failure is reported as interception, not a generic error`() {
        val error = javax.net.ssl.SSLPeerUnverifiedException("Certificate pinning failure!")
        assertThat(PinFailureHandler.isPinFailure(error)).isTrue()
        assertThat(PinFailureHandler.userMessage()).contains("intercepted")
        assertThat(PinFailureHandler.isPinFailure(java.io.IOException("timeout"))).isFalse()
    }
}

class UpdateCheckerTest {

    private fun release(code: Int, mandatory: Boolean = false, minSdk: Int = 26) = LatestRelease(
        versionCode = code,
        versionName = "1.$code.0",
        apkUrl = "https://dl.example.com/app.apk",
        sha256 = "abc",
        minAndroidSdk = minSdk,
        mandatory = mandatory,
    )

    @Test fun `a newer version code prompts an update`() {
        val d = UpdateChecker.decide(1, "1.0.0", 34, release(2), null)
        assertThat(d).isInstanceOf(UpdateDecision.Available::class.java)
    }

    @Test fun `the same or older version code is up to date`() {
        assertThat(UpdateChecker.decide(2, "1.2.0", 34, release(2), null)).isEqualTo(UpdateDecision.UpToDate)
        assertThat(UpdateChecker.decide(3, "1.3.0", 34, release(2), null)).isEqualTo(UpdateDecision.UpToDate)
    }

    @Test fun `a min-version breach blocks even without latest json`() {
        val d = UpdateChecker.decide(1, "1.0.0", 34, null, "2.0.0")
        assertThat(d).isInstanceOf(UpdateDecision.Blocked::class.java)
    }

    @Test fun `mandatory flag is carried through`() {
        val d = UpdateChecker.decide(1, "1.0.0", 34, release(5, mandatory = true), null)
        assertThat((d as UpdateDecision.Available).mandatory).isTrue()
    }

    @Test fun `an update needing a newer Android is not offered`() {
        val d = UpdateChecker.decide(1, "1.0.0", 26, release(2, minSdk = 33), null)
        assertThat(d).isInstanceOf(UpdateDecision.Unsupported::class.java)
    }
}

class ChecksumVerifierTest {

    @Test fun `sha256 matches the known vector`() {
        // echo -n "" | sha256sum
        assertThat(ChecksumVerifier.sha256(ByteArray(0)))
            .isEqualTo("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    }

    @Test fun `a corrupted download is rejected`() {
        val good = ChecksumVerifier.sha256("apk-bytes".toByteArray())
        val corrupted = ChecksumVerifier.sha256("apk-bytez".toByteArray())
        assertThat(ChecksumVerifier.matches(good, good)).isTrue()
        assertThat(ChecksumVerifier.matches(corrupted, good)).isFalse()
    }

    @Test fun `verification fails closed on a blank expectation`() {
        val actual = ChecksumVerifier.sha256("x".toByteArray())
        assertThat(ChecksumVerifier.matches(actual, "")).isFalse()
    }

    @Test fun `comparison is case-insensitive and tolerates a sha256 prefix`() {
        val actual = ChecksumVerifier.sha256("x".toByteArray())
        assertThat(ChecksumVerifier.matches(actual, actual.uppercase())).isTrue()
        assertThat(ChecksumVerifier.matches(actual, "sha256:$actual")).isTrue()
    }
}

class ReliabilityScoreTest {

    private val healthy = ReliabilityInputs(
        hasSmsPermission = true,
        ignoringBatteryOptimisation = true,
        autostartAcknowledged = true,
        foregroundServiceEnabled = false,
        heartbeatWithinLastHour = true,
        isAggressiveOem = false,
    )

    @Test fun `a healthy phone reads good`() {
        val report = ReliabilityScore.evaluate(healthy)
        assertThat(report.level).isEqualTo(ReliabilityLevel.GOOD)
        assertThat(report.unmet).isEmpty()
    }

    @Test fun `missing SMS permission alone is at risk`() {
        val report = ReliabilityScore.evaluate(healthy.copy(hasSmsPermission = false))
        assertThat(report.level).isEqualTo(ReliabilityLevel.AT_RISK)
    }

    @Test fun `one unmet item needs attention and names the exact fix`() {
        val report = ReliabilityScore.evaluate(healthy.copy(ignoringBatteryOptimisation = false))
        assertThat(report.level).isEqualTo(ReliabilityLevel.NEEDS_ATTENTION)
        assertThat(report.unmet.single().fix).isNotEmpty()
    }

    @Test fun `autostart is only asked about on aggressive OEMs`() {
        val stock = ReliabilityScore.evaluate(healthy.copy(isAggressiveOem = false, autostartAcknowledged = false))
        assertThat(stock.level).isEqualTo(ReliabilityLevel.GOOD)
        val xiaomi = ReliabilityScore.evaluate(healthy.copy(isAggressiveOem = true, autostartAcknowledged = false))
        assertThat(xiaomi.level).isEqualTo(ReliabilityLevel.NEEDS_ATTENTION)
    }
}

class OemGuidanceTest {

    @Test fun `the aggressive-OEM list covers this market's common brands`() {
        for (brand in listOf("Xiaomi", "REDMI", "oppo", "Realme", "vivo")) {
            assertThat(OemGuidance.isAggressiveOem(brand)).isTrue()
        }
        assertThat(OemGuidance.isAggressiveOem("Google")).isFalse()
    }

    @Test fun `a known OEM has an autostart target and an unknown one falls back`() {
        assertThat(OemGuidance.autostartTargetFor("Xiaomi")).isNotNull()
        assertThat(OemGuidance.autostartTargetFor("Oppo")).isNotNull()
        // Unknown → null, so the caller uses the generic app-settings fallback
        // instead of throwing on a ROM we have never seen.
        assertThat(OemGuidance.autostartTargetFor("SomeNewBrand")).isNull()
    }
}
