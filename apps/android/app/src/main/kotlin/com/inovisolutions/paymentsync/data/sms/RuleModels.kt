package com.inovisolutions.paymentsync.data.sms

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The parser rule format (architecture §8.2), mirroring `packages/parsers` and
 * consumed from the SAME rule JSON the server serves via /device/config. Unknown
 * fields are ignored (forward compatibility — a newer server rule must never
 * crash an older app), configured on the `Json` instance in ParserEngine.
 */
@Serializable
data class MessageTypeRule(
    val type: String,
    val direction: String,
    @SerialName("must_contain") val mustContain: List<String> = emptyList(),
    @SerialName("must_not_contain") val mustNotContain: List<String> = emptyList(),
    val patterns: Map<String, String> = emptyMap(),
    @SerialName("timestamp_formats") val timestampFormats: List<String> = emptyList(),
    val required: List<String> = emptyList(),
)

@Serializable
data class ProviderRule(
    val provider: String,
    val version: Int,
    @SerialName("sender_addresses") val senderAddresses: List<String>,
    @SerialName("message_types") val messageTypes: List<MessageTypeRule>,
)
