package com.inovisolutions.paymentsync.data.sms

/**
 * THE privacy control (architecture §17.2, CLAUDE.md rule 8). A message from a
 * non-provider address is dropped before anything is stored or logged. Matching
 * is **exact** (case-insensitive), never `contains` — a spoofed sender like
 * "bKash-Promo" must NOT match. Fails **closed**: an unknown address is dropped.
 *
 * Numeric shortcodes and `+880`-prefixed variants some operators deliver are
 * normalised so a legitimate provider address still matches.
 */
class AddressAllowlist(allowed: Collection<String>) {

    private val normalized: Set<String> = allowed.map { normalize(it) }.toSet()

    fun matches(address: String): Boolean = normalize(address) in normalized

    private fun normalize(address: String): String {
        val trimmed = address.trim().lowercase()
        // Some operators deliver an alphanumeric sender (e.g. "bKash"); others a
        // numeric shortcode with an optional +880 prefix. Strip that prefix so
        // "+88016247" and "16247" match the same allowlisted entry.
        return if (trimmed.all { it.isDigit() || it == '+' }) {
            trimmed.removePrefix("+").removePrefix("880")
        } else {
            trimmed
        }
    }
}
