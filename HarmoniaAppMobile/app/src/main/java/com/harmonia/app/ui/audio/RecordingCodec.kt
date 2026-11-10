package com.harmonia.app.ui.audio

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteOrder

object RecordingCodec {
    /** Encode PCM WAV to AAC-LC; retain the WAV until the result is durably persisted. */
    fun encode(wav: File): File {
        val destination = File(wav.parentFile, wav.nameWithoutExtension + ".m4a")
        if (destination.isFile && destination.length() > 0) return destination
        val temporary = File(wav.parentFile, wav.nameWithoutExtension + ".encoding")
        val codec = MediaCodec.createEncoderByType("audio/mp4a-latm")
        var muxer: MediaMuxer? = null
        var started = false; var successful = false
        try {
            RandomAccessFile(wav, "r").use { input ->
                val header = ByteArray(44); input.readFully(header)
                val rate = java.nio.ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN).getInt(24)
                val format = MediaFormat.createAudioFormat("audio/mp4a-latm", rate, 1).apply {
                    setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
                    setInteger(MediaFormat.KEY_BIT_RATE, 64000)
                    setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 8192)
                }
                codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE); codec.start()
                muxer = MediaMuxer(temporary.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
                val info = MediaCodec.BufferInfo(); var track = -1; var bytes = 0L
                var inputEnded = false; var outputEnded = false
                val deadline = android.os.SystemClock.elapsedRealtime() + 120_000
                while (!outputEnded) {
                    check(android.os.SystemClock.elapsedRealtime() < deadline) { "Audio encoding timed out. Your WAV recording is preserved." }
                    if (!inputEnded) {
                        // Do not wait for input space while encoded output is waiting to be drained.
                        val index = codec.dequeueInputBuffer(0)
                        if (index >= 0) {
                            val buffer = codec.getInputBuffer(index)!!; buffer.clear()
                            val chunk = ByteArray(minOf(buffer.remaining(), 8192))
                            val count = input.read(chunk)
                            val time = bytes * 1_000_000 / (rate * 2)
                            if (count < 0) { inputEnded = true; codec.queueInputBuffer(index, 0, 0, time, MediaCodec.BUFFER_FLAG_END_OF_STREAM) }
                            else { buffer.put(chunk, 0, count); bytes += count; codec.queueInputBuffer(index, 0, count, time, 0) }
                        }
                    }
                    when (val index = codec.dequeueOutputBuffer(info, 10_000)) {
                        MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> { track = muxer!!.addTrack(codec.outputFormat); muxer!!.start(); started = true }
                        else -> if (index >= 0) {
                            val buffer = codec.getOutputBuffer(index)!!
                            if (info.size > 0 && info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0) {
                                check(started); buffer.position(info.offset); buffer.limit(info.offset + info.size)
                                muxer!!.writeSampleData(track, buffer, info)
                            }
                            outputEnded = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                            codec.releaseOutputBuffer(index, false)
                        }
                    }
                }
            }
            muxer!!.stop(); started = false; muxer!!.release(); muxer = null
            check(temporary.length() in 1..8L * 1024 * 1024) { "Encoded recording exceeds the upload limit. Your recording is preserved." }
            check(temporary.renameTo(destination)) { "Could not finalize the recording." }
            successful = true
            return destination
        } finally {
            runCatching { codec.stop() }; codec.release()
            if (started) runCatching { muxer?.stop() }
            runCatching { muxer?.release() }
            if (!successful) temporary.delete()
        }
    }
}
