package com.harmonia.app.data.repository

import com.harmonia.app.data.local.dao.ExerciseDao
import com.harmonia.app.data.local.dao.NotificationDao
import com.harmonia.app.data.local.dao.PracticeSessionDao
import com.harmonia.app.data.local.entity.NotificationEntity
import com.harmonia.app.data.local.entity.PracticeSessionEntity
import com.harmonia.app.data.local.entity.VocalExerciseEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import java.util.UUID

data class ExerciseUiItem(
    val exercise: VocalExerciseEntity,
    val status: String, // locked, available, completed
    val bestScore: Float
)

class ExerciseRepository(
    private val exerciseDao: ExerciseDao,
    private val sessionDao: PracticeSessionDao,
    private val notificationDao: NotificationDao
) {

    fun observeExercisesForStudent(studentId: String, difficulty: String? = null): Flow<List<ExerciseUiItem>> {
        val exercisesFlow = exerciseDao.observeAllExercises()
        val sessionsFlow = sessionDao.observeSessionsForStudent(studentId)

        return combine(exercisesFlow, sessionsFlow) { exercises, sessions ->
            val sessionMap = sessions.associateBy { it.exerciseId }
            exercises.filter { difficulty == null || it.difficultyLevel == difficulty }.map { ex ->
                val session = sessionMap[ex.id]
                val prerequisite = ex.prerequisiteId ?: if (ex.coachId == null && ex.orderIndex > 1)
                    exercises.filter { it.coachId == null && it.orderIndex < ex.orderIndex }.maxByOrNull { it.orderIndex }?.id else null
                val unlocked = prerequisite == null || sessionMap[prerequisite]?.status == "completed"
                val status = if (!unlocked) "locked" else session?.status ?: "available"
                val score = session?.bestScore ?: 0.0f
                ExerciseUiItem(
                    exercise = ex,
                    status = status,
                    bestScore = score
                )
            }
        }
    }

    suspend fun getExerciseById(id: String): VocalExerciseEntity? {
        return exerciseDao.getById(id)
    }

    suspend fun getAllExercises(): List<VocalExerciseEntity> {
        return exerciseDao.getAllExercises()
    }

    suspend fun handleExerciseCompletion(
        studentId: String,
        exerciseId: String,
        score: Float,
        isPassed: Boolean = score >= 70f
    ): Boolean {
        val currentSession = sessionDao.getSession(studentId, exerciseId)
        val currentBest = currentSession?.bestScore ?: 0.0f
        val newBest = maxOf(currentBest, score)

        // A machine grade is advisory. Only downloaded staff approval completes this exercise.
        sessionDao.insertOrUpdate(PracticeSessionEntity(
            id = currentSession?.id ?: "ps_${studentId}_$exerciseId", studentId = studentId,
            exerciseId = exerciseId, status = if (currentSession?.status == "completed") "completed" else "awaiting_review",
            bestScore = newBest, unlockedAt = currentSession?.unlockedAt ?: System.currentTimeMillis(),
            completedAt = currentSession?.completedAt
        ))

        return false
    }
}
