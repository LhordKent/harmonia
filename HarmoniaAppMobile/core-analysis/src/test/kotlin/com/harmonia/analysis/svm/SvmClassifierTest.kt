package com.harmonia.analysis.svm

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SvmClassifierTest {

    @Test
    fun testStandardScaler() {
        val scaler = StandardScalerConfig(
            mean = doubleArrayOf(10.0, 20.0),
            scale = doubleArrayOf(2.0, 5.0)
        )
        val transformed = scaler.transform(doubleArrayOf(14.0, 10.0))
        assertEquals(2.0, transformed[0], 1e-4)
        assertEquals(-2.0, transformed[1], 1e-4)
    }

    @Test
    fun testPitchSvmAccuratePrediction() {
        val classifier = SvmClassifier.DEFAULT_PITCH_MODEL

        // Highly accurate singer: mean cents err = 8.0, std = 6.0, inTuneRatio = 0.95, latency = 0.2s
        val features = doubleArrayOf(8.0, 6.0, 0.95, 0.2)
        val prediction = classifier.predict(features)

        assertTrue("Expected score >= 75.0, got ${prediction.score}", prediction.score >= 75.0f)
        assertTrue("Expected passed verdict", prediction.isPassed)
        assertTrue("Decision value should be positive", prediction.decisionValue > 0.0)
    }

    @Test
    fun testPitchSvmInaccuratePrediction() {
        val classifier = SvmClassifier.DEFAULT_PITCH_MODEL

        // Off-pitch singer: mean cents err = 85.0, std = 45.0, inTuneRatio = 0.15, latency = 1.2s
        val features = doubleArrayOf(85.0, 45.0, 0.15, 1.2)
        val prediction = classifier.predict(features)

        assertTrue("Expected score < 50.0, got ${prediction.score}", prediction.score < 50.0f)
        assertFalse("Expected failed verdict", prediction.isPassed)
    }

    @Test
    fun testToneSvmResonantPrediction() {
        val classifier = SvmClassifier.DEFAULT_TONE_MODEL

        // High clarity tone: low jitter (0.35%), low shimmer (1.2%), high HNR (24.0 dB)
        val features = doubleArrayOf(0.35, 0.20, 1.2, 0.15, 24.0)
        val prediction = classifier.predict(features)

        assertTrue("Expected tone score >= 70.0, got ${prediction.score}", prediction.score >= 70.0f)
        assertTrue(prediction.isPassed)
    }
}
