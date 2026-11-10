package com.harmonia.app.data.sync

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.QuerySnapshot
import com.google.firebase.Timestamp
import com.harmonia.app.data.local.HarmoniaDatabase
import com.harmonia.app.data.local.entity.CoachAssessmentEntity
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.collect

/** Listener lifecycle belongs to its collecting screen; Room keeps offline copies. */
class CoachFeedbackSync(private val local: HarmoniaDatabase) {
    private val cloud get() = FirebaseFirestore.getInstance()
    private fun requireOwner(uid: String) { check(FirebaseAuth.getInstance().currentUser?.uid == uid) { "Sign in as this student to refresh feedback." } }

    suspend fun watch(studentId: String) {
        requireOwner(studentId)
        callbackFlow<QuerySnapshot> {
            val listener = cloud.collection("practiceSessions").whereEqualTo("studentId", studentId)
                .addSnapshotListener { snapshot, error ->
                    if (error != null) close(error) else if (snapshot != null) trySend(snapshot)
                }
            awaitClose { listener.remove() }
        }.collect { applySessions(studentId, it) }
    }

    suspend fun watchAssessments(studentId: String) {
        requireOwner(studentId)
        callbackFlow<QuerySnapshot> {
            val listener = cloud.collection("coachAssessments").whereEqualTo("studentId", studentId).whereEqualTo("status", "finalized")
                .addSnapshotListener { snapshot, error ->
                    if (error != null) close(error) else if (snapshot != null) trySend(snapshot)
                }
            awaitClose { listener.remove() }
        }.collect { applyAssessments(studentId, it) }
    }

    suspend fun applySessions(studentId: String, snapshot: QuerySnapshot) {
        requireOwner(studentId)
        for (doc in snapshot.documents) {
            val data = doc.data ?: continue
            if (data["studentId"] != studentId) continue
            val attempt = local.practiceAttemptDao().getById(doc.id) ?: continue
            if (attempt.studentId != studentId) continue
            CoachReview.from(data)?.save(local.analysisResultDao(), doc.id)
            val decision = data["advancementDecision"] as? String
            if (data["verdictStatus"] == "reviewed" && decision in listOf("approved", "repeat"))
                local.analysisResultDao().saveAdvancement(doc.id, decision)
        }
        // Decide per exercise from the latest explicit staff decision, never from a client score.
        snapshot.documents.filter { it.getString("studentId") == studentId && it.getString("verdictStatus") == "reviewed"
            && it.getString("advancementDecision") in listOf("approved", "repeat") && it.getTimestamp("reviewedAt") != null }
            .groupBy { it.getString("exerciseId") }.forEach { (exerciseId, reviews) ->
                if (exerciseId == null) return@forEach
                val latest = reviews.maxByOrNull { it.getTimestamp("reviewedAt")!!.toDate().time }!!
                val previous = local.practiceSessionDao().getSession(studentId, exerciseId)
                val approved = latest.getString("advancementDecision") == "approved"
                local.practiceSessionDao().insertOrUpdate(com.harmonia.app.data.local.entity.PracticeSessionEntity(
                    id = previous?.id ?: "ps_${studentId}_$exerciseId", studentId = studentId, exerciseId = exerciseId,
                    status = if (approved) "completed" else "available", bestScore = previous?.bestScore ?: 0f,
                    completedAt = if (approved) latest.getTimestamp("reviewedAt")!!.toDate().time else null))
            }
    }

    suspend fun applyAssessments(studentId: String, snapshot: QuerySnapshot) {
        requireOwner(studentId)
        // Ignore snapshots with unresolved server timestamps until committed.
        val latest = snapshot.documents.filter { it.getTimestamp("finalizedAt") != null }
            .maxByOrNull { it.getTimestamp("finalizedAt")!!.toDate().time }
        if (latest == null) {
            if (!snapshot.metadata.isFromCache) local.coachAssessmentDao().clear(studentId)
            return
        }
        local.coachAssessmentDao().save(CoachAssessmentEntity(
            studentId = studentId, assessmentId = latest.id,
            coachName = latest.getString("coachName").orEmpty(),
            feedback = latest.getString("coachFeedback").orEmpty(),
            observations = latest.getString("additionalObservations").orEmpty(),
            verdict = latest.getString("finalVerdict").orEmpty(),
            finalizedAt = latest.getTimestamp("finalizedAt")!!.toDate().time
        ))
    }
}
