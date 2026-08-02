package com.inovisolutions.paymentsync.ui

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.inovisolutions.paymentsync.R
import com.inovisolutions.paymentsync.ui.dashboard.Dashboard
import com.inovisolutions.paymentsync.ui.diagnostics.DiagnosticsScreen
import com.inovisolutions.paymentsync.ui.onboarding.OnboardingViewModel
import com.inovisolutions.paymentsync.ui.transactions.TransactionsScreen

private enum class Step { WELCOME, RATIONALE, PERMISSIONS, ENROLL, DONE }

/** Main-area destinations once the phone is enrolled. */
private enum class MainScreen { DASHBOARD, TRANSACTIONS, DIAGNOSTICS }

/**
 * The onboarding flow order is deliberate and must not be reordered (§17.2):
 * welcome → rationale + consent → permission request → enrollment. The permission
 * dialog is NEVER shown before consent is recorded.
 */
@Composable
fun AppRoot(startEnrolled: Boolean) {
    var step by remember { mutableStateOf(if (startEnrolled) Step.DONE else Step.WELCOME) }
    val vm: OnboardingViewModel = hiltViewModel()
    val state by vm.state.collectAsState()

    if (state.enrolled) step = Step.DONE

    when (step) {
        Step.WELCOME -> Welcome { step = Step.RATIONALE }
        Step.RATIONALE -> Rationale(onConsent = {
            vm.recordConsent("1.0.0", "1", "en")
            step = Step.PERMISSIONS
        })
        Step.PERMISSIONS -> Permissions { step = Step.ENROLL }
        Step.ENROLL -> Enroll(
            busy = state.enrolling,
            error = state.error,
            onEnroll = { code, key, name, wallet -> vm.enroll(code, key, name, wallet) },
        )
        Step.DONE -> MainArea()
    }
}

/** Dashboard ⇄ Transactions / Diagnostics — deliberately shallow navigation. */
@Composable
private fun MainArea() {
    var screen by remember { mutableStateOf(MainScreen.DASHBOARD) }
    when (screen) {
        MainScreen.DASHBOARD -> Dashboard(
            onOpenTransactions = { screen = MainScreen.TRANSACTIONS },
            onOpenDiagnostics = { screen = MainScreen.DIAGNOSTICS },
        )
        MainScreen.TRANSACTIONS -> Column {
            BackRow { screen = MainScreen.DASHBOARD }
            TransactionsScreen()
        }
        MainScreen.DIAGNOSTICS -> Column {
            BackRow { screen = MainScreen.DASHBOARD }
            DiagnosticsScreen()
        }
    }
}

@Composable
private fun BackRow(onBack: () -> Unit) {
    Button(onClick = onBack, modifier = Modifier.padding(start = 16.dp, top = 16.dp)) {
        Text(stringResource(R.string.back))
    }
}

@Composable
private fun Screen(content: @Composable () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) { content() }
}

@Composable
private fun Welcome(onContinue: () -> Unit) = Screen {
    Text(stringResource(R.string.onb_welcome_title))
    Text(stringResource(R.string.onb_welcome_body))
    Button(onClick = onContinue) { Text(stringResource(R.string.onb_continue)) }
}

@Composable
private fun Rationale(onConsent: () -> Unit) = Screen {
    var checked by remember { mutableStateOf(false) }
    Text(stringResource(R.string.onb_rationale_title))
    Text(stringResource(R.string.onb_rationale_body))
    Column {
        Checkbox(checked = checked, onCheckedChange = { checked = it })
        Text(stringResource(R.string.onb_consent_checkbox), textAlign = TextAlign.Start)
    }
    Button(enabled = checked, onClick = onConsent) { Text(stringResource(R.string.onb_continue)) }
}

@Composable
private fun Permissions(onGranted: () -> Unit) = Screen {
    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { result ->
        if (result[Manifest.permission.RECEIVE_SMS] == true) onGranted()
    }
    Text(stringResource(R.string.onb_perm_title))
    Text(stringResource(R.string.onb_perm_body))
    Button(onClick = {
        launcher.launch(arrayOf(Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS))
    }) { Text(stringResource(R.string.onb_grant)) }
}

@Composable
private fun Enroll(
    busy: Boolean,
    error: String?,
    onEnroll: (String, String, String, String?) -> Unit,
) = Screen {
    var code by remember { mutableStateOf("") }
    var key by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var wallet by remember { mutableStateOf("") }
    Text(stringResource(R.string.onb_enroll_title))
    OutlinedTextField(code, { code = it }, label = { Text(stringResource(R.string.company_code)) })
    OutlinedTextField(key, { key = it }, label = { Text(stringResource(R.string.enroll_key)) })
    OutlinedTextField(name, { name = it }, label = { Text(stringResource(R.string.device_name)) })
    OutlinedTextField(wallet, { wallet = it }, label = { Text(stringResource(R.string.wallet_number)) })
    if (error != null) Text(error)
    Spacer(Modifier.height(4.dp))
    Button(enabled = !busy && code.isNotBlank() && key.isNotBlank(), onClick = {
        onEnroll(code, key, name, wallet.ifBlank { null })
    }) { Text(stringResource(R.string.enroll_button)) }
}
