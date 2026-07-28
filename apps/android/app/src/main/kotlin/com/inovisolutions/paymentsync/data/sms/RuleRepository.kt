package com.inovisolutions.paymentsync.data.sms

import android.content.Context
import com.inovisolutions.paymentsync.data.local.ConfigDao
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Holds the active parser rules + provider address allowlist. Prefers the cached
 * `/device/config` rules; falls back to the APK-bundled `parser-rules-bundled.json`
 * (kept byte-identical to `packages/parsers` by the export step). The allowlist
 * derived here is THE privacy control.
 */
@Singleton
class RuleRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val configDao: ConfigDao,
) {
    @Volatile private var rules: List<ProviderRule> = emptyList()
    @Volatile private var allowlist: AddressAllowlist = AddressAllowlist(emptyList())

    suspend fun load() {
        val cached = configDao.latest()?.json
        val text = cached ?: bundled()
        rules = runCatching { RuleJson.decodeRules(text) }.getOrDefault(emptyList())
        allowlist = AddressAllowlist(rules.flatMap { it.senderAddresses })
    }

    fun currentRules(): List<ProviderRule> = rules
    fun currentAllowlist(): AddressAllowlist = allowlist

    private fun bundled(): String =
        context.assets.open("parser-rules-bundled.json").bufferedReader().use { it.readText() }
}
