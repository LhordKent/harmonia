package com.harmonia.app

import com.harmonia.app.data.local.dao.AchievementDao
import com.harmonia.app.data.local.dao.NotificationDao
import com.harmonia.app.data.local.entity.AchievementEntity
import com.harmonia.app.data.local.entity.NotificationEntity
import com.harmonia.app.data.local.entity.StudentAchievementEntity
import com.harmonia.app.data.repository.AchievementRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AchievementMilestoneTest {

    private class FakeAchievementDao : AchievementDao {
        val achievements = mutableListOf(
            AchievementEntity("ach_first_note", "First Note", "Complete your first practice", "sessionCount", 1, "mic_badge"),
            AchievementEntity("ach_pitch_sharp", "Pitch Precision", "Achieve 85% accuracy", "accuracy", 85, "target_badge"),
            AchievementEntity("ach_streak_3", "Vocal Discipline", "3-day streak", "streak", 3, "flame_badge")
        )
        val earned = mutableListOf<StudentAchievementEntity>()

        override fun observeAllAchievements(): Flow<List<AchievementEntity>> = flowOf(achievements)
        override suspend fun getAllAchievements(): List<AchievementEntity> = achievements
        override fun observeEarnedAchievements(studentId: String): Flow<List<StudentAchievementEntity>> = flowOf(earned)
        override suspend fun getEarnedAchievements(studentId: String): List<StudentAchievementEntity> = earned
        override suspend fun insertAllAchievements(achievements: List<AchievementEntity>) {}
        override suspend fun insertStudentAchievement(studentAchievement: StudentAchievementEntity) {
            earned.add(studentAchievement)
        }
    }

    private class FakeNotificationDao : NotificationDao {
        val notifications = mutableListOf<NotificationEntity>()
        override fun observeNotifications(studentId: String): Flow<List<NotificationEntity>> = flowOf(notifications)
        override suspend fun insert(notification: NotificationEntity) { notifications.add(notification) }
        override suspend fun markAsRead(id: String) {}
        override suspend fun markAllAsRead(studentId: String) {}
        override fun observeUnreadCount(studentId: String): Flow<Int> = flowOf(0)
    }

    @Test
    fun testAwardBadgesOnHighAccuracyAndFirstSession() = runBlocking {
        val achievementDao = FakeAchievementDao()
        val notificationDao = FakeNotificationDao()
        val repository = AchievementRepository(achievementDao, notificationDao)

        val newlyEarned = repository.checkAndAwardBadges(
            studentId = "student_test",
            sessionScore = 92.0f,
            totalSessions = 1,
            dayStreak = 1
        )

        // Should earn "First Note" (sessionCount 1) and "Pitch Precision" (accuracy >= 85)
        assertEquals(2, newlyEarned.size)
        assertTrue(newlyEarned.any { it.id == "ach_first_note" })
        assertTrue(newlyEarned.any { it.id == "ach_pitch_sharp" })
        assertEquals(2, notificationDao.notifications.size)
    }

    @Test
    fun testAwardStreakBadge() = runBlocking {
        val achievementDao = FakeAchievementDao()
        val notificationDao = FakeNotificationDao()
        val repository = AchievementRepository(achievementDao, notificationDao)

        val newlyEarned = repository.checkAndAwardBadges(
            studentId = "student_test",
            sessionScore = 65.0f,
            totalSessions = 5,
            dayStreak = 3
        )

        assertTrue("Should earn streak badge", newlyEarned.any { it.id == "ach_streak_3" })
    }
}
