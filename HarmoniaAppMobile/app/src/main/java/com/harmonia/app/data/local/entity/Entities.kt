package com.harmonia.app.data.local.entity

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "institutions"
)
data class InstitutionEntity(
    @PrimaryKey val id: String,
    val name: String,
    val address: String,
    val contactEmail: String,
    val status: String = "active", // active/inactive
    val createdAt: Long = System.currentTimeMillis()
)

@Entity(
    tableName = "vocal_coaches"
)
data class VocalCoachEntity(
    @PrimaryKey val id: String,
    val fullName: String,
    val email: String,
    val status: String = "active",
    val createdAt: Long = System.currentTimeMillis()
)

@Entity(
    tableName = "students",
    indices = [
        Index(value = ["email"], unique = true),
        Index(value = ["institutionId"])
    ]
)
data class StudentEntity(
    @PrimaryKey val id: String,
    val fullName: String,
    val email: String,
    val passwordHash: String = "", // Managed via Firebase Auth
    val profilePictureUrl: String? = null,
    val status: String = "active", // active/suspended
    val studentType: String = "independent", // independent/collaborated
    val institutionId: String? = null,
    val micSensitivity: Float = 1.0f,
    val audioQuality: String = "standard", // standard/high
    val dataPrivacyOptOut: Boolean = false,
    val createdAt: Long = System.currentTimeMillis()
)

@Entity(
    tableName = "vocal_lessons",
    indices = [Index(value = ["coachId"])]
)
data class VocalLessonEntity(
    @PrimaryKey val id: String,
    val coachId: String? = null,
    val title: String,
    val description: String,
    val difficultyLevel: String, // Foundations, Pitch Training, Advanced
    val createdAt: Long = System.currentTimeMillis()
)

@Entity(
    tableName = "vocal_exercises",
    indices = [Index(value = ["coachId"])]
)
data class VocalExerciseEntity(
    @PrimaryKey val id: String,
    val coachId: String? = null,
    val title: String,
    val description: String,
    val difficultyLevel: String, // Foundations, Pitch Training, Advanced
    val targetNote: String, // e.g. "A4", "C4", "G3"
    val targetFrequencyHz: Float, // e.g. 440.0
    val referencePitchData: String? = null, // JSON pitch sequence
    val referenceToneData: String? = null,  // JSON acoustic profile
    val audioSampleUrl: String? = null,
    val durationSeconds: Int = 15,
    val orderIndex: Int = 0,
    val createdAt: Long = System.currentTimeMillis(),
    @androidx.room.ColumnInfo(defaultValue = "'single'") val exerciseType: String = "single",
    @androidx.room.ColumnInfo(defaultValue = "'1'") val targetVersion: String = "1",
    val prerequisiteId: String? = null
)

@Entity(
    tableName = "lesson_exercises",
    indices = [
        Index(value = ["lessonId"]),
        Index(value = ["exerciseId"])
    ]
)
data class LessonExerciseEntity(
    @PrimaryKey val id: String,
    val lessonId: String,
    val exerciseId: String,
    val orderIndex: Int = 0
)

@Entity(
    tableName = "practice_sessions",
    indices = [
        Index(value = ["studentId"]),
        Index(value = ["exerciseId"]),
        Index(value = ["studentId", "exerciseId"], unique = true)
    ]
)
data class PracticeSessionEntity(
    @PrimaryKey val id: String,
    val studentId: String,
    val exerciseId: String,
    val status: String = "locked", // locked, available, completed
    val bestScore: Float = 0.0f,
    val unlockedAt: Long = System.currentTimeMillis(),
    val completedAt: Long? = null
)

@Entity(
    tableName = "practice_attempts",
    indices = [
        Index(value = ["studentId"]),
        Index(value = ["exerciseId"])
    ]
)
data class PracticeAttemptEntity(
    @PrimaryKey val id: String,
    val studentId: String,
    val exerciseId: String,
    val audioRecordingUrl: String, // Local file path or cloud URL
    val durationSeconds: Int,
    val isSynced: Boolean = false,
    val recordedAt: Long = System.currentTimeMillis()
)

