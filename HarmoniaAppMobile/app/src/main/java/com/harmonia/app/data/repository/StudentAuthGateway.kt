package com.harmonia.app.data.repository

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Source
import com.harmonia.app.data.local.entity.StudentEntity
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext

/** Boundary for cloud identity verification; local Room records are not credentials. */
interface StudentAuthGateway {
    suspend fun signIn(email: String, password: String): StudentEntity
    suspend fun register(fullName: String, email: String, password: String, studentType: String): StudentEntity
    suspend fun sendPasswordReset(email: String)
    fun signOut()
}

internal fun verifiedStudentProfile(
    uid: String,
    email: String,
    user: Map<String, Any?>?,
    student: Map<String, Any?>?
): StudentEntity {
    check(user != null && student != null) {
        "Your student profile is incomplete. Please contact the administrator."
    }
    check(user["role"] == "student") { "Coach and administrator accounts must use the web dashboard." }
    check(user["status"] == "active" && student["status"] == "active") {
        "This account is inactive. Please contact the administrator."
    }
    val fullName = (student["name"] as? String)?.takeIf { it.isNotBlank() }
        ?: (student["fullName"] as? String)?.takeIf { it.isNotBlank() }
        ?: listOfNotNull(user["firstName"] as? String, user["lastName"] as? String)
            .joinToString(" ").trim().ifBlank { "Student Singer" }
    return StudentEntity(
        id = uid,
        fullName = fullName,
        email = email,
        status = "active",
        studentType = student["studentType"] as? String ?: "collaborated",
        institutionId = student["institutionId"] as? String ?: user["institutionId"] as? String
    )
}

class FirebaseStudentAuthGateway : StudentAuthGateway {
    private val auth get() = FirebaseAuth.getInstance()
    private val firestore get() = FirebaseFirestore.getInstance()

    override suspend fun signIn(email: String, password: String): StudentEntity {
        // Clear any previous Firebase session before attempting a different account.
        auth.signOut()
        val firebaseUser = auth.signInWithEmailAndPassword(email, password).await().user
            ?: error("Sign in failed. Please try again.")
        // Server reads prevent a stale cached active profile from reactivating a disabled account.
        val user = firestore.collection("users").document(firebaseUser.uid).get(Source.SERVER).await()
        val student = firestore.collection("students").document(firebaseUser.uid).get(Source.SERVER).await()
        return verifiedStudentProfile(firebaseUser.uid, firebaseUser.email ?: email, user.data, student.data)
    }

    override suspend fun register(
        fullName: String,
        email: String,
        password: String,
        studentType: String
    ): StudentEntity {
        auth.signOut()
        val firebaseUser = auth.createUserWithEmailAndPassword(email, password).await().user
            ?: error("Registration failed. Please try again.")
        // Institution membership is assigned by staff, never selected by a registering client.
        val student = StudentEntity(
            id = firebaseUser.uid,
            fullName = fullName,
            email = firebaseUser.email ?: email,
            studentType = studentType
        )
        val nameParts = fullName.split(" ", limit = 2)
        val timestamp = FieldValue.serverTimestamp()
        val userData = mapOf(
            "uid" to student.id,
            "firstName" to nameParts[0],
            "lastName" to nameParts.getOrElse(1) { "" },
            "email" to student.email,
            "role" to "student",
            "status" to "active",
            "institutionId" to null,
            "createdAt" to timestamp,
            "updatedAt" to timestamp
        )
        val studentData = mapOf(
            "id" to student.id,
            "userId" to student.id,
            "name" to student.fullName,
            "fullName" to student.fullName,
            "firstName" to nameParts[0],
            "lastName" to nameParts.getOrElse(1) { "" },
            "email" to student.email,
            "studentType" to student.studentType,
            "status" to "active",
            "institutionId" to null,
            "createdAt" to timestamp,
            "updatedAt" to timestamp
        )
        try {
            // Either both role/profile documents are committed, or neither is written.
            firestore.batch()
                .set(firestore.collection("users").document(student.id), userData)
                .set(firestore.collection("students").document(student.id), studentData)
                .commit().await()
        } catch (e: CancellationException) {
            // A cancelled wait does not prove that the remote commit failed.
            throw e
        } catch (e: Exception) {
            // Roll back only the Auth account created by this registration attempt.
            val rollbackError = withContext(NonCancellable) {
                try {
                    firebaseUser.delete().await()
                    null
                } catch (cleanup: Exception) {
                    cleanup
                }
            }
            val message = if (rollbackError == null) {
                "Registration could not save your profile. Please contact the administrator to check student enrollment permissions."
            } else {
                "Your account was created but profile setup failed. Please contact the administrator before registering again."
            }
            throw IllegalStateException(message, e).also {
                if (rollbackError != null) it.addSuppressed(rollbackError)
            }
        }
        return student
    }

    override fun signOut() {
        auth.signOut()
    }

    override suspend fun sendPasswordReset(email: String) {
        auth.sendPasswordResetEmail(email).await()
    }
}
