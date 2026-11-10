package com.harmonia.analysis

import com.harmonia.analysis.dsp.AudioSample
import com.harmonia.analysis.dsp.PitchColorCategory
import com.harmonia.analysis.dsp.PitchResult
import com.harmonia.analysis.dsp.VoiceQualityExtractor
import com.harmonia.analysis.dsp.VoiceQualityMetrics
import com.harmonia.analysis.dsp.YinPitchDetector
import kotlin.math.abs
import kotlin.math.sqrt

data class AnalyzedFrame(
    val timestampMs: Long,
    val frequencyHz: Float,
    val targetFrequencyHz: Float,
    val centsDeviation: Float,
    val noteName: String,
    val colorCategory: PitchColorCategory,
    val periodicity: Float
)

data class NoteDetection(
    val noteName: String,
    val durationSeconds: Float,
    val averageCentsError: Float,
    val accuracyPercent: Float,
    val colorCategory: PitchColorCategory
)

data class AnalysisResultData(
    val accuracyScore: Float,
    val toneScore: Float,
    val overallScore: Float,
    val detectedNotes: List<NoteDetection>,
    val pitchFrames: List<AnalyzedFrame>,
    val voiceQuality: VoiceQualityMetrics,
    val feedbackNotes: String,
    val verdictStatus: String = "aiPending", // Section 2: "AI-generated, pending coach confirmation"
    val isPassed: Boolean
)

/**
 * High-level pitch and tone analyzer interface per Section 3.
 */
interface PitchToneAnalyzer {
    fun analyze(
        audioSample: AudioSample,
        targetNoteName: String,
        targetFrequencyHz: Float? = null,
        expectedDurationSeconds: Float? = null
    ): AnalysisResultData
}

/**
 * Measured pitch accuracy and experimental signal stability from on-device DSP.
 * These scores are practice indicators, not calibrated model probabilities or a coach assessment.
 */
