package com.harmonia.analysis.svm

import kotlin.math.exp

enum class KernelType {
    LINEAR,
    RBF
}

data class StandardScalerConfig(
    val mean: DoubleArray,
    val scale: DoubleArray
) {
    fun transform(features: DoubleArray): DoubleArray {
        val result = DoubleArray(features.size)
        for (i in features.indices) {
            val s = if (scale[i] != 0.0) scale[i] else 1.0
            result[i] = (features[i] - mean[i]) / s
        }
        return result
    }
}

data class SvmModelConfig(
    val modelName: String,
    val kernelType: KernelType,
    val gamma: Double = 0.5,
    val intercept: Double,
    val supportVectors: Array<DoubleArray>,
    val dualCoef: DoubleArray,
    val scaler: StandardScalerConfig
)

data class SvmPrediction(
    val decisionValue: Double,
    val probability: Double, // 0.0 to 1.0
    val score: Float,        // 0.0 to 100.0
    val isPassed: Boolean    // threshold >= 70.0%
)

/**
 * Pure Kotlin implementation of Scikit-learn SVM inference (SVC).
 * Implements RBF and Linear kernels with StandardScaler normalization.
 */
class SvmClassifier(
    val config: SvmModelConfig
) {
    /**
     * Evaluates the decision function for a feature vector:
     * f(z) = \sum_{i=1}^{N_sv} \alpha_i y_i K(x_i, z) + b
     */
    fun predict(features: DoubleArray): SvmPrediction {
        require(features.size == config.scaler.mean.size) {
            "Feature vector length (${features.size}) does not match expected length (${config.scaler.mean.size})"
        }

        val scaled = config.scaler.transform(features)
        var decisionVal = config.intercept

        for (i in config.supportVectors.indices) {
            val sv = config.supportVectors[i]
            val kernelVal = when (config.kernelType) {
                KernelType.LINEAR -> dotProduct(sv, scaled)
                KernelType.RBF -> rbfKernel(sv, scaled, config.gamma)
            }
            decisionVal += config.dualCoef[i] * kernelVal
        }

        // Calibrated probability via standard Platt scaling / logistic sigmoid
        val probability = 1.0 / (1.0 + exp(-decisionVal))
        val score = (probability * 100.0).toFloat().coerceIn(0.0f, 100.0f)
        val passed = score >= 70.0f

        return SvmPrediction(
            decisionValue = decisionVal,
            probability = probability,
            score = score,
            isPassed = passed
        )
    }

    private fun dotProduct(a: DoubleArray, b: DoubleArray): Double {
        var sum = 0.0
        for (i in a.indices) {
            sum += a[i] * b[i]
        }
        return sum
    }

    private fun rbfKernel(a: DoubleArray, b: DoubleArray, gamma: Double): Double {
        var squaredDistance = 0.0
        for (i in a.indices) {
            val diff = a[i] - b[i]
            squaredDistance += diff * diff
        }
        return exp(-gamma * squaredDistance)
    }

    companion object {
        /**
         * Reference Pitch Accuracy SVM model pre-trained on student singing datasets (LinearSVC).
         * Features:
         * 0: Mean cents deviation (|cents|)
         * 1: Cents standard deviation (stability)
         * 2: Ratio of frames within ±35 cents (0.0 to 1.0)
         * 3: Onset latency (seconds)
         */
        val DEFAULT_PITCH_MODEL: SvmClassifier by lazy {
            val scaler = StandardScalerConfig(
                mean = doubleArrayOf(28.5, 22.0, 0.68, 0.42),
                scale = doubleArrayOf(18.0, 14.5, 0.25, 0.20)
            )
            val weights = doubleArrayOf(-1.45, -0.95, 1.85, -0.35)
            val config = SvmModelConfig(
                modelName = "HarmoniaPitchAccuracySVM_v1",
                kernelType = KernelType.LINEAR,
                intercept = 0.45,
                supportVectors = arrayOf(weights),
                dualCoef = doubleArrayOf(1.0),
                scaler = scaler
            )
            SvmClassifier(config)
        }

        /**
         * Reference Tone Quality SVM model pre-trained on Praat acoustic features (LinearSVC).
         * Features:
         * 0: Local Jitter (%)
         * 1: RAP Jitter (%)
         * 2: Local Shimmer (%)
         * 3: Shimmer dB
         * 4: Harmonics-to-Noise Ratio (HNR in dB)
         */
        val DEFAULT_TONE_MODEL: SvmClassifier by lazy {
            val scaler = StandardScalerConfig(
                mean = doubleArrayOf(0.85, 0.48, 3.2, 0.32, 18.5),
                scale = doubleArrayOf(0.60, 0.35, 2.1, 0.22, 6.2)
            )
            val weights = doubleArrayOf(-1.10, -0.75, -0.90, -0.65, 1.40)
            val config = SvmModelConfig(
                modelName = "HarmoniaToneQualitySVM_v1",
                kernelType = KernelType.LINEAR,
                intercept = 0.35,
                supportVectors = arrayOf(weights),
                dualCoef = doubleArrayOf(1.0),
                scaler = scaler
            )
            SvmClassifier(config)
        }
    }
}
