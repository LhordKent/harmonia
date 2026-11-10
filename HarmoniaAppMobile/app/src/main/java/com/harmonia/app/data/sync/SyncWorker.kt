package com.harmonia.app.data.sync

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.SetOptions
import com.harmonia.app.data.local.HarmoniaDatabase
import com.harmonia.app.data.local.entity.VocalExerciseEntity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException

class SyncWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val db = HarmoniaDatabase.getInstance(applicationContext)
        val attemptDao  = db.practiceAttemptDao()
        val resultDao   = db.analysisResultDao()
        val reportDao   = db.progressReportDao()
        val studentDao  = db.studentDao()

        val firestore: FirebaseFirestore
        try {
            firestore = FirebaseFirestore.getInstance()
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            Log.w(TAG, "Firebase not configured; will retry.", e)
            return@withContext Result.retry()
        }

        val auth = FirebaseAuth.getInstance()
        val currentUid = auth.currentUser?.uid ?: return@withContext Result.success()
        // Never upload or refresh while account setup is pending (or for a removed account):
        // the persisted Firebase session alone does not authorize synchronization.
        val ready = try {
            val profile = firestore.collection("users").document(currentUid)
                .get(com.google.firebase.firestore.Source.SERVER).await().data
            com.harmonia.app.data.repository.onboardingState(profile) ==
                com.harmonia.app.data.repository.AuthState.Ready
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            if (e is com.google.firebase.firestore.FirebaseFirestoreException &&
                e.code == com.google.firebase.firestore.FirebaseFirestoreException.Code.UNAVAILABLE) {
                return@withContext Result.retry()
            }
            false
        }
        if (!ready) {
            Log.i(TAG, "Account setup is not complete; skipping synchronization.")
            return@withContext Result.success()
        }
        val audioStore = SupabaseAudioStore(firestore, auth)

        var anyFailed = false

        // ── 1. Sync Practice Attempts ─────────────────────────────────────────
        val resultParents = resultDao.getUnsyncedResults().mapNotNull { attemptDao.getById(it.practiceAttemptId) }
        val unsyncedAttempts = (attemptDao.getUnsyncedAttempts() + resultParents)
            .filter { it.studentId == currentUid }.distinctBy { it.id }
        Log.d(TAG, "Found ${unsyncedAttempts.size} unsynced practice attempts")

        for (attempt in unsyncedAttempts) {
            val student = studentDao.getById(attempt.studentId)

            // Audio is private in Supabase; Firestore stores its durable reference.
            var storageUrl = attempt.audioRecordingUrl
            if (!storageUrl.startsWith("supabase://") && !storageUrl.startsWith("https://")) {
                try {
                    storageUrl = audioStore.uploadAttempt(File(attempt.audioRecordingUrl), attempt.id, attempt.studentId)
                } catch (e: Exception) {
            if (e is CancellationException) throw e
                    Log.e(TAG, "Recording upload failed for ${attempt.id}: ${e.message}")
                    anyFailed = true
                    continue
                }
            }

            // 1b. Write students/{uid}/practiceAttempts/{attemptId}
            val attemptMap = hashMapOf(
                "id"                to attempt.id,
                "studentId"         to attempt.studentId,
                "exerciseId"        to attempt.exerciseId,
                "audioRecordingUrl" to storageUrl,
                "durationSeconds"   to attempt.durationSeconds,
                "recordedAt"        to attempt.recordedAt
            )
            // 1c. Write flat practiceSessions/{attemptId} (read by web dashboard)
            val analysisResult = resultDao.getByAttemptId(attempt.id)
            val flatSessionMap = hashMapOf<String, Any?>(
                "id"              to attempt.id,
                "studentId"       to attempt.studentId,
                "exerciseId"      to attempt.exerciseId,
                "institutionId"   to student?.institutionId,
                "durationSeconds" to attempt.durationSeconds,
                "audioStoragePath" to storageUrl,
                "overallScore"    to (analysisResult?.overallScore ?: 0.0f),
                "accuracyScore"   to (analysisResult?.accuracyScore ?: 0.0f),
                "toneScore"       to (analysisResult?.toneScore ?: 0.0f),
                "verdictStatus"   to (analysisResult?.verdictStatus ?: "aiPending"),
                "createdAt"       to attempt.recordedAt
            )
            if (analysisResult == null) { anyFailed = true; continue }
            analysisResult.gradingEvidence?.let {
                flatSessionMap["gradingEvidence"] = com.google.gson.Gson().fromJson(it, Map::class.java)
                flatSessionMap["feedbackNotes"] = analysisResult.feedbackNotes
            }
            val resultMap = hashMapOf<String, Any?>(
                "id" to analysisResult.id, "practiceAttemptId" to attempt.id,
                "accuracyScore" to analysisResult.accuracyScore, "toneScore" to analysisResult.toneScore,
                "overallScore" to analysisResult.overallScore, "feedbackNotes" to analysisResult.feedbackNotes,
                "verdictStatus" to analysisResult.verdictStatus, "analyzedAt" to analysisResult.analyzedAt
            )
            analysisResult.gradingEvidence?.let { resultMap["gradingEvidence"] = com.google.gson.Gson().fromJson(it, Map::class.java) }
            try {
                val sessionRef = firestore.collection("practiceSessions").document(attempt.id)
                val attemptRef = firestore.collection("students").document(currentUid).collection("practiceAttempts").document(attempt.id)
                val resultRef = attemptRef.collection("analysisResult").document(analysisResult.id)
                firestore.runTransaction { transaction ->
                    val existing = transaction.get(sessionRef)
                    val existingAttempt = transaction.get(attemptRef)
                    val existingResult = transaction.get(resultRef)
                    if (!existing.exists()) transaction.set(sessionRef, flatSessionMap)
                    else check(existing.getString("studentId") == currentUid) { "Recording owner mismatch." }
                    if (!existingAttempt.exists()) transaction.set(attemptRef, attemptMap)
                    if (!existingResult.exists()) transaction.set(resultRef, resultMap)
                }.await()
                attemptDao.markSynced(attempt.id)
                resultDao.markSynced(analysisResult.id)
            } catch (e: Exception) {
            if (e is CancellationException) throw e
                Log.w(TAG, "Session sync failed for ${attempt.id}: ${e.message}")
                anyFailed = true
            }
        }

        // Progress reports
        val unsyncedReports = reportDao.getUnsyncedReports().filter { it.studentId == currentUid }
        Log.d(TAG, "Found ${unsyncedReports.size} unsynced progress reports")
        for (rep in unsyncedReports) {
            val reportMap = hashMapOf(
                "id"                  to rep.id,
                "studentId"           to rep.studentId,
                "averageAccuracy"     to rep.averageAccuracy,
                "totalSessions"       to rep.totalSessions,
                "totalDurationSeconds" to rep.totalDurationSeconds,
                "generatedAt"         to rep.generatedAt
            )
            try {
                firestore.collection("students").document(rep.studentId)
                    .collection("progressReports").document(rep.id)
                    .set(reportMap, SetOptions.merge())
                    .await()
                reportDao.markSynced(rep.id)
            } catch (e: Exception) {
            if (e is CancellationException) throw e
                Log.e(TAG, "Progress report write failed for ${rep.id} [${e.javaClass.simpleName}]: ${e.message}")
                anyFailed = true
            }
        }

        // ── 4. Pull Exercises from Firestore ──────────────────────────────────
        try {
            val exerciseSnapshot = firestore.collection("exercises").get().await()
            if (!exerciseSnapshot.isEmpty) {
                val remoteExercises = exerciseSnapshot.documents.mapNotNull { doc ->
                    val mapped = RemoteExerciseMapper.from(doc.id, doc.data ?: emptyMap())
                    if (mapped == null) Log.w(TAG, "Skipping exercise ${doc.id}: invalid targets or duration.")
                    mapped
                }
                if (remoteExercises.isNotEmpty()) {
                    db.exerciseDao().insertAll(remoteExercises)
                    Log.d(TAG, "Synced ${remoteExercises.size} exercises from web portal")
                }
            }
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            Log.w(TAG, "Could not fetch remote exercises: ${e.message}")
        }

        try {
            val feedback = CoachFeedbackSync(db)
            feedback.applySessions(currentUid, firestore.collection("practiceSessions").whereEqualTo("studentId", currentUid).get(com.google.firebase.firestore.Source.SERVER).await())
            feedback.applyAssessments(currentUid, firestore.collection("coachAssessments").whereEqualTo("studentId", currentUid).whereEqualTo("status", "finalized").get(com.google.firebase.firestore.Source.SERVER).await())
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            Log.w(TAG, "Coach feedback refresh failed: ${e.message}")
            anyFailed = true
        }

        if (anyFailed) Result.retry() else Result.success()
    }

    companion object {
        private const val TAG       = "HarmoniaSyncWorker"
        private const val WORK_NAME = "harmonia_sync"

        fun enqueue(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val workRequest = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(constraints)
                .build()

            // Replace stale work when a new recording/login requests a refresh.
            WorkManager.getInstance(context)
                .enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.REPLACE, workRequest)
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                "harmonia_feedback_refresh", ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                    .setInitialDelay(15, TimeUnit.MINUTES).setConstraints(constraints).build()
            )
        }
    }
}
