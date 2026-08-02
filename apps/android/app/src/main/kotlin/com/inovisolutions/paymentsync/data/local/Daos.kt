package com.inovisolutions.paymentsync.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface SmsMessageDao {
    /** Idempotent capture: a duplicate clientMsgHash is ignored (returns -1). */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertIgnore(message: SmsMessageEntity): Long

    @Query("SELECT * FROM sms_message WHERE syncStatus = 'PENDING' AND (nextAttemptAt IS NULL OR nextAttemptAt <= :now) ORDER BY smsTimestamp ASC LIMIT :limit")
    suspend fun dueForUpload(now: Long, limit: Int): List<SmsMessageEntity>

    @Query("SELECT * FROM sms_message ORDER BY smsTimestamp DESC LIMIT 1")
    suspend fun latest(): SmsMessageEntity?

    @Query("SELECT COUNT(*) FROM sms_message WHERE syncStatus = 'PENDING'")
    suspend fun pendingCount(): Int

    @Query("SELECT * FROM sms_message WHERE clientMsgHash = :hash LIMIT 1")
    suspend fun byHash(hash: String): SmsMessageEntity?

    /** Retention purge: only UPLOADED rows older than the window are removed. */
    @Query("DELETE FROM sms_message WHERE syncStatus = 'UPLOADED' AND createdAt < :cutoff")
    suspend fun purgeUploadedOlderThan(cutoff: Long): Int

    // ---- queue drainer (Task 14) -------------------------------------------

    /** Oldest-first claim: Task 08's matching semantics depend on upload ordering. */
    @Query(
        "SELECT * FROM sms_message WHERE syncStatus = 'PENDING' " +
            "AND (nextAttemptAt IS NULL OR nextAttemptAt <= :now) " +
            "ORDER BY smsTimestamp ASC LIMIT :limit",
    )
    suspend fun claimBatch(now: Long, limit: Int): List<SmsMessageEntity>

    @Query("UPDATE sms_message SET syncStatus = 'UPLOADING' WHERE clientMsgHash IN (:hashes)")
    suspend fun markUploading(hashes: List<String>)

    /** Settle one row from a batch result. */
    @Query(
        "UPDATE sms_message SET syncStatus = :status, attemptCount = :attempts, " +
            "nextAttemptAt = :nextAttemptAt, lastError = :lastError, " +
            "serverSmsLogId = :serverSmsLogId, serverMatchStatus = :serverMatchStatus " +
            "WHERE clientMsgHash = :hash",
    )
    suspend fun settle(
        hash: String,
        status: String,
        attempts: Int,
        nextAttemptAt: Long?,
        lastError: String?,
        serverSmsLogId: String?,
        serverMatchStatus: String?,
    )

    /** A killed worker's rows return to PENDING so nothing is ever stranded. */
    @Query(
        "UPDATE sms_message SET syncStatus = 'PENDING', nextAttemptAt = :now " +
            "WHERE syncStatus = 'UPLOADING' AND receivedAt < :staleBefore",
    )
    suspend fun reclaimStaleUploading(now: Long, staleBefore: Long): Int

    @Query("SELECT COUNT(*) FROM sms_message WHERE syncStatus = 'FAILED'")
    suspend fun failedCount(): Int

    @Query("SELECT COUNT(*) FROM sms_message WHERE syncStatus = 'UPLOADED'")
    suspend fun uploadedCount(): Int

    @Query("SELECT * FROM sms_message ORDER BY smsTimestamp DESC LIMIT :limit")
    suspend fun recent(limit: Int): List<SmsMessageEntity>

    /** Manual Sync / Reconcile: everything not yet safely on the server. */
    @Query("SELECT * FROM sms_message WHERE syncStatus IN ('PENDING','FAILED') ORDER BY smsTimestamp ASC LIMIT :limit")
    suspend fun notUploaded(limit: Int): List<SmsMessageEntity>

    @Query("UPDATE sms_message SET syncStatus = 'PENDING', nextAttemptAt = :now, attemptCount = 0 WHERE syncStatus = 'FAILED'")
    suspend fun requeueFailed(now: Long): Int
}

@Dao
interface EventLogDao {
    @Insert
    suspend fun insert(event: EventLogEntity)

    @Query("DELETE FROM event_log WHERE id NOT IN (SELECT id FROM event_log ORDER BY id DESC LIMIT 500)")
    suspend fun trim()

    @Query("SELECT COUNT(*) FROM event_log")
    suspend fun count(): Int
}

@Dao
interface ConfigDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun put(config: ConfigCacheEntity)

    @Query("SELECT * FROM config_cache ORDER BY configVersion DESC LIMIT 1")
    suspend fun latest(): ConfigCacheEntity?
}
