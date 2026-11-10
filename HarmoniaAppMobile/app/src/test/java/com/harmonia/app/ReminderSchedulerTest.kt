package com.harmonia.app

import com.harmonia.app.data.sync.ReminderScheduler
import org.junit.Assert.*
import org.junit.Test
import java.util.Calendar

/**
 * Unit tests for [ReminderScheduler.computeInitialDelayMs].
 *
 * This function is pure (Calendar-based, no Android dependencies) so it can run
 * on the JVM without Robolectric.
 */
class ReminderSchedulerTest {

    @Test
    fun `future time today returns positive delay less than 24h`() {
        val now = Calendar.getInstance()
        val futureHour = (now.get(Calendar.HOUR_OF_DAY) + 2).coerceAtMost(23)
        val delay = ReminderScheduler.computeInitialDelayMs(futureHour, 0)
        assertTrue("Delay should be positive", delay > 0)
        assertTrue("Delay should be less than 24h", delay < 24 * 60 * 60 * 1000L)
    }

    @Test
    fun `past time today returns delay between 0 and 24h`() {
        // Hour 0 minute 0 is always in the past unless it is exactly midnight right now
        val delay = ReminderScheduler.computeInitialDelayMs(0, 0)
        assertTrue("Delay should be positive (points to tomorrow)", delay > 0)
        assertTrue("Delay should be at most 24h", delay <= 24 * 60 * 60 * 1000L)
    }

    @Test
    fun `midnight target always returns positive delay`() {
        val delay = ReminderScheduler.computeInitialDelayMs(0, 0)
        assertTrue("Delay must be > 0", delay > 0)
    }

    @Test
    fun `two sequential future hours produce strictly increasing delays`() {
        val now = Calendar.getInstance()
        val h1 = (now.get(Calendar.HOUR_OF_DAY) + 1).coerceAtMost(22)
        val h2 = h1 + 1
        val delay1 = ReminderScheduler.computeInitialDelayMs(h1, 0)
        val delay2 = ReminderScheduler.computeInitialDelayMs(h2, 0)
        // h2 is one hour later than h1, so its delay must be ~1 h longer
        assertTrue("Later time should have a longer delay (got $delay1 vs $delay2)", delay2 > delay1)
    }

    @Test
    fun `delay difference between adjacent hours is approximately 3600 seconds`() {
        val now = Calendar.getInstance()
        val h1 = (now.get(Calendar.HOUR_OF_DAY) + 1).coerceAtMost(22)
        val h2 = h1 + 1
        val diff = ReminderScheduler.computeInitialDelayMs(h2, 0) -
                   ReminderScheduler.computeInitialDelayMs(h1, 0)
        val oneHourMs = 60 * 60 * 1000L
        // Allow ±5 s for execution time between the two calls
        assertTrue("Difference should be ~1 h, got ${diff}ms", diff in (oneHourMs - 5000)..(oneHourMs + 5000))
    }
}

