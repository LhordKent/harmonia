package com.harmonia.app

import com.harmonia.app.ui.audio.NeuralPitchEstimator
import com.harmonia.analysis.dsp.AudioSample
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.*

class NeuralPitchEstimatorTest {
    private fun model() = File("src/main/assets/models/swiftf0.onnx").readBytes()
    @Test fun matchesPinnedPythonReference() {
        val bytes = File("src/test/resources/models/parity.f32").readBytes()
        val floats = FloatArray(bytes.size / 4)
        ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer().get(floats)
        val expected = File("src/test/resources/models/parity.csv").readLines().drop(1).map { it.split(',').map(String::toDouble) }
        NeuralPitchEstimator(model()).use { estimator ->
            val actual = estimator.estimate(AudioSample(floats, 16000))
            assertEquals(expected.size, actual.size)
            actual.forEachIndexed { i, frame ->
                assertEquals(expected[i][0], frame.seconds, 1e-8)
                assertEquals(expected[i][1], frame.hz.toDouble(), .02)
                assertEquals(expected[i][2], frame.confidence.toDouble(), .001)
            }
        }
    }
    @Test fun silenceDoesNotBecomeVoicedAndResamplingPreservesPitch() {
        NeuralPitchEstimator(model()).use { estimator ->
            assertTrue(estimator.estimate(AudioSample(FloatArray(32000), 16000)).all { it.confidence == 0f })
            for (rate in listOf(16000, 44100, 48000)) {
                val frames = estimator.estimate(AudioSample.generateSine(261.63f, 2f, rate))
                val voiced = frames.filter { it.confidence >= .5f }.drop(5).dropLast(5)
                assertTrue("No usable pitch at $rate", voiced.isNotEmpty())
                assertTrue(voiced.count { abs(1200 * log2(it.hz / 261.63)) < 25 }.toDouble() / voiced.size > .9)
            }
        }
    }
    @Test fun rejectsDifferentModelArtifact() {
        assertThrows(IllegalStateException::class.java) { NeuralPitchEstimator(byteArrayOf(1, 2, 3)) }
    }
}
