package com.inovisolutions.paymentsync.data.remote

import com.inovisolutions.paymentsync.data.remote.dto.ErrorEnvelope
import kotlinx.serialization.json.Json
import retrofit2.Response

/**
 * Sealed error model so the UI and the Task 14 sync engine can react differently
 * to each case (architecture §11.3). A `RateLimited` carries the server's
 * Retry-After; retry policy itself lives in WorkManager, never here.
 */
sealed class ApiError(open val requestId: String? = null) {
    data class Unauthenticated(override val requestId: String?) : ApiError(requestId)
    data class DeviceBlocked(override val requestId: String?) : ApiError(requestId)
    data class DeviceRetired(override val requestId: String?) : ApiError(requestId)
    data class DeviceLimitReached(override val requestId: String?) : ApiError(requestId)
    data class CompanySuspended(override val requestId: String?) : ApiError(requestId)
    data class RateLimited(val retryAfterSeconds: Long?, override val requestId: String?) : ApiError(requestId)
    data class Validation(val message: String, override val requestId: String?) : ApiError(requestId)
    data class Server(val status: Int, override val requestId: String?) : ApiError(requestId)
    data class Network(val cause: Throwable) : ApiError(null)
}

object ErrorMapper {
    private val json = Json { ignoreUnknownKeys = true }

    fun fromResponse(response: Response<*>): ApiError {
        val raw = response.errorBody()?.string().orEmpty()
        val env = runCatching { json.decodeFromString<ErrorEnvelope>(raw) }.getOrNull()
        val code = env?.error?.code
        val requestId = env?.error?.requestId
        return when {
            code == "DEVICE_BLOCKED" -> ApiError.DeviceBlocked(requestId)
            code == "DEVICE_RETIRED" -> ApiError.DeviceRetired(requestId)
            code == "DEVICE_LIMIT_REACHED" -> ApiError.DeviceLimitReached(requestId)
            code == "COMPANY_SUSPENDED" -> ApiError.CompanySuspended(requestId)
            response.code() == 401 -> ApiError.Unauthenticated(requestId)
            response.code() == 429 -> ApiError.RateLimited(
                response.headers()["Retry-After"]?.toLongOrNull(),
                requestId,
            )
            response.code() == 400 -> ApiError.Validation(env?.error?.message ?: "Invalid request.", requestId)
            else -> ApiError.Server(response.code(), requestId)
        }
    }

    fun fromThrowable(t: Throwable): ApiError = ApiError.Network(t)
}
