package com.harmonia.analysis.dsp

import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.sqrt

/**
 * Acoustic voice quality features matching Section 2 (Parselmouth/Praat-equivalent metrics):
 * - Jitter: Short-term (cycle-to-cycle) perturbation in pitch period.
 * - Shimmer: Short-term perturbation in peak-to-peak amplitude.
 * - Harmonics-to-Noise Ratio (HNR): Ratio of harmonic acoustic energy to noise energy in dB.
 */
data class VoiceQualityMetrics(
    val jitterLocalPercent: Float,     // Local jitter (%)
    val jitterRapPercent: Float,       // Relative Average Perturbation (%)
    val shimmerLocalPercent: Float,   // Local shimmer (%)
    val shimmerDb: Float,              // Shimmer in dB
    val hnrDb: Float,                  // Harmonics-to-noise ratio (dB)
    val vocalClarityScore: Float       // Normalized clarity score (0 to 100)
)

class VoiceQualityExtractor(
    private val sampleRate: Int = 44100
) {
    /**
     * Extracts Jitter, Shimmer, and HNR from audio samples and fundamental periods.
     * @param audioBuffer Window of audio samples
     * @param pitchResults List of PitchResults detected across the audio window
     */
    fun extractMetrics(
        audioBuffer: FloatArray,
        pitchResults: List<PitchResult>
    ): VoiceQualityMetrics {
        // Collect voiced pitch periods (in samples)
        val voicedPeriods = mutableListOf<Float>()
        for (res in pitchResults) {
            if (res.isPitched && res.frequencyHz > 50.0f) {
                voicedPeriods.add(sampleRate / res.frequencyHz)
            }
        }

        // 1. Calculate Jitter metrics
        val (jitterLocal, jitterRap) = calculateJitter(voicedPeriods)

        // 2. Detect cycle-to-cycle peak amplitudes and calculate Shimmer
        val peakAmplitudes = extractPeakAmplitudes(audioBuffer, voicedPeriods)
        val (shimmerLocal, shimmerDb) = calculateShimmer(peakAmplitudes)

        // 3. Calculate Harmonics-to-Noise Ratio (HNR) via autocorrelation
        val hnr = calculateHnr(audioBuffer)

        // 4. Compute composite vocal clarity score (0-100)
        // High quality: Jitter < 1.04%, Shimmer < 3.81% (standard clinical/normative thresholds), HNR > 15 dB
        val jitterPenalty = (jitterLocal / 2.5f).coerceIn(0.0f, 1.0f) * 30.0f
        val shimmerPenalty = (shimmerLocal / 8.0f).coerceIn(0.0f, 1.0f) * 30.0f
        val hnrScore = (hnr / 25.0f).coerceIn(0.0f, 1.0f) * 40.0f
        val clarity = (100.0f - jitterPenalty - shimmerPenalty + (hnrScore - 40.0f * 0.4f))
            .coerceIn(10.0f, 98.0f)

        return VoiceQualityMetrics(
            jitterLocalPercent = jitterLocal,
            jitterRapPercent = jitterRap,
            shimmerLocalPercent = shimmerLocal,
            shimmerDb = shimmerDb,
            hnrDb = hnr,
            vocalClarityScore = clarity
        )
    }

    private fun calculateJitter(periods: List<Float>): Pair<Float, Float> {
        val n = periods.size
        if (n < 4) {
            return Pair(0.45f, 0.25f) // Default healthy baseline
        }

        var sumPeriod = 0.0
        for (p in periods) sumPeriod += p
        val meanPeriod = sumPeriod / n
        if (meanPeriod <= 0.0) return Pair(0.0f, 0.0f)

        // Local jitter: (1 / (N-1) * \sum |T_i - T_{i+1}|) / meanPeriod * 100
        var diffSum = 0.0
        for (i in 0 until n - 1) {
            diffSum += abs(periods[i] - periods[i + 1])
        }
        val jitterLocal = ((diffSum / (n - 1)) / meanPeriod * 100.0).toFloat()

        // RAP (Relative Average Perturbation): 3-point smoothing
        var rapDiffSum = 0.0
        for (i in 1 until n - 1) {
            val threePointAvg = (periods[i - 1] + periods[i] + periods[i + 1]) / 3.0
            rapDiffSum += abs(periods[i] - threePointAvg)
        }
        val jitterRap = ((rapDiffSum / (n - 2)) / meanPeriod * 100.0).toFloat()

        return Pair(jitterLocal.coerceIn(0.05f, 15.0f), jitterRap.coerceIn(0.02f, 10.0f))
    }

    private fun extractPeakAmplitudes(audioBuffer: FloatArray, periods: List<Float>): List<Float> {
        val peaks = mutableListOf<Float>()
        if (periods.isEmpty() || audioBuffer.isEmpty()) return peaks

        var avgPeriod = 0.0
        for (p in periods) avgPeriod += p
        val periodSamples = (avgPeriod / periods.size).toInt().coerceIn(20, 2048)

        var idx = 0
        while (idx + periodSamples <= audioBuffer.size) {
            var maxAmp = 0.0f
            for (j in 0 until periodSamples) {
                val amp = abs(audioBuffer[idx + j])
                if (amp > maxAmp) maxAmp = amp
            }
            if (maxAmp > 0.005f) {
                peaks.add(maxAmp)
            }
            idx += periodSamples
        }
        return peaks
    }

    private fun calculateShimmer(peaks: List<Float>): Pair<Float, Float> {
        val n = peaks.size
        if (n < 4) {
            return Pair(1.8f, 0.2f) // Default healthy baseline
        }

        var sumAmp = 0.0
        for (p in peaks) sumAmp += p
        val meanAmp = sumAmp / n
        if (meanAmp <= 0.0) return Pair(0.0f, 0.0f)

        // Local shimmer (%)
        var diffSum = 0.0
        var dbDiffSum = 0.0
        for (i in 0 until n - 1) {
            val a1 = peaks[i]
            val a2 = peaks[i + 1]
            diffSum += abs(a1 - a2)
            if (a1 > 1e-4f && a2 > 1e-4f) {
                dbDiffSum += abs(20.0 * log10((a2 / a1).toDouble()))
            }
        }
        val shimmerLocal = ((diffSum / (n - 1)) / meanAmp * 100.0).toFloat()
        val shimmerDb = (dbDiffSum / (n - 1)).toFloat()

        return Pair(shimmerLocal.coerceIn(0.1f, 30.0f), shimmerDb.coerceIn(0.01f, 5.0f))
    }

    /**
     * Autocorrelation-based Harmonics-to-Noise Ratio (HNR in dB).
     * Compares the maximum normalized autocorrelation peak (harmonic component)
     * with the noise floor: HNR = 10 * log10(r_max / (1 - r_max))
     */
    private fun calculateHnr(audioBuffer: FloatArray): Float {
        val n = audioBuffer.size.coerceAtMost(4096)
        if (n < 512) return 15.0f

        // Compute zero-lag energy
        var r0 = 0.0
        for (i in 0 until n) {
            r0 += audioBuffer[i] * audioBuffer[i]
        }
        if (r0 < 1e-5) return 0.0f

        // Search lags between 40Hz (1102 samples) and 1000Hz (44 samples)
        val minLag = (sampleRate / 1000).coerceAtLeast(20)
        val maxLag = (sampleRate / 60).coerceAtMost(n / 2)

        var maxAutocorr = 0.0
        for (lag in minLag..maxLag) {
            var sum = 0.0
            for (i in 0 until (n - lag)) {
                sum += audioBuffer[i] * audioBuffer[i + lag]
            }
            if (sum > maxAutocorr) {
                maxAutocorr = sum
            }
        }

        val rMax = (maxAutocorr / r0).coerceIn(0.01, 0.999)
        val hnr = 10.0 * log10(rMax / (1.0 - rMax))
        return hnr.toFloat().coerceIn(0.0f, 40.0f)
    }
}
