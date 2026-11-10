package com.harmonia.app.data.local.dao

import androidx.room.Dao
import androidx.room.Embedded
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Relation
import androidx.room.Transaction
import androidx.room.Update
import com.harmonia.app.data.local.entity.AchievementEntity
import com.harmonia.app.data.local.entity.AnalysisResultEntity
import com.harmonia.app.data.local.entity.NotificationEntity
import com.harmonia.app.data.local.entity.PracticeAttemptEntity
import com.harmonia.app.data.local.entity.PracticeSessionEntity
import com.harmonia.app.data.local.entity.ProgressReportEntity
import com.harmonia.app.data.local.entity.StudentAchievementEntity
import com.harmonia.app.data.local.entity.StudentEntity
import com.harmonia.app.data.local.entity.ReminderSettingsEntity
import com.harmonia.app.data.local.entity.VocalExerciseEntity
import com.harmonia.app.data.local.entity.VocalLessonEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface StudentDao {
    @Query("SELECT * FROM students WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): StudentEntity?

    @Query("SELECT * FROM students WHERE id = :id LIMIT 1")
    fun observeById(id: String): Flow<StudentEntity?>

    @Query("SELECT * FROM students WHERE email = :email LIMIT 1")
    suspend fun getByEmail(email: String): StudentEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertOrUpdate(student: StudentEntity)

    @Query("UPDATE students SET micSensitivity = :sensitivity WHERE id = :studentId")
    suspend fun updateMicSensitivity(studentId: String, sensitivity: Float)

    @Query("UPDATE students SET audioQuality = :quality, dataPrivacyOptOut = :privacyOptOut WHERE id = :studentId")
    suspend fun updateSettings(studentId: String, quality: String, privacyOptOut: Boolean)
}

@Dao
interface ExerciseDao {
    @Query("SELECT * FROM vocal_exercises ORDER BY orderIndex ASC")
    fun observeAllExercises(): Flow<List<VocalExerciseEntity>>

    @Query("SELECT * FROM vocal_exercises WHERE difficultyLevel = :difficulty ORDER BY orderIndex ASC")
    fun observeExercisesByDifficulty(difficulty: String): Flow<List<VocalExerciseEntity>>

    @Query("SELECT * FROM vocal_exercises WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): VocalExerciseEntity?

    @Query("SELECT * FROM vocal_exercises ORDER BY orderIndex ASC")
    suspend fun getAllExercises(): List<VocalExerciseEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(exercises: List<VocalExerciseEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(exercise: VocalExerciseEntity)
}

data class ExerciseWithSession(
    val exercise: VocalExerciseEntity,
    val session: PracticeSessionEntity?
)

@Dao
interface PracticeSessionDao {
    @Query("SELECT * FROM practice_sessions WHERE studentId = :studentId AND exerciseId = :exerciseId LIMIT 1")
    suspend fun getSession(studentId: String, exerciseId: String): PracticeSessionEntity?

    @Query("SELECT * FROM practice_sessions WHERE studentId = :studentId")
    fun observeSessionsForStudent(studentId: String): Flow<List<PracticeSessionEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertOrUpdate(session: PracticeSessionEntity)

    @Query("UPDATE practice_sessions SET status = :status, completedAt = :completedAt, bestScore = :bestScore WHERE studentId = :studentId AND exerciseId = :exerciseId")
    suspend fun updateStatus(studentId: String, exerciseId: String, status: String, completedAt: Long?, bestScore: Float)
}

data class PracticeAttemptWithResult(
    @Embedded val attempt: PracticeAttemptEntity,
    @Relation(
        parentColumn = "id",
        entityColumn = "practiceAttemptId"
    )
    val result: AnalysisResultEntity?
)

@Dao
interface PracticeAttemptDao {
    @Query("SELECT EXISTS(SELECT 1 FROM practice_attempts WHERE audioRecordingUrl = :path)")
    suspend fun containsAudioPath(path: String): Boolean

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(attempt: PracticeAttemptEntity)

    @Query("SELECT * FROM practice_attempts WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): PracticeAttemptEntity?

    @Query("SELECT * FROM practice_attempts WHERE studentId = :studentId ORDER BY recordedAt DESC")
    fun observeAttemptsForStudent(studentId: String): Flow<List<PracticeAttemptEntity>>

    @Transaction
    @Query("SELECT * FROM practice_attempts WHERE studentId = :studentId ORDER BY recordedAt DESC")
    fun observeAttemptsWithResult(studentId: String): Flow<List<PracticeAttemptWithResult>>

    @Query("SELECT * FROM practice_attempts WHERE studentId = :studentId ORDER BY recordedAt DESC LIMIT :limit")
    suspend fun getRecentAttempts(studentId: String, limit: Int = 10): List<PracticeAttemptEntity>

    @Query("SELECT * FROM practice_attempts WHERE isSynced = 0")
    suspend fun getUnsyncedAttempts(): List<PracticeAttemptEntity>

    @Query("UPDATE practice_attempts SET isSynced = 1 WHERE id = :id")
    suspend fun markSynced(id: String)
}

@Dao
interface AnalysisResultDao {
    @Query("UPDATE analysis_results SET advancementDecision = :decision WHERE practiceAttemptId = :attemptId")
    suspend fun saveAdvancement(attemptId: String, decision: String?)
    @Query("UPDATE analysis_results SET coachVerdict = :verdict, coachFeedback = :feedback, coachPitchScore = :pitch, coachToneScore = :tone, reviewedBy = :reviewer, reviewedAt = :reviewedAt WHERE practiceAttemptId = :attemptId")
    suspend fun saveCoachReview(attemptId: String, verdict: String?, feedback: String?, pitch: Float?, tone: Float?, reviewer: String?, reviewedAt: Long?)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(result: AnalysisResultEntity)

    @Query("SELECT * FROM analysis_results WHERE practiceAttemptId = :attemptId LIMIT 1")
    suspend fun getByAttemptId(attemptId: String): AnalysisResultEntity?

    @Query("SELECT * FROM analysis_results WHERE practiceAttemptId = :attemptId LIMIT 1")
    fun observeByAttemptId(attemptId: String): Flow<AnalysisResultEntity?>

    @Query("SELECT * FROM analysis_results WHERE isSynced = 0")
    suspend fun getUnsyncedResults(): List<AnalysisResultEntity>

    @Query("UPDATE analysis_results SET isSynced = 1 WHERE id = :id")
    suspend fun markSynced(id: String)

    @Query("UPDATE analysis_results SET verdictStatus = :verdict WHERE id = :id")
    suspend fun updateVerdict(id: String, verdict: String)
}

@Dao
interface ProgressReportDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(report: ProgressReportEntity)

    @Query("SELECT * FROM progress_reports WHERE studentId = :studentId ORDER BY generatedAt DESC LIMIT 1")
    suspend fun getLatestReport(studentId: String): ProgressReportEntity?

    @Query("SELECT * FROM progress_reports WHERE studentId = :studentId ORDER BY generatedAt DESC LIMIT 1")
    fun observeLatestReport(studentId: String): Flow<ProgressReportEntity?>

    @Query("SELECT * FROM progress_reports WHERE isSynced = 0")
    suspend fun getUnsyncedReports(): List<ProgressReportEntity>

    @Query("UPDATE progress_reports SET isSynced = 1 WHERE id = :id")
    suspend fun markSynced(id: String)
}

@Dao
interface AchievementDao {
    @Query("SELECT * FROM achievements")
    fun observeAllAchievements(): Flow<List<AchievementEntity>>

    @Query("SELECT * FROM achievements")
    suspend fun getAllAchievements(): List<AchievementEntity>

    @Query("SELECT * FROM student_achievements WHERE studentId = :studentId")
    fun observeEarnedAchievements(studentId: String): Flow<List<StudentAchievementEntity>>

    @Query("SELECT * FROM student_achievements WHERE studentId = :studentId")
    suspend fun getEarnedAchievements(studentId: String): List<StudentAchievementEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAllAchievements(achievements: List<AchievementEntity>)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertStudentAchievement(studentAchievement: StudentAchievementEntity)
}

@Dao
interface NotificationDao {
    @Query("SELECT * FROM notifications WHERE studentId = :studentId ORDER BY sentAt DESC")
    fun observeNotifications(studentId: String): Flow<List<NotificationEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(notification: NotificationEntity)

    @Query("UPDATE notifications SET isRead = 1 WHERE id = :id")
    suspend fun markAsRead(id: String)

    @Query("UPDATE notifications SET isRead = 1 WHERE studentId = :studentId")
    suspend fun markAllAsRead(studentId: String)

    @Query("SELECT COUNT(*) FROM notifications WHERE studentId = :studentId AND isRead = 0")
    fun observeUnreadCount(studentId: String): Flow<Int>
}

@Dao
interface ReminderSettingsDao {
    @Query("SELECT * FROM reminder_settings WHERE studentId = :studentId LIMIT 1")
    fun observe(studentId: String): Flow<ReminderSettingsEntity?>

    @Query("SELECT * FROM reminder_settings WHERE studentId = :studentId LIMIT 1")
    suspend fun get(studentId: String): ReminderSettingsEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(settings: ReminderSettingsEntity)
}

@Dao
interface VocalLessonDao {
    @Query("SELECT * FROM vocal_lessons ORDER BY createdAt ASC")
    fun observeLessons(): Flow<List<VocalLessonEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertLessons(lessons: List<VocalLessonEntity>)
}