@Entity(
    tableName = "analysis_results",
    indices = [
        Index(value = ["practiceAttemptId"], unique = true)
    ]
)
data class AnalysisResultEntity(
    @PrimaryKey val id: String,
    val practiceAttemptId: String,
    val accuracyScore: Float, // Pitch accuracy 0.0 - 100.0
    val toneScore: Float,     // Tone quality 0.0 - 100.0
    val overallScore: Float,  // Composite score 0.0 - 100.0
    val spectrogramUrl: String? = null,
    val detectedPitchData: String, // JSON serialized pitch frames
    val feedbackNotes: String,
    val verdictStatus: String = "aiPending", // aiPending / coachConfirmed / coachOverridden
    val isSynced: Boolean = false,
    val analyzedAt: Long = System.currentTimeMillis(),
    val coachVerdict: String? = null,
    val coachFeedback: String? = null,
    val coachPitchScore: Float? = null,
    val coachToneScore: Float? = null,
    val reviewedBy: String? = null,
    val reviewedAt: Long? = null,
    val gradingEvidence: String? = null,
    val advancementDecision: String? = null
)

@Entity(tableName = "coach_assessments")
data class CoachAssessmentEntity(
    @PrimaryKey val studentId: String,
    val assessmentId: String,
    val coachName: String,
    val feedback: String,
    val observations: String,
    val verdict: String,
    val finalizedAt: Long
)

@Entity(
    tableName = "progress_reports",
    indices = [Index(value = ["studentId"])]
)
data class ProgressReportEntity(
    @PrimaryKey val id: String,
    val studentId: String,
    val averageAccuracy: Float,
    val totalSessions: Int,
    val totalDurationSeconds: Int,
    val isSynced: Boolean = false,
    val generatedAt: Long = System.currentTimeMillis()
)

@Entity(
    tableName = "achievements"
)
data class AchievementEntity(
    @PrimaryKey val id: String,
    val title: String,
    val description: String,
    val criteriaType: String, // accuracy, streak, sessionCount
    val criteriaValue: Int,
    val badgeIconUrl: String
)

@Entity(
    tableName = "student_achievements",
    indices = [
        Index(value = ["studentId"]),
        Index(value = ["achievementId"]),
        Index(value = ["studentId", "achievementId"], unique = true)
    ]
)
data class StudentAchievementEntity(
    @PrimaryKey val id: String,
    val studentId: String,
    val achievementId: String,
    val earnedAt: Long = System.currentTimeMillis()
)

@Entity(
    tableName = "notifications",
    indices = [Index(value = ["studentId"])]
)
data class NotificationEntity(
    @PrimaryKey val id: String,
    val studentId: String,
    val title: String,
    val message: String,
    val isRead: Boolean = false,
    val sentAt: Long = System.currentTimeMillis()
)

@Entity(
    tableName = "subscriptions",
    indices = [Index(value = ["studentId"])]
)
data class SubscriptionEntity(
    @PrimaryKey val id: String,
    val studentId: String,
    val paymentId: String? = null,
    val planType: String = "individual", // individual/institutional
    val status: String = "active",       // active/inactive/expired
    val startDate: Long = System.currentTimeMillis(),
    val endDate: Long = System.currentTimeMillis() + 30L * 24 * 60 * 60 * 1000 // 30 days
)

/**
 * Stores the student's daily-reminder preference.
 * One row per studentId (upserted on change).
 * [hourOfDay] and [minuteOfHour] are 24-hour values (0-23, 0-59).
 */
@Entity(tableName = "reminder_settings")
data class ReminderSettingsEntity(
    @PrimaryKey val studentId: String,
    val enabled: Boolean = false,
    val hourOfDay: Int = 9,
    val minuteOfHour: Int = 0,
    val updatedAt: Long = System.currentTimeMillis()
)

@Entity(
    tableName = "student_feature_access",
    indices = [
        Index(value = ["studentId"]),
        Index(value = ["studentId", "featureId"], unique = true)
    ]
)
data class StudentFeatureAccessEntity(
    @PrimaryKey val id: String,
    val studentId: String,
    val featureId: String,
    val accessStatus: String = "unlocked", // locked/unlocked
    val unlockedAt: Long = System.currentTimeMillis()
)
