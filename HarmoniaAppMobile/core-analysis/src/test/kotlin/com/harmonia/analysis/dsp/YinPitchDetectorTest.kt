package com.harmonia.analysis.dsp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class YinPitchDetectorTest {

    private val detector = YinPitchDetector(sampleRate = 44100, bufferSize = 2048)

    @Test
    fun testDetectA4_440Hz() {
        val sample = AudioSample.generateSine(frequencyHz = 440.0f, durationSeconds = 0.5f)
        val result = detector.getPitch(sample.samples, offset = 0, targetFrequencyHz = 440.0f)

        assertTrue("Expected pitched signal", result.isPitched)
        assertEquals("Expected note A4", "A4", result.noteName)
        assertTrue("Estimated frequency should be close to 440Hz: got ${result.frequencyHz}",
            abs(result.frequencyHz - 440.0f) < 3.0f)
        assertEquals(PitchColorCategory.ON_PITCH, result.colorCategory)
    }

    @Test
    fun testDetectC4_261Hz() {
        val sample = AudioSample.generateSine(frequencyHz = 261.63f, durationSeconds = 0.5f)
        val result = detector.getPitch(sample.samples, offset = 0, targetFrequencyHz = 261.63f)

        assertTrue("Expected pitched signal", result.isPitched)
        assertEquals("Expected note C4", "C4", result.noteName)
        assertTrue("Estimated frequency should be close to 261.63Hz: got ${result.frequencyHz}",
            abs(result.frequencyHz - 261.63f) < 3.0f)
        assertEquals(PitchColorCategory.ON_PITCH, result.colorCategory)
    }

    @Test
    fun testDetectE5_659Hz() {
        val sample = AudioSample.generateSine(frequencyHz = 659.25f, durationSeconds = 0.5f)
        val result = detector.getPitch(sample.samples, offset = 0, targetFrequencyHz = 659.25f)

        assertTrue("Expected pitched signal", result.isPitched)
        assertEquals("Expected note E5", "E5", result.noteName)
        assertTrue("Estimated frequency should be close to 659.25Hz: got ${result.frequencyHz}",
            abs(result.frequencyHz - 659.25f) < 5.0f)
    }

    @Test
    fun testSilenceIsUnpitched() {
        val silence = FloatArray(2048) { 0.0f }
        val result = detector.getPitch(silence, offset = 0)
        assertTrue("Silence should not be pitched", !result.isPitched)
        assertEquals(PitchColorCategory.UNPITCHED, result.colorCategory)
    }

    @Test
    fun testNoteNameAndFrequencyConversion() {
        val freqA4 = YinPitchDetector.noteNameToFrequency("A4")
        assertEquals(440.0f, freqA4 ?: 0.0f, 0.5f)

        val freqC4 = YinPitchDetector.noteNameToFrequency("C4")
        assertEquals(261.63f, freqC4 ?: 0.0f, 0.5f)

        val name = YinPitchDetector.frequencyToNoteName(440.0f)
        assertEquals("A4", name)
    }

    @Test
    fun testColorCategorization() {
        assertEquals(PitchColorCategory.ON_PITCH, YinPitchDetector.categorizePitch(15.0f))
        assertEquals(PitchColorCategory.ON_PITCH, YinPitchDetector.categorizePitch(-20.0f))
        assertEquals(PitchColorCategory.NEAR_PITCH, YinPitchDetector.categorizePitch(35.0f))
        assertEquals(PitchColorCategory.NEAR_PITCH, YinPitchDetector.categorizePitch(-45.0f))
        assertEquals(PitchColorCategory.OFF_PITCH, YinPitchDetector.categorizePitch(65.0f))
        assertEquals(PitchColorCategory.OFF_PITCH, YinPitchDetector.categorizePitch(-120.0f))
    }
}
