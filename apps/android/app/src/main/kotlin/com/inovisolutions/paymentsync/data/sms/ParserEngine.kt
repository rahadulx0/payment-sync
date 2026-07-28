package com.inovisolutions.paymentsync.data.sms

import com.inovisolutions.paymentsync.domain.model.Direction
import com.inovisolutions.paymentsync.domain.model.ParseResult
import com.inovisolutions.paymentsync.domain.model.ParseStatus
import com.inovisolutions.paymentsync.domain.model.ParsedFields
import kotlin.math.max
import kotlin.math.round

/**
 * The Kotlin parser, provably equivalent to the server's reference parser
 * (`packages/parsers/src/parse.ts`). Same evaluation order, same
 * must_contain/must_not_contain, same DEBIT→IGNORED handling (so the app never
 * shows "payment received" for a Cash Out), same normalisation. The parity test
 * against the exported fixtures is a release blocker.
 *
 * The server re-parse is authoritative (ADR-5); this result is only a local
 * `parsed_hint` and instant merchant feedback.
 */
class ParserEngine {

    private val fieldByPattern = mapOf(
        "amount" to "amount",
        "transaction_id" to "transactionId",
        "sender_msisdn" to "senderMsisdn",
        "balance_after" to "balanceAfter",
        "fee" to "fee",
        "timestamp" to "timestamp",
    )

    fun parse(rules: List<ProviderRule>, smsAddress: String, body: String, nowMs: Long): ParseResult {
        val provider = resolveProvider(rules, smsAddress)
        val rule = rules.firstOrNull { it.provider == provider }
            ?: return ParseResult(status = ParseStatus.UNPARSED, provider = provider)

        val normBody = Normalize.normalizeBody(body)

        for (mt in rule.messageTypes) {
            if (!mt.mustContain.all { normBody.contains(it) }) continue
            if (mt.mustNotContain.any { normBody.contains(it) }) continue

            val direction = parseDirection(mt.direction)
            if (direction != Direction.CREDIT) {
                return ParseResult(
                    status = ParseStatus.IGNORED,
                    provider = provider,
                    messageType = mt.type,
                    direction = direction,
                    ruleVersion = rule.version,
                    ignoredReason = if (direction == Direction.DEBIT) "DEBIT_MESSAGE" else "INFO_MESSAGE",
                )
            }
            return extract(rule, mt, provider, normBody, nowMs)
        }
        return ParseResult(status = ParseStatus.UNPARSED, provider = provider, ruleVersion = rule.version)
    }

    private fun resolveProvider(rules: List<ProviderRule>, smsAddress: String): String {
        val addr = smsAddress.trim().lowercase()
        for (rule in rules) {
            if (rule.senderAddresses.any { it.lowercase() == addr }) return rule.provider
        }
        return "UNKNOWN"
    }

    private fun extract(rule: ProviderRule, mt: MessageTypeRule, provider: String, body: String, nowMs: Long): ParseResult {
        val raw = mutableMapOf<String, String>()
        val unmatched = mutableListOf<String>()

        for ((key, pattern) in mt.patterns) {
            val extracted = extractValue(body, pattern, key)
            if (extracted == null) {
                unmatched.add(key)
                continue
            }
            val value = normalizeField(key, extracted, mt.timestampFormats, nowMs)
            val field = fieldByPattern[key]
            if (value == null || field == null) {
                unmatched.add(key)
                continue
            }
            raw[field] = value
        }

        val missingRequired = mt.required.filter { k ->
            val field = fieldByPattern[k]
            field == null || raw[field] == null
        }
        val status = if (missingRequired.isNotEmpty()) ParseStatus.PARTIAL else ParseStatus.PARSED
        val optionalPatternCount = mt.patterns.size - mt.required.size
        val unmatchedOptional = unmatched.count { it !in mt.required }
        val confidence = if (status == ParseStatus.PARTIAL) 0.4
        else round2(max(0.5, 1.0 - 0.15 * minOf(unmatchedOptional, optionalPatternCount)))

        return ParseResult(
            status = status,
            provider = provider,
            messageType = mt.type,
            direction = Direction.CREDIT,
            fields = ParsedFields(
                amount = raw["amount"],
                transactionId = raw["transactionId"],
                senderMsisdn = raw["senderMsisdn"],
                balanceAfter = raw["balanceAfter"],
                fee = raw["fee"],
                timestamp = raw["timestamp"],
            ),
            confidence = confidence,
            ruleVersion = rule.version,
            unmatchedPatterns = unmatched,
        )
    }

    private fun extractValue(body: String, pattern: String, key: String): String? {
        val m = Regex(pattern).find(body) ?: return null
        return runCatching { m.groups[key]?.value }.getOrNull() ?: m.groupValues.getOrNull(1)
    }

    private fun normalizeField(key: String, raw: String, formats: List<String>, nowMs: Long): String? = when (key) {
        "amount", "balance_after", "fee" -> Normalize.normalizeAmount(raw)
        "sender_msisdn" -> Normalize.normalizeMsisdn(raw)
        "transaction_id" -> Normalize.normalizeTrxId(raw)
        "timestamp" -> Normalize.normalizeTimestamp(raw, formats, nowMs)
        else -> null
    }

    private fun parseDirection(d: String): Direction = when (d) {
        "CREDIT" -> Direction.CREDIT
        "DEBIT" -> Direction.DEBIT
        else -> Direction.INFO
    }

    private fun round2(n: Double): Double = round(n * 100) / 100
}
