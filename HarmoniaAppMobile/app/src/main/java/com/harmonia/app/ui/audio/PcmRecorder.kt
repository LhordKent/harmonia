package com.harmonia.app.ui.audio

import com.harmonia.analysis.dsp.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.RandomAccessFile
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.sqrt

interface PcmInput {
    fun start()
    /** Non-blocking: zero means waiting; negative values indicate capture failure. */
    fun read(buffer: ShortArray): Int
    fun stop()
    fun release()
}
data class LiveAudioState(
    val isRecording: Boolean = false, val hasRecording: Boolean = false,
    val currentPitch: Float = 0f, val noteName: String = "--", val centsDeviation: Float = 0f,
    val colorCategory: PitchColorCategory = PitchColorCategory.UNPITCHED,
    val audioLevel: Float = 0f, val durationSeconds: Int = 0,
    val limitReached: Boolean = false, val errorMessage: String? = null, val elapsedMs: Long = 0
)

/** The capture job alone writes PCM. Saving waits for that job to finish. */
open class PcmRecorder(
    private val directory: File, private val inputFactory: () -> PcmInput,
    private val sampleRate: Int = 44100, private val dispatcher: CoroutineDispatcher = Dispatchers.IO,
    private val maxSeconds: Int = 600
) {
    var recordingKey: String = "unassigned"
    fun recoveryFiles(): List<File> = directory.listFiles()?.filter { it.extension == "wav" &&
        it.name.startsWith("recording_${recordingKey.replace(Regex("[^A-Za-z0-9_-]"), "_")}_") && it.length() > 44 }?.sortedByDescending { it.lastModified() } ?: emptyList()
    private val state = MutableStateFlow(LiveAudioState())
    val liveState = state.asStateFlow()
    private val lock = Any()
    private val saveMutex = Mutex()
    private var session: Capture? = null
    private var saving = false
    private var saved: Pair<AudioSample, String>? = null
    private class Capture(val input: PcmInput, val file: File, val sampleRate: Int) {
        val output = RandomAccessFile(file, "rw").apply { setLength(44); seek(44) }
        private val released = AtomicBoolean(false)
        @Volatile var stopRequested = false
        @Volatile var cancelled = false
        @Volatile var failure: String? = null
        var job: Job? = null
        fun release() {
            if (released.compareAndSet(false, true)) {
                runCatching { input.stop() }; runCatching { input.release() }
                runCatching {
                    val size = (output.length() - 44).toInt().coerceAtLeast(0)
                    val h = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
                    h.put("RIFF".toByteArray()); h.putInt(size + 36); h.put("WAVEfmt ".toByteArray())
                    h.putInt(16); h.putShort(1); h.putShort(1); h.putInt(sampleRate); h.putInt(sampleRate * 2)
                    h.putShort(2); h.putShort(16); h.put("data".toByteArray()); h.putInt(size)
                    output.seek(0); output.write(h.array()); output.close()
                    if (size == 0) file.delete()
                }
            }
        }
    }
    fun startRecording(scope: CoroutineScope, targetFrequencyHz: Float, micSensitivity: Float = 1f,
                       targetAtTime: ((Double) -> Float?)? = null, toleranceCents: Float = 25f) {
        synchronized(lock) {
            if (saving || session?.job?.isCompleted == false) return
            saved = null
            var input: PcmInput? = null
            try {
                require(scope.isActive && sampleRate > 0 && maxSeconds in 1..600)
                require(targetFrequencyHz.isFinite() && targetFrequencyHz > 0)
                check(directory.isDirectory || directory.mkdirs()) { "Recording storage is unavailable." }
                check(directory.usableSpace > sampleRate.toLong() * maxSeconds * 2 + 16 * 1024 * 1024) { "Free some device storage before recording." }
                input = inputFactory(); input.start()
                val key = recordingKey.replace(Regex("[^A-Za-z0-9_-]"), "_")
                val capture = Capture(input, File(directory, "recording_${key}_${UUID.randomUUID()}.wav"), sampleRate); session = capture
                state.value = LiveAudioState(isRecording = true, hasRecording = true)
                capture.job = scope.launch(dispatcher) {
                    val detector = YinPitchDetector(sampleRate, 2048)
                    val buffer = ShortArray(2048); val floats = FloatArray(2048)
                    val encoded = ByteArray(4096)
                    val gain = if (micSensitivity.isFinite()) micSensitivity.coerceIn(.5f, 2.5f) else 1f
                    val maximum = sampleRate * maxSeconds; var total = 0
                    try {
                        while (isActive && !capture.stopRequested && total < maximum) {
                            val read = capture.input.read(buffer)
                            check(read in 0..buffer.size) { "Microphone capture failed. Check microphone access and try again." }
                            if (read == 0) { delay(10); continue }
                            val count = minOf(read, maximum - total)
                            floats.fill(0f)
                            var energy = 0.0
                            for (i in 0 until count) {
                                val value = (buffer[i] * gain).toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
                                encoded[i * 2] = value.toByte(); encoded[i * 2 + 1] = (value shr 8).toByte()
                                floats[i] = value / 32768f; energy += floats[i] * floats[i]
                            }
                            capture.output.write(encoded, 0, count * 2)
                            total += count
                            val pitch = detector.getPitch(floats, 0, if (targetAtTime != null) targetAtTime(total.toDouble() / sampleRate) else targetFrequencyHz)
                            val category = if (!pitch.isPitched) PitchColorCategory.UNPITCHED else when {
                                kotlin.math.abs(pitch.centsDeviation) <= toleranceCents -> PitchColorCategory.ON_PITCH
                                kotlin.math.abs(pitch.centsDeviation) <= toleranceCents * 1.5f -> PitchColorCategory.NEAR_PITCH
                                else -> PitchColorCategory.OFF_PITCH
                            }
                            state.value = state.value.copy(currentPitch = pitch.frequencyHz, noteName = pitch.noteName,
                                centsDeviation = pitch.centsDeviation, colorCategory = category,
                                audioLevel = (sqrt(energy / count).toFloat() * 4).coerceIn(0f, 1f), durationSeconds = total / sampleRate, elapsedMs = total.toLong() * 1000 / sampleRate)
                        }
                        if (total == maximum && !capture.cancelled) state.value = state.value.copy(limitReached = true)
                    } catch (e: CancellationException) { throw e }
                    catch (e: Exception) {
                        capture.failure = e.message ?: "Microphone capture failed. Please try again."
                        state.value = state.value.copy(errorMessage = capture.failure, hasRecording = false)
                    } finally { capture.release() }
                }
                // Covers cancellation before the job first executes, too.
                capture.job!!.invokeOnCompletion {
                    capture.release()
                    synchronized(lock) {
                        if (session === capture) state.value = state.value.copy(isRecording = false,
                            hasRecording = !capture.cancelled && capture.failure == null)
                    }
                }
            } catch (e: Exception) {
                input?.let { runCatching { it.stop() }; runCatching { it.release() } }
                session = null
                state.value = LiveAudioState(errorMessage = "Could not start the microphone. Check microphone permission and availability, then try again.")
            }
        }
    }
    suspend fun stopRecording(saveFile: Boolean = true): Pair<AudioSample, String> = saveMutex.withLock {
        synchronized(lock) { saved }?.let { return@withLock it }
        val capture = synchronized(lock) {
            saving = true
            session?.also { it.stopRequested = true } ?: run { saving = false; error("No recording is available. Try recording again.") }
        }
        var file: File? = null; var complete = false
        try {
            capture.job?.cancelAndJoin(); capture.release()
            check(!capture.cancelled) { "Recording was cancelled." }
            check(capture.failure == null) { capture.failure.orEmpty() }
            check(capture.file.length() > 44) { "No audio was captured. Check your microphone and try again." }
            val sample = withContext(dispatcher) {
                RandomAccessFile(capture.file, "r").use { input ->
                    input.seek(44)
                    val values = FloatArray(((input.length() - 44) / 2).toInt())
                    val buffer = ByteArray(8192); var offset = 0
                    while (offset < values.size) {
                        val count = minOf(buffer.size / 2, values.size - offset)
                        input.readFully(buffer, 0, count * 2)
                        for (i in 0 until count) values[offset + i] = (((buffer[i * 2].toInt() and 255) or (buffer[i * 2 + 1].toInt() shl 8)).toShort()) / 32768f
                        offset += count
                    }
                    AudioSample(values, sampleRate)
                }
            }
            val result = withContext(dispatcher) {
                val path = if (saveFile) {
                    file = finalizeRecording(capture.file)
                    file!!.absolutePath
                } else { capture.file.delete(); "" }
                sample to path
            }
            synchronized(lock) { saved = result; state.value = state.value.copy(isRecording = false, hasRecording = false) }
            complete = true
            result
        } finally {
            // The original WAV remains recoverable if encoding or analysis is interrupted.
            synchronized(lock) { saving = false }
        }
    }
    protected open fun finalizeRecording(wav: File): File = wav
    fun cancelRecording() {
        synchronized(lock) {
            session?.let { it.cancelled = true; it.stopRequested = true; it.job?.cancel() }
            state.value = LiveAudioState()
        }
    }
}
