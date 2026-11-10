package com.harmonia.app.data.sync

import com.google.firebase.Timestamp
import com.harmonia.app.data.local.dao.AnalysisResultDao

data class CoachReview(val verdict: String, val feedback: String, val pitch: Float?, val tone: Float?, val reviewer: String, val reviewedAt: Long) {
    suspend fun save(dao: AnalysisResultDao, attemptId: String) = dao.saveCoachReview(attemptId, verdict, feedback, pitch, tone, reviewer, reviewedAt)
    companion object {
        fun from(data: Map<String, Any?>): CoachReview? {
            if (data["verdictStatus"] != "reviewed") return null
            val verdict = data["coachVerdict"] as? String ?: return null
            if (verdict !in listOf("Excellent accuracy", "Good stability", "Requires improvement")) return null
            val reviewer = data["reviewedBy"] as? String ?: return null
            val at = (data["reviewedAt"] as? Timestamp)?.toDate()?.time ?: return null
            val pitch = (data["coachPitchScore"] as? Number)?.toFloat()
            val tone = (data["coachToneScore"] as? Number)?.toFloat()
            if ((pitch != null || tone != null) && (pitch == null || tone == null || !pitch.isFinite() || !tone.isFinite() || pitch !in 0f..100f || tone !in 0f..100f)) return null
            return CoachReview(verdict, (data["coachFeedback"] as? String).orEmpty(), pitch, tone, reviewer, at)
        }
    }
}
