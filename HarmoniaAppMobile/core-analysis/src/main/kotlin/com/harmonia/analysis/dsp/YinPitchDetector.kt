package com.harmonia.analysis.dsp

import kotlin.math.abs
import kotlin.math.ln
import kotlin.math.log2
import kotlin.math.roundToInt

/**
 * Color-coded visual feedback categories matching Section 1 and Section 4 of the Harmonia specification:
 * - ON_PITCH: Green (within ±25 cents of target note)
 * - NEAR_PITCH: Yellow (between 25 and 50 cents of target note)
 * - OFF_PITCH: Red (greater than 50 cents deviation)
 * - UNPITCHED: Gray / Inactive (silence or non-periodic sound)
 */
enum class PitchColorCategory {
    ON_PITCH,
    NEAR_PITCH,
    OFF_PITCH,
    UNPITCHED
}

data class PitchResult(
    val frequencyHz: Float,
    val periodicity: Float, // 0.0 to 1.0 (1.0 = pure periodic tone)
    val isPitched: Boolean,
    val noteName: String,
    val midiNote: Float,
    val centsDeviation: Float, // Deviation from target note (or nearest equal-tempered pitch)
    val colorCategory: PitchColorCategory
)

/**
 * Implementation of the YIN algorithm for fundamental frequency (F0) estimation
 * (de Cheveigné & Kawahara, 2002), implemented in pure Kotlin with zero Android dependencies.
 */
