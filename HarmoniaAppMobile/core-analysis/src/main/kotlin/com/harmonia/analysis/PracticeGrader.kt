package com.harmonia.analysis

import com.harmonia.analysis.dsp.*
import kotlin.math.*

data class PitchEstimate(val seconds: Double, val hz: Float, val confidence: Float)
fun interface PitchEstimator { fun estimate(audio: AudioSample): List<PitchEstimate> }
data class TargetNote(val startSeconds: Double, val endSeconds: Double, val frequencyHz: Float)
data class GradingPolicy(val difficulty: String, val toleranceCents: Float, val passMark: Float) {
    companion object {
        fun forDifficulty(value: String) = when (value) {
            "Beginner", "Foundations" -> GradingPolicy("Beginner", 50f, 60f)
            "Intermediate", "Pitch Training" -> GradingPolicy("Intermediate", 35f, 70f)
            "Advanced" -> GradingPolicy("Advanced", 25f, 80f)
            else -> error("Unknown exercise difficulty.")
        }
    }
}
data class GradingEvidence(
    val scoringVersion: String = "harmonia-v2", val engine: String,
    val policy: GradingPolicy, val exerciseType: String, val targetVersion: String,
    val status: String, val pitchScore: Float?, val toneScore: Float?, val overallScore: Float?,
    val coverage: Float, val clarity: Float?, val pitchSteadiness: Float?, val volumeSteadiness: Float?,
    val automaticPassed: Boolean, val reasons: List<String>, val modelSha256: String? = null,
    val targetNotes: List<TargetNote> = emptyList()
)
data class GradedPractice(val result: AnalysisResultData, val evidence: GradingEvidence)

