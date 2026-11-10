package com.harmonia.app.data.repository

import com.harmonia.app.data.local.entity.StudentEntity

/** Explicit authentication states; only [Ready] may open lessons, recordings, feedback or sync. */
enum class AuthState { SignedOut, PasswordChangeRequired, EnrollmentRequired, Ready }

data class StudentSession(val student: StudentEntity, val state: AuthState)

/** The device could not reach Firebase or the accounts service; nothing was decided. */
class OfflineException(cause: Throwable? = null) :
    Exception("Connect to the internet to verify your account.", cause)

/** A recoverable error reported by the trusted accounts service (message is user-facing). */
class AccountServiceException(message: String, val code: String?) : Exception(message)

/**
 * Same state machine as the accounts service and the web portal. The server profile decides;
 * a client-written flag never grants access (Firestore rules and the backend re-check it).
 */
fun onboardingState(user: Map<String, Any?>?): AuthState {
    check(user != null) { "Your student profile is missing. Contact your school." }
    check(user["role"] == "student") { "Coach and administrator accounts must use the web portal." }
    check(user["status"] == "active") { "This account is inactive. Contact your school." }
    if (user["mustChangePassword"] == true) return AuthState.PasswordChangeRequired
    if ((user["institutionId"] as? String).isNullOrBlank()) return AuthState.EnrollmentRequired
    return AuthState.Ready
}

/** Local checks mirrored by the backend, which also rejects the school base password. */
fun validateNewPassword(current: String, new: String, confirm: String): String? = when {
    current.isEmpty() -> "Enter your current password."
    new.length < 8 -> "Your new password must have at least 8 characters."
    new != confirm -> "The new password and confirmation do not match."
    new == current -> "Your new password must be different from your current password."
    else -> null
}

/**
 * Remembers which account this device last verified online as fully set up, so a restored
 * session can keep supported offline access. Installations from before this rollout have no
 * entry and therefore need one online verification.
 */
interface OnboardingCache {
    fun isVerifiedReady(uid: String): Boolean
    fun markVerifiedReady(uid: String?)
}

class InMemoryOnboardingCache : OnboardingCache {
    private var verified: String? = null
    override fun isVerifiedReady(uid: String) = verified == uid
    override fun markVerifiedReady(uid: String?) { verified = uid }
}

class SharedPrefsOnboardingCache(context: android.content.Context) : OnboardingCache {
    private val prefs = context.getSharedPreferences("harmonia_account_setup", android.content.Context.MODE_PRIVATE)
    override fun isVerifiedReady(uid: String) = prefs.getString(KEY, null) == uid
    override fun markVerifiedReady(uid: String?) { prefs.edit().putString(KEY, uid).apply() }
    private companion object { const val KEY = "verified_ready_uid" }
}
