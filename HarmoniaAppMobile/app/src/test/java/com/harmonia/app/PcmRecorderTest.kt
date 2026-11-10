package com.harmonia.app

import com.harmonia.app.ui.audio.*
import com.harmonia.analysis.dsp.AudioSample
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

@OptIn(ExperimentalCoroutinesApi::class)
class PcmRecorderTest {
    @get:Rule val temporary = TemporaryFolder()
    private class Input(val frames: MutableList<ShortArray> = mutableListOf(), val failStart: Boolean = false, val failRead: Boolean = false) : PcmInput {
        var starts = 0; var releases = 0; var reads = 0
        override fun start() { starts++; check(!failStart) { "Unavailable" } }
        override fun read(buffer: ShortArray): Int {
            reads++; if (failRead) return -6
            val frame = frames.removeFirstOrNull() ?: return 0
            frame.copyInto(buffer); return frame.size
        }
        override fun stop() {}
        override fun release() { releases++ }
    }
    @Test fun calibratedGainAffectsSavedAudioAndClipsWithoutIntegerWraparound() = runTest {
        val input = Input(mutableListOf(shortArrayOf(1000, 20000, -20000)))
        val recorder = PcmRecorder(temporary.root, { input }, dispatcher = StandardTestDispatcher(testScheduler))
        recorder.startRecording(this, 440f, 2f); runCurrent()
        val (sample, _) = recorder.stopRecording(saveFile = false)
        assertArrayEquals(floatArrayOf(2000 / 32768f, 32767 / 32768f, -1f), sample.samples, .00001f)
    }
    @Test fun failedStartupNeverClaimsItIsRecordingAndReleasesInput() = runTest {
        val input = Input(failStart = true)
        val recorder = PcmRecorder(temporary.root, { input }, dispatcher = StandardTestDispatcher(testScheduler))
        recorder.startRecording(this, 440f)
        assertFalse(recorder.liveState.value.isRecording); assertNotNull(recorder.liveState.value.errorMessage)
        assertEquals(1, input.releases); assertEquals(0, input.reads)
    }
    @Test fun partialReadsProduceExactWavSamplesAndRepeatedStopsSaveOnce() = runTest {
        val expected = shortArrayOf(123, -456, 789, 21, -30)
        val input = Input(mutableListOf(expected.take(3).toShortArray(), expected.drop(3).toShortArray()))
        val recorder = PcmRecorder(temporary.root, { input }, dispatcher = StandardTestDispatcher(testScheduler))
        recorder.startRecording(this, 440f); recorder.startRecording(this, 440f); runCurrent()
        val first = async { recorder.stopRecording() }; val second = async { recorder.stopRecording() }
        assertEquals(first.await().second, second.await().second)
        assertEquals(1, input.starts); assertEquals(1, input.releases)
        val decoded = AudioSample.fromWavBytes(File(first.await().second).readBytes())
        assertArrayEquals(expected.map { it / 32768f }.toFloatArray(), decoded.samples, .00001f)
        assertEquals(1, temporary.root.listFiles()!!.size)
    }
    @Test fun captureErrorsTerminateWithoutBusyLoopOrSavingCorruptedAudio() = runTest {
        val input = Input(failRead = true)
        val recorder = PcmRecorder(temporary.root, { input }, dispatcher = StandardTestDispatcher(testScheduler))
        recorder.startRecording(this, 440f); runCurrent()
        assertFalse(recorder.liveState.value.isRecording); assertNotNull(recorder.liveState.value.errorMessage)
        assertEquals(1, input.reads); assertEquals(1, input.releases)
        assertTrue(runCatching { recorder.stopRecording() }.isFailure)
        assertTrue(temporary.root.listFiles()!!.isEmpty())
    }
    @Test fun leavingScreenBeforeFirstReadStillReleasesMicrophoneWithoutCreatingFile() = runTest {
        val input = Input()
        val recorder = PcmRecorder(temporary.root, { input }, dispatcher = StandardTestDispatcher(testScheduler))
        recorder.startRecording(this, 440f); recorder.cancelRecording(); runCurrent()
        assertEquals(1, input.releases); assertEquals(0, input.reads)
        assertFalse(recorder.liveState.value.hasRecording)
        assertTrue(temporary.root.listFiles()!!.isEmpty())
    }
    @Test fun cancellationDuringCaptureDiscardsSamplesAndAllowsRestart() = runTest {
        val first = Input(mutableListOf(shortArrayOf(12, 34)))
        val second = Input(mutableListOf(shortArrayOf(56)))
        var next = first
        val recorder = PcmRecorder(temporary.root, { next }, dispatcher = StandardTestDispatcher(testScheduler))
        recorder.startRecording(this, 440f); runCurrent(); recorder.cancelRecording(); runCurrent()
        next = second; recorder.startRecording(this, 440f); runCurrent()
        val (sample, path) = recorder.stopRecording(saveFile = false)
        assertEquals(1, sample.samples.size); assertEquals("", path)
        assertEquals(1, first.releases); assertEquals(1, second.releases)
    }
    @Test fun capStopsCaptureAndKeepsAClipThatCanBeSaved() = runTest {
        val input = Input(MutableList(22) { ShortArray(2048) { 12 } })
        val recorder = PcmRecorder(temporary.root, { input }, dispatcher = StandardTestDispatcher(testScheduler), maxSeconds = 1)
        recorder.startRecording(this, 440f); runCurrent()
        assertFalse(recorder.liveState.value.isRecording); assertTrue(recorder.liveState.value.limitReached)
        val (sample, _) = recorder.stopRecording()
        assertEquals(44100, sample.samples.size); assertEquals(1, input.releases)
    }
}
