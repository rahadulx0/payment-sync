package com.inovisolutions.paymentsync.notifications

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.inovisolutions.paymentsync.R
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Notifications for the states a merchant must actually act on (Task 14 §4.7).
 * Rate-limited per type so the app never becomes a nag — an app that cries wolf
 * gets its notifications turned off, and then the one that mattered is missed.
 */
@Singleton
class SyncNotifier @Inject constructor(@ApplicationContext private val context: Context) {

    private val lastShown = mutableMapOf<Int, Long>()

    init {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
        manager?.createNotificationChannel(
            NotificationChannel(CHANNEL_ATTENTION, "Attention", NotificationManager.IMPORTANCE_DEFAULT),
        )
        manager?.createNotificationChannel(
            NotificationChannel(CHANNEL_SYNC, "Sync", NotificationManager.IMPORTANCE_LOW),
        )
    }

    fun permissionLost() = notify(
        ID_PERMISSION, CHANNEL_ATTENTION,
        "SMS permission is off",
        "Payments cannot be captured until SMS access is granted again.",
    )

    fun needsReenroll() = notify(
        ID_REENROLL, CHANNEL_ATTENTION,
        "This phone needs reconnecting",
        "Payments are being saved but not sent. Contact support to reconnect.",
    )

    fun syncIncomplete(stillPending: Int) = notify(
        ID_SYNC, CHANNEL_SYNC,
        "Sync finished with $stillPending message(s) still waiting",
        "They will retry automatically. Open the app for details.",
    )

    fun recoveredMissedMessages(count: Int) = notify(
        ID_RECOVERED, CHANNEL_SYNC,
        "Recovered $count missed payment message(s)",
        "Your phone may be closing the app in the background. Open the app for the fix.",
    )

    fun serverMessage(message: String) = notify(ID_SERVER_MSG, CHANNEL_ATTENTION, "payment-sync", message)

    private fun notify(id: Int, channel: String, title: String, body: String) {
        val now = System.currentTimeMillis()
        // Rate limit: at most one of each kind per hour.
        if (now - (lastShown[id] ?: 0) < RATE_LIMIT_MS) return
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        lastShown[id] = now
        val notification = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(id, notification) }
    }

    private companion object {
        const val CHANNEL_ATTENTION = "attention"
        const val CHANNEL_SYNC = "sync"
        const val RATE_LIMIT_MS = 60 * 60 * 1000L
        const val ID_PERMISSION = 1
        const val ID_REENROLL = 2
        const val ID_SYNC = 3
        const val ID_RECOVERED = 4
        const val ID_SERVER_MSG = 5
    }
}
