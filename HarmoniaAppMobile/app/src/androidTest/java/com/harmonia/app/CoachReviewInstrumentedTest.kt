package com.harmonia.app

import androidx.room.Room
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.graphics.asAndroidBitmap
import android.graphics.Bitmap
import android.content.ContentValues
import android.provider.MediaStore
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Source
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkInfo
import com.google.firebase.auth.FirebaseAuth
import com.harmonia.app.data.local.HarmoniaDatabase
import com.harmonia.app.data.local.entity.*
import com.harmonia.app.data.sync.CoachFeedbackSync
import com.harmonia.app.data.sync.SyncWorker
import com.harmonia.app.data.repository.PracticeRepository
import com.harmonia.app.ui.screens.ResultsScreen
import com.harmonia.app.ui.theme.HarmoniaTheme
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.tasks.await
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.Rule
import org.junit.runner.RunWith
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

@RunWith(AndroidJUnit4::class)
class CoachReviewInstrumentedTest {
    @get:Rule val compose = createComposeRule()
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()

    @Test fun migrationPreservesSavedAnalysisOnRealAndroidSQLite() = runBlocking {
        val context = instrumentation.targetContext
        val name = "review_migration_test.db"
        context.deleteDatabase(name)
        context.openOrCreateDatabase(name, 0, null).use { legacy ->
            val sql = instrumentation.context.assets.open("v4.sql").bufferedReader().use { it.readText() }
            sql.split(';').filter { it.isNotBlank() }.forEach { legacy.execSQL(it) }
            legacy.execSQL("INSERT INTO analysis_results (id,practiceAttemptId,accuracyScore,toneScore,overallScore,detectedPitchData,feedbackNotes,verdictStatus,isSynced,analyzedAt) VALUES ('old_result','old_attempt',45,55,49,'[]','Original estimate','aiPending',1,1700000000000)")
            legacy.version = 4
        }
        val db = Room.databaseBuilder(context, HarmoniaDatabase::class.java, name).addMigrations(HarmoniaDatabase.MIGRATION_4_5, HarmoniaDatabase.MIGRATION_5_6).build()
        try {
            val original = db.analysisResultDao().getByAttemptId("old_attempt")!!
            assertEquals(45f, original.accuracyScore); assertNull(original.coachVerdict)
            db.analysisResultDao().saveCoachReview("old_attempt", "Good stability", "Steady vowel", 82f, 78f, "coach1", 1700000001000)
            val reviewed = db.analysisResultDao().getByAttemptId("old_attempt")!!
            assertEquals(45f, reviewed.accuracyScore); assertEquals(82f, reviewed.coachPitchScore)
            assertEquals("Original estimate", reviewed.feedbackNotes)
        } finally { db.close(); context.deleteDatabase(name) }
    }

