package com.inovisolutions.paymentsync

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.lifecycle.lifecycleScope
import com.inovisolutions.paymentsync.data.secure.CredentialStore
import com.inovisolutions.paymentsync.data.sms.RuleRepository
import com.inovisolutions.paymentsync.ui.AppRoot
import com.inovisolutions.paymentsync.ui.theme.PaymentSyncTheme
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject lateinit var credentials: CredentialStore
    @Inject lateinit var rules: RuleRepository

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        lifecycleScope.launch { rules.load() }
        val enrolled = credentials.isEnrolled
        setContent {
            PaymentSyncTheme {
                AppRoot(startEnrolled = enrolled)
            }
        }
    }
}
