package com.inovisolutions.paymentsync.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.inovisolutions.paymentsync.R
import com.inovisolutions.paymentsync.work.WorkScheduler
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

/**
 * Optional foreground service (Task 15 §4.3.3). OFF by default and toggled by the
 * merchant. Its only job is to keep the process warm on hostile ROMs — it does
 * NOT upload anything itself, because duplicating `UploadWorker` would mean two
 * drainers and duplicate requests. On start it nudges a reconcile, which is the
 * cheap way to catch anything missed while the process was dead.
 */
@AndroidEntryPoint
class SmsMonitorService : Service() {

    @Inject lateinit var scheduler: WorkScheduler

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForegroundCompat()
        scheduler.runManualSyncNow(scanDays = 1)
        // STICKY: if the ROM kills us, come back — that is the whole point.
        return START_STICKY
    }

    private fun startForegroundCompat() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
        manager?.createNotificationChannel(
            NotificationChannel(CHANNEL, "Payment monitoring", NotificationManager.IMPORTANCE_MIN),
        )
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle(getString(R.string.fgs_title))
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    companion object {
        private const val CHANNEL = "monitoring"
        private const val NOTIFICATION_ID = 42

        fun start(context: Context) {
            val intent = Intent(context, SmsMonitorService::class.java)
            runCatching {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            }
        }

        fun stop(context: Context) {
            runCatching { context.stopService(Intent(context, SmsMonitorService::class.java)) }
        }
    }
}
