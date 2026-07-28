package com.inovisolutions.paymentsync.data.local

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Room schema (architecture §11.2). Money is `Long` paisa (`parsedAmountMinor`) —
 * never `Double`. The unique index on `clientMsgHash` makes re-capture idempotent
 * (ignore-on-conflict). Sync/parse states drive the Task 14 upload engine.
 */
@Entity(
    tableName = "sms_message",
    indices = [
        Index(value = ["clientMsgHash"], unique = true),
        Index(value = ["syncStatus", "nextAttemptAt"]),
        Index(value = ["smsTimestamp"]),
        Index(value = ["serverMatchStatus"]),
    ],
)
data class SmsMessageEntity(
    @PrimaryKey val id: String,
    val clientMsgHash: String,
    val address: String,
    val body: String,
    val smsTimestamp: Long?,
    val receivedAt: Long,
    val provider: String,
    val parsedAmountMinor: Long?,
    val parsedTrxId: String?,
    val parseStatus: String,
    val syncStatus: String,
    val attemptCount: Int = 0,
    val lastError: String? = null,
    val nextAttemptAt: Long? = null,
    val serverSmsLogId: String? = null,
    val serverMatchStatus: String? = null,
    val uploadSource: String,
    val createdAt: Long,
)

/** Ring-buffer diagnostics log, capped at 500 rows (trimmed by the DAO). */
@Entity(tableName = "event_log")
data class EventLogEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val type: String,
    val at: Long,
    val detail: String?,
    val synced: Boolean = false,
)

@Entity(tableName = "config_cache")
data class ConfigCacheEntity(
    @PrimaryKey val configVersion: Int,
    val json: String,
    val fetchedAt: Long,
)
