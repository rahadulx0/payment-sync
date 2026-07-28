package com.inovisolutions.paymentsync.domain.port

/**
 * The seam between capture (Task 13) and the upload engine (Task 14). Capture
 * enqueues work through this port; here it's a no-op binding so the capture
 * pipeline is testable on its own. Task 14 replaces it with the WorkManager
 * scheduler.
 */
fun interface UploadScheduler {
    fun scheduleUpload()
}
