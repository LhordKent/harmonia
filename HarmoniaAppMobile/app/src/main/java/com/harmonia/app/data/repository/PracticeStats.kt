package com.harmonia.app.data.repository

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

object PracticeStats {
    fun calculate(items: List<PracticeHistoryItem>, now: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): DashboardSummaryStats {
        val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
        fun day(item: PracticeHistoryItem) = Instant.ofEpochMilli(item.attempt.recordedAt).atZone(zone).toLocalDate()
        fun valid(score: Float?) = score != null && score.isFinite() && score in 0f..100f
        fun scored(item: PracticeHistoryItem) = item.result?.gradingEvidence?.let { json ->
            runCatching { com.google.gson.JsonParser.parseString(json).asJsonObject.get("pitchScore")?.isJsonPrimitive == true }.getOrDefault(false)
        } ?: (item.result != null)
        val week = items.filter(::scored).filter { day(it) in today.minusDays(6)..today }
        val weekScores = week.mapNotNull { it.result?.accuracyScore }.filter { valid(it) }
        val days = items.map(::day).filter { it <= today }.toSet()
        var cursor = if (today in days) today else today.minusDays(1)
        var streak = 0
        while (cursor in days) { streak++; cursor = cursor.minusDays(1) }
        val label = DateTimeFormatter.ofPattern("EEE", Locale.ENGLISH)
        return DashboardSummaryStats(
            weeklyAccuracyAverage = if (weekScores.isEmpty()) 0f else weekScores.average().toFloat(),
            totalPracticeSeconds = items.sumOf { it.attempt.durationSeconds.coerceAtLeast(0) },
            dayStreak = streak, totalSessionsCompleted = items.size,
            bestScore = items.filter(::scored).mapNotNull { it.result?.overallScore }.filter { valid(it) }.maxOrNull() ?: 0f,
            weeklyTrend = (6L downTo 0L).map { ago ->
                val date = today.minusDays(ago)
                val values = week.filter { day(it) == date }.mapNotNull { it.result?.accuracyScore }.filter { valid(it) }
                label.format(date) to if (values.isEmpty()) 0f else values.average().toFloat()
            }
        )
    }
}
