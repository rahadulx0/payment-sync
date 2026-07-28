package com.inovisolutions.paymentsync.domain.model

enum class Direction { CREDIT, DEBIT, INFO }

enum class ParseStatus { PARSED, PARTIAL, UNPARSED, IGNORED }

/** Extracted fields — amounts kept as normalised decimal strings for wire/hint parity. */
data class ParsedFields(
    val amount: String? = null,
    val transactionId: String? = null,
    val senderMsisdn: String? = null,
    val balanceAfter: String? = null,
    val fee: String? = null,
    val timestamp: String? = null,
)

/**
 * The whole-result shape asserted against `parser-fixtures.json` for parity with
 * the server (a mismatch is a release blocker). Field order/naming mirrors
 * `packages/parsers` ParseResult.
 */
data class ParseResult(
    val status: ParseStatus,
    val provider: String,
    val messageType: String? = null,
    val direction: Direction? = null,
    val fields: ParsedFields = ParsedFields(),
    val confidence: Double = 0.0,
    val ruleVersion: Int? = null,
    val ignoredReason: String? = null,
    val unmatchedPatterns: List<String> = emptyList(),
)
