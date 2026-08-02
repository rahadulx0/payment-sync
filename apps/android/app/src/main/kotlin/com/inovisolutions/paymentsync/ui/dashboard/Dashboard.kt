package com.inovisolutions.paymentsync.ui.dashboard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inovisolutions.paymentsync.R
import com.inovisolutions.paymentsync.data.local.SmsMessageDao
import com.inovisolutions.paymentsync.data.secure.CredentialStore
import com.inovisolutions.paymentsync.domain.model.Money
import com.inovisolutions.paymentsync.domain.usecase.SendHeartbeat
import com.inovisolutions.paymentsync.work.WorkScheduler
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class DashboardUiState(
    val enrolled: Boolean = false,
    val pending: Int = 0,
    val failed: Int = 0,
    val uploaded: Int = 0,
    val lastProvider: String? = null,
    val lastAmount: String? = null,
    val syncing: Boolean = false,
    val attention: List<String> = emptyList(),
)

@HiltViewModel
class DashboardViewModel @Inject constructor(
    private val smsDao: SmsMessageDao,
    private val credentials: CredentialStore,
    private val heartbeat: SendHeartbeat,
    private val scheduler: WorkScheduler,
) : ViewModel() {

    private val _state = MutableStateFlow(DashboardUiState())
    val state: StateFlow<DashboardUiState> = _state.asStateFlow()

    fun refresh() {
        viewModelScope.launch {
            val last = smsDao.latest()
            val attention = buildList {
                if (!heartbeat.hasSmsPermission()) add("SMS permission is off — payments cannot be captured.")
                if (!heartbeat.isIgnoringBatteryOptimisation()) {
                    add("Battery optimisation is on — this phone may stop capturing in the background.")
                }
                if (!credentials.isEnrolled) add("This phone is not connected to a business yet.")
                if (smsDao.failedCount() > 0) add("Some messages failed to send. Tap Sync now to retry.")
            }
            _state.value = _state.value.copy(
                enrolled = credentials.isEnrolled,
                pending = smsDao.pendingCount(),
                failed = smsDao.failedCount(),
                uploaded = smsDao.uploadedCount(),
                lastProvider = last?.provider,
                lastAmount = last?.parsedAmountMinor?.let { Money.fromPaisa(it).toDisplayString() },
                attention = attention,
            )
        }
    }

    /** Manual Sync — the recovery path. Runs as unique work; a second tap attaches. */
    fun manualSync() {
        _state.value = _state.value.copy(syncing = true)
        scheduler.runManualSyncNow()
        viewModelScope.launch {
            kotlinx.coroutines.delay(1500)
            _state.value = _state.value.copy(syncing = false)
            refresh()
        }
    }
}

@Composable
fun Dashboard(onOpenTransactions: () -> Unit = {}, onOpenDiagnostics: () -> Unit = {}) {
    val vm: DashboardViewModel = hiltViewModel()
    val state by vm.state.collectAsState()
    LaunchedEffect(Unit) { vm.refresh() }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(stringResource(R.string.dashboard_title), style = MaterialTheme.typography.titleLarge)

        // Anything that needs the merchant's attention comes first.
        for (message in state.attention) {
            Card(Modifier.fillMaxWidth()) {
                Text(message, Modifier.padding(12.dp), style = MaterialTheme.typography.bodyMedium)
            }
        }

        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("${stringResource(R.string.dashboard_pending)}: ${state.pending}")
                Text("${stringResource(R.string.dashboard_failed)}: ${state.failed}")
                Text("${stringResource(R.string.dashboard_uploaded)}: ${state.uploaded}")
                if (state.lastProvider != null) {
                    Text("${stringResource(R.string.dashboard_last)}: ${state.lastProvider} ${state.lastAmount ?: ""}")
                } else {
                    Text(stringResource(R.string.dashboard_none))
                }
            }
        }

        Button(onClick = { vm.manualSync() }, enabled = !state.syncing, modifier = Modifier.fillMaxWidth()) {
            if (state.syncing) {
                CircularProgressIndicator(Modifier.padding(end = 8.dp))
            }
            Text(stringResource(R.string.manual_sync))
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = onOpenTransactions) { Text(stringResource(R.string.transactions_title)) }
            OutlinedButton(onClick = onOpenDiagnostics) { Text(stringResource(R.string.diagnostics_title)) }
        }
    }
}
