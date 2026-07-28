package com.inovisolutions.paymentsync.data.remote.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Wire DTOs mirroring the frozen device API (`docs/openapi.yaml`). Amounts are
 * STRINGS and timestamps ISO-8601 with offset — never floats/instants on the wire
 * (CLAUDE.md rule 1, ADR-5). The device sends `raw_message` + an advisory
 * `parsed_hint`; the server re-parse is authoritative.
 */
@Serializable
data class EnrollRequest(
    @SerialName("company_code") val companyCode: String,
    @SerialName("enroll_key") val enrollKey: String,
    @SerialName("install_id") val installId: String,
    val model: String? = null,
    val manufacturer: String? = null,
    @SerialName("android_version") val androidVersion: String? = null,
    @SerialName("app_version") val appVersion: String? = null,
    @SerialName("device_name") val deviceName: String? = null,
    @SerialName("wallet_msisdn") val walletMsisdn: String? = null,
)

@Serializable
data class EnrollResponse(
    @SerialName("device_token") val deviceToken: String,
    @SerialName("device_id") val deviceId: String? = null,
    val config: DeviceConfig? = null,
)

@Serializable
data class DeviceConfig(
    @SerialName("config_version") val configVersion: Int = 0,
    val providers: List<String> = emptyList(),
    @SerialName("parser_rules") val parserRules: kotlinx.serialization.json.JsonElement? = null,
)

@Serializable
data class ParsedHint(
    @SerialName("transaction_id") val transactionId: String? = null,
    val amount: String? = null,
)

@Serializable
data class UploadMessage(
    @SerialName("client_msg_hash") val clientMsgHash: String,
    @SerialName("sms_address") val smsAddress: String,
    @SerialName("raw_message") val rawMessage: String,
    @SerialName("device_received_at") val deviceReceivedAt: String,
    @SerialName("parsed_hint") val parsedHint: ParsedHint? = null,
)

@Serializable
data class UploadRequest(
    @SerialName("upload_source") val uploadSource: String,
    val messages: List<UploadMessage>,
)

@Serializable
data class UploadResultItem(
    @SerialName("client_msg_hash") val clientMsgHash: String,
    val status: String,
    @SerialName("sms_log_id") val smsLogId: String? = null,
    @SerialName("parse_status") val parseStatus: String? = null,
    @SerialName("match_status") val matchStatus: String? = null,
)

@Serializable
data class UploadResponse(
    val results: List<UploadResultItem> = emptyList(),
)

@Serializable
data class ErrorEnvelope(val error: ErrorBody? = null)

@Serializable
data class ErrorBody(
    val code: String? = null,
    val message: String? = null,
    @SerialName("request_id") val requestId: String? = null,
)
