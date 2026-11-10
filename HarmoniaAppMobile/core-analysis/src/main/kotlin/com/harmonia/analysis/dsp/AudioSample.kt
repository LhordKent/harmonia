package com.harmonia.analysis.dsp

import java.io.ByteArrayInputStream
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.sin

/**
 * AudioSample represents mono 16-bit PCM audio sampled at a given sample rate (default 44100 Hz).
 * It includes utilities for reading raw PCM buffers, WAV streams, and generating synthetic test tones.
 */
data class AudioSample(
    val samples: FloatArray,
    val sampleRate: Int = 44100
) {
    val durationSeconds: Float get() = samples.size.toFloat() / sampleRate

    fun slice(startIndex: Int, endIndex: Int): FloatArray {
        val start = startIndex.coerceIn(0, samples.size)
        val end = endIndex.coerceIn(start, samples.size)
        return samples.copyOfRange(start, end)
    }

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false
        other as AudioSample
        return samples.contentEquals(other.samples) && sampleRate == other.sampleRate
    }

    override fun hashCode(): Int {
        var result = samples.contentHashCode()
        result = 31 * result + sampleRate
        return result
    }

    companion object {
        fun fromShortArray(shorts: ShortArray, sampleRate: Int = 44100): AudioSample {
            val floats = FloatArray(shorts.size)
            for (i in shorts.indices) {
                floats[i] = shorts[i] / 32768.0f
            }
            return AudioSample(floats, sampleRate)
        }

        fun fromByteArray(bytes: ByteArray, sampleRate: Int = 44100): AudioSample {
            val shortCount = bytes.size / 2
            val floats = FloatArray(shortCount)
            val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
            for (i in 0 until shortCount) {
                floats[i] = buffer.short / 32768.0f
            }
            return AudioSample(floats, sampleRate)
        }

        /**
         * Decodes standard 16-bit PCM WAV bytes (mono or stereo converted to mono).
         */
        fun fromWavBytes(wavBytes: ByteArray): AudioSample {
            if (wavBytes.size < 44) {
                return AudioSample(FloatArray(0))
            }
            val buffer = ByteBuffer.wrap(wavBytes).order(ByteOrder.LITTLE_ENDIAN)

            // Verify RIFF & WAVE markers
            val riff = ByteArray(4)
            buffer.get(riff)
            if (String(riff) != "RIFF") return fromByteArray(wavBytes)
            buffer.int // ChunkSize
            val wave = ByteArray(4)
            buffer.get(wave)
            if (String(wave) != "WAVE") return fromByteArray(wavBytes)

            var sampleRate = 44100
            var channels = 1
            var bitsPerSample = 16
            var dataOffset = 44
            var dataSize = wavBytes.size - 44

            while (buffer.remaining() >= 8) {
                val chunkId = ByteArray(4)
                buffer.get(chunkId)
                val chunkSize = buffer.int
                val chunkIdStr = String(chunkId)

                if (chunkIdStr == "fmt ") {
                    val audioFormat = buffer.short.toInt()
                    channels = buffer.short.toInt()
                    sampleRate = buffer.int
                    buffer.int // ByteRate
                    buffer.short // BlockAlign
                    bitsPerSample = buffer.short.toInt()
                    val extra = chunkSize - 16
                    if (extra > 0 && buffer.remaining() >= extra) {
                        buffer.position(buffer.position() + extra)
                    }
                } else if (chunkIdStr == "data") {
                    dataOffset = buffer.position()
                    dataSize = chunkSize.coerceAtMost(buffer.remaining())
                    break
                } else {
                    if (buffer.remaining() >= chunkSize) {
                        buffer.position(buffer.position() + chunkSize)
                    } else {
                        break
                    }
                }
            }

            buffer.position(dataOffset)
            val samples: FloatArray
            if (bitsPerSample == 16) {
                val totalSamples = dataSize / (2 * channels)
                samples = FloatArray(totalSamples)
                for (i in 0 until totalSamples) {
                    var sum = 0.0f
                    for (c in 0 until channels) {
                        sum += buffer.short / 32768.0f
                    }
                    samples[i] = sum / channels
                }
            } else {
                val totalSamples = dataSize / channels
                samples = FloatArray(totalSamples)
                for (i in 0 until totalSamples) {
                    var sum = 0.0f
                    for (c in 0 until channels) {
                        sum += ((buffer.get().toInt() and 0xFF) - 128) / 128.0f
                    }
                    samples[i] = sum / channels
                }
            }

            return AudioSample(samples, sampleRate)
        }

        /**
         * Generates a synthetic sine tone for testing and pitch verification.
         */
        fun generateSine(
            frequencyHz: Float,
            durationSeconds: Float,
            sampleRate: Int = 44100,
            amplitude: Float = 0.8f
        ): AudioSample {
            val totalSamples = (sampleRate * durationSeconds).toInt()
            val samples = FloatArray(totalSamples)
            val twoPiF = 2.0 * PI * frequencyHz
            for (i in 0 until totalSamples) {
                val t = i.toDouble() / sampleRate
                samples[i] = (amplitude * sin(twoPiF * t)).toFloat()
            }
            return AudioSample(samples, sampleRate)
        }
    }
}