    @Test fun actualWorkerAndLiveCoachListenersCompleteTheFeedbackRoundtrip() = runBlocking {
        val asset = "review-e2e.local.json"
        assumeTrue("Run scripts/native-review-smoke.mjs to provision isolated live fixtures", instrumentation.context.assets.list("")?.contains(asset) == true)
        val config = JSONObject(instrumentation.context.assets.open(asset).bufferedReader().use { it.readText() })
        val context = instrumentation.targetContext
        val auth = FirebaseAuth.getInstance()
        val db = HarmoniaDatabase.getInstance(context)
        val uid = config.getString("studentId")
        val attemptId = config.getString("attemptId")
        val file = File(context.filesDir, "$attemptId.wav")
        val jobs = mutableListOf<Job>()
        try {
            auth.signInWithEmailAndPassword(config.getString("studentEmail"), config.getString("password")).await()
            db.studentDao().insertOrUpdate(StudentEntity(uid, "Native Test", config.getString("studentEmail"), institutionId = config.getString("institutionId")))
            val bytes = ByteBuffer.allocate(44 + 88200 * 2).order(ByteOrder.LITTLE_ENDIAN)
            bytes.put("RIFF".toByteArray()); bytes.putInt(bytes.capacity() - 8); bytes.put("WAVEfmt ".toByteArray())
            bytes.putInt(16); bytes.putShort(1); bytes.putShort(1); bytes.putInt(44100); bytes.putInt(88200)
            bytes.putShort(2); bytes.putShort(16); bytes.put("data".toByteArray()); bytes.putInt(88200 * 2)
            repeat(88200) { bytes.putShort((kotlin.math.sin(2 * Math.PI * 440 * it / 44100) * 12000).toInt().toShort()) }
            file.writeBytes(bytes.array())
            db.practiceAttemptDao().insert(PracticeAttemptEntity(attemptId, uid, "ex_f1", file.absolutePath, 2))
            db.analysisResultDao().insert(AnalysisResultEntity("result_$attemptId", attemptId, 45f, 55f, 49f, detectedPitchData = "[]", feedbackNotes = "Original estimate"))
            val request = OneTimeWorkRequestBuilder<SyncWorker>().build()
            WorkManager.getInstance(context).enqueue(request).result.get()
            withTimeout(150_000) {
                while (true) {
                    val state = WorkManager.getInstance(context).getWorkInfoById(request.id).get()?.state
                    check(state != WorkInfo.State.FAILED) { "Native sync worker failed" }
                    if (state == WorkInfo.State.SUCCEEDED) break
                    delay(500)
                }
            }
            assertTrue(db.practiceAttemptDao().getById(attemptId)!!.isSynced)
            val feedback = CoachFeedbackSync(db)
            jobs += launch { feedback.watch(uid) }
            jobs += launch { feedback.watchAssessments(uid) }
            val reviewed = withTimeout(150_000) {
                db.analysisResultDao().observeByAttemptId(attemptId).first { it?.coachVerdict != null }!!
            }
            assertEquals("Good stability", reviewed.coachVerdict)
            assertEquals("Native roundtrip feedback", reviewed.coachFeedback)
            assertEquals(82f, reviewed.coachPitchScore); assertEquals(78f, reviewed.coachToneScore)
            assertEquals(45f, reviewed.accuracyScore); assertEquals(55f, reviewed.toneScore)
            val assessment = withTimeout(150_000) { db.coachAssessmentDao().observe(uid).first { it != null }!! }
            assertEquals("approved", assessment.verdict)
            assertEquals("Native general assessment", assessment.feedback)
            // Simulate a lost local acknowledgement after the coach has reviewed.
            val sessionRef = FirebaseFirestore.getInstance().collection("practiceSessions").document(attemptId)
            val reviewedAt = sessionRef.get(Source.SERVER).await().getTimestamp("reviewedAt")
            db.practiceAttemptDao().insert(db.practiceAttemptDao().getById(attemptId)!!.copy(isSynced = false))
            db.analysisResultDao().insert(reviewed.copy(isSynced = false))
            val replay = OneTimeWorkRequestBuilder<SyncWorker>().build()
            WorkManager.getInstance(context).enqueue(replay).result.get()
            withTimeout(150_000) {
                while (WorkManager.getInstance(context).getWorkInfoById(replay.id).get()?.state != WorkInfo.State.SUCCEEDED) delay(500)
            }
            val remoteAfterRetry = sessionRef.get(Source.SERVER).await()
            assertEquals(reviewedAt, remoteAfterRetry.getTimestamp("reviewedAt"))
            assertEquals("Native roundtrip feedback", remoteAfterRetry.getString("coachFeedback"))
            compose.setContent {
                HarmoniaTheme {
                    ResultsScreen(attemptId, PracticeRepository(db.practiceAttemptDao(), db.analysisResultDao(), db.progressReportDao()), {}, {}, {})
                }
            }
            compose.waitForIdle()
            compose.onNodeWithText("Coach Review Received").assertIsDisplayed()
            compose.onNodeWithText("Native roundtrip feedback").assertIsDisplayed()
            compose.onNodeWithText("Coach scores: pitch 82% · tone 78%").assertIsDisplayed()
            compose.onRoot().captureToImage().asAndroidBitmap().let { bitmap ->
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, "harmonia-review-e2e.png")
                    put(MediaStore.Downloads.MIME_TYPE, "image/png")
                    put(MediaStore.Downloads.RELATIVE_PATH, "Download/HarmoniaTests")
                }
                val uri = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)!!
                context.contentResolver.openOutputStream(uri)!!.use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            }
            jobs.forEach { it.cancelAndJoin() }
            auth.signOut()
            // Local persistence remains readable without any cloud identity.
            assertEquals("Native roundtrip feedback", db.analysisResultDao().getByAttemptId(attemptId)?.coachFeedback)
            assertEquals(assessment, db.coachAssessmentDao().observe(uid).first())
        } finally {
            jobs.forEach { it.cancelAndJoin() }
            auth.signOut()
            file.delete()
        }
    }
}
