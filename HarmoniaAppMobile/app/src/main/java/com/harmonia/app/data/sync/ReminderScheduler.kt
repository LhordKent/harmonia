package com.harmonia.app.data.sync

import android.content.Context
import android.util.Log
import androidx.work.Data
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.Calendar
import java.util.concurrent.TimeUnit

/**
 * Encapsulates WorkManager scheduling for the daily practice reminder.
 *
 * WorkManager does not guarantee exact delivery times, but [PeriodicWorkRequest]
 * with a 15-minute flex window will fire within roughly the target hour on most devices.
 *
 * Usage:
 *   ReminderScheduler.schedule(context, studentId, hourOfDay = 9, minuteOfHour = 0)
 *   ReminderScheduler.cancel(context)
 */
object ReminderScheduler {

    private const val TAG       = "HarmoniaReminderScheduler"
    private const val WORK_NAME = "harmonia_daily_reminder"

    /**
     * Schedules (or replaces) the daily reminder.
     *
     * @param hourOfDay     24-hour clock hour (0–23)
     * @param minuteOfHour  Minute within the hour (0–59)
     */
    fun schedule(
        context: Context,
        studentId: String,
        hourOfDay: Int,
        minuteOfHour: Int
    ) {
        val initialDelayMs = computeInitialDelayMs(hourOfDay, minuteOfHour)

        val inputData = Data.Builder()
            .putString(ReminderWorker.KEY_STUDENT_ID, studentId)
            .build()

        val request = PeriodicWorkRequestBuilder<ReminderWorker>(
            repeatInterval      = 24,
            repeatIntervalTimeUnit = TimeUnit.HOURS,
            flexTimeInterval    = 15,
            flexTimeIntervalUnit = TimeUnit.MINUTES
        )
            .setInitialDelay(initialDelayMs, TimeUnit.MILLISECONDS)
            .setInputData(inputData)
            .build()

        WorkManager.getInstance(context.applicationContext)
            .enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.CANCEL_AND_REENQUEUE,
                request
            )

        Log.d(TAG, "Reminder scheduled for %02d:%02d (initial delay ${initialDelayMs / 60_000} min)"
            .format(hourOfDay, minuteOfHour))
    }

    /** Cancels the reminder. Safe to call even if no reminder is scheduled. */
    fun cancel(context: Context) {
        WorkManager.getInstance(context.applicationContext)
            .cancelUniqueWork(WORK_NAME)
        Log.d(TAG, "Daily reminder cancelled")
    }

    /**
     * Computes the milliseconds until the next occurrence of [hourOfDay]:[minuteOfHour].
     * If that time has already passed today, the delay points to tomorrow's occurrence.
     *
     * Visible for testing (package-private in Kotlin via `internal`).
     */
    internal fun computeInitialDelayMs(hourOfDay: Int, minuteOfHour: Int): Long {
        val now = Calendar.getInstance()

        val target = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, hourOfDay)
            set(Calendar.MINUTE, minuteOfHour)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }

        // If the target time is in the past today, advance to tomorrow
        if (!target.after(now)) {
            target.add(Calendar.DAY_OF_YEAR, 1)
        }

        return target.timeInMillis - now.timeInMillis
    }
}

