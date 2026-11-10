package com.harmonia.app.data.repository

import com.harmonia.app.data.local.dao.AnalysisResultDao
import com.harmonia.app.data.local.dao.PracticeAttemptDao
import com.harmonia.app.data.local.dao.ProgressReportDao
import com.harmonia.app.data.local.entity.AnalysisResultEntity
import com.harmonia.app.data.local.entity.PracticeAttemptEntity
import com.harmonia.app.data.local.entity.ProgressReportEntity
import com.google.gson.Gson
import com.harmonia.app.data.local.HarmoniaDatabase
import androidx.room.withTransaction
import com.harmonia.analysis.AnalysisResultData
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.UUID

data class PracticeHistoryItem(
    val attempt: PracticeAttemptEntity,
    val result: AnalysisResultEntity?
)

data class DashboardSummaryStats(
    val weeklyAccuracyAverage: Float,
    val totalPracticeSeconds: Int,
    val dayStreak: Int,
    val totalSessionsCompleted: Int,
    val bestScore: Float,
    val weeklyTrend: List<Pair<String, Float>> // Day label e.g. "Mon" to accuracy %
)

class PracticeRepository(
    private val attemptDao: PracticeAttemptDao,
    private val resultDao: AnalysisResultDao,
    private val reportDao: ProgressReportDao,
    private val gson: Gson = Gson(),
    private val database: HarmoniaDatabase? = null
) {

    suspend fun recordAttemptAndAnalysis(
        studentId: String,
        exerciseId: String,
        durationSeconds: Int,
        audioPath: String,
        analysisData: AnalysisResultData,
        gradingEvidence: com.harmonia.analysis.GradingEvidence? = null
    ): Pair<PracticeAttemptEntity, AnalysisResultEntity> {
        val attemptId = "att_" + UUID.randomUUID().toString()
        val attempt = PracticeAttemptEntity(
            id = attemptId,
            studentId = studentId,
            exerciseId = exerciseId,
            audioRecordingUrl = audioPath,
            durationSeconds = durationSeconds,
            isSynced = false,
            recordedAt = System.currentTimeMillis()
        )

        val frames = analysisData.pitchFrames
        val step = ((frames.size + 238) / 239).coerceAtLeast(1)
        val displayFrames = frames.filterIndexed { index, _ -> index % step == 0 || index == frames.lastIndex }
        val pitchFramesJson = gson.toJson(displayFrames)
        val resultId = "res_" + UUID.randomUUID().toString()
        val result = AnalysisResultEntity(
            id = resultId,
            practiceAttemptId = attemptId,
            accuracyScore = analysisData.accuracyScore,
            toneScore = analysisData.toneScore,
            overallScore = analysisData.overallScore,
            detectedPitchData = pitchFramesJson,
            feedbackNotes = analysisData.feedbackNotes,
            verdictStatus = analysisData.verdictStatus,
            isSynced = false,
            analyzedAt = System.currentTimeMillis(),
            gradingEvidence = gradingEvidence?.let { gson.toJson(it) }
        )
        suspend fun persist() {
            attemptDao.insert(attempt)
            resultDao.insert(result)
            rollupProgressReport(studentId)
        }
        if (database != null) database.withTransaction { persist() } else persist()

        return Pair(attempt, result)
    }

    suspend fun getResultForAttempt(attemptId: String): AnalysisResultEntity? {
        return resultDao.getByAttemptId(attemptId)
    }

    fun observeResultForAttempt(attemptId: String) = resultDao.observeByAttemptId(attemptId)
    suspend fun getAttempt(attemptId: String) = attemptDao.getById(attemptId)
    suspend fun containsRecording(path: String) = attemptDao.containsAudioPath(path)

    fun observeHistory(studentId: String): Flow<List<PracticeHistoryItem>> {
        return attemptDao.observeAttemptsWithResult(studentId).map { list ->
            list.map { PracticeHistoryItem(attempt = it.attempt, result = it.result) }
        }
    }

    suspend fun getRecentHistory(studentId: String, limit: Int = 20): List<PracticeHistoryItem> {
        val attempts = attemptDao.getRecentAttempts(studentId, limit)
        return attempts.map { att ->
            val res = resultDao.getByAttemptId(att.id)
            PracticeHistoryItem(attempt = att, result = res)
        }
    }

    suspend fun getDashboardStats(studentId: String): DashboardSummaryStats {
        val items = attemptDao.getRecentAttempts(studentId, Int.MAX_VALUE).map { PracticeHistoryItem(it, resultDao.getByAttemptId(it.id)) }
        return PracticeStats.calculate(items)
    }

    private suspend fun rollupProgressReport(studentId: String) {
        val attempts = attemptDao.getRecentAttempts(studentId, Int.MAX_VALUE)
        val results = attempts.mapNotNull { resultDao.getByAttemptId(it.id) }
        val scored = results.filter { result -> result.gradingEvidence?.let { json ->
            runCatching { com.google.gson.JsonParser.parseString(json).asJsonObject.get("pitchScore")?.isJsonPrimitive == true }.getOrDefault(false)
        } ?: true }
        val avgAccuracy = if (scored.isEmpty()) 0f else scored.map { it.accuracyScore }.average().toFloat()
        val totalSec = attempts.sumOf { it.durationSeconds }

        reportDao.insert(
            ProgressReportEntity(
                id = "rep_" + UUID.randomUUID().toString(),
                studentId = studentId,
                averageAccuracy = avgAccuracy,
                totalSessions = attempts.size,
                totalDurationSeconds = totalSec,
                isSynced = false,
                generatedAt = System.currentTimeMillis()
            )
        )
    }
}
