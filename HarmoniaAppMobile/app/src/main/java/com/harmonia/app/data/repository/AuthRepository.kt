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
    private val authGateway: StudentAuthGateway = FirebaseStudentAuthGateway(),
    private val onboardingCache: OnboardingCache = InMemoryOnboardingCache()
) {
    // An empty ID means signed out; seeded demo data is never an authenticated identity.
    private val _currentStudentId = MutableStateFlow("")
    val currentStudentId: StateFlow<String> = _currentStudentId.asStateFlow()

    private val _authState = MutableStateFlow(AuthState.SignedOut)
    /** Lessons, recordings, feedback listeners and sync are allowed only in [AuthState.Ready]. */
    val authState: StateFlow<AuthState> = _authState.asStateFlow()

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    fun observeCurrentStudent(): Flow<StudentEntity?> = currentStudentId.flatMapLatest { id ->
        studentDao.observeById(id)
    }

    suspend fun getCurrentStudent(): StudentEntity? = withContext(Dispatchers.IO) {
        studentDao.getById(_currentStudentId.value)
    }

    private fun clearSession() {
        _currentStudentId.value = ""
        _authState.value = AuthState.SignedOut
    }

    /** Cloud identity/status wins; this device's microphone and privacy preferences are preserved. */
    private suspend fun apply(session: StudentSession): StudentEntity {
        val remote = session.student
        val cached = studentDao.getById(remote.id)
        val student = if (cached == null) remote else remote.copy(
            micSensitivity = cached.micSensitivity,
            audioQuality = cached.audioQuality,
            dataPrivacyOptOut = cached.dataPrivacyOptOut
        )
        studentDao.insertOrUpdate(student)
        onboardingCache.markVerifiedReady(if (session.state == AuthState.Ready) student.id else null)
        _currentStudentId.value = student.id
        _authState.value = session.state
        return student
    }

    suspend fun login(email: String, password: String): Result<StudentEntity> = withContext(Dispatchers.IO) {
        clearSession()
        try {
            require(email.isNotBlank() && password.isNotBlank()) { "Please enter your email and password." }
            Result.success(apply(authGateway.signIn(email.trim(), password)))
        } catch (e: CancellationException) {
            authGateway.signOut()
            clearSession()
            throw e
        } catch (e: Exception) {
            authGateway.signOut()
            clearSession()
            Result.failure(e)
        }
    }

    /**
     * Restores a persisted Firebase session at app start. Online, the server profile decides.
     * Offline, only an account this device previously verified as ready keeps (offline) access;
     * a legacy installation without that verification must go online once.
     */
    suspend fun restoreSession(): AuthState = withContext(Dispatchers.IO) {
        val uid = authGateway.currentUid() ?: return@withContext AuthState.SignedOut.also { clearSession() }
        try {
            val session = authGateway.currentSession()
            if (session == null) clearSession() else apply(session)
        } catch (e: CancellationException) {
            throw e
        } catch (e: OfflineException) {
            if (onboardingCache.isVerifiedReady(uid) && studentDao.getById(uid) != null) {
                _currentStudentId.value = uid
                _authState.value = AuthState.Ready
            } else {
                // Keep the Firebase session so the student can verify once online; show sign-in meanwhile.
                clearSession()
            }
        } catch (e: Exception) {
            // Inactive, removed or otherwise invalid account: never fall back to cached access.
            onboardingCache.markVerifiedReady(null)
            authGateway.signOut()
            clearSession()
        }
        _authState.value
    }

    suspend fun changePassword(currentPassword: String, newPassword: String, confirmPassword: String): Result<AuthState> =
        withContext(Dispatchers.IO) {
            validateNewPassword(currentPassword, newPassword, confirmPassword)?.let {
                return@withContext Result.failure(IllegalArgumentException(it))
            }
            try {
                Result.success(apply(authGateway.changePassword(currentPassword, newPassword)).let { _authState.value })
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Result.failure(e)
            }
        }

    /** After an email reset: the backend verifies the change and the fresh sign-in before clearing the requirement. */
    suspend fun completeOnboarding(): Result<AuthState> = withContext(Dispatchers.IO) {
        try {
            Result.success(apply(authGateway.completeOnboarding()).let { _authState.value })
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Result.failure(e)
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
        onboardingCache.markVerifiedReady(null)
        clearSession()
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
