package com.inovisolutions.paymentsync.data.remote

import com.inovisolutions.paymentsync.data.remote.dto.DeviceConfig
import com.inovisolutions.paymentsync.data.remote.dto.DeviceEventsRequest
import com.inovisolutions.paymentsync.data.remote.dto.EnrollRequest
import com.inovisolutions.paymentsync.data.remote.dto.EnrollResponse
import com.inovisolutions.paymentsync.data.remote.dto.HeartbeatRequest
import com.inovisolutions.paymentsync.data.remote.dto.HeartbeatResponse
import com.inovisolutions.paymentsync.data.remote.dto.TokenRotateResponse
import com.inovisolutions.paymentsync.data.remote.dto.UploadRequest
import com.inovisolutions.paymentsync.data.remote.dto.UploadResponse
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

/** Retrofit service for the frozen device API (base `/api/v1`). */
interface DeviceApi {
    @POST("device/register")
    suspend fun enroll(@Body body: EnrollRequest): Response<EnrollResponse>

    @GET("device/config")
    suspend fun config(): Response<DeviceConfig>

    @POST("sms/upload")
    suspend fun upload(@Body body: UploadRequest): Response<UploadResponse>

    @POST("device/heartbeat")
    suspend fun heartbeat(@Body body: HeartbeatRequest): Response<HeartbeatResponse>

    @POST("device/token")
    suspend fun rotateToken(): Response<TokenRotateResponse>

    @POST("device/events")
    suspend fun events(@Body body: DeviceEventsRequest): Response<Unit>
}
