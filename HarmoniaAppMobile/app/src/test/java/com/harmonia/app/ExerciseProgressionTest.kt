package com.harmonia.app

import com.harmonia.app.data.local.dao.ExerciseDao
import com.harmonia.app.data.local.dao.NotificationDao
import com.harmonia.app.data.local.dao.PracticeSessionDao
import com.harmonia.app.data.local.entity.NotificationEntity
import com.harmonia.app.data.local.entity.PracticeSessionEntity
import com.harmonia.app.data.local.entity.VocalExerciseEntity
import com.harmonia.app.data.repository.ExerciseRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ExerciseProgressionTest {
    @Test fun compositeScoreDoesNotUnlockNextExerciseWhenPitchRequirementFails() = runBlocking {
        val sessions = FakePracticeSessionDao()
        val repository = ExerciseRepository(FakeExerciseDao(), sessions, FakeNotificationDao())
        assertFalse(repository.handleExerciseCompletion("student_1", "ex_1", 76f, isPassed = false))
        assertEquals("awaiting_review", sessions.getSession("student_1", "ex_1")?.status)
        assertEquals(null, sessions.getSession("student_1", "ex_2"))
    }

    private class FakeExerciseDao : ExerciseDao {
        val exercises = mutableListOf(
            VocalExerciseEntity("ex_1", null, "Sustain A4", "Foundations", "Foundations", "A4", 440f, durationSeconds = 15, orderIndex = 1),
            VocalExerciseEntity("ex_2", null, "Anchor C4", "Foundations", "Foundations", "C4", 261.63f, durationSeconds = 15, orderIndex = 2),
            VocalExerciseEntity("ex_3", null, "Jump G4", "Foundations", "Foundations", "G4", 392f, durationSeconds = 15, orderIndex = 3)
        )
        override fun observeAllExercises(): Flow<List<VocalExerciseEntity>> = flowOf(exercises)
        override fun observeExercisesByDifficulty(difficulty: String): Flow<List<VocalExerciseEntity>> = flowOf(exercises)
        override suspend fun getById(id: String): VocalExerciseEntity? = exercises.find { it.id == id }
        override suspend fun getAllExercises(): List<VocalExerciseEntity> = exercises
        override suspend fun insertAll(exercises: List<VocalExerciseEntity>) {}
        override suspend fun insert(exercise: VocalExerciseEntity) {}
    }

    private class FakePracticeSessionDao : PracticeSessionDao {
        val sessions = mutableMapOf<String, PracticeSessionEntity>()

        override suspend fun getSession(studentId: String, exerciseId: String): PracticeSessionEntity? =
            sessions["${studentId}_$exerciseId"]

        override fun observeSessionsForStudent(studentId: String): Flow<List<PracticeSessionEntity>> =
            flowOf(sessions.values.toList())

        override suspend fun insertOrUpdate(session: PracticeSessionEntity) {
            sessions["${session.studentId}_${session.exerciseId}"] = session
        }

        override suspend fun updateStatus(studentId: String, exerciseId: String, status: String, completedAt: Long?, bestScore: Float) {
            val key = "${studentId}_$exerciseId"
            val existing = sessions[key]
            if (existing != null) {
                sessions[key] = existing.copy(status = status, completedAt = completedAt, bestScore = bestScore)
            }
        }
    }

    private class FakeNotificationDao : NotificationDao {
        val notifs = mutableListOf<NotificationEntity>()
        override fun observeNotifications(studentId: String): Flow<List<NotificationEntity>> = flowOf(notifs)
        override suspend fun insert(notification: NotificationEntity) { notifs.add(notification) }
        override suspend fun markAsRead(id: String) {}
        override suspend fun markAllAsRead(studentId: String) {}
        override fun observeUnreadCount(studentId: String): Flow<Int> = flowOf(0)
    }

    @Test
    fun automaticPassWaitsForCoachAndDoesNotUnlockNextExercise() = runBlocking {
        val exerciseDao = FakeExerciseDao()
        val sessionDao = FakePracticeSessionDao()
        val notificationDao = FakeNotificationDao()
        val repository = ExerciseRepository(exerciseDao, sessionDao, notificationDao)

        // Given student starts ex_1
        sessionDao.insertOrUpdate(
            PracticeSessionEntity("ps_1", "student_1", "ex_1", "available")
        )

        // When student scores 88% (passing >= 70%)
        val isPassed = repository.handleExerciseCompletion("student_1", "ex_1", 88.0f)

        assertFalse("Automatic scores never authorize progression", isPassed)

        // Then ex_1 is completed
        val s1 = sessionDao.getSession("student_1", "ex_1")
        assertEquals("awaiting_review", s1?.status)
        assertEquals(88.0f, s1?.bestScore ?: 0.0f, 0.1f)

        // And ex_2 is unlocked as "available"
        val s2 = sessionDao.getSession("student_1", "ex_2")
        assertEquals(null, s2)

        // Notification is sent
        assertTrue(notificationDao.notifs.isEmpty())
    }

    @Test
    fun testDoNotUnlockNextWhenScoreFails() = runBlocking {
        val exerciseDao = FakeExerciseDao()
        val sessionDao = FakePracticeSessionDao()
        val notificationDao = FakeNotificationDao()
        val repository = ExerciseRepository(exerciseDao, sessionDao, notificationDao)

        sessionDao.insertOrUpdate(
            PracticeSessionEntity("ps_1", "student_1", "ex_1", "available")
        )

        // Student scores 55% (< 70%)
        val isPassed = repository.handleExerciseCompletion("student_1", "ex_1", 55.0f)

        assertFalse("Exercise attempt should not pass", isPassed)
        val s2 = sessionDao.getSession("student_1", "ex_2")
        assertEquals(null, s2) // Remains un-created/locked
    }
}
