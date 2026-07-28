package com.inovisolutions.paymentsync.ui.onboarding

import android.os.Build
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inovisolutions.paymentsync.data.local.EventLogDao
import com.inovisolutions.paymentsync.data.local.EventLogEntity
import com.inovisolutions.paymentsync.data.remote.ApiError
import com.inovisolutions.paymentsync.data.remote.DeviceApi
import com.inovisolutions.paymentsync.data.remote.ErrorMapper
import com.inovisolutions.paymentsync.data.remote.dto.EnrollRequest
import com.inovisolutions.paymentsync.data.secure.CredentialStore
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Immutable UI state for the onboarding flow; no Android SMS API above this layer. */
data class OnboardingUiState(
    val enrolling: Boolean = false,
    val enrolled: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class OnboardingViewModel @Inject constructor(
    private val api: DeviceApi,
    private val credentials: CredentialStore,
    private val eventDao: EventLogDao,
) : ViewModel() {

    private val _state = MutableStateFlow(OnboardingUiState())
    val state: StateFlow<OnboardingUiState> = _state.asStateFlow()

    /** Records consent locally + reports it as a device event (auditable, §17.2). */
    fun recordConsent(appVersion: String, policyVersion: String, locale: String) {
        viewModelScope.launch {
            eventDao.insert(
                EventLogEntity(
                    type = "CONSENT_GRANTED",
                    at = System.currentTimeMillis(),
                    detail = "app=$appVersion policy=$policyVersion locale=$locale",
                ),
            )
        }
    }

    /** Enroll. The enrollment key is used once and NEVER persisted (§11.5). */
    fun enroll(companyCode: String, enrollKey: String, deviceName: String, walletMsisdn: String?) {
        if (_state.value.enrolling) return
        _state.value = _state.value.copy(enrolling = true, error = null)
        viewModelScope.launch {
            val result = runCatching {
                api.enroll(
                    EnrollRequest(
                        companyCode = companyCode.trim(),
                        enrollKey = enrollKey.trim(),
                        installId = credentials.installId,
                        model = Build.MODEL,
                        manufacturer = Build.MANUFACTURER,
                        androidVersion = Build.VERSION.RELEASE,
                        appVersion = "1.0.0",
                        deviceName = deviceName.ifBlank { null },
                        walletMsisdn = walletMsisdn?.ifBlank { null },
                    ),
                )
            }
            result.onSuccess { response ->
                if (response.isSuccessful) {
                    val body = response.body()
                    if (body != null) {
                        credentials.deviceToken = body.deviceToken
                        credentials.companyCode = companyCode.trim()
                        credentials.deviceId = body.deviceId
                        credentials.tokenIssuedAt = System.currentTimeMillis()
                        _state.value = OnboardingUiState(enrolled = true)
                        return@launch
                    }
                }
                _state.value = _state.value.copy(enrolling = false, error = messageFor(ErrorMapper.fromResponse(response)))
            }.onFailure {
                _state.value = _state.value.copy(enrolling = false, error = messageFor(ErrorMapper.fromThrowable(it)))
            }
        }
    }

    private fun messageFor(error: ApiError): String = when (error) {
        is ApiError.Unauthenticated -> "Wrong company code or enrollment key."
        is ApiError.DeviceLimitReached -> "This company already has a registered device. Contact support."
        is ApiError.DeviceRetired -> "This device was retired. Contact support to re-enable it."
        is ApiError.CompanySuspended -> "This company is not active."
        is ApiError.RateLimited -> "Too many attempts. Please wait a moment."
        is ApiError.Validation -> error.message
        is ApiError.Network -> "No connection. Check the network and try again."
        else -> "Something went wrong. Please try again."
    }
}
