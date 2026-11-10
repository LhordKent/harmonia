package com.harmonia.app

import com.harmonia.app.data.sync.RemoteExerciseMapper
import org.junit.Assert.*
import org.junit.Test

class RemoteExerciseMapperTest {
    private fun web() = mapOf<String, Any?>("title" to "C4 practice", "coachId" to "coach1", "tier" to "Beginner", "targetPitchData" to 261.63, "duration" to 15,
        "referenceAudioRef" to "supabase://harmonia-audio/references/coach1/reference1")
    @Test fun webExerciseKeepsItsActualFrequencyDurationReferenceAndTier() {
        val exercise = RemoteExerciseMapper.from("exercise1", web())!!
        assertEquals("C4", exercise.targetNote); assertEquals(261.63f, exercise.targetFrequencyHz)
        assertEquals(15, exercise.durationSeconds); assertEquals("Foundations", exercise.difficultyLevel)
        assertTrue(exercise.audioSampleUrl!!.startsWith("supabase://"))
    }
    @Test fun canonicalMobileSchemaAndLegacyWebSchemaResolveIdentically() {
        val web = RemoteExerciseMapper.from("exercise1", web())!!
        val mobile = RemoteExerciseMapper.from("exercise1", mapOf("title" to web.title, "coachId" to web.coachId,
            "difficultyLevel" to "Foundations", "targetFrequencyHz" to 261.63, "durationSeconds" to 15, "audioSampleUrl" to web.audioSampleUrl))!!
        assertEquals(web.targetFrequencyHz, mobile.targetFrequencyHz); assertEquals(web.targetNote, mobile.targetNote)
    }
    @Test fun missingOrInvalidTargetsAreNotSilentlyReplacedWithA4() {
        listOf(mapOf("targetPitchData" to null), mapOf("duration" to 601), mapOf("targetPitchData" to 0), mapOf("tier" to "Unknown"), mapOf("duration" to 3.2)).forEach {
            assertNull(RemoteExerciseMapper.from("exercise1", web() + it))
        }
    }
}
