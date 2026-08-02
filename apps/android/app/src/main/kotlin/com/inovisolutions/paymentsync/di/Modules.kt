package com.inovisolutions.paymentsync.di

import android.content.Context
import androidx.room.Room
import com.inovisolutions.paymentsync.BuildConfig
import com.inovisolutions.paymentsync.data.local.AppDatabase
import com.inovisolutions.paymentsync.data.remote.AuthInterceptor
import com.inovisolutions.paymentsync.data.remote.DeviceApi
import com.inovisolutions.paymentsync.data.remote.RequestIdInterceptor
import com.inovisolutions.paymentsync.data.secure.CredentialStore
import com.inovisolutions.paymentsync.data.sms.ParserEngine
import com.inovisolutions.paymentsync.domain.port.UploadScheduler
import com.inovisolutions.paymentsync.work.WorkScheduler
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    @Provides @Singleton
    fun credentialStore(@ApplicationContext context: Context): CredentialStore = CredentialStore(context)

    @Provides @Singleton
    fun parserEngine(): ParserEngine = ParserEngine()

    @Provides @Singleton
    fun json(): Json = Json { ignoreUnknownKeys = true }

    /** Task 14: the capture pipeline's upload port is now the WorkManager scheduler. */
    @Provides @Singleton
    fun uploadScheduler(scheduler: WorkScheduler): UploadScheduler =
        UploadScheduler { scheduler.scheduleUpload() }
}

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {
    @Provides @Singleton
    fun database(@ApplicationContext context: Context): AppDatabase =
        Room.databaseBuilder(context, AppDatabase::class.java, "paysync.db").build()

    @Provides fun smsDao(db: AppDatabase) = db.smsMessageDao()
    @Provides fun eventDao(db: AppDatabase) = db.eventLogDao()
    @Provides fun configDao(db: AppDatabase) = db.configDao()
}

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {
    @Provides @Singleton
    fun okHttp(credentials: CredentialStore): OkHttpClient =
        OkHttpClient.Builder()
            .addInterceptor(RequestIdInterceptor())
            .addInterceptor(AuthInterceptor(credentials))
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .callTimeout(60, TimeUnit.SECONDS)
            .retryOnConnectionFailure(false) // retry policy belongs to WorkManager (Task 14)
            .build()

    @Provides @Singleton
    fun retrofit(client: OkHttpClient, json: Json): Retrofit =
        Retrofit.Builder()
            .baseUrl("${BuildConfig.API_BASE_URL}/api/v1/")
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()

    @Provides @Singleton
    fun deviceApi(retrofit: Retrofit): DeviceApi = retrofit.create(DeviceApi::class.java)
}
