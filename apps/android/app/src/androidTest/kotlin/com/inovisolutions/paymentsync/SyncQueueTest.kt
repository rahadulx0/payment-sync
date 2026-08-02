package com.inovisolutions.paymentsync

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.common.truth.Truth.assertThat
import com.inovisolutions.paymentsync.data.local.AppDatabase
import com.inovisolutions.paymentsync.data.local.SmsMessageDao
import com.inovisolutions.paymentsync.data.local.SmsMessageEntity
import com.inovisolutions.paymentsync.domain.sync.SyncStateMachine
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

/**
 * Queue-behaviour tests against a real Room database (instrumented — run on an
 * emulator by the `android.yml` CI job). These cover the durability guarantees
 * that make the platform survive real phones: nothing is ever dropped, a killed
 * worker's rows come back, and retention never eats an unsent message.
 */
@RunWith(AndroidJUnit4::class)
class SyncQueueTest {

    private lateinit var db: AppDatabase
    private lateinit var dao: SmsMessageDao

    @Before fun setUp() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        dao = db.smsMessageDao()
    }

    @After fun tearDown() = db.close()

    private fun row(
        hash: String = UUID.randomUUID().toString(),
        status: String = "PENDING",
        smsTimestamp: Long = System.currentTimeMillis(),
        createdAt: Long = System.currentTimeMillis(),
        receivedAt: Long = System.currentTimeMillis(),
    ) = SmsMessageEntity(
        id = UUID.randomUUID().toString(),
        clientMsgHash = hash,
        address = "bKash",
        body = "Cash In Tk 100 TrxID ABC123XYZ",
        smsTimestamp = smsTimestamp,
        receivedAt = receivedAt,
        provider = "BKASH",
        parsedAmountMinor = 10000,
        parsedTrxId = "ABC123XYZ",
        parseStatus = "PARSED",
        syncStatus = status,
        uploadSource = "REALTIME",
        createdAt = createdAt,
    )

    @Test fun duplicateCaptureIsIgnored() = runBlocking {
        val hash = "same-hash"
        assertThat(dao.insertIgnore(row(hash = hash))).isNotEqualTo(-1L)
        assertThat(dao.insertIgnore(row(hash = hash))).isEqualTo(-1L) // one row, not two
        assertThat(dao.pendingCount()).isEqualTo(1)
    }

    @Test fun claimReturnsOldestFirst() = runBlocking {
        val now = System.currentTimeMillis()
        dao.insertIgnore(row(hash = "new", smsTimestamp = now))
        dao.insertIgnore(row(hash = "old", smsTimestamp = now - 60_000))
        val batch = dao.claimBatch(now, 10)
        // Task 08's matching semantics depend on oldest-first upload ordering.
        assertThat(batch.first().clientMsgHash).isEqualTo("old")
    }

    @Test fun staleUploadingRowsAreReclaimed() = runBlocking {
        val old = System.currentTimeMillis() - SyncStateMachine.STALE_CLAIM_TIMEOUT_MS - 1000
        dao.insertIgnore(row(hash = "stuck", status = "UPLOADING", receivedAt = old))
        assertThat(dao.pendingCount()).isEqualTo(0)

        val now = System.currentTimeMillis()
        dao.reclaimStaleUploading(now, now - SyncStateMachine.STALE_CLAIM_TIMEOUT_MS)
        assertThat(dao.pendingCount()).isEqualTo(1) // a killed worker loses nothing
    }

    @Test fun retentionNeverDeletesUnsentMessages() = runBlocking {
        val ancient = System.currentTimeMillis() - 90L * 24 * 60 * 60 * 1000
        dao.insertIgnore(row(hash = "old-pending", status = "PENDING", createdAt = ancient))
        dao.insertIgnore(row(hash = "old-failed", status = "FAILED", createdAt = ancient))
        dao.insertIgnore(row(hash = "old-uploaded", status = "UPLOADED", createdAt = ancient))

        val deleted = dao.purgeUploadedOlderThan(System.currentTimeMillis() - 30L * 24 * 60 * 60 * 1000)
        assertThat(deleted).isEqualTo(1) // only the UPLOADED one
        assertThat(dao.pendingCount()).isEqualTo(1)
        assertThat(dao.failedCount()).isEqualTo(1)
    }

    @Test fun failedRowsAreRequeuedByManualSync() = runBlocking {
        dao.insertIgnore(row(hash = "failed", status = "FAILED"))
        assertThat(dao.failedCount()).isEqualTo(1)
        dao.requeueFailed(System.currentTimeMillis())
        assertThat(dao.failedCount()).isEqualTo(0)
        assertThat(dao.pendingCount()).isEqualTo(1) // recoverable, never dropped
    }

    @Test fun settleStoresServerIdsAndStatus() = runBlocking {
        dao.insertIgnore(row(hash = "h1"))
        dao.settle("h1", "UPLOADED", 0, null, null, "log-123", "MATCHED")
        val stored = dao.byHash("h1")
        assertThat(stored?.syncStatus).isEqualTo("UPLOADED")
        assertThat(stored?.serverSmsLogId).isEqualTo("log-123")
        assertThat(stored?.serverMatchStatus).isEqualTo("MATCHED")
    }
}
