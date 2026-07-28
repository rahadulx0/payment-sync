package com.inovisolutions.paymentsync.data.remote

import com.inovisolutions.paymentsync.data.secure.CredentialStore
import okhttp3.Interceptor
import okhttp3.Response
import java.util.UUID

/** Attaches the device token + install id. The token is never logged (see RedactingLogger). */
class AuthInterceptor(private val credentials: CredentialStore) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val builder = chain.request().newBuilder()
        credentials.deviceToken?.let { builder.header("Authorization", "Bearer $it") }
        builder.header("X-Install-Id", credentials.installId)
        return chain.proceed(builder.build())
    }
}

/** A client-generated request id, echoed in logs so a case can be traced across app and server. */
class RequestIdInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val req = chain.request().newBuilder()
            .header("X-Request-Id", UUID.randomUUID().toString())
            .build()
        return chain.proceed(req)
    }
}

/** Redacts the bearer token in any logged headers (redaction asserted by test). */
object RedactingLogger {
    fun redactHeader(name: String, value: String): String =
        if (name.equals("Authorization", ignoreCase = true)) "Bearer [redacted]" else value
}