/** Measured exercise performance. Confidence is used only for voicing, never as a skill grade. */
class PracticeGrader(private val estimator: PitchEstimator, private val engine: String, private val modelSha256: String? = null) {
    fun grade(audio: AudioSample, targets: List<TargetNote>, duration: Double, policy: GradingPolicy,
              exerciseType: String = "single", targetVersion: String = "1"): GradedPractice {
        require(duration.isFinite() && duration in 3.0..600.0)
        require(audio.samples.isNotEmpty() && audio.samples.all { it.isFinite() } && audio.sampleRate > 0)
        require(exerciseType in listOf("single", "scale", "song", "free"))
        require(exerciseType == "free" || targets.isNotEmpty()) { "An approved target melody is required." }
        var previousEnd = 0.0
        targets.forEach {
            require(it.startSeconds.isFinite() && it.endSeconds.isFinite() && it.startSeconds >= previousEnd &&
                it.endSeconds > it.startSeconds && it.endSeconds <= duration + .001 &&
                it.frequencyHz.isFinite() && it.frequencyHz in 65f..1050f) { "Invalid target melody." }
            previousEnd = it.endSeconds
        }
        val estimates = estimator.estimate(audio)
        val slots = max(1, (duration * 10).roundToInt())
        val actualSlots = min((audio.durationSeconds * 10).roundToInt(), 6000)
        val actual = FloatArray(actualSlots.coerceAtLeast(1))
        val confidence = FloatArray(actual.size)
        // Nearest actual estimate; a low-confidence frame must remain missing.
        for (e in estimates) {
            if (!e.seconds.isFinite() || !e.hz.isFinite() || !e.confidence.isFinite()) continue
            val index = (e.seconds * 10).roundToInt()
            if (index in actual.indices && e.confidence >= confidence[index]) {
                confidence[index] = e.confidence
                actual[index] = if (e.confidence >= .5f && e.hz in 65f..1050f) e.hz else 0f
            }
        }
        val target = FloatArray(slots) { i -> targets.firstOrNull { i * .1 >= it.startSeconds && i * .1 < it.endSeconds }?.frequencyHz ?: 0f }
        val mapping = if (exerciseType == "single" || exerciseType == "free") IntArray(slots) { it }
            else align(actual, target)
        val expected = target.indices.filter { target[it] > 0 }
        val heard = expected.count { mapping[it] in actual.indices && actual[mapping[it]] > 0 }
        val coverage = if (expected.isEmpty()) 0f else heard.toFloat() / expected.size
        val matched = expected.count { i -> mapping[i] in actual.indices && actual[mapping[i]] > 0 &&
            abs(cents(actual[mapping[i]], target[i])) <= policy.toleranceCents }
        val frames = actual.indices.map { i ->
            val targetIndex = mapping.indexOf(i)
            val goal = if (targetIndex >= 0) target[targetIndex] else 0f
            val error = if (actual[i] > 0 && goal > 0) cents(actual[i], goal) else 0f
            AnalyzedFrame((i * 100).toLong(), actual[i], goal, error,
                if (actual[i] > 0) YinPitchDetector.frequencyToNoteName(actual[i]) else "--",
                if (actual[i] <= 0 || goal <= 0) PitchColorCategory.UNPITCHED else when {
                    abs(error) <= policy.toleranceCents -> PitchColorCategory.ON_PITCH
                    abs(error) <= policy.toleranceCents * 1.5 -> PitchColorCategory.NEAR_PITCH
                    else -> PitchColorCategory.OFF_PITCH
                }, confidence[i])
        }
        val reasons = mutableListOf<String>()
        val clipped = audio.samples.count { abs(it) >= .995f }.toDouble() / audio.samples.size
        val rms = sqrt(audio.samples.sumOf { it.toDouble() * it } / audio.samples.size)
        if (clipped > .01) reasons += "Recording is clipped. Move farther from the microphone or lower sensitivity."
        if (rms < .003) reasons += "Recording is too quiet. Move closer to the microphone."
        if (audio.durationSeconds < duration * .8) reasons += "Recording is incomplete. Sing through the exercise."
        if (exerciseType != "free" && coverage < .8f) reasons += "Not enough usable singing matched the target. Record again without background music."
        if (actual.count { it > 0 } < 15) reasons += "At least 1.5 seconds of usable pitched sound is required."
        val components = tone(audio, actual, target, mapping)
        val status = when { reasons.isNotEmpty() -> "needsRecording"; exerciseType == "free" -> "unscored"; components == null -> "partial"; else -> "scored" }
        val pitch = if (status in listOf("scored", "partial")) matched * 100f / expected.size else null
        val tone = if (reasons.isEmpty()) components?.let { .5f * it[0] + .3f * it[1] + .2f * it[2] } else null
        val overall = if (pitch != null && tone != null) .6f * pitch + .4f * tone else null
        val passed = pitch != null && tone != null && overall != null && pitch >= policy.passMark && tone >= policy.passMark && overall >= policy.passMark
        if (components == null && reasons.isEmpty()) reasons += "Tone estimate unavailable: there are not enough sustained note regions. Your coach can assess this recording."
        val feedback = if (reasons.isNotEmpty()) reasons.take(3).joinToString(" ") else buildList {
            if (pitch != null) add("${pitch.roundToInt()}% of expected singing time was within ${policy.toleranceCents.toInt()} cents of the target.")
            if (pitch != null && pitch < policy.passMark) add("Listen to the guide, then repeat the missed notes slowly.")
            if (components != null && components[1] < 70) add("Try sustaining each note more evenly.")
            if (components != null && components[2] < 70) add("Keep your distance from the microphone and sustain an even volume.")
            add("Clarity and steadiness are experimental practice indicators. Coach approval is required before advancement.")
        }.joinToString(" ")
        val evidence = GradingEvidence(engine = engine, policy = policy, exerciseType = exerciseType,
            targetVersion = targetVersion, status = status, pitchScore = pitch, toneScore = tone, overallScore = overall,
            coverage = coverage, clarity = components?.get(0), pitchSteadiness = components?.get(1), volumeSteadiness = components?.get(2),
            automaticPassed = passed, reasons = reasons, modelSha256 = modelSha256, targetNotes = targets)
        val result = AnalysisResultData(pitch ?: 0f, tone ?: 0f, overall ?: 0f, emptyList(), frames,
            VoiceQualityMetrics(0f, 0f, 0f, 0f, 0f, tone ?: 0f), feedback,
            if (status == "needsRecording") "insufficientAudio" else "aiPending", passed)
        return GradedPractice(result, evidence)
    }

