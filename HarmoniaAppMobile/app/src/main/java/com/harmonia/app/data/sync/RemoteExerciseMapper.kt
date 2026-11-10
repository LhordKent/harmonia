package com.harmonia.app.data.sync

import com.harmonia.app.data.local.entity.VocalExerciseEntity
import kotlin.math.log2
import kotlin.math.roundToInt

object RemoteExerciseMapper {
    fun from(id: String, data: Map<String, Any?>): VocalExerciseEntity? {
        val title = (data["title"] as? String)?.takeIf { it.isNotBlank() } ?: return null
        val frequency = ((data["targetFrequencyHz"] ?: data["targetPitchData"]) as? Number)?.toFloat() ?: return null
        val seconds = ((data["durationSeconds"] ?: data["duration"]) as? Number)?.toDouble() ?: return null
        if (!frequency.isFinite() || frequency !in 65f..1050f || !seconds.isFinite() || seconds !in 3.0..600.0 || seconds % 1 != 0.0) return null
        val type = data["exerciseType"] as? String ?: "single"
        if (type !in listOf("single", "scale", "song", "free")) return null
        val notes = (data["targetNotes"] as? List<*>)?.map { entry ->
            val note = entry as? Map<*, *> ?: return null
            val start = (note["startSeconds"] as? Number)?.toDouble() ?: return null
            val end = (note["endSeconds"] as? Number)?.toDouble() ?: return null
            val hz = (note["frequencyHz"] as? Number)?.toFloat() ?: return null
            com.harmonia.analysis.TargetNote(start, end, hz)
        }
        if (type in listOf("scale", "song") && (data["targetApproved"] != true || notes.isNullOrEmpty())) return null
        var end = 0.0
        for (note in notes.orEmpty()) {
            if (!note.startSeconds.isFinite() || !note.endSeconds.isFinite() || note.startSeconds < end ||
                note.endSeconds <= note.startSeconds || note.endSeconds > seconds || !note.frequencyHz.isFinite() || note.frequencyHz !in 65f..1050f) return null
            end = note.endSeconds
        }
        val tier = when (data["difficultyLevel"] ?: data["tier"]) {
            "Beginner", "Foundations" -> "Foundations"
            "Intermediate", "Pitch Training" -> "Pitch Training"
            "Advanced" -> "Advanced"
            else -> return null
        }
        val midi = (69 + 12 * log2(frequency / 440f)).roundToInt()
        val note = listOf("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")[Math.floorMod(midi, 12)] + (midi / 12 - 1)
        return VocalExerciseEntity(id = id, coachId = data["coachId"] as? String, title = title,
            description = (data["description"] as? String).orEmpty(), difficultyLevel = tier,
            targetNote = note, targetFrequencyHz = frequency, durationSeconds = seconds.toInt(),
            audioSampleUrl = (data["referenceAudioRef"] ?: data["audioSampleUrl"]) as? String,
            orderIndex = (data["orderIndex"] as? Number)?.toInt() ?: 0,
            referencePitchData = notes?.let { com.google.gson.Gson().toJson(it) }, exerciseType = type,
            targetVersion = data["targetVersion"]?.toString() ?: "1", prerequisiteId = data["prerequisiteId"] as? String)
    }
}
