package com.harmonia.app.ui.audio

import android.content.Context
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.harmonia.analysis.*
import com.harmonia.analysis.dsp.AudioSample
import com.harmonia.app.data.local.entity.VocalExerciseEntity

object PracticeAnalysis {
    fun analyze(context: Context, audio: AudioSample, exercise: VocalExerciseEntity): GradedPractice {
        val targets: List<TargetNote> = when (exercise.exerciseType) {
            "single" -> listOf(TargetNote(0.0, exercise.durationSeconds.toDouble(), exercise.targetFrequencyHz))
            "free" -> emptyList()
            else -> Gson().fromJson(exercise.referencePitchData ?: error("Download an approved target melody first."),
                object : TypeToken<List<TargetNote>>() {}.type)
        }
        val model = context.assets.open("models/swiftf0.onnx").use { it.readBytes() }
        return NeuralPitchEstimator(model).use { estimator ->
            PracticeGrader(estimator, NeuralPitchEstimator.ENGINE, NeuralPitchEstimator.MODEL_SHA256).grade(audio, targets, exercise.durationSeconds.toDouble(),
                GradingPolicy.forDifficulty(exercise.difficultyLevel), exercise.exerciseType, exercise.targetVersion)
        }
    }
}
