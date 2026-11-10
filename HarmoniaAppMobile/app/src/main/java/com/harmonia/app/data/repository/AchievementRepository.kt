package com.harmonia.app.data.repository

import com.harmonia.app.data.local.dao.AchievementDao
import com.harmonia.app.data.local.dao.NotificationDao
import com.harmonia.app.data.local.entity.AchievementEntity
import com.harmonia.app.data.local.entity.NotificationEntity
import com.harmonia.app.data.local.entity.StudentAchievementEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import java.util.UUID

data class AchievementUiItem(
    val achievement: AchievementEntity,
    val isEarned: Boolean,
    val earnedAt: Long?,
    val progressPercent: Float
)

class AchievementRepository(
    private val achievementDao: AchievementDao,
    private val notificationDao: NotificationDao
) {

    fun observeAchievementsForStudent(studentId: String): Flow<List<AchievementUiItem>> {
        val allFlow = achievementDao.observeAllAchievements()
        val earnedFlow = achievementDao.observeEarnedAchievements(studentId)

        return combine(allFlow, earnedFlow) { all, earned ->
            val earnedMap = earned.associateBy { it.achievementId }
            all.map { ach ->
                val earnedRecord = earnedMap[ach.id]
                AchievementUiItem(
                    achievement = ach,
                    isEarned = earnedRecord != null,
                    earnedAt = earnedRecord?.earnedAt,
                    progressPercent = if (earnedRecord != null) 100.0f else 0.0f
                )
            }
        }
    }

    suspend fun checkAndAwardBadges(
        studentId: String,
        sessionScore: Float,
        totalSessions: Int,
        dayStreak: Int
    ): List<AchievementEntity> {
        val all = achievementDao.getAllAchievements()
        val earnedIds = achievementDao.getEarnedAchievements(studentId).map { it.achievementId }.toSet()
        val newlyEarned = mutableListOf<AchievementEntity>()

        for (ach in all) {
            if (earnedIds.contains(ach.id)) continue

            val unlocked = when (ach.criteriaType) {
                "sessionCount" -> totalSessions >= ach.criteriaValue
                "accuracy" -> sessionScore >= ach.criteriaValue
                "streak" -> dayStreak >= ach.criteriaValue
                else -> false
            }

            if (unlocked) {
                achievementDao.insertStudentAchievement(
                    StudentAchievementEntity(
                        id = "sa_${studentId}_${ach.id}",
                        studentId = studentId,
                        achievementId = ach.id,
                        earnedAt = System.currentTimeMillis()
                    )
                )
                newlyEarned.add(ach)

                notificationDao.insert(
                    NotificationEntity(
                        id = "notif_badge_" + UUID.randomUUID().toString().take(8),
                        studentId = studentId,
                        title = "Achievement Unlocked: ${ach.title}!",
                        message = "Congratulations! You unlocked the '${ach.title}' badge. ${ach.description}",
                        isRead = false,
                        sentAt = System.currentTimeMillis()
                    )
                )
            }
        }

        return newlyEarned
    }
}
