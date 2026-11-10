package com.harmonia.app.data.repository

import com.google.firebase.FirebaseNetworkException
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.firestore.Source
import com.harmonia.app.data.local.entity.StudentEntity
import kotlinx.coroutines.tasks.await
import org.json.JSONObject

/**
 * Boundary for cloud identity verification; local Room records are not credentials.
 * Accounts are created only by school administrators, so there is no registration here.
 */
interface StudentAuthGateway {
    suspend fun signIn(email: String, password: String): StudentSession
    /** The persisted Firebase session re-verified online; null when no one is signed in. Throws [OfflineException]. */
    suspend fun currentSession(): StudentSession?
    fun currentUid(): String?
    suspend fun changePassword(currentPassword: String, newPassword: String): StudentSession
    suspend fun completeOnboarding(): StudentSession
    suspend fun sendPasswordReset(email: String)
    fun signOut()
}

/** Builds the local student from server profiles. Pending users cannot read students/{uid}, so it is optional until ready. */
internal fun verifiedStudentProfile(
    uid: String,
    email: String,
    user: Map<String, Any?>?,
    student: Map<String, Any?>?
): StudentSession {
    val state = onboardingState(user)
    if (state == AuthState.Ready) {
        check(student != null) { "Your student profile is incomplete. Contact your school." }
        check(student["status"] == "active") { "This account is inactive. Contact your school." }
    }
    val fullName = (student?.get("name") as? String)?.takeIf { it.isNotBlank() }
        ?: (student?.get("fullName") as? String)?.takeIf { it.isNotBlank() }
        ?: (user?.get("name") as? String)?.takeIf { it.isNotBlank() }
        ?: listOfNotNull(user?.get("firstName") as? String, user?.get("lastName") as? String)
            .joinToString(" ").trim().ifBlank { "Student Singer" }
    return StudentSession(
        StudentEntity(
            id = uid,
            fullName = fullName,
            email = email,
            status = "active",
            studentType = student?.get("studentType") as? String ?: "collaborated",
            institutionId = student?.get("institutionId") as? String ?: user?.get("institutionId") as? String
        ),
        state
    )
}

class FirebaseStudentAuthGateway(
    private val accounts: AccountsClient = AccountsClient()
) : StudentAuthGateway {
    private val auth get() = FirebaseAuth.getInstance()
    private val firestore get() = FirebaseFirestore.getInstance()

    private suspend fun <T> online(block: suspend () -> T): T = try {
        block()
    } catch (e: FirebaseNetworkException) {
        throw OfflineException(e)
    } catch (e: FirebaseFirestoreException) {
        if (e.code == FirebaseFirestoreException.Code.UNAVAILABLE) throw OfflineException(e) else throw e
    }

    /** Server reads only: a stale cached profile can never reopen access. */
    private suspend fun load(user: FirebaseUser): StudentSession = online {
        val profile = firestore.collection("users").document(user.uid).get(Source.SERVER).await().data
        val state = onboardingState(profile)
        val student = if (state == AuthState.Ready) readWhenAccessSettles {
            firestore.collection("students").document(user.uid).get(Source.SERVER).await().data
        } else null
        verifiedStudentProfile(user.uid, user.email ?: "", profile, student)
    }

    /** Right after setup completes, Firestore may refuse protected reads for a moment; retry briefly. */
    private suspend fun <T> readWhenAccessSettles(block: suspend () -> T): T {
        repeat(5) { attempt ->
            try {
                return block()
            } catch (e: FirebaseFirestoreException) {
                if (e.code != FirebaseFirestoreException.Code.PERMISSION_DENIED) throw e
                kotlinx.coroutines.delay(250L * (attempt + 1))
            }
        }
        return block()
    }

    private suspend fun token(): String = online {
        auth.currentUser?.getIdToken(false)?.await()?.token ?: error("Sign in again.")
    }

    /** A pending account may already have changed its password by email; let the backend verify that. */
    private suspend fun resumeIfChanged(user: FirebaseUser, session: StudentSession): StudentSession {
        if (session.state != AuthState.PasswordChangeRequired) return session
        return try {
            accounts.call(token(), "completeOnboarding")
            load(user)
        } catch (e: AccountServiceException) {
            session
        } catch (e: OfflineException) {
            session
        }
    }

    override suspend fun signIn(email: String, password: String): StudentSession {
        // Clear any previous Firebase session before attempting a different account.
        auth.signOut()
        val user = online { auth.signInWithEmailAndPassword(email, password).await().user }
            ?: error("Sign in failed. Please try again.")
        return resumeIfChanged(user, load(user))
    }

    override suspend fun currentSession(): StudentSession? {
        val user = auth.currentUser ?: return null
        return resumeIfChanged(user, load(user))
    }

    override fun currentUid(): String? = auth.currentUser?.uid

    override suspend fun changePassword(currentPassword: String, newPassword: String): StudentSession {
        val email = auth.currentUser?.email ?: error("Sign in again before changing your password.")
        val body = JSONObject().put("currentPassword", currentPassword).put("newPassword", newPassword)
        try {
            accounts.call(token(), "changePassword", body)
        } catch (e: AccountServiceException) {
            if (e.code != "PROFILE_PENDING") throw e
            // The new password is active; sign in with it and resume setup.
            val user = online { auth.signInWithEmailAndPassword(email, newPassword).await().user } ?: throw e
            try {
                accounts.call(token(), "completeOnboarding")
            } catch (_: Exception) {
                throw IllegalStateException("Your new password is active, but setup could not be finished. Sign out, then sign in with your new password.")
            }
            return load(user)
        }
        // Older sessions are revoked by the change: authenticate again, then reload the profile.
        val user = online { auth.signInWithEmailAndPassword(email, newPassword).await().user }
            ?: error("Sign in with your new password.")
        return load(user)
    }

    override suspend fun completeOnboarding(): StudentSession {
        val user = auth.currentUser ?: error("Sign in again.")
        accounts.call(token(), "completeOnboarding")
        return load(user)
    }

    override fun signOut() {
        auth.signOut()
    }

    override suspend fun sendPasswordReset(email: String) {
        online { auth.sendPasswordResetEmail(email).await() }
    }
}
