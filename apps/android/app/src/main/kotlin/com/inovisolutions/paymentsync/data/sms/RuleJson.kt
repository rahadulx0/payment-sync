package com.inovisolutions.paymentsync.data.sms

import kotlinx.serialization.json.Json

/**
 * The single Json instance for parser rules — `ignoreUnknownKeys = true` gives
 * forward compatibility: a newer server rule with fields this app version doesn't
 * know must parse without crashing (Task 13 §4.8).
 */
object RuleJson {
    val json: Json = Json { ignoreUnknownKeys = true }

    fun decodeRules(text: String): List<ProviderRule> = json.decodeFromString(text)
}
