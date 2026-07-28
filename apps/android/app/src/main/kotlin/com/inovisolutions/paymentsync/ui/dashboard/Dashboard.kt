package com.inovisolutions.paymentsync.ui.dashboard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import com.inovisolutions.paymentsync.domain.model.Money
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class DashboardUiState(
    val pending: Int = 0,
    val lastProvider: String? = null,
    val lastAmount: String? = null,
)

@HiltViewModel
class DashboardViewModel @Inject constructor(private val smsDao: SmsMessageDao) : ViewModel() {
    private val _state = MutableStateFlow(DashboardUiState())
    val state: StateFlow<DashboardUiState> = _state.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            val last = smsDao.latest()
            _state.value = DashboardUiState(
                pending = smsDao.pendingCount(),
                lastProvider = last?.provider,
                lastAmount = last?.parsedAmountMinor?.let { Money.fromPaisa(it).toDisplayString() },
            )
        }
    }
}

@Composable
fun Dashboard() {
    val vm: DashboardViewModel = hiltViewModel()
    val state by vm.state.collectAsState()
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(stringResource(R.string.dashboard_title))
        Text("${stringResource(R.string.dashboard_pending)}: ${state.pending}")
        if (state.lastProvider != null) {
            Text("${stringResource(R.string.dashboard_last)}: ${state.lastProvider} ${state.lastAmount ?: ""}")
        } else {
            Text(stringResource(R.string.dashboard_none))
        }
    }
}
