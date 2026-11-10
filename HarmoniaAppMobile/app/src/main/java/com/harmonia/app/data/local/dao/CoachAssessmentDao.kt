package com.harmonia.app.data.local.dao

import androidx.room.*
import com.harmonia.app.data.local.entity.CoachAssessmentEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface CoachAssessmentDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun save(assessment: CoachAssessmentEntity)
    @Query("SELECT * FROM coach_assessments WHERE studentId = :studentId")
    fun observe(studentId: String): Flow<CoachAssessmentEntity?>
    @Query("DELETE FROM coach_assessments WHERE studentId = :studentId")
    suspend fun clear(studentId: String)
}
