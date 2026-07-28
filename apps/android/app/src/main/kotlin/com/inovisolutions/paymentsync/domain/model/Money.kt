package com.inovisolutions.paymentsync.domain.model

/**
 * Money as integer paisa (1 BDT = 100 paisa), mirroring `packages/shared/money.ts`
 * (CLAUDE.md rule 1). NEVER `Double` anywhere near an amount. Parses decimal
 * strings (tolerating thousands separators, `Tk`/`BDT`/`৳`, Bengali digits) and
 * renders back to a two-decimal string on the wire.
 */
@JvmInline
value class Money private constructor(val paisa: Long) {

    fun toDisplayString(): String {
        val negative = paisa < 0
        val abs = if (negative) -paisa else paisa
        val int = abs / 100
        val frac = abs % 100
        return buildString {
            if (negative) append('-')
            append(int)
            append('.')
            if (frac < 10) append('0')
            append(frac)
        }
    }

    companion object {
        private const val PAISA_PER_TAKA = 100L
        private const val MAX_ABS_PAISA = 99_999_999_999_999L

        fun fromPaisa(paisa: Long): Money {
            require(paisa in -MAX_ABS_PAISA..MAX_ABS_PAISA) { "amount out of range for NUMERIC(14,2)" }
            return Money(paisa)
        }

        fun zero(): Money = Money(0)

        /** Bengali numerals (০–৯, U+09E6..U+09EF) → ASCII; everything else untouched. */
        private fun toAsciiDigits(input: String): String = buildString {
            for (ch in input) {
                val code = ch.code
                if (code in 0x09E6..0x09EF) append('0' + (code - 0x09E6)) else append(ch)
            }
        }

        private val VALID = Regex("^\\d+(\\.\\d{1,2})?$")

        /** Throws on any ambiguity — `1.005` is an error, never silently rounded. */
        fun fromDecimalString(input: String): Money {
            val normalized = toAsciiDigits(input).trim()
            require(normalized.isNotEmpty()) { "empty amount" }
            val cleaned = normalized
                .replace(Regex("^(?i)(tk\\.?|bdt|৳)\\s*"), "")
                .replace(Regex("\\s*(?i)(tk|bdt|৳)$"), "")
                .replace(Regex("[\\s,]"), "")
            require(VALID.matches(cleaned)) { "not a valid non-negative amount: $input" }
            val dot = cleaned.indexOf('.')
            val intPart = if (dot == -1) cleaned else cleaned.substring(0, dot)
            val fracRaw = if (dot == -1) "" else cleaned.substring(dot + 1)
            val fracPart = (fracRaw + "00").substring(0, 2)
            return fromPaisa(intPart.toLong() * PAISA_PER_TAKA + fracPart.toLong())
        }

        /** Lenient parse used by the local parser hint — returns null instead of throwing. */
        fun fromDecimalStringOrNull(input: String): Money? =
            runCatching { fromDecimalString(input) }.getOrNull()
    }
}