    private fun tone(audio: AudioSample, actual: FloatArray, target: FloatArray, mapping: IntArray): FloatArray? {
        val reverse = IntArray(actual.size) { -1 }
        mapping.forEachIndexed { t, a -> if (a in reverse.indices) reverse[a] = t }
        val periodicity = mutableListOf<Float>(); val pitchSteps = mutableListOf<Float>(); val volumeSteps = mutableListOf<Float>()
        var previousRms = 0.0
        for (i in 1 until actual.lastIndex) {
            if (actual[i - 1] <= 0 || actual[i] <= 0 || actual[i + 1] <= 0) { previousRms = 0.0; continue }
            val t = reverse[i]; val before = reverse[i - 1]; val after = reverse[i + 1]
            if (target.any { it > 0 } && (t !in target.indices || before !in target.indices || after !in target.indices ||
                    target[t] <= 0 || target[before] != target[t] || target[after] != target[t])) continue
            val start = (i * .1 * audio.sampleRate).roundToInt()
            val lag = (audio.sampleRate / actual[i]).roundToInt().coerceAtLeast(1)
            val length = max((audio.sampleRate * .032).toInt(), lag * 3)
            if (start + length + lag > audio.samples.size) continue
            var xx = 0.0; var yy = 0.0; var xy = 0.0
            for (j in 0 until length) {
                val x = audio.samples[start + j].toDouble(); val y = audio.samples[start + j + lag].toDouble()
                xx += x * x; yy += y * y; xy += x * y
            }
            if (xx <= 1e-8 || yy <= 1e-8) continue
            periodicity += (xy / sqrt(xx * yy)).toFloat().coerceIn(0f, 1f) * 100
            // Small frame-to-frame motion, including ordinary vibrato, is tolerated.
            pitchSteps += (100 - max(0f, abs(cents(actual[i], actual[i - 1])) - 35f) * .6f).coerceIn(0f, 100f)
            val level = sqrt(xx / length)
            if (previousRms > 0) volumeSteps += (100 - max(0.0, abs(20 * log10(level / previousRms)) - 2) * 8).toFloat().coerceIn(0f, 100f)
            previousRms = level
        }
        if (periodicity.size < 10 || pitchSteps.isEmpty() || volumeSteps.isEmpty()) return null
        return floatArrayOf(periodicity.average().toFloat(), pitchSteps.average().toFloat(), volumeSteps.average().toFloat())
    }

    /** Banded, monotonic DTW. Every target slot remains in the denominator, including skipped phrases. */
    private fun align(actual: FloatArray, target: FloatArray): IntArray {
        val n = actual.size; val m = target.size
        if (n < m * .5 || n > m * 1.5) return IntArray(m) { it }
        val width = max(12, (m * .05).toInt()); val span = width * 2 + 1
        val path = Array(n) { ByteArray(span) }
        var previous = FloatArray(m + 1) { Float.POSITIVE_INFINITY }; previous[0] = 0f
        for (a in 1..n) {
            val current = FloatArray(m + 1) { Float.POSITIVE_INFINITY }
            val center = (a.toDouble() * m / n).roundToInt()
            for (t in max(1, center - width)..min(m, center + width)) {
                val x = actual[a - 1]; val y = target[t - 1]
                val cost = if (x <= 0 || y <= 0) { if (x <= 0 && y <= 0) 0f else 2f } else min(6f, abs(cents(x, y)) / 100)
                val choices = floatArrayOf(previous[t - 1], previous[t] + .5f, current[t - 1] + .5f)
                val choice = choices.indices.minByOrNull { choices[it] }!!
                current[t] = cost + choices[choice]
                path[a - 1][t - center + width] = choice.toByte()
            }
            previous = current
        }
        if (!previous[m].isFinite()) return IntArray(m) { it }
        val mapping = IntArray(m) { -1 }; var a = n; var t = m
        while (a > 0 && t > 0) {
            mapping[t - 1] = a - 1
            val center = (a.toDouble() * m / n).roundToInt()
            val index = t - center + width
            if (index !in 0 until span) break
            when (path[a - 1][index].toInt()) { 0 -> { a--; t-- }; 1 -> a--; else -> t-- }
        }
        return mapping
    }
    private fun cents(hz: Float, target: Float) = (1200 * log2(hz / target)).toFloat()
}
