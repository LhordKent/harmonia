package com.harmonia.analysis

import com.harmonia.analysis.dsp.AudioSample
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PitchToneAnalyzerTest {

    private val analyzer = DefaultPitchToneAnalyzer()

    @Test
    fun testEndToEndAnalysisOnSyntheticA4() {
        // A 2-second pure 440 Hz sine should produce a high pitch-accuracy score
        val audioSample = AudioSample.generateSine(
            frequencyHz = 440.0f,
            durationSeconds = 2.0f,
            sampleRate = 44100
        )

        val result = analyzer.analyze(
            audioSample = audioSample,
            targetNoteName = "A4",
            targetFrequencyHz = 440.0f
        )

        assertNotNull(result)
        assertTrue("Expected passing score for pure 440 Hz tone, was ${result.overallScore}", result.isPassed)
        assertTrue("Accuracy score should be >= 70, was ${result.accuracyScore}", result.accuracyScore >= 70.0f)
        assertTrue("Tone score should be > 0, was ${result.toneScore}", result.toneScore > 0.0f)
        assertEquals("aiPending", result.verdictStatus)
        assertTrue("Pitch frames should not be empty", result.pitchFrames.isNotEmpty())
        assertTrue("Feedback notes should be generated", result.feedbackNotes.isNotBlank())
    }

    @Test
    fun testFlatPitchScoresLow() {
        // 85 cents flat from A4: f = 440 * 2^(-85/1200) ≈ 415.3 Hz, targeting 440 Hz
        val flatFreq = (440.0 * Math.pow(2.0, -85.0 / 1200.0)).toFloat()
        val audioSample = AudioSample.generateSine(
            frequencyHz = flatFreq,
            durationSeconds = 2.0f,
            sampleRate = 44100
        )

        val result = analyzer.analyze(
            audioSample = audioSample,
            targetNoteName = "A4",
            targetFrequencyHz = 440.0f
        )

        assertNotNull(result)
        // 85 cents flat keeps inTuneRatio near 0 → SVM score low
        assertTrue(
            "Accuracy should be < 70 for 85-cent flat pitch, was ${result.accuracyScore}",
            result.accuracyScore < 70.0f
        )
        // A pitched (non-silent) result should NOT be noVoiceDetected
        assertTrue(
            "Verdict should not be 'noVoiceDetected' for pitched input, was '${result.verdictStatus}'",
            result.verdictStatus != "noVoiceDetected"
        )
    }

    @Test
    fun testSilenceReturnsNoVoiceDetected() {
        // All-zero samples → RMS < 0.01 → no voiced frames → noVoiceDetected
        val silence = AudioSample(FloatArray(44100 * 2) { 0.0f }, 44100)

        val result = analyzer.analyze(
            audioSample = silence,
            targetNoteName = "A4",
            targetFrequencyHz = 440.0f
        )

        assertNotNull(result)
        assertEquals("noVoiceDetected", result.verdictStatus)
        assertEquals(0.0f, result.overallScore, 0.001f)
        assertEquals(0.0f, result.accuracyScore, 0.001f)
        assertTrue(
            "Feedback should mention 'No voice', was: '${result.feedbackNotes}'",
            result.feedbackNotes.contains("No voice", ignoreCase = true)
        )
    }

    @Test
    fun testVeryShortClipReturnsNoVoiceDetected() {
        // 0.02 s = 882 samples — shorter than one YIN buffer (2048) → no frames → noVoiceDetected
        val tinyClip = AudioSample.generateSine(
            frequencyHz = 440.0f,
            durationSeconds = 0.02f,
            sampleRate = 44100
        )

        val result = analyzer.analyze(
            audioSample = tinyClip,
            targetNoteName = "A4",
            targetFrequencyHz = 440.0f
        )

        assertNotNull(result)
        assertEquals(
            "Very short clip should return noVoiceDetected, was '${result.verdictStatus}'",
            "noVoiceDetected",
            result.verdictStatus
        )
        assertEquals(0.0f, result.overallScore, 0.001f)
    }

    @Test
    fun briefToneCannotPassSustainExercise() {
        val brief = AudioSample.generateSine(440f, 0.2f)
        val result = analyzer.analyze(brief, "A4", 440f)
        assertEquals("insufficientAudio", result.verdictStatus)
        assertTrue(!result.isPassed)
        assertEquals(0f, result.overallScore, 0.001f)
    }

    @Test
    fun toneFollowedBySilenceCannotPass() {
        val samples = FloatArray(44100 * 15)
        AudioSample.generateSine(440f, 0.2f).samples.copyInto(samples)
        val result = analyzer.analyze(AudioSample(samples), "A4", 440f, 15f)
        assertEquals("insufficientAudio", result.verdictStatus)
        assertTrue(!result.isPassed)
        assertEquals(0f, result.accuracyScore, 0.001f)
    }

    @Test
    fun stoppingEarlyCannotPassLongExercise() {
        val result = analyzer.analyze(AudioSample.generateSine(440f, 2f), "A4", 440f, 15f)
        assertEquals("insufficientAudio", result.verdictStatus)
        assertTrue(!result.isPassed)
    }

    @Test
    fun silenceLowersAccuracyInsteadOfBeingExcluded() {
        val full = AudioSample.generateSine(440f, 3f).samples
        java.util.Arrays.fill(full, 0, 44100 / 2, 0f)
        val result = analyzer.analyze(AudioSample(full), "A4", 440f, 3f)
        assertTrue(result.accuracyScore in 75f..90f)
    }
}
