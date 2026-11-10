package com.harmonia.app.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.harmonia.app.data.local.dao.AchievementDao
import com.harmonia.app.data.local.dao.AnalysisResultDao
import com.harmonia.app.data.local.dao.ExerciseDao
import com.harmonia.app.data.local.dao.NotificationDao
import com.harmonia.app.data.local.dao.PracticeAttemptDao
import com.harmonia.app.data.local.dao.PracticeSessionDao
import com.harmonia.app.data.local.dao.ProgressReportDao
import com.harmonia.app.data.local.dao.StudentDao
import com.harmonia.app.data.local.dao.ReminderSettingsDao
import com.harmonia.app.data.local.entity.AchievementEntity
import com.harmonia.app.data.local.entity.AnalysisResultEntity
import com.harmonia.app.data.local.entity.CoachAssessmentEntity
import com.harmonia.app.data.local.entity.InstitutionEntity
import com.harmonia.app.data.local.entity.LessonExerciseEntity
import com.harmonia.app.data.local.entity.NotificationEntity
import com.harmonia.app.data.local.entity.PracticeAttemptEntity
import com.harmonia.app.data.local.entity.PracticeSessionEntity
import com.harmonia.app.data.local.entity.ProgressReportEntity
import com.harmonia.app.data.local.entity.StudentAchievementEntity
import com.harmonia.app.data.local.entity.StudentEntity
import com.harmonia.app.data.local.entity.StudentFeatureAccessEntity
import com.harmonia.app.data.local.entity.SubscriptionEntity
import com.harmonia.app.data.local.dao.VocalLessonDao
import com.harmonia.app.data.local.entity.ReminderSettingsEntity
import com.harmonia.app.data.local.entity.VocalExerciseEntity
import com.harmonia.app.data.local.entity.VocalCoachEntity
import com.harmonia.app.data.local.entity.VocalLessonEntity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

@Database(
    entities = [
        StudentEntity::class,
        VocalCoachEntity::class,
        InstitutionEntity::class,
        VocalLessonEntity::class,
        VocalExerciseEntity::class,
        LessonExerciseEntity::class,
        PracticeSessionEntity::class,
        PracticeAttemptEntity::class,
        AnalysisResultEntity::class,
        CoachAssessmentEntity::class,
        ProgressReportEntity::class,
        AchievementEntity::class,
        StudentAchievementEntity::class,
        NotificationEntity::class,
        SubscriptionEntity::class,
        StudentFeatureAccessEntity::class,
        ReminderSettingsEntity::class
    ],
    version = 6,
    exportSchema = false
)
abstract class HarmoniaDatabase : RoomDatabase() {

    abstract fun studentDao(): StudentDao
    abstract fun exerciseDao(): ExerciseDao
    abstract fun practiceSessionDao(): PracticeSessionDao
    abstract fun practiceAttemptDao(): PracticeAttemptDao
    abstract fun analysisResultDao(): AnalysisResultDao
    abstract fun coachAssessmentDao(): com.harmonia.app.data.local.dao.CoachAssessmentDao
    abstract fun progressReportDao(): ProgressReportDao
    abstract fun achievementDao(): AchievementDao
    abstract fun notificationDao(): NotificationDao
    abstract fun vocalLessonDao(): VocalLessonDao
    abstract fun reminderSettingsDao(): ReminderSettingsDao

