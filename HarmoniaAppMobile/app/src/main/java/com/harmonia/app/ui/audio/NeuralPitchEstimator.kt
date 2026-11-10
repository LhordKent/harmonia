package com.harmonia.app.ui.audio

import ai.onnxruntime.*
import com.harmonia.analysis.PitchEstimate
import com.harmonia.analysis.PitchEstimator
import com.harmonia.analysis.dsp.AudioSample
import java.nio.FloatBuffer
import java.security.MessageDigest
import kotlin.math.*

/** SwiftF0's pinned ONNX includes its spectrogram and pitch decoding; no hand-ported preprocessing. */
class NeuralPitchEstimator(model: ByteArray) : PitchEstimator, AutoCloseable {
    private val environment = OrtEnvironment.getEnvironment()
    private val session: OrtSession
    init {
        val hash = MessageDigest.getInstance("SHA-256").digest(model).joinToString("") { "%02x".format(it) }
        check(hash == MODEL_SHA256) { "The pitch model could not be verified. Reinstall the app." }
        session = OrtSession.SessionOptions().use { options ->
            options.setIntraOpNumThreads(2)
            options.addConfigEntry("session.intra_op.allow_spinning", "0")
            environment.createSession(model, options)
        }
    }
    override fun estimate(audio: AudioSample): List<PitchEstimate> {
        val signal = resample(audio.samples, audio.sampleRate)
        require(signal.isNotEmpty()) { "Recording contains no audio." }
        val count = max(1, signal.size / 256)
        val results = ArrayList<PitchEstimate>(count)
        for (start in 0 until count step 1875) {
            if (Thread.currentThread().isInterrupted) throw InterruptedException("Pitch analysis cancelled.")
            val end = min(start + 1875, count)
            val left = max(0, start - 11)
            val sampleEnd = if (end < count) min(signal.size, (end + 10) * 256) else signal.size
            val window = signal.copyOfRange(left * 256, sampleEnd)
            OnnxTensor.createTensor(environment, FloatBuffer.wrap(window), longArrayOf(1, window.size.toLong())).use { input ->
                OnnxTensor.createTensor(environment, 65f).use { minimum ->
                    OnnxTensor.createTensor(environment, 1050f).use { maximum ->
                        session.run(mapOf("audio" to input, "fmin" to minimum, "fmax" to maximum)).use { output ->
                            val pitch = (output.get("pitch").get().value as Array<*>)[0] as DoubleArray
                            val confidence = (output.get("confidence").get().value as Array<*>)[0] as FloatArray
                            for (i in start until end) {
                                val local = i - left
                                var peak = 0f
                                for (s in i * 256 until min(signal.size, (i + 1) * 256)) peak = max(peak, abs(signal[s]))
                                results += PitchEstimate(i * .016, pitch[local].toFloat(), if (peak < .001f) 0f else confidence[local])
                            }
                        }
                    }
                }
            }
        }
        return results
    }
    override fun close() = session.close()

    companion object {
        const val MODEL_SHA256 = "6385e8c2ebc3872e82c9ff5946228de44cd3be77a750ea53698b7dbfe94b0a22"
        const val ENGINE = "swiftf0-d1ba77fe"
        /** Windowed-sinc low-pass resampling. Live production capture is already 16 kHz. */
        fun resample(samples: FloatArray, sourceRate: Int): FloatArray {
            require(sourceRate in 8000..192000 && samples.all { it.isFinite() })
            if (sourceRate == 16000) return samples
            val size = (samples.size.toDouble() * 16000 / sourceRate).roundToInt()
            val cutoff = min(1.0, 16000.0 / sourceRate) * .94
            return FloatArray(size) { i ->
                val location = i.toDouble() * sourceRate / 16000
                val center = floor(location).toInt()
                var sum = 0.0; var weights = 0.0
                for (j in center - 24..center + 24) {
                    if (j !in samples.indices) continue
                    val d = location - j
                    val kernel = if (abs(d) < 1e-9) cutoff else sin(PI * cutoff * d) / (PI * d)
                    val weight = kernel * (.5 + .5 * cos(PI * d / 25))
                    sum += samples[j] * weight; weights += weight
                }
                (if (abs(weights) > 1e-9) sum / weights else 0.0).toFloat()
            }
        }
    }
}