class DefaultPitchToneAnalyzer(
    private val pitchDetector: YinPitchDetector = YinPitchDetector(),
    private val voiceQualityExtractor: VoiceQualityExtractor = VoiceQualityExtractor()
) : PitchToneAnalyzer {

    override fun analyze(
        audioSample: AudioSample,
        targetNoteName: String,
        targetFrequencyHz: Float?,
        expectedDurationSeconds: Float?
    ): AnalysisResultData {
        val targetFreq = targetFrequencyHz
            ?: YinPitchDetector.noteNameToFrequency(targetNoteName)
            ?: 440.0f // Fallback to A4

        require(audioSample.sampleRate == pitchDetector.sampleRate) { "Audio sample rate does not match the pitch detector." }
        require(targetFreq.isFinite() && targetFreq > 0f) { "Invalid target frequency." }
        require(expectedDurationSeconds == null || (expectedDurationSeconds.isFinite() && expectedDurationSeconds > 0f)) { "Invalid exercise duration." }
        val samples = audioSample.samples
        val sampleRate = audioSample.sampleRate
        val frameSize = pitchDetector.bufferSize
        val hopSize = frameSize / 2 // 50% overlap

        val frames = mutableListOf<AnalyzedFrame>()
        val pitchResults = mutableListOf<PitchResult>()
        var offset = 0
        var frameIndex = 0

        while (offset + frameSize <= samples.size) {
            val result = pitchDetector.getPitch(samples, offset, targetFreq)
            pitchResults.add(result)

            val timestampMs = ((offset.toDouble() / sampleRate) * 1000.0).toLong()
            frames.add(
                AnalyzedFrame(
                    timestampMs = timestampMs,
                    frequencyHz = result.frequencyHz,
                    targetFrequencyHz = targetFreq,
                    centsDeviation = result.centsDeviation,
                    noteName = result.noteName,
                    colorCategory = result.colorCategory,
                    periodicity = result.periodicity
                )
            )

            offset += hopSize
            frameIndex++
        }

        // Filter voiced frames for statistics
        val voicedFrames = frames.filter { it.frequencyHz > 50.0f }

        // No voiced frames → microphone produced silence or noise only
        if (voicedFrames.isEmpty()) {
            return AnalysisResultData(
                accuracyScore = 0.0f,
                toneScore = 0.0f,
                overallScore = 0.0f,
                detectedNotes = emptyList(),
                pitchFrames = frames,
                voiceQuality = VoiceQualityMetrics(
                    jitterLocalPercent = 0.0f,
                    jitterRapPercent = 0.0f,
                    shimmerLocalPercent = 0.0f,
                    shimmerDb = 0.0f,
                    hnrDb = 0.0f,
                    vocalClarityScore = 0.0f
                ),
                feedbackNotes = "No voice detected. Please check your microphone and try again in a quiet environment.",
                verdictStatus = "noVoiceDetected",
                isPassed = false
            )
        }

        val absCentsList = voicedFrames.map { abs(it.centsDeviation).toDouble() }
        val meanCentsError = absCentsList.average()
        val inTuneCount = voicedFrames.count { abs(it.centsDeviation) <= 35.0f }
        val voicedRatio = voicedFrames.size.toFloat() / frames.size
        val voicedSeconds = voicedFrames.size * hopSize.toFloat() / sampleRate
        val requiredSeconds = expectedDurationSeconds?.times(0.80f) ?: 1.5f
        val enoughAudio = audioSample.durationSeconds >= requiredSeconds &&
            voicedSeconds >= minOf(1.5f, requiredSeconds) && voicedRatio >= 0.60f

        // Analyze actual voiced audio, so leading silence does not define signal stability.
        val firstVoicedSample = (voicedFrames.first().timestampMs * sampleRate / 1000).toInt()
        val lastVoicedSample = ((voicedFrames.last().timestampMs * sampleRate / 1000).toInt() + frameSize).coerceAtMost(samples.size)
        val voiceQuality = voiceQualityExtractor.extractMetrics(samples.copyOfRange(firstVoicedSample, lastVoicedSample), pitchResults)
        // Silence counts against accuracy. The denominator is every analysis frame, not just voiced frames.
        val inTuneRatio = inTuneCount.toFloat() / frames.size
        val accuracyScore = if (enoughAudio) inTuneRatio * 100f else 0f
        val toneScore = if (enoughAudio) voiceQuality.vocalClarityScore * voicedRatio else 0f
        val overallScore = (0.60f * accuracyScore + 0.40f * toneScore).coerceIn(0f, 100f)
        val isPassed = enoughAudio && accuracyScore >= 70f && overallScore >= 70f

        // 6. Summarize Note Detections
        val detectedNotes = summarizeNotes(frames, targetFreq, sampleRate, hopSize)

        // 7. Generate Personalized AI Vocal Feedback Notes
        val feedbackNotes = if (!enoughAudio) "Not enough sustained voice to score this exercise. Record at least ${String.format("%.1f", requiredSeconds)} seconds and keep singing through the exercise." else generateFeedback(
            accuracyScore = accuracyScore,
            toneScore = toneScore,
            meanCents = meanCentsError.toFloat(),
            inTuneRatio = inTuneRatio.toFloat(),
            voiceQuality = voiceQuality
        )

        return AnalysisResultData(
            accuracyScore = accuracyScore,
            toneScore = toneScore,
            overallScore = overallScore,
            detectedNotes = detectedNotes,
            pitchFrames = frames,
            voiceQuality = voiceQuality,
            feedbackNotes = feedbackNotes,
            verdictStatus = if (enoughAudio) "aiPending" else "insufficientAudio",
            isPassed = isPassed
        )
    }

    private fun summarizeNotes(
        frames: List<AnalyzedFrame>,
        targetFreq: Float,
        sampleRate: Int,
        hopSize: Int
    ): List<NoteDetection> {
        val notes = mutableListOf<NoteDetection>()
        if (frames.isEmpty()) return notes

        val frameDurationSec = hopSize.toFloat() / sampleRate
        var currentNote = frames.first().noteName
        var currentFrames = mutableListOf<AnalyzedFrame>()

        for (frame in frames) {
            if (frame.noteName == currentNote) {
                currentFrames.add(frame)
            } else {
                if (currentNote != "--" && currentFrames.isNotEmpty()) {
                    notes.add(createNoteDetection(currentNote, currentFrames, frameDurationSec))
                }
                currentNote = frame.noteName
                currentFrames = mutableListOf(frame)
            }
        }
        if (currentNote != "--" && currentFrames.isNotEmpty()) {
            notes.add(createNoteDetection(currentNote, currentFrames, frameDurationSec))
        }

        return notes
    }

    private fun createNoteDetection(
        noteName: String,
        frames: List<AnalyzedFrame>,
        frameDurationSec: Float
    ): NoteDetection {
        val duration = frames.size * frameDurationSec
        val avgError = frames.map { abs(it.centsDeviation) }.average().toFloat()
        val inTuneFrames = frames.count { abs(it.centsDeviation) <= 25.0f }
        val accPercent = (inTuneFrames.toFloat() / frames.size) * 100.0f
        val color = YinPitchDetector.categorizePitch(avgError)
        return NoteDetection(
            noteName = noteName,
            durationSeconds = duration,
            averageCentsError = avgError,
            accuracyPercent = accPercent,
            colorCategory = color
        )
    }

    private fun generateFeedback(
        accuracyScore: Float,
        toneScore: Float,
        meanCents: Float,
        inTuneRatio: Float,
        voiceQuality: VoiceQualityMetrics
    ): String {
        val sb = StringBuilder()
        when {
            accuracyScore >= 85.0f -> {
                sb.append("Outstanding pitch accuracy! You maintained a centered pitch line throughout the target exercise.")
            }
            accuracyScore >= 70.0f -> {
                sb.append("Good pitch control. You kept within tolerance for ${(inTuneRatio * 100).toInt()}% of the duration. Focus on sustaining the note evenly without scooping.")
            }
            else -> {
                sb.append("Pitch deviation averaged ±${meanCents.toInt()} cents. Try practicing with a guide tone or hum before singing the open vowel.")
            }
        }

        sb.append(" ")
        when {
            voiceQuality.hnrDb >= 18.0f && voiceQuality.jitterLocalPercent < 1.0f -> {
                sb.append("The recording has a stable periodic signal (estimated HNR: ${String.format("%.1f", voiceQuality.hnrDb)} dB).")
            }
            voiceQuality.jitterLocalPercent >= 1.5f -> {
                sb.append("Pitch variation (${String.format("%.1f", voiceQuality.jitterLocalPercent)}%) detected. Try sustaining an even note and ask your coach to assess tone.")
            }
            else -> {
                sb.append("Signal stability is an experimental indicator. Your coach provides the final tone assessment.")
            }
        }

        return sb.toString().trim()
    }
}
