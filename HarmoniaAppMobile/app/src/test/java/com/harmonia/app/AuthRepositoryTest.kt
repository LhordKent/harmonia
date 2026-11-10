package com.harmonia.app

import com.harmonia.app.data.local.dao.StudentDao
import com.harmonia.app.data.local.entity.StudentEntity
import com.harmonia.app.data.repository.AuthRepository
import com.harmonia.app.data.repository.StudentAuthGateway
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
        var failure: Exception? = null
        var signOuts = 0
        var receivedEmail = ""
        var receivedPassword = ""
        var resetEmail = ""
        override suspend fun signIn(email: String, password: String): StudentEntity {
            receivedEmail = email
            receivedPassword = password
            failure?.let { throw it }
            return student
        }
        override suspend fun register(fullName: String, email: String, password: String, studentType: String): StudentEntity {
            failure?.let { throw it }
            return student.copy(fullName = fullName, email = email, studentType = studentType)
        }
        override fun signOut() { signOuts++ }
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
        assertEquals(0, dao.emailLookups)
        assertEquals(1, auth.signOuts)
    }

    @Test
    fun networkFailureDoesNotBecomeSuccessfulLocalAuthentication() = runBlocking {
        val dao = FakeStudents()
        dao.rows["cached"] = StudentEntity("cached", "Cached", "student@example.com")
        val auth = FakeAuth().apply { failure = IllegalStateException("Network unavailable") }
        val repository = AuthRepository(dao, auth)
        assertTrue(repository.login("student@example.com", "password").isFailure)
        assertEquals("", repository.currentStudentId.value)
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
        assertEquals("student@example.com", auth.receivedEmail)
        assertEquals(" password with spaces ", auth.receivedPassword)
    }

    @Test
    fun failedSecondLoginClearsPreviousStudentSession() = runBlocking {
        val auth = FakeAuth()
        val repository = AuthRepository(FakeStudents(), auth)
        repository.login("student@example.com", "password").getOrThrow()
        auth.failure = IllegalArgumentException("Bad password")
        assertTrue(repository.login("other@example.com", "wrong").isFailure)
        assertEquals("", repository.currentStudentId.value)
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
    fun registrationFailureCreatesNoLocalStudent() = runBlocking {
        val dao = FakeStudents()
        val auth = FakeAuth().apply { failure = IllegalArgumentException("Email already in use") }
        val repository = AuthRepository(dao, auth)
        assertTrue(repository.signUp("Student", "student@example.com", "password").isFailure)
        assertTrue(dao.rows.isEmpty())
        assertEquals("", repository.currentStudentId.value)
        assertEquals(1, auth.signOuts)
    }

    @Test
    fun registrationUsesCloudUidAndRequiresExplicitLogin() = runBlocking {
        val dao = FakeStudents()
        val auth = FakeAuth()
        val repository = AuthRepository(dao, auth)
        val registered = repository.signUp(" Student ", " student@example.com ", "password").getOrThrow()
        assertEquals("firebase_uid", registered.id)
        assertEquals("Student", registered.fullName)
        assertEquals("", repository.currentStudentId.value)
        assertEquals(registered, dao.rows["firebase_uid"])
        assertEquals(1, auth.signOuts)
    }

    @Test
    fun logoutDoesNotSwitchToSeededDemoStudent() = runBlocking {
        val repository = AuthRepository(FakeStudents(), FakeAuth())
        repository.login("student@example.com", "password").getOrThrow()
        repository.logout()
        assertEquals("", repository.currentStudentId.value)
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
    fun cloudProfileAcceptsWebAndLegacyMobileNames() {
        val user = mapOf("role" to "student", "status" to "active", "institutionId" to "institution_001")
        val web = verifiedStudentProfile("uid", "student@example.com", user, mapOf("name" to "Web Name", "status" to "active"))
        val mobile = verifiedStudentProfile("uid", "student@example.com", user, mapOf("fullName" to "Mobile Name", "status" to "active"))
        assertEquals("Web Name", web.fullName)
        assertEquals("Mobile Name", mobile.fullName)
        assertEquals("institution_001", web.institutionId)
    }

    @Test
    fun missingInactiveDeletedAndStaffProfilesAreRejected() {
        val user = mapOf<String, Any?>("role" to "student", "status" to "active")
        val student = mapOf<String, Any?>("name" to "Student", "status" to "active")
        val cases = listOf(
            null to student,
            user to null,
            (user + ("status" to "inactive")) to student,
            (user + ("status" to "deleted")) to student,
            user to (student + ("status" to "inactive")),
            (user + ("role" to "coach")) to student,
            (user + ("role" to "admin")) to student
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