    companion object {
        @Volatile
        private var INSTANCE: HarmoniaDatabase? = null
        val MIGRATION_5_6 = object : Migration(5, 6) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE analysis_results ADD COLUMN gradingEvidence TEXT")
                db.execSQL("ALTER TABLE analysis_results ADD COLUMN advancementDecision TEXT")
                db.execSQL("ALTER TABLE vocal_exercises ADD COLUMN exerciseType TEXT NOT NULL DEFAULT 'single'")
                db.execSQL("ALTER TABLE vocal_exercises ADD COLUMN targetVersion TEXT NOT NULL DEFAULT '1'")
                db.execSQL("ALTER TABLE vocal_exercises ADD COLUMN prerequisiteId TEXT")
                // Past automatic completions are not evidence of coach approval.
                db.execSQL("UPDATE practice_sessions SET status = 'available', completedAt = NULL WHERE status = 'completed'")
            }
        }
        val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE analysis_results ADD COLUMN coachVerdict TEXT")
                db.execSQL("ALTER TABLE analysis_results ADD COLUMN coachFeedback TEXT")
                db.execSQL("ALTER TABLE analysis_results ADD COLUMN coachPitchScore REAL")
                db.execSQL("ALTER TABLE analysis_results ADD COLUMN coachToneScore REAL")
                db.execSQL("ALTER TABLE analysis_results ADD COLUMN reviewedBy TEXT")
                db.execSQL("ALTER TABLE analysis_results ADD COLUMN reviewedAt INTEGER")
                db.execSQL("CREATE TABLE IF NOT EXISTS coach_assessments (studentId TEXT NOT NULL PRIMARY KEY, assessmentId TEXT NOT NULL, coachName TEXT NOT NULL, feedback TEXT NOT NULL, observations TEXT NOT NULL, verdict TEXT NOT NULL, finalizedAt INTEGER NOT NULL)")
            }
        }

        fun getInstance(context: Context): HarmoniaDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    HarmoniaDatabase::class.java,
                    "harmonia_app.db"
                )
                    .addMigrations(MIGRATION_4_5, MIGRATION_5_6)
                    .addCallback(object : Callback() {
                        override fun onCreate(db: SupportSQLiteDatabase) {
                            super.onCreate(db)
                            CoroutineScope(Dispatchers.IO).launch {
                                getInstance(context).populateInitialData()
                            }
                        }
                    })
                    .build()
                INSTANCE = instance
                instance
            }
        }
    }

    suspend fun populateInitialData() {
        val student = StudentEntity(
            id = "student_default",
            fullName = "Maria Santos",
            email = "maria.santos@uc.edu.ph",
            studentType = "collaborated",
            institutionId = "inst_uc_banilad",
            micSensitivity = 1.0f,
            audioQuality = "high"
        )
        studentDao().insertOrUpdate(student)

        // Seed Exercises
        val exercises = listOf(
            VocalExerciseEntity(
                id = "ex_f1",
                title = "Single Tone Sustain (A4)",
                description = "Sustain a clean, steady A4 note (440 Hz) on an open 'Ah' vowel with stable breath support.",
                difficultyLevel = "Foundations",
                targetNote = "A4",
                targetFrequencyHz = 440.0f,
                durationSeconds = 15,
                orderIndex = 1
            ),
            VocalExerciseEntity(
                id = "ex_f2",
                title = "Middle C Anchor (C4)",
                description = "Find and sustain middle C (261.6 Hz) using gentle vocal onset.",
                difficultyLevel = "Foundations",
                targetNote = "C4",
                targetFrequencyHz = 261.63f,
                durationSeconds = 15,
                orderIndex = 2
            ),
            VocalExerciseEntity(
                id = "ex_f3",
                title = "Fifth Interval Jump (G4)",
                description = "Practice leaping up from Middle C to G4 (392.0 Hz) and locking in your pitch immediately.",
                difficultyLevel = "Foundations",
                targetNote = "G4",
                targetFrequencyHz = 392.00f,
                durationSeconds = 15,
                orderIndex = 3
            ),
            VocalExerciseEntity(
                id = "ex_p1",
                title = "Major Third Precision (E4)",
                description = "Tune the bright major 3rd interval on E4 (329.6 Hz) with forward vocal placement.",
                difficultyLevel = "Pitch Training",
                targetNote = "E4",
                targetFrequencyHz = 329.63f,
                durationSeconds = 20,
                orderIndex = 4
            ),
            VocalExerciseEntity(
                id = "ex_p2",
                title = "Octave Lift (D4)",
                description = "Bridge registers smoothly and hold D4 (293.7 Hz) with consistent acoustic resonance.",
                difficultyLevel = "Pitch Training",
                targetNote = "D4",
                targetFrequencyHz = 293.66f,
                durationSeconds = 20,
                orderIndex = 5
            ),
            VocalExerciseEntity(
                id = "ex_p3",
                title = "Tenor/Soprano Focus (F4)",
                description = "Stabilize pitch near the vocal break (passaggio) at F4 (349.2 Hz).",
                difficultyLevel = "Pitch Training",
                targetNote = "F4",
                targetFrequencyHz = 349.23f,
                durationSeconds = 20,
                orderIndex = 6
            ),
            VocalExerciseEntity(
                id = "ex_a1",
                title = "High Register Control (B4)",
                description = "Control vocal tract shape and sustain B4 (493.9 Hz) with minimal vocal jitter.",
                difficultyLevel = "Advanced",
                targetNote = "B4",
                targetFrequencyHz = 493.88f,
                durationSeconds = 25,
                orderIndex = 7
            ),
            VocalExerciseEntity(
                id = "ex_a2",
                title = "Chromatic Target (F#4)",
                description = "Sing an accurate F#4 (370.0 Hz) with centered intonation and low shimmer.",
                difficultyLevel = "Advanced",
                targetNote = "F#4",
                targetFrequencyHz = 369.99f,
                durationSeconds = 25,
                orderIndex = 8
            ),
            VocalExerciseEntity(
                id = "ex_a3",
                title = "Mastery Soprano C (C5)",
                description = "Deliver a confident, resonant High C (523.3 Hz) with maximum clarity and harmonic richness.",
                difficultyLevel = "Advanced",
                targetNote = "C5",
                targetFrequencyHz = 523.25f,
                durationSeconds = 30,
                orderIndex = 9
            )
        )
        exerciseDao().insertAll(exercises)

        // Seed initial practice session states: first exercise available, others locked
        exercises.forEachIndexed { index, ex ->
            val status = if (index == 0) "available" else "locked"
            practiceSessionDao().insertOrUpdate(
                PracticeSessionEntity(
                    id = "ps_${student.id}_${ex.id}",
                    studentId = student.id,
                    exerciseId = ex.id,
                    status = status,
                    unlockedAt = System.currentTimeMillis()
                )
            )
        }

        // Seed Achievements
        val achievements = listOf(
            AchievementEntity(
                id = "ach_first_note",
                title = "First Note",
                description = "Complete your first vocal practice recording",
                criteriaType = "sessionCount",
                criteriaValue = 1,
                badgeIconUrl = "mic_badge"
            ),
            AchievementEntity(
                id = "ach_pitch_sharp",
                title = "Pitch Precision",
                description = "Achieve 85% or higher pitch accuracy on any exercise",
                criteriaType = "accuracy",
                criteriaValue = 85,
                badgeIconUrl = "target_badge"
            ),
            AchievementEntity(
                id = "ach_streak_3",
                title = "Vocal Discipline",
                description = "Maintain a 3-day practice streak",
                criteriaType = "streak",
                criteriaValue = 3,
                badgeIconUrl = "flame_badge"
            ),
            AchievementEntity(
                id = "ach_sessions_10",
                title = "Dedicated Singer",
                description = "Complete 10 total practice sessions",
                criteriaType = "sessionCount",
                criteriaValue = 10,
                badgeIconUrl = "trophy_badge"
            ),
            AchievementEntity(
                id = "ach_mastery_95",
                title = "Virtuoso Pitch",
                description = "Attain an extraordinary 95%+ accuracy score",
                criteriaType = "accuracy",
                criteriaValue = 95,
                badgeIconUrl = "crown_badge"
            )
        )
        achievementDao().insertAllAchievements(achievements)

        // Seed initial notification
        notificationDao().insert(
            NotificationEntity(
                id = "notif_welcome",
                studentId = student.id,
                title = "Welcome to Harmonia!",
                message = "Start your vocal journey with 'Single Tone Sustain (A4)'. Make sure your microphone is ready.",
                isRead = false,
                sentAt = System.currentTimeMillis()
            )
        )
    }
}
