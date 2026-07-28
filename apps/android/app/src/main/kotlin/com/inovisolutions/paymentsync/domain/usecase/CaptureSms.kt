package com.inovisolutions.paymentsync.domain.usecase

import com.inovisolutions.paymentsync.data.local.EventLogEntity
import com.inovisolutions.paymentsync.data.local.EventLogDao
import com.inovisolutions.paymentsync.data.local.SmsMessageDao
import com.inovisolutions.paymentsync.data.local.SmsMessageEntity
import com.inovisolutions.paymentsync.data.secure.CredentialStore
import com.inovisolutions.paymentsync.data.sms.MessageHash
import com.inovisolutions.paymentsync.data.sms.ParserEngine
import com.inovisolutions.paymentsync.data.sms.RuleRepository
import com.inovisolutions.paymentsync.domain.model.Money
import com.inovisolutions.paymentsync.domain.port.UploadScheduler
import java.util.UUID
import javax.inject.Inject

/**
 * The capture pipeline core (architecture §11.3, Task 13 §4.7). The allowlist
 * check happens in the receiver BEFORE this runs — nothing here executes for a
 * non-provider message. This does no network and is safe to run off the main
 * thread; it hashes, parses locally (advisory hint only — the server re-parse is
 * authoritative, ADR-5), stores durably, and schedules an upload.
 */
class CaptureSms @Inject constructor(
    private val smsDao: SmsMessageDao,
    private val eventDao: EventLogDao,
    private val parser: ParserEngine,
    private val rules: RuleRepository,
    private val credentials: CredentialStore,
    private val uploadScheduler: UploadScheduler,
) {
    suspend fun handle(address: String, body: String, smsTimestampMillis: Long, uploadSource: String = "REALTIME") {
        val companyCode = credentials.companyCode ?: return
        val now = System.currentTimeMillis()
        val hash = MessageHash.clientMsgHash(companyCode, address, body, smsTimestampMillis)

        val parsed = parser.parse(rules.currentRules(), address, body, now)
        val amountMinor = parsed.fields.amount?.let { Money.fromDecimalStringOrNull(it)?.paisa }

        val inserted = smsDao.insertIgnore(
            SmsMessageEntity(
                id = UUID.randomUUID().toString(),
                clientMsgHash = hash,
                address = address,
                body = body,
                smsTimestamp = smsTimestampMillis,
                receivedAt = now,
                provider = parsed.provider,
                parsedAmountMinor = amountMinor,
                parsedTrxId = parsed.fields.transactionId,
                parseStatus = parsed.status.name,
                syncStatus = "PENDING",
                uploadSource = uploadSource,
                createdAt = now,
            ),
        )
        if (inserted == -1L) return // duplicate — already captured

        eventDao.insert(EventLogEntity(type = "SMS_CAPTURED", at = now, detail = parsed.provider))
        eventDao.trim()
        uploadScheduler.scheduleUpload()
    }
}
