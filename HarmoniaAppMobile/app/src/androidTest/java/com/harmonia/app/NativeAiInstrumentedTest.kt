package com.harmonia.app

import android.media.MediaExtractor
import android.media.MediaFormat
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.harmonia.analysis.*
import com.harmonia.analysis.dsp.AudioSample
import com.harmonia.app.ui.audio.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.*

@RunWith(AndroidJUnit4::class)
class NativeAiInstrumentedTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    @Test fun tenMinuteAnalysisStaysWithinLatencyBudgetAndCoversTheEntireClip() {
        val samples = FloatArray(16000 * 600) { i ->
            val phase = 2 * PI * 220 * i / 16000
            (.35 * sin(phase) + .15 * sin(phase * 2) + .05 * sin(phase * 3)).toFloat()
        }
        val started = android.os.SystemClock.elapsedRealtime()
        NeuralPitchEstimator(context.assets.open("models/swiftf0.onnx").use { it.readBytes() }).use { estimator ->
            val result = PracticeGrader(estimator, NeuralPitchEstimator.ENGINE).grade(AudioSample(samples, 16000),
                listOf(TargetNote(0.0, 600.0, 220f)), 600.0, GradingPolicy.forDifficulty("Beginner"))
            assertTrue(result.evidence.reasons.toString(), result.evidence.automaticPassed)
            assertEquals(6000, result.result.pitchFrames.size)
            assertTrue(result.result.pitchFrames.last().timestampMs >= 599000)
        }
        val elapsed = android.os.SystemClock.elapsedRealtime() - started
        android.util.Log.i("HarmoniaAI", "Ten-minute analysis elapsedMs=$elapsed")
        assertTrue("Ten-minute analysis exceeded 60-second budget: ${elapsed}ms", elapsed <= 60_000)
    }
    @Test fun neuralMelodyGradingTracksChangingNotesAndExcludesReferenceRests() {
        val notes = listOf(TargetNote(0.0, 3.0, 261.63f), TargetNote(4.0, 6.0, 329.63f), TargetNote(6.0, 8.0, 392f))
        val samples = FloatArray(16000 * 8) { i ->
            val time = i / 16000.0; val hz = notes.firstOrNull { time >= it.startSeconds && time < it.endSeconds }?.frequencyHz
            if (hz == null) 0f else {
                val phase = 2 * PI * hz * time
                (.35 * sin(phase) + .15 * sin(phase * 2) + .05 * sin(phase * 3)).toFloat()
            }
        }
        NeuralPitchEstimator(context.assets.open("models/swiftf0.onnx").use { it.readBytes() }).use { estimator ->
            val graded = PracticeGrader(estimator, NeuralPitchEstimator.ENGINE).grade(AudioSample(samples, 16000),
                notes, 8.0, GradingPolicy.forDifficulty("Beginner"), "song")
            assertEquals(graded.evidence.reasons.toString(), "scored", graded.evidence.status)
            assertTrue("Melody accuracy: ${graded.evidence.pitchScore}", graded.evidence.pitchScore!! >= 85)
            assertTrue(graded.evidence.automaticPassed)
        }
    }
    @Test fun bundledModelGradesSingingLikeHarmonicsOnAndroidWithoutAnAccount() {
        val hz = 261.63f
        val audio = AudioSample(FloatArray(16000 * 3) { i ->
            val phase = 2 * PI * hz * i / 16000
            (.35 * sin(phase) + .15 * sin(2 * phase) + .05 * sin(3 * phase)).toFloat()
        }, 16000)
        val bytes = context.assets.open("models/swiftf0.onnx").use { it.readBytes() }
        NeuralPitchEstimator(bytes).use { estimator ->
            val result = PracticeGrader(estimator, NeuralPitchEstimator.ENGINE).grade(audio,
                listOf(TargetNote(0.0, 3.0, hz)), 3.0, GradingPolicy.forDifficulty("Beginner"))
            assertTrue(result.evidence.reasons.toString(), result.evidence.automaticPassed)
            assertTrue(result.evidence.pitchScore!! > 90)
            assertTrue(result.evidence.toneScore!! > 80)
        }
    }
    @Test fun tenMinuteRecordingEncodesBelowStorageLimitAndRetainsOriginalOnDisk() {
        val wav = File(context.cacheDir, "ai_long_recording.wav")
        val count = 16000 * 600
        val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray()); putInt(count * 2 + 36); put("WAVEfmt ".toByteArray()); putInt(16)
            putShort(1); putShort(1); putInt(16000); putInt(32000); putShort(2); putShort(16); put("data".toByteArray()); putInt(count * 2)
        }.array()
        val block = ByteBuffer.allocate(32000).order(ByteOrder.LITTLE_ENDIAN).apply {
            repeat(16000) { putShort((10000 * sin(2 * PI * 220 * it / 16000)).toInt().toShort()) }
        }.array()
        val encoded = File(wav.parentFile, wav.nameWithoutExtension + ".m4a")
        encoded.delete()
        try {
            wav.outputStream().use { out -> out.write(header); repeat(600) { out.write(block) } }
            assertEquals(19_200_044L, wav.length())
            val result = RecordingCodec.encode(wav)
            assertTrue(result.length() in 1..8L * 1024 * 1024)
            assertTrue(wav.exists())
            val extractor = MediaExtractor()
            try {
                extractor.setDataSource(result.absolutePath)
                val format = extractor.getTrackFormat(0)
                assertEquals("audio/mp4a-latm", format.getString(MediaFormat.KEY_MIME))
                assertEquals(600.0, format.getLong(MediaFormat.KEY_DURATION) / 1_000_000.0, .5)
            } finally { extractor.release() }
        } finally { wav.delete(); encoded.delete() }
    }
}
