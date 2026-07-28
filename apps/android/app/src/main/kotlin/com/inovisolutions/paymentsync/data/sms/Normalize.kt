package com.inovisolutions.paymentsync.data.sms

import com.inovisolutions.paymentsync.domain.model.Money
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * Field normalizers mirroring `packages/parsers/src/normalize.ts` and
 * `packages/shared/src/time.ts` byte-for-byte (CLAUDE.md rule 9). The parser
 * parity test is the proof these agree with the server.
 */
object Normalize {

    private const val DHAKA_OFFSET_HOURS = 6L
    private const val TWO_DIGIT_YEAR_PIVOT = 70
    private val ISO_UTC: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'")

    private fun toAsciiDigits(input: String): String = buildString {
        for (ch in input) {
            val code = ch.code
            if (code in 0x09E6..0x09EF) append('0' + (code - 0x09E6)) else append(ch)
        }
    }

    /** Canonical body for hashing/matching: NFKC, collapsed whitespace, trimmed. Case preserved. */
    fun normalizeBody(raw: String): String =
        java.text.Normalizer.normalize(raw, java.text.Normalizer.Form.NFKC)
            .replace(Regex("\\s+"), " ")
            .trim()

    fun normalizeAmount(raw: String): String? = Money.fromDecimalStringOrNull(raw)?.toDisplayString()

    fun normalizeMsisdn(raw: String): String? {
        var d = toAsciiDigits(raw).replace(Regex("[^\\d+]"), "")
        d = d.removePrefix("+")
        if (d.startsWith("880")) d = d.substring(3)
        if (d.startsWith("0")) d = d.substring(1)
        return if (Regex("^1[3-9]\\d{8}$").matches(d)) "+880$d" else null
    }

    fun normalizeTrxId(raw: String): String? {
        val t = raw.trim().uppercase().replace(Regex("[^A-Z0-9]"), "")
        if (!Regex("^[A-Z0-9]{6,20}$").matches(t)) return null
        if (Regex("^\\d{1,5}$").matches(t)) return null
        return t
    }

    /** ISO-8601 UTC string (matching JS `Date.toISOString()`), or null if invalid / >24h ahead. */
    fun normalizeTimestamp(raw: String, formats: List<String>, nowMs: Long): String? {
        val input = toAsciiDigits(raw).trim()
        for (format in formats) {
            val groups = formatToRegex(format).matchEntire(input)?.groups ?: continue
            // A named group absent from the pattern throws on JVM regex (JS returns
            // undefined) — guard so optional tokens like `ss` are simply null.
            fun g(name: String): String? = runCatching { groups[name]?.value }.getOrNull()
            val year = g("yyyy")?.toInt() ?: pivotYear((g("yy") ?: "0").toInt())
            val month = (g("MM") ?: "0").toInt()
            val day = (g("dd") ?: "0").toInt()
            val hour = (g("HH") ?: "0").toInt()
            val minute = (g("mm") ?: "0").toInt()
            val second = (g("ss") ?: "0").toInt()
            if (month !in 1..12 || day !in 1..31 || hour > 23 || minute > 59 || second > 59) continue
            val utcMs = try {
                LocalDateTime.of(year, month, day, hour, minute, second)
                    .toInstant(ZoneOffset.ofHours(DHAKA_OFFSET_HOURS.toInt()))
                    .toEpochMilli()
            } catch (_: Exception) {
                continue
            }
            if (utcMs > nowMs + 24L * 60 * 60 * 1000) return null
            return ISO_UTC.withZone(ZoneOffset.UTC).format(java.time.Instant.ofEpochMilli(utcMs))
        }
        return null
    }

    private fun pivotYear(yy: Int): Int = if (yy < TWO_DIGIT_YEAR_PIVOT) 2000 + yy else 1900 + yy

    private val TOKEN = Regex("yyyy|yy|MM|dd|HH|mm|ss")
    private val TOKEN_PATTERNS = mapOf(
        "yyyy" to "(?<yyyy>\\d{4})",
        "yy" to "(?<yy>\\d{2})",
        "MM" to "(?<MM>\\d{2})",
        "dd" to "(?<dd>\\d{2})",
        "HH" to "(?<HH>\\d{2})",
        "mm" to "(?<mm>\\d{2})",
        "ss" to "(?<ss>\\d{2})",
    )

    private fun formatToRegex(format: String): Regex {
        val sb = StringBuilder("^")
        var last = 0
        for (m in TOKEN.findAll(format)) {
            sb.append(Regex.escape(format.substring(last, m.range.first)))
            sb.append(TOKEN_PATTERNS[m.value] ?: "")
            last = m.range.last + 1
        }
        sb.append(Regex.escape(format.substring(last)))
        sb.append("$")
        return Regex(sb.toString())
    }
}