class YinPitchDetector(
    val sampleRate: Int = 44100,
    val bufferSize: Int = 2048,
    val threshold: Float = 0.15f,
    val minFrequency: Float = 65.0f,   // ~C2
    val maxFrequency: Float = 1050.0f  // ~C6
) {
    private val halfBufferSize = bufferSize / 2
    private val yinBuffer = FloatArray(halfBufferSize)

    // Precomputed period limits based on frequency range
    private val minPeriod = (sampleRate / maxFrequency).toInt().coerceAtLeast(2)
    private val maxPeriod = (sampleRate / minFrequency).toInt().coerceAtMost(halfBufferSize - 1)

    /**
     * Estimates fundamental frequency from a window of audio samples.
     * @param audioBuffer Audio samples of length at least [bufferSize]
     * @param offset Start index in the buffer
     * @param targetFrequencyHz Optional target frequency for calculating cents deviation and color category
     */
    fun getPitch(
        audioBuffer: FloatArray,
        offset: Int = 0,
        targetFrequencyHz: Float? = null
    ): PitchResult {
        if (audioBuffer.size - offset < bufferSize) {
            return unpitchedResult(targetFrequencyHz)
        }

        // Energy gate: check RMS
        var sumSquares = 0.0
        for (i in 0 until bufferSize) {
            val sample = audioBuffer[offset + i]
            sumSquares += sample * sample
        }
        val rms = kotlin.math.sqrt(sumSquares / bufferSize).toFloat()
        if (rms < 0.01f) {
            // Signal is silence or too quiet
            return unpitchedResult(targetFrequencyHz)
        }

        // Step 1: Difference Function
        difference(audioBuffer, offset)

        // Step 2: Cumulative Mean Normalized Difference Function
        cumulativeMeanNormalizedDifference()

        // Step 3: Absolute Thresholding
        val tauEstimate = absoluteThreshold()

        if (tauEstimate == -1) {
            return unpitchedResult(targetFrequencyHz)
        }

        // Step 4: Parabolic Interpolation
        val betterTau = parabolicInterpolation(tauEstimate)

        if (betterTau <= 0.0f) {
            return unpitchedResult(targetFrequencyHz)
        }

        val pitchInHz = sampleRate / betterTau
        if (pitchInHz < minFrequency || pitchInHz > maxFrequency) {
            return unpitchedResult(targetFrequencyHz)
        }

        val periodicity = (1.0f - yinBuffer[tauEstimate]).coerceIn(0.0f, 1.0f)
        val noteName = frequencyToNoteName(pitchInHz)
        val midiNote = frequencyToMidi(pitchInHz)

        val referenceFreq = targetFrequencyHz ?: midiToFrequency(midiNote.roundToInt())
        val cents = centsDifference(pitchInHz, referenceFreq)
        val color = categorizePitch(cents)

        return PitchResult(
            frequencyHz = pitchInHz,
            periodicity = periodicity,
            isPitched = true,
            noteName = noteName,
            midiNote = midiNote,
            centsDeviation = cents,
            colorCategory = color
        )
    }

    /**
     * Step 1: Calculates squared difference function:
     * d_t(\tau) = \sum_{j=1}^{W} (x_j - x_{j+\tau})^2
     */
    private fun difference(buffer: FloatArray, offset: Int) {
        for (tau in 0 until halfBufferSize) {
            yinBuffer[tau] = 0.0f
        }
        for (tau in 1 until halfBufferSize) {
            var sum = 0.0f
            for (j in 0 until halfBufferSize) {
                val delta = buffer[offset + j] - buffer[offset + j + tau]
                sum += delta * delta
            }
            yinBuffer[tau] = sum
        }
    }

    /**
     * Step 2: Cumulative mean normalized difference function:
     * d'_t(\tau) = 1 if \tau == 0 else d_t(\tau) / ((1/\tau) * \sum_{j=1}^\tau d_t(j))
     */
    private fun cumulativeMeanNormalizedDifference() {
        yinBuffer[0] = 1.0f
        var runningSum = 0.0f
        for (tau in 1 until halfBufferSize) {
            runningSum += yinBuffer[tau]
            yinBuffer[tau] = if (runningSum == 0.0f) 1.0f else (yinBuffer[tau] * tau) / runningSum
        }
    }

    /**
     * Step 3: Absolute thresholding:
     * Find the first tau where d'_t(\tau) drops below the threshold, then find the local minimum.
     */
    private fun absoluteThreshold(): Int {
        var tau = minPeriod
        while (tau < maxPeriod) {
            if (yinBuffer[tau] < threshold) {
                // Seek local minimum
                while (tau + 1 < maxPeriod && yinBuffer[tau + 1] < yinBuffer[tau]) {
                    tau++
                }
                return tau
            }
            tau++
        }
        // Fallback: if no point below threshold, find global minimum in range if low enough
        var globalMinTau = -1
        var minVal = 0.35f // relaxed threshold for singing voice with vibrato
        for (t in minPeriod until maxPeriod) {
            if (yinBuffer[t] < minVal) {
                minVal = yinBuffer[t]
                globalMinTau = t
            }
        }
        return globalMinTau
    }

    /**
     * Step 4: Parabolic interpolation around local minimum to refine tau with sub-sample precision.
     */
    private fun parabolicInterpolation(tau: Int): Float {
        if (tau <= 0 || tau >= halfBufferSize - 1) {
            return tau.toFloat()
        }
        val s0 = yinBuffer[tau - 1]
        val s1 = yinBuffer[tau]
        val s2 = yinBuffer[tau + 1]

        val bottom = 2.0f * (2.0f * s1 - s2 - s0)
        if (abs(bottom) < 1e-6f) return tau.toFloat()

        val delta = (s2 - s0) / bottom
        return tau + delta
    }

    private fun unpitchedResult(targetFrequencyHz: Float?): PitchResult {
        val cents = if (targetFrequencyHz != null) 999.0f else 0.0f
        return PitchResult(
            frequencyHz = 0.0f,
            periodicity = 0.0f,
            isPitched = false,
            noteName = "--",
            midiNote = 0.0f,
            centsDeviation = cents,
            colorCategory = PitchColorCategory.UNPITCHED
        )
    }

    companion object {
        private val NOTE_NAMES = arrayOf("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")

        fun frequencyToMidi(frequencyHz: Float): Float {
            if (frequencyHz <= 0.0f) return 0.0f
            return 69.0f + 12.0f * (ln(frequencyHz / 440.0) / ln(2.0)).toFloat()
        }

        fun midiToFrequency(midiNote: Int): Float {
            return (440.0 * Math.pow(2.0, (midiNote - 69) / 12.0)).toFloat()
        }

        fun frequencyToNoteName(frequencyHz: Float): String {
            if (frequencyHz <= 0.0f) return "--"
            val midi = frequencyToMidi(frequencyHz)
            val roundedMidi = midi.roundToInt()
            val noteIndex = ((roundedMidi % 12) + 12) % 12
            val octave = (roundedMidi / 12) - 1
            return "${NOTE_NAMES[noteIndex]}$octave"
        }

        fun noteNameToFrequency(noteName: String): Float? {
            val trimmed = noteName.trim().uppercase()
            if (trimmed.length < 2) return null

            var namePart = trimmed.substring(0, trimmed.length - 1)
            var octavePart = trimmed.substring(trimmed.length - 1)
            // Handle negative octave or 2-digit octave if needed
            if (trimmed.length >= 3 && (trimmed[trimmed.length - 2] == '-' || trimmed[trimmed.length - 2].isDigit())) {
                namePart = trimmed.substring(0, trimmed.length - 2)
                octavePart = trimmed.substring(trimmed.length - 2)
            }

            val noteIndex = NOTE_NAMES.indexOf(namePart)
            if (noteIndex == -1) return null
            val octave = octavePart.toIntOrNull() ?: return null

            val midi = (octave + 1) * 12 + noteIndex
            return midiToFrequency(midi)
        }

        fun centsDifference(frequencyHz: Float, referenceHz: Float): Float {
            if (frequencyHz <= 0.0f || referenceHz <= 0.0f) return 0.0f
            return (1200.0 * log2(frequencyHz.toDouble() / referenceHz.toDouble())).toFloat()
        }

        fun categorizePitch(centsDeviation: Float): PitchColorCategory {
            val absCents = abs(centsDeviation)
            return when {
                absCents <= 25.0f -> PitchColorCategory.ON_PITCH     // Green
                absCents <= 50.0f -> PitchColorCategory.NEAR_PITCH   // Yellow
                else -> PitchColorCategory.OFF_PITCH                // Red
            }
        }
    }
}
