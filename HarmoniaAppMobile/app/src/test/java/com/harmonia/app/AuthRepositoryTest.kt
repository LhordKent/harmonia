package com.harmonia.app

import com.harmonia.app.data.local.dao.StudentDao
import com.harmonia.app.data.local.entity.StudentEntity
import com.harmonia.app.data.repository.AccountServiceException
import com.harmonia.app.data.repository.AuthRepository
import com.harmonia.app.data.repository.AuthState
import com.harmonia.app.data.repository.InMemoryOnboardingCache
import com.harmonia.app.data.repository.OfflineException
import com.harmonia.app.data.repository.StudentAuthGateway
import com.harmonia.app.data.repository.StudentSession
import com.harmonia.app.data.repository.onboardingState
import com.harmonia.app.data.repository.validateNewPassword
import com.harmonia.app.data.repository.verifiedStudentProfile
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class AuthRepositoryTest {
    private class FakeStudents : StudentDao {
        val rows = mutableMapOf<String, StudentEntity>()
        var emailLookups = 0
        var writeFailure: Exception? = null
        override suspend fun getById(id: String) = rows[id]
        override fun observeById(id: String): Flow<StudentEntity?> = flowOf(rows[id])
        override suspend fun getByEmail(email: String): StudentEntity? {
            emailLookups++
            return rows.values.firstOrNull { it.email == email }
        }
        override suspend fun insertOrUpdate(student: StudentEntity) {
            writeFailure?.let { throw it }
            rows[student.id] = student
        }
        override suspend fun updateMicSensitivity(studentId: String, sensitivity: Float) {}
        override suspend fun updateSettings(studentId: String, quality: String, privacyOptOut: Boolean) {}
    }

    private class FakeAuth : StudentAuthGateway {
        val student = StudentEntity("firebase_uid", "Cloud Student", "student@example.com", institutionId = "institution_001")
        var state = AuthState.Ready
        var failure: Exception? = null
        var restoreFailure: Exception? = null
        var changeFailure: Exception? = null
        var uid: String? = null
        var signOuts = 0
        var receivedEmail = ""
        var receivedPassword = ""
        var resetEmail = ""
        var changedTo = ""
        override suspend fun signIn(email: String, password: String): StudentSession {
            receivedEmail = email
            receivedPassword = password
            failure?.let { throw it }
            uid = student.id
            return StudentSession(student, state)
        }
        override suspend fun currentSession(): StudentSession? {
            restoreFailure?.let { throw it }
            return uid?.let { StudentSession(student, state) }
        }
        override fun currentUid() = uid
        override suspend fun changePassword(currentPassword: String, newPassword: String): StudentSession {
            changeFailure?.let { throw it }
            changedTo = newPassword
            state = AuthState.Ready
            return StudentSession(student, state)
        }
        override suspend fun completeOnboarding(): StudentSession {
            changeFailure?.let { throw it }
            state = AuthState.Ready
            return StudentSession(student, state)
        }
        override fun signOut() { signOuts++; uid = null }
        override suspend fun sendPasswordReset(email: String) {
            failure?.let { throw it }
            resetEmail = email
        }
    }

    @Test
    fun passwordResetCallsGatewayAndReportsFailure() = runBlocking {
        val auth = FakeAuth()
        val repository = AuthRepository(FakeStudents(), auth)
        assertTrue(repository.resetPassword(" student@example.com ").isSuccess)
        assertEquals("student@example.com", auth.resetEmail)
        auth.failure = IllegalStateException("Network unavailable")
        assertTrue(repository.resetPassword("student@example.com").isFailure)
        assertTrue(repository.resetPassword(" ").isFailure)
    }

    @Test
    fun rejectedPasswordCannotSignInUsingCachedEmail() = runBlocking {
        val dao = FakeStudents()
        dao.rows["firebase_uid"] = StudentEntity("firebase_uid", "Cached", "student@example.com")
        val auth = FakeAuth().apply { failure = IllegalArgumentException("Invalid credentials") }
        val repository = AuthRepository(dao, auth)
        val result = repository.login("student@example.com", "wrong")
        assertTrue(result.isFailure)
        assertEquals("", repository.currentStudentId.value)
        assertEquals(AuthState.SignedOut, repository.authState.value)
        assertEquals(0, dao.emailLookups)
        assertEquals(1, auth.signOuts)
    }

    @Test
    fun networkFailureDoesNotBecomeSuccessfulLocalAuthentication() = runBlocking {
        val dao = FakeStudents()
        dao.rows["cached"] = StudentEntity("cached", "Cached", "student@example.com")
        val auth = FakeAuth().apply { failure = OfflineException() }
        val repository = AuthRepository(dao, auth)
        assertTrue(repository.login("student@example.com", "password").isFailure)
        assertEquals("", repository.currentStudentId.value)
        assertEquals(AuthState.SignedOut, repository.authState.value)
        assertEquals(0, dao.emailLookups)
    }

    @Test
    fun loginRefreshesCloudProfileAndPreservesDevicePreferences() = runBlocking {
        val dao = FakeStudents()
        dao.rows["firebase_uid"] = StudentEntity(
            "firebase_uid", "Old Name", "old@example.com", institutionId = "old_institution",
            micSensitivity = 1.7f, audioQuality = "high", dataPrivacyOptOut = true
        )
        val auth = FakeAuth()
        val repository = AuthRepository(dao, auth)
        val student = repository.login(" student@example.com ", " password with spaces ").getOrThrow()
        assertEquals("Cloud Student", student.fullName)
        assertEquals("institution_001", student.institutionId)
        assertEquals(1.7f, student.micSensitivity, 0.001f)
        assertEquals("high", student.audioQuality)
        assertTrue(student.dataPrivacyOptOut)
        assertEquals("firebase_uid", repository.currentStudentId.value)
        assertEquals(AuthState.Ready, repository.authState.value)
        assertEquals("student@example.com", auth.receivedEmail)
        assertEquals(" password with spaces ", auth.receivedPassword)
    }

    @Test
    fun pendingLoginIsConfinedUntilPasswordChangeSucceeds() = runBlocking {
        val auth = FakeAuth().apply { state = AuthState.PasswordChangeRequired }
        val cache = InMemoryOnboardingCache()
        val repository = AuthRepository(FakeStudents(), auth, cache)
        repository.login("student@example.com", "School-Base-1").getOrThrow()
        assertEquals(AuthState.PasswordChangeRequired, repository.authState.value)
        assertFalse(cache.isVerifiedReady("firebase_uid"))

        assertTrue(repository.changePassword("School-Base-1", "short", "short").isFailure)
        assertTrue(repository.changePassword("School-Base-1", "Mine-pass-1", "Mine-pass-2").isFailure)
        assertTrue(repository.changePassword("School-Base-1", "School-Base-1", "School-Base-1").isFailure)
        assertEquals("", auth.changedTo)

        auth.changeFailure = AccountServiceException("Your current password is incorrect.", "WRONG_PASSWORD")
        val wrong = repository.changePassword("bad", "Mine-pass-1", "Mine-pass-1")
        assertEquals("Your current password is incorrect.", wrong.exceptionOrNull()?.message)
        assertEquals(AuthState.PasswordChangeRequired, repository.authState.value)

        auth.changeFailure = null
        assertEquals(AuthState.Ready, repository.changePassword("School-Base-1", "Mine-pass-1", "Mine-pass-1").getOrThrow())
        assertEquals(AuthState.Ready, repository.authState.value)
        assertTrue(cache.isVerifiedReady("firebase_uid"))
    }

    @Test
    fun enrollmentRequiredIsAStateNotAnError() = runBlocking {
        val auth = FakeAuth().apply { state = AuthState.EnrollmentRequired }
        val repository = AuthRepository(FakeStudents(), auth)
        assertTrue(repository.login("student@example.com", "password").isSuccess)
        assertEquals(AuthState.EnrollmentRequired, repository.authState.value)
    }

    @Test
    fun restoredSessionUsesServerStateOnline() = runBlocking {
        val auth = FakeAuth().apply { uid = "firebase_uid"; state = AuthState.PasswordChangeRequired }
        val cache = InMemoryOnboardingCache().apply { markVerifiedReady("firebase_uid") }
        val repository = AuthRepository(FakeStudents(), auth, cache)
        // A stale "ready" cache never overrides the server's pending requirement.
        assertEquals(AuthState.PasswordChangeRequired, repository.restoreSession())
        assertFalse(cache.isVerifiedReady("firebase_uid"))
    }

    @Test
    fun offlineRestoreKeepsAccessOnlyForPreviouslyVerifiedAccounts() = runBlocking {
        val dao = FakeStudents()
        dao.rows["firebase_uid"] = StudentEntity("firebase_uid", "Cached", "student@example.com", institutionId = "s1")
        // Legacy installation: no verification recorded yet -> must go online once.
        val legacy = FakeAuth().apply { uid = "firebase_uid"; restoreFailure = OfflineException() }
        val legacyRepository = AuthRepository(dao, legacy, InMemoryOnboardingCache())
        assertEquals(AuthState.SignedOut, legacyRepository.restoreSession())
        assertEquals("", legacyRepository.currentStudentId.value)
        assertEquals(0, legacy.signOuts)

        val verified = FakeAuth().apply { uid = "firebase_uid"; restoreFailure = OfflineException() }
        val cache = InMemoryOnboardingCache().apply { markVerifiedReady("firebase_uid") }
        val repository = AuthRepository(dao, verified, cache)
        assertEquals(AuthState.Ready, repository.restoreSession())
        assertEquals("firebase_uid", repository.currentStudentId.value)
    }

    @Test
    fun invalidAccountOnRestoreSignsOutAndForgetsVerification() = runBlocking {
        val auth = FakeAuth().apply { uid = "firebase_uid"; restoreFailure = IllegalStateException("This account is inactive.") }
        val cache = InMemoryOnboardingCache().apply { markVerifiedReady("firebase_uid") }
        val repository = AuthRepository(FakeStudents(), auth, cache)
        assertEquals(AuthState.SignedOut, repository.restoreSession())
        assertFalse(cache.isVerifiedReady("firebase_uid"))
        assertEquals(1, auth.signOuts)
    }

    @Test
    fun failedSecondLoginClearsPreviousStudentSession() = runBlocking {
        val auth = FakeAuth()
        val repository = AuthRepository(FakeStudents(), auth)
        repository.login("student@example.com", "password").getOrThrow()
        auth.failure = IllegalArgumentException("Bad password")
        assertTrue(repository.login("other@example.com", "wrong").isFailure)
        assertEquals("", repository.currentStudentId.value)
        assertEquals(AuthState.SignedOut, repository.authState.value)
    }

    @Test
    fun localPersistenceFailureDoesNotLeaveAuthenticatedAppSession() = runBlocking {
        val dao = FakeStudents().apply { writeFailure = IllegalStateException("Disk unavailable") }
        val auth = FakeAuth()
        val repository = AuthRepository(dao, auth)
        assertTrue(repository.login("student@example.com", "password").isFailure)
        assertEquals("", repository.currentStudentId.value)
        assertEquals(1, auth.signOuts)
    }

    @Test
    fun logoutDoesNotSwitchToSeededDemoStudent() = runBlocking {
        val cache = InMemoryOnboardingCache()
        val repository = AuthRepository(FakeStudents(), FakeAuth(), cache)
        repository.login("student@example.com", "password").getOrThrow()
        repository.logout()
        assertEquals("", repository.currentStudentId.value)
        assertEquals(AuthState.SignedOut, repository.authState.value)
        assertFalse(cache.isVerifiedReady("firebase_uid"))
        assertNull(repository.getCurrentStudent())
    }

    @Test
    fun cancelledAuthenticationPropagatesCancellation() = runBlocking {
        val auth = FakeAuth().apply { failure = CancellationException("Screen closed") }
        val repository = AuthRepository(FakeStudents(), auth)
        try {
            repository.login("student@example.com", "password")
            fail("Cancellation must propagate")
        } catch (_: CancellationException) {
            assertEquals("", repository.currentStudentId.value)
            assertEquals(1, auth.signOuts)
        }
    }

    @Test
    fun onboardingStateMatchesBackendStateMachine() {
        val base = mapOf<String, Any?>("role" to "student", "status" to "active", "institutionId" to "school_1")
        assertEquals(AuthState.Ready, onboardingState(base))
        assertEquals(AuthState.Ready, onboardingState(base + ("mustChangePassword" to false)))
        assertEquals(AuthState.PasswordChangeRequired, onboardingState(base + ("mustChangePassword" to true)))
        assertEquals(AuthState.EnrollmentRequired, onboardingState(base + ("institutionId" to null)))
        assertEquals(AuthState.PasswordChangeRequired, onboardingState(base + mapOf("institutionId" to null, "mustChangePassword" to true)))
    }

    @Test
    fun newPasswordValidationMirrorsBackend() {
        assertNotNull(validateNewPassword("", "Long-enough-1", "Long-enough-1"))
        assertNotNull(validateNewPassword("old", "short", "short"))
        assertNotNull(validateNewPassword("old", "Long-enough-1", "Long-enough-2"))
        assertNotNull(validateNewPassword("Long-enough-1", "Long-enough-1", "Long-enough-1"))
        assertNull(validateNewPassword("old-password", "Long-enough-1", "Long-enough-1"))
    }

    @Test
    fun cloudProfileAcceptsWebAndLegacyMobileNames() {
        val user = mapOf("role" to "student", "status" to "active", "institutionId" to "institution_001")
        val web = verifiedStudentProfile("uid", "student@example.com", user, mapOf("name" to "Web Name", "status" to "active"))
        val mobile = verifiedStudentProfile("uid", "student@example.com", user, mapOf("fullName" to "Mobile Name", "status" to "active"))
        assertEquals("Web Name", web.student.fullName)
        assertEquals("Mobile Name", mobile.student.fullName)
        assertEquals("institution_001", web.student.institutionId)
    }

    @Test
    fun pendingProfileNeedsNoStudentRecordButReadyProfileDoes() {
        val pending = mapOf("role" to "student", "status" to "active", "institutionId" to "s1", "mustChangePassword" to true, "name" to "Pending Pat")
        val session = verifiedStudentProfile("uid", "p@example.com", pending, null)
        assertEquals(AuthState.PasswordChangeRequired, session.state)
        assertEquals("Pending Pat", session.student.fullName)
        try {
            verifiedStudentProfile("uid", "p@example.com", pending - "mustChangePassword", null)
            fail("A ready account requires its student record")
        } catch (_: IllegalStateException) { }
    }

    @Test
    fun missingInactiveDeletedAndStaffProfilesAreRejected() {
        val user = mapOf<String, Any?>("role" to "student", "status" to "active", "institutionId" to "s1")
        val student = mapOf<String, Any?>("name" to "Student", "status" to "active")
        val cases = listOf(
            null to student,
            user to null,
            (user + ("status" to "inactive")) to student,
            (user + ("status" to "deleted")) to student,
            user to (student + ("status" to "inactive")),
            (user + ("role" to "coach")) to student,
            (user + ("role" to "admin")) to student,
            (user + ("role" to "institution")) to student
        )
        for ((profile, record) in cases) {
            try {
                verifiedStudentProfile("uid", "student@example.com", profile, record)
                fail("Invalid account profile was accepted: $profile / $record")
            } catch (_: IllegalStateException) {
                // Expected: the server profile is mandatory and must allow student access.
            }
        }
    }
}
