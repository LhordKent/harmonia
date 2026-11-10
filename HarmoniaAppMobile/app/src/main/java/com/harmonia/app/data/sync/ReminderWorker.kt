package com.harmonia.app.data.sync

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.harmonia.app.MainActivity
import com.harmonia.app.R
import com.harmonia.app.data.local.HarmoniaDatabase
import com.harmonia.app.data.local.entity.NotificationEntity

/**
 * WorkManager worker that fires once per day at the user's chosen reminder time.
 *
 * On execution it:
 *  1. Posts an Android system notification (tapping opens the exercises screen).
 *  2. Inserts a row into the Room `notifications` table so it shows in NotificationsScreen.
 *
 * The worker is scheduled/cancelled by [ReminderScheduler].
 * Input data key [KEY_STUDENT_ID] is mandatory; without it the work is skipped.
 */
class ReminderWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result {
        val studentId = inputData.getString(KEY_STUDENT_ID)
        if (studentId.isNullOrBlank()) {
            Log.w(TAG, "No studentId in input data — skipping reminder")
            return Result.failure()
        }

        ensureNotificationChannel()

        val title   = "Time to practise! 🎵"
        val message = "Open Harmonia and work through today's vocal exercise."

        postSystemNotification(title, message)
        insertIntoNotificationTable(studentId, title, message)

        Log.d(TAG, "Daily reminder fired for student $studentId")
        return Result.success()
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private fun ensureNotificationChannel() {
        val nm = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE)
                as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Daily Practice Reminders",
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = "Reminds students to complete their daily vocal exercise."
        }
        nm.createNotificationChannel(channel)
    }

    private fun postSystemNotification(title: String, message: String) {
        // Tapping the notification opens MainActivity; the nav graph then
        // routes to the exercises screen via the OPEN_EXERCISES action.
        val intent = Intent(applicationContext, MainActivity::class.java).apply {
            action = ACTION_OPEN_EXERCISES
            flags  = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            applicationContext,
            REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(message)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        val nm = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE)
                as NotificationManager
        nm.notify(NOTIFICATION_ID, notification)
    }

    private suspend fun insertIntoNotificationTable(
        studentId: String,
        title: String,
        message: String
    ) {
        try {
            val db  = HarmoniaDatabase.getInstance(applicationContext)
            val now = System.currentTimeMillis()
            db.notificationDao().insert(
                NotificationEntity(
                    id        = "reminder_${now}",
                    studentId = studentId,
                    title     = title,
                    message   = message,
                    isRead    = false,
                    sentAt    = now
                )
            )
        } catch (e: Exception) {
            Log.e(TAG, "Could not insert reminder notification into Room: ${e.message}")
            // Not fatal — the system notification was already posted.
        }
    }

    companion object {
        private const val TAG             = "HarmoniaReminderWorker"
        const val  KEY_STUDENT_ID         = "studentId"
        const val  CHANNEL_ID             = "harmonia_daily_reminder"
        const val  ACTION_OPEN_EXERCISES  = "com.harmonia.app.OPEN_EXERCISES"
        private const val NOTIFICATION_ID = 1001
        private const val REQUEST_CODE    = 1001
    }
}

