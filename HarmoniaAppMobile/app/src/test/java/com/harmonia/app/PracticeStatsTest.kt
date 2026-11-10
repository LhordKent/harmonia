package com.harmonia.app

import com.harmonia.app.data.repository.*
import com.harmonia.app.data.local.entity.*
import java.time.Instant
import java.time.ZoneId
import org.junit.Assert.*
import org.junit.Test

class PracticeStatsTest {
    private val now = Instant.parse("2026-11-10T12:00:00Z").toEpochMilli()
    private fun item(daysAgo: Int, score: Float) = PracticeHistoryItem(
        PracticeAttemptEntity("a$daysAgo", "student", "exercise", "audio.wav", 15, recordedAt = now - daysAgo * 86400000L),
        AnalysisResultEntity("r$daysAgo", "a$daysAgo", score, score, score, detectedPitchData = "[]", feedbackNotes = "")
    )
    @Test fun emptyHistoryHasNoInventedScoresSessionsOrStreak() {
        val stats = PracticeStats.calculate(emptyList(), now, ZoneId.of("Asia/Manila"))
        assertEquals(0f, stats.weeklyAccuracyAverage); assertEquals(0, stats.dayStreak)
        assertEquals(0, stats.totalSessionsCompleted); assertTrue(stats.weeklyTrend.all { it.second == 0f })
    }
    @Test fun weekIsChronologicalAndExcludesOldScoresWithoutLosingLifetimeTotals() {
        val stats = PracticeStats.calculate(listOf(item(0, 80f), item(1, 90f), item(8, 100f)), now, ZoneId.of("UTC"))
        assertEquals(85f, stats.weeklyAccuracyAverage); assertEquals(100f, stats.bestScore)
        assertEquals(45, stats.totalPracticeSeconds); assertEquals(2, stats.dayStreak)
        assertEquals("Tue", stats.weeklyTrend.last().first); assertEquals(80f, stats.weeklyTrend.last().second)
    }
    @Test fun yesterdayCanContinueAStreakButAnOldPracticeCannotCreateOne() {
        assertEquals(2, PracticeStats.calculate(listOf(item(1, 70f), item(2, 80f)), now).dayStreak)
        assertEquals(0, PracticeStats.calculate(listOf(item(8, 80f)), now).dayStreak)
    }
}
