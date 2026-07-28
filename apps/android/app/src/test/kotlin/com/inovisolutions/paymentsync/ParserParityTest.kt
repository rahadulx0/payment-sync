package com.inovisolutions.paymentsync

import com.google.common.truth.Truth.assertThat
import com.inovisolutions.paymentsync.data.sms.ParserEngine
import com.inovisolutions.paymentsync.data.sms.RuleJson
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.time.Instant
import org.junit.Test

/**
 * The parser-parity gate (Task 13 §6, release blocker). Iterates the fixtures
 * exported from `packages/parsers` and asserts the Kotlin `ParserEngine` produces
 * the SAME whole result as the server's reference parser for every case,
 * including debit / promotional / adversarial ones. If this fails, the app and
 * the server disagree on what a message means — do not ship.
 */
class ParserParityTest {

    @Serializable
    private data class FixtureFields(
        val amount: String? = null,
        val transactionId: String? = null,
        val senderMsisdn: String? = null,
        val balanceAfter: String? = null,
        val fee: String? = null,
        val timestamp: String? = null,
    )

    @Serializable
    private data class Expected(
        val status: String,
        val provider: String,
        val messageType: String? = null,
        val direction: String? = null,
        val fields: FixtureFields = FixtureFields(),
        val confidence: Double = 0.0,
        val ruleVersion: Int? = null,
        val ignoredReason: String? = null,
        val unmatchedPatterns: List<String> = emptyList(),
    )

    @Serializable
    private data class Fixture(
        val id: String,
        val address: String,
        val body: String,
        val now: String,
        val expected: Expected,
    )

    private fun resource(name: String): String =
        requireNotNull(javaClass.getResource(name)) { "missing test resource $name" }.readText()

    @Test
    fun `kotlin parser matches every exported fixture`() {
        val rules = RuleJson.decodeRules(resource("/parser-rules-bundled.json"))
        val fixtures: List<Fixture> =
            Json { ignoreUnknownKeys = true }.decodeFromString(resource("/parser-fixtures.json"))
        assertThat(fixtures).isNotEmpty()

        val engine = ParserEngine()
        for (fx in fixtures) {
            val nowMs = Instant.parse(fx.now).toEpochMilli()
            val result = engine.parse(rules, fx.address, fx.body, nowMs)
            val e = fx.expected

            assertThat("${fx.id}:status" to result.status.name).isEqualTo("${fx.id}:status" to e.status)
            assertThat("${fx.id}:provider" to result.provider).isEqualTo("${fx.id}:provider" to e.provider)
            assertThat("${fx.id}:messageType" to result.messageType).isEqualTo("${fx.id}:messageType" to e.messageType)
            assertThat("${fx.id}:direction" to result.direction?.name).isEqualTo("${fx.id}:direction" to e.direction)
            assertThat("${fx.id}:amount" to result.fields.amount).isEqualTo("${fx.id}:amount" to e.fields.amount)
            assertThat("${fx.id}:trxId" to result.fields.transactionId).isEqualTo("${fx.id}:trxId" to e.fields.transactionId)
            assertThat("${fx.id}:sender" to result.fields.senderMsisdn).isEqualTo("${fx.id}:sender" to e.fields.senderMsisdn)
            assertThat("${fx.id}:balance" to result.fields.balanceAfter).isEqualTo("${fx.id}:balance" to e.fields.balanceAfter)
            assertThat("${fx.id}:fee" to result.fields.fee).isEqualTo("${fx.id}:fee" to e.fields.fee)
            assertThat("${fx.id}:timestamp" to result.fields.timestamp).isEqualTo("${fx.id}:timestamp" to e.fields.timestamp)
            assertThat("${fx.id}:confidence" to result.confidence).isEqualTo("${fx.id}:confidence" to e.confidence)
            assertThat("${fx.id}:ruleVersion" to result.ruleVersion).isEqualTo("${fx.id}:ruleVersion" to e.ruleVersion)
            assertThat("${fx.id}:ignoredReason" to result.ignoredReason).isEqualTo("${fx.id}:ignoredReason" to e.ignoredReason)
            assertThat("${fx.id}:unmatched" to result.unmatchedPatterns).isEqualTo("${fx.id}:unmatched" to e.unmatchedPatterns)
        }
    }
}
