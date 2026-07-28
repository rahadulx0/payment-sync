package com.inovisolutions.paymentsync.data.sms

/**
 * Reassembles a multipart (concatenated) SMS into one body. Provider payment
 * messages occasionally exceed one segment; the parts must be joined in order so
 * they hash and parse as a single message (Task 13 §6). Order-independent input:
 * parts are sorted by their sequence index before joining.
 */
object PduAssembler {

    data class Part(val index: Int, val text: String)

    /** Join parts in sequence order into a single body. */
    fun assemble(parts: List<Part>): String =
        parts.sortedBy { it.index }.joinToString(separator = "") { it.text }
}
