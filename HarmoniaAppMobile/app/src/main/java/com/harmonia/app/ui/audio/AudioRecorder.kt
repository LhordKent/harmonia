package com.harmonia.app.ui.audio

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import java.io.File

class AudioRecorder(context: Context, sampleRate: Int = 16000) : PcmRecorder(
    File(context.filesDir, "recordings/" + (com.google.firebase.auth.FirebaseAuth.getInstance().currentUser?.uid ?: "calibration")), { AndroidPcmInput(sampleRate) }, sampleRate
) {
    override fun finalizeRecording(wav: File): File = RecordingCodec.encode(wav)
}

@SuppressLint("MissingPermission")
internal class AndroidPcmInput(sampleRate: Int) : PcmInput {
    private val recorder: AudioRecord
    init {
        val minimum = AudioRecord.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        check(minimum > 0) { "This microphone configuration is unavailable." }
        recorder = AudioRecord(MediaRecorder.AudioSource.MIC, sampleRate, AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT, maxOf(minimum, 4096))
        if (recorder.state != AudioRecord.STATE_INITIALIZED) { recorder.release(); error("Microphone initialization failed.") }
    }
    override fun start() {
        recorder.startRecording()
        check(recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) { "Microphone did not start." }
    }
    override fun read(buffer: ShortArray) = recorder.read(buffer, 0, buffer.size, AudioRecord.READ_NON_BLOCKING)
    override fun stop() { if (recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) recorder.stop() }
    override fun release() = recorder.release()
}
