package com.inovisolutions.paymentsync.data.local

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [SmsMessageEntity::class, EventLogEntity::class, ConfigCacheEntity::class],
    version = 1,
    exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun smsMessageDao(): SmsMessageDao
    abstract fun eventLogDao(): EventLogDao
    abstract fun configDao(): ConfigDao
}
