package com.inovisolutions.paymentsync.ui.diagnostics

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inovisolutions.paymentsync.R
import com.inovisolutions.paymentsync.data.local.SmsMessageDao
import com.inovisolutions.paymentsync.data.secure.CredentialStore
import com.inovisolutions.paymentsync.data.sms.RuleRepository
import com.inovisolutions.paymentsync.domain.usecase.SendHeartbeat
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class DiagnosticsViewModel @Inject constructor(
    private val smsDao: SmsMessageDao,
    private val credentials: CredentialStore,
    private val heartbeat: SendHeartbeat,
    private val rules: RuleRepository,
) : ViewModel() {

    private val _text = MutableStateFlow("")
    val text: StateFlow<String> = _text.asStateFlow()

    fun refresh() {
        viewModelScope.launch {
            val snapshot = DiagnosticsSnapshot(
                appVersion = "1.0.0",
                androidVersion = Build.VERSION.RELEASE ?: "unknown",
                deviceModel = "${Build.MANUFACTURER} ${Build.MODEL}",
                companyCode = credentials.companyCode,
                installId = credentials.installId,
                enrolled = credentials.isEnrolled,
                hasSmsPermission = heartbeat.hasSmsPermission(),
                ignoringBatteryOptimisation = heartbeat.isIgnoringBatteryOptimisation(),
                networkType = "unknown",
                pendingCount = smsDao.pendingCount(),
                failedCount = smsDao.failedCount(),
                uploadedCount = smsDao.uploadedCount(),
                clockSkewSeconds = 0,
                lastHeartbeatAt = null,
                lastSyncAt = null,
                configVersion = 0,
                parserRuleVersions = rules.currentRules().associate { it.provider to it.version },
                recentEvents = emptyList(),
            )
            _text.value = DiagnosticsFormatter.format(snapshot)
        }
    }
}

/**
 * The Diagnostics screen (architecture §11.6). "Copy diagnostics" produces a
 * redacted, support-ready block a merchant can paste into WhatsApp — the single
 * feature that makes remote support viable.
 */
@Composable
fun DiagnosticsScreen() {
    val vm: DiagnosticsViewModel = hiltViewModel()
    val text by vm.text.collectAsState()
    val context = LocalContext.current
    LaunchedEffect(Unit) { vm.refresh() }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        Text(stringResource(R.string.diagnostics_title), style = MaterialTheme.typography.titleLarge)
        Text(text, Modifier.padding(vertical = 12.dp), style = MaterialTheme.typography.bodySmall)
        Button(
            onClick = { copyToClipboard(context, text) },
            modifier = Modifier.fillMaxWidth(),
        ) { Text(stringResource(R.string.copy_diagnostics)) }
    }
}

private fun copyToClipboard(context: Context, text: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
    clipboard?.setPrimaryClip(ClipData.newPlainText("payment-sync diagnostics", text))
}
