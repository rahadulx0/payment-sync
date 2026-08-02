package com.inovisolutions.paymentsync.ui.transactions

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
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
import com.inovisolutions.paymentsync.domain.model.Money
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class TransactionRow(
    val provider: String,
    val amount: String?,
    val trxId: String?,
    val capturedAt: Long,
    val syncStatus: String,
    val serverMatchStatus: String?,
)

@HiltViewModel
class TransactionsViewModel @Inject constructor(private val smsDao: SmsMessageDao) : ViewModel() {
    private val _rows = MutableStateFlow<List<TransactionRow>>(emptyList())
    val rows: StateFlow<List<TransactionRow>> = _rows.asStateFlow()

    fun refresh() {
        viewModelScope.launch {
            _rows.value = smsDao.recent(200).map {
                TransactionRow(
                    provider = it.provider,
                    amount = it.parsedAmountMinor?.let { p -> Money.fromPaisa(p).toDisplayString() },
                    trxId = it.parsedTrxId,
                    capturedAt = it.smsTimestamp ?: it.receivedAt,
                    syncStatus = it.syncStatus,
                    serverMatchStatus = it.serverMatchStatus,
                )
            }
        }
    }
}

/** The merchant's local view of what was captured and whether it reached the server. */
@Composable
fun TransactionsScreen() {
    val vm: TransactionsViewModel = hiltViewModel()
    val rows by vm.rows.collectAsState()
    LaunchedEffect(Unit) { vm.refresh() }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text(stringResource(R.string.transactions_title), style = MaterialTheme.typography.titleLarge)
        if (rows.isEmpty()) {
            Text(stringResource(R.string.dashboard_none), Modifier.padding(top = 12.dp))
            return@Column
        }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 12.dp)) {
            items(rows) { row ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        Text("${row.provider} ${row.amount ?: ""}", style = MaterialTheme.typography.bodyLarge)
                        Text(row.trxId ?: "—", style = MaterialTheme.typography.bodySmall)
                        Text(
                            "${row.syncStatus}${row.serverMatchStatus?.let { " · $it" } ?: ""}",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }
        }
    }
}
