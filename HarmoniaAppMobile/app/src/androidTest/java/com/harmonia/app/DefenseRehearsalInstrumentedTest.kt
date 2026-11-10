package com.harmonia.app

import android.Manifest
import android.content.ContentValues
import android.graphics.Bitmap
import android.provider.MediaStore
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.harmonia.app.data.local.HarmoniaDatabase
import com.harmonia.app.data.repository.*
import com.harmonia.app.data.sync.*
import com.harmonia.app.ui.audio.*
import com.harmonia.app.ui.screens.*
import com.harmonia.app.ui.theme.HarmoniaTheme
import com.harmonia.analysis.dsp.AudioSample
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.net.URL

@RunWith(AndroidJUnit4::class)
class DefenseRehearsalInstrumentedTest {
    @get:Rule val compose = createComposeRule()
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()

    @Test fun androidMicrophoneStartsStopsAndCanBeReopened() = runBlocking {
        val context = instrumentation.targetContext
        instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.RECORD_AUDIO)
        val recorder = AudioRecorder(context)
        try {
            recorder.startRecording(this, 440f)
            assertTrue(recorder.liveState.value.errorMessage, recorder.liveState.value.isRecording)
            delay(800)
            val (sample, path) = recorder.stopRecording(saveFile = false)
            assertTrue("Android AudioRecord returned no PCM samples", sample.samples.isNotEmpty())
            assertEquals("", path)
            recorder.startRecording(this, 440f); assertTrue(recorder.liveState.value.isRecording)
            delay(200); recorder.cancelRecording(); delay(100)
            assertFalse(recorder.liveState.value.isRecording)
        } finally { recorder.cancelRecording() }
    }

    @Test fun loginWebExerciseReferenceRecordScoreUploadReviewAndOfflineResults() = runBlocking {
        assumeTrue(instrumentation.context.assets.list("")?.contains("review-e2e.local.json") == true)
        val config = JSONObject(instrumentation.context.assets.open("review-e2e.local.json").bufferedReader().use { it.readText() })
        val context = instrumentation.targetContext
        instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.RECORD_AUDIO)
        val local = HarmoniaDatabase.getInstance(context)
        val auth = AuthRepository(local.studentDao())
        val exercises = ExerciseRepository(local.exerciseDao(), local.practiceSessionDao(), local.notificationDao())
        val practice = PracticeRepository(local.practiceAttemptDao(), local.analysisResultDao(), local.progressReportDao(), database = local)
        val achievements = AchievementRepository(local.achievementDao(), local.notificationDao())
        auth.login(config.getString("studentEmail"), config.getString("password")).getOrThrow()
        val uid = config.getString("studentId")
        val syncRequest = OneTimeWorkRequestBuilder<SyncWorker>().build()
        WorkManager.getInstance(context).enqueue(syncRequest).result.get()
        withTimeout(120_000) {
            while (WorkManager.getInstance(context).getWorkInfoById(syncRequest.id).get()?.state != WorkInfo.State.SUCCEEDED) delay(500)
        }
        val exercise = exercises.getExerciseById(config.getString("exerciseId"))!!
        assertEquals("C4", exercise.targetNote); assertEquals(261.63f, exercise.targetFrequencyHz); assertEquals(3, exercise.durationSeconds)
        val reference = SupabaseAudioStore(FirebaseFirestore.getInstance(), FirebaseAuth.getInstance()).playbackUrl(exercise.audioSampleUrl!!)
        val downloaded = withContext(Dispatchers.IO) { URL(reference).readBytes() }
        assertEquals(3f, AudioSample.fromWavBytes(downloaded).durationSeconds, .01f)
        assertEquals(0, practice.getDashboardStats(uid).totalSessionsCompleted)
        val sine = AudioSample.generateSine(261.63f, 3f).samples.map { (it * 30000).toInt().toShort() }.toShortArray()
        val input = object : PcmInput {
            var offset = 0
            override fun start() {}
            override fun read(buffer: ShortArray): Int {
                val size = minOf(buffer.size, sine.size - offset)
                if (size == 0) return 0
                sine.copyInto(buffer, 0, offset, offset + size); offset += size; return size
            }
            override fun stop() {}
            override fun release() {}
        }
        val recorder = object : PcmRecorder(File(context.filesDir, "recordings"), { input }) {
            override fun finalizeRecording(wav: File): File = RecordingCodec.encode(wav)
        }
        var attemptId by mutableStateOf<String?>(null)
        try {
            compose.setContent {
                HarmoniaTheme {
                    val id = attemptId
                    if (id == null) PracticeScreen(exercise.id, auth, exercises, practice, achievements, { attemptId = it }, {}, { recorder })
                    else ResultsScreen(id, practice, {}, {}, {})
                }
            }
            compose.waitUntil(30_000) { compose.onAllNodesWithText("Play reference audio").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("Play reference audio").performClick()
            compose.waitUntil(30_000) { compose.onAllNodesWithText("Stop reference audio").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("Stop reference audio").performClick()
            compose.onNodeWithContentDescription("Start Recording").performClick()
            compose.waitUntil(30_000) { recorder.liveState.value.durationSeconds >= 3 }
            compose.onNodeWithContentDescription("Stop Recording").performClick()
            compose.waitUntil(90_000) { attemptId != null }
            // Mount ResultsScreen (and its live listeners) before suspending this
            // test on a Room flow. Compose's test clock does not drive itself.
            compose.waitForIdle()
            compose.onNodeWithText("Coach review for this recording").assertExists()
            val result = local.analysisResultDao().getByAttemptId(attemptId!!)!!
            assertEquals("m4a", File(local.practiceAttemptDao().getById(attemptId!!)!!.audioRecordingUrl).extension)
            assertTrue("C4 target was not analyzed accurately: ${result.accuracyScore}", result.accuracyScore > 90f)
            assertEquals(1, practice.getDashboardStats(uid).totalSessionsCompleted)
            val reviewed = withTimeout(150_000) { local.analysisResultDao().observeByAttemptId(attemptId!!).first { it?.coachVerdict != null }!! }
            assertEquals("Native roundtrip feedback", reviewed.coachFeedback)
            assertNotNull(reviewed.gradingEvidence)
            withTimeout(20_000) { while (local.practiceSessionDao().getSession(uid, exercise.id)?.status != "completed") delay(200) }
            assertEquals("approved", local.analysisResultDao().getByAttemptId(attemptId!!)?.advancementDecision)
            compose.waitUntil(20_000) { compose.onAllNodesWithText("Coach Review Received").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("Native roundtrip feedback").assertIsDisplayed()
            val assessment = withTimeout(150_000) { local.coachAssessmentDao().observe(uid).first { it != null }!! }
            assertEquals("approved", assessment.verdict)
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, "harmonia-defense-e2e.png")
                put(MediaStore.Downloads.MIME_TYPE, "image/png")
                put(MediaStore.Downloads.RELATIVE_PATH, "Download/HarmoniaTests")
            }
            val uri = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)!!
            compose.onRoot().captureToImage().asAndroidBitmap().let { bitmap -> context.contentResolver.openOutputStream(uri)!!.use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) } }
            FirebaseAuth.getInstance().signOut()
            assertEquals(reviewed.coachFeedback, local.analysisResultDao().getByAttemptId(attemptId!!)?.coachFeedback)
        } finally { recorder.cancelRecording(); FirebaseAuth.getInstance().signOut() }
    }
}
