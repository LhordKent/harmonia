package com.harmonia.analysis

import com.harmonia.analysis.dsp.AudioSample
import org.junit.Assert.*
import org.junit.Test
import kotlin.math.*

class PracticeGraderTest {
    private val beginner = GradingPolicy.forDifficulty("Beginner")
    private fun grader(frequency: Float, voiced: Boolean = true) = PracticeGrader(PitchEstimator { audio ->
        List((audio.durationSeconds / .016f).toInt()) { PitchEstimate(it * .016, frequency, if (voiced) 1f else 0f) }
    }, "test")
    private val target = listOf(TargetNote(0.0, 3.0, 440f))
    @Test fun difficultyChangesPitchToleranceAndPassMark() {
        val hz = (440 * 2.0.pow(40.0 / 1200)).toFloat()
        val audio = AudioSample.generateSine(hz, 3f)
        val easy = grader(hz).grade(audio, target, 3.0, beginner)
        val hard = grader(hz).grade(audio, target, 3.0, GradingPolicy.forDifficulty("Advanced"))
        assertTrue(easy.evidence.automaticPassed)
        assertEquals(0f, hard.evidence.pitchScore!!, .01f)
        assertFalse(hard.evidence.automaticPassed)
        assertEquals(60f, beginner.passMark)
        assertEquals(70f, GradingPolicy.forDifficulty("Intermediate").passMark)
        assertEquals(80f, GradingPolicy.forDifficulty("Advanced").passMark)
    }
    @Test fun silenceShortAudioAndClippingWithholdGrades() {
        val silence = grader(440f, false).grade(AudioSample(FloatArray(44100 * 3)), target, 3.0, beginner)
        assertNull(silence.evidence.pitchScore)
        assertFalse(silence.evidence.automaticPassed)
        val short = grader(440f).grade(AudioSample.generateSine(440f, .2f), target, 3.0, beginner)
        assertEquals("needsRecording", short.evidence.status)
        val clipped = grader(440f).grade(AudioSample(FloatArray(44100 * 3) { 1f }), target, 3.0, beginner)
        assertNull(clipped.evidence.overallScore)
    }
    @Test fun freePracticeHasToneButNoPitchGradeOrPass() {
        val result = grader(440f).grade(AudioSample.generateSine(440f, 3f), emptyList(), 3.0, beginner, "free")
        assertEquals("unscored", result.evidence.status)
        assertNull(result.evidence.pitchScore)
        assertNotNull(result.evidence.toneScore)
        assertFalse(result.evidence.automaticPassed)
    }
    @Test fun melodyRestsAreNotMissedNotesAndSkippedPhraseCannotDisappear() {
        val notes = listOf(TargetNote(0.0, 2.0, 440f), TargetNote(3.0, 5.0, 523.25f))
        val samples = FloatArray(44100 * 5) { i ->
            val time = i / 44100.0
            if (time in 2.0..<3.0) 0f else (.4 * sin(2 * PI * (if (time < 2) 440.0 else 523.25) * time)).toFloat()
        }
        val detector = PitchEstimator { List(312) { i ->
            val t = i * .016
            PitchEstimate(t, if (t < 2) 440f else if (t >= 3) 523.25f else 0f, 1f)
        } }
        val result = PracticeGrader(detector, "test").grade(AudioSample(samples), notes, 5.0, beginner, "scale")
        assertTrue(result.evidence.pitchScore!! >= 90)
        assertTrue(result.evidence.automaticPassed)
        val missed = grader(440f).grade(AudioSample.generateSine(440f, 5f), notes, 5.0, beginner, "song")
        assertFalse(missed.evidence.automaticPassed)
    }
    @Test fun wrongOctaveDoesNotGetCorrected() {
        val result = grader(220f).grade(AudioSample.generateSine(220f, 3f), target, 3.0, beginner)
        assertEquals(0f, result.evidence.pitchScore!!, .01f)
        assertFalse(result.evidence.automaticPassed)
    }
}
