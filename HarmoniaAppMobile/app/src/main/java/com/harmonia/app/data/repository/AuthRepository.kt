package com.harmonia.app.data.repository

import android.util.Log
import com.google.firebase.auth.FirebaseAuth
import com.harmonia.app.BuildConfig
import com.harmonia.app.data.local.dao.StudentDao
import com.harmonia.app.data.local.entity.StudentEntity
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext

class AuthRepository(
    private val studentDao: StudentDao,
    private val authGateway: StudentAuthGateway = FirebaseStudentAuthGateway()
) {
    // An empty ID means signed out; seeded demo data is never an authenticated identity.
    private val _currentStudentId = MutableStateFlow("")
    val currentStudentId: StateFlow<String> = _currentStudentId.asStateFlow()

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    fun observeCurrentStudent(): Flow<StudentEntity?> = currentStudentId.flatMapLatest { id ->
        studentDao.observeById(id)
    }

    suspend fun getCurrentStudent(): StudentEntity? = withContext(Dispatchers.IO) {
        studentDao.getById(_currentStudentId.value)
    }

    suspend fun login(email: String, password: String): Result<StudentEntity> = withContext(Dispatchers.IO) {
        _currentStudentId.value = ""
        try {
            require(email.isNotBlank() && password.isNotBlank()) { "Please enter your email and password." }
            val remote = authGateway.signIn(email.trim(), password)
            val cached = studentDao.getById(remote.id)
            // Cloud identity/status wins; preserve this device's microphone and privacy preferences.
            val student = if (cached == null) remote else remote.copy(
                micSensitivity = cached.micSensitivity,
                audioQuality = cached.audioQuality,
                dataPrivacyOptOut = cached.dataPrivacyOptOut
            )
            studentDao.insertOrUpdate(student)
            _currentStudentId.value = student.id
            Result.success(student)
        } catch (e: CancellationException) {
            authGateway.signOut()
            throw e
        } catch (e: Exception) {
            authGateway.signOut()
            Result.failure(e)
        }
    }

    suspend fun signUp(
        fullName: String,
        email: String,
        password: String,
        studentType: String = "independent"
    ): Result<StudentEntity> = withContext(Dispatchers.IO) {
        _currentStudentId.value = ""
        try {
            require(fullName.isNotBlank() && email.isNotBlank() && password.isNotBlank()) {
                "Please fill in all required fields."
            }
            require(studentType in setOf("independent", "collaborated")) { "Invalid student type." }
            // Cloud registration must finish before reporting success. Never fabricate a local UID.
            val student = authGateway.register(fullName.trim(), email.trim(), password, studentType)
            studentDao.insertOrUpdate(student)
            Result.success(student)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Result.failure(e)
        } finally {
            // Registration returns to the login screen and must not leave a hidden Firebase session.
            authGateway.signOut()
        }
    }

    suspend fun resetPassword(email: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            require(email.isNotBlank()) { "Enter your account email address." }
            authGateway.sendPasswordReset(email.trim())
            Result.success(Unit)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun updateMicSensitivity(sensitivity: Float) {
        studentDao.updateMicSensitivity(_currentStudentId.value, sensitivity)
    }

    suspend fun updateAudioSettings(quality: String, privacyOptOut: Boolean) {
        studentDao.updateSettings(_currentStudentId.value, quality, privacyOptOut)
    }

    fun logout() {
        _currentStudentId.value = ""
        authGateway.signOut()
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DEBUG-only: Firebase ID token retrieval for Swagger / Render API testing
    // This method is excluded from release builds via BuildConfig.DEBUG.
    // The token is NEVER saved to disk, Firestore, Room, or SharedPreferences.
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * Fetches a fresh Firebase ID token for the currently signed-in Firebase user.
     *
     * Returns [Result.failure] if:
     *  - The build is not a DEBUG build.
     *  - No Firebase user is active (e.g. the user logged in through the local
     *    Room fallback — [FirebaseAuth.currentUser] is null in that case).
     *  - The token fetch itself fails.
     *
     * The token is **not** persisted anywhere. Only a masked prefix/suffix is
     * written to Logcat; the full value is returned only to the caller so it
     * can be placed on the system clipboard for Swagger testing.
     */
    suspend fun getDebugIdToken(): Result<String> {
        if (!BuildConfig.DEBUG) {
            return Result.failure(IllegalStateException("ID token retrieval is only available in DEBUG builds."))
        }

        return withContext(Dispatchers.IO) {
            try {
                val currentUser = FirebaseAuth.getInstance().currentUser
                    ?: return@withContext Result.failure(
                        IllegalStateException(
                            "No Firebase-authenticated user found.\n" +
                            "You may have signed in through the offline Room fallback.\n" +
                            "Please log out and log in again with a valid Firebase account."
                        )
                    )

                val tokenResult = currentUser.getIdToken(/* forceRefresh = */ true).await()
                val token = tokenResult?.token
                    ?: return@withContext Result.failure(Exception("Firebase returned a null ID token."))

                // Log only a safe masked preview — never the full token
                val preview = if (token.length > 24) {
                    "${token.take(12)}…${token.takeLast(6)}"
                } else {
                    "token(${token.length} chars)"
                }
                Log.d("AuthRepository", "[DEBUG] Firebase ID token fetched for uid=${currentUser.uid}. Preview: $preview")

                Result.success(token)
            } catch (e: Exception) {
                Log.e("AuthRepository", "[DEBUG] Failed to fetch Firebase ID token: ${e.message}")
                Result.failure(e)
            }
        }
    }
}
