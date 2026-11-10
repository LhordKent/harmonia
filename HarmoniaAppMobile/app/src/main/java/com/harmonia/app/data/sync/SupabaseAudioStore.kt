package com.harmonia.app.data.sync

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Source
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder

/** Uses only a Firebase ID token. Storage credentials remain in the Edge Function. */
class SupabaseAudioStore(
    private val firestore: FirebaseFirestore,
    private val auth: FirebaseAuth
) {
    suspend fun playbackUrl(ref: String): String = withContext(Dispatchers.IO) {
        if (ref.startsWith("https://")) return@withContext ref
        require(ref.startsWith("supabase://harmonia-audio/")) { "Reference audio is unavailable." }
        val endpoint = firestore.collection("appConfig").document("audio").get(Source.SERVER).await().getString("endpoint")
            ?: error("Audio storage setup is pending.")
        require(validEndpoint(endpoint))
        val token = auth.currentUser?.getIdToken(false)?.await()?.token ?: error("Sign in to play reference audio.")
        val url = URI("$endpoint?action=playback&ref=${URLEncoder.encode(ref, "UTF-8")}").toURL()
        val connection = url.openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"; connection.connectTimeout = 20_000; connection.readTimeout = 30_000
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Authorization", "Bearer $token")
            val code = connection.responseCode
            val body = (if (code in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() } ?: "{}"
            val result = JSONObject(body)
            check(code in 200..299) { result.optString("error", "Reference audio could not be loaded.") }
            val signed = result.getString("url")
            val parsed = URI(signed)
            check(parsed.scheme == "https" && parsed.host == URI(endpoint).host && parsed.path.startsWith("/storage/v1/object/sign/"))
            signed
        } finally { connection.disconnect() }
    }

    suspend fun uploadAttempt(file: File, attemptId: String, studentId: String): String {
        require(auth.currentUser?.uid == studentId) { "Sign in as the recording's owner before syncing." }
        require(attemptId.matches(Regex("[A-Za-z0-9_-]{1,128}"))) { "Invalid recording ID." }
        require(file.isFile && file.length() in 1..MAX_BYTES) { "Recording must exist and be at most 8 MB." }
        val config = firestore.collection("appConfig").document("audio").get(Source.SERVER).await()
        val endpoint = config.getString("endpoint") ?: error("Audio storage setup is pending.")
        require(validEndpoint(endpoint)) { "Audio storage configuration is invalid." }
        val user = auth.currentUser ?: error("Sign in before syncing.")
        require(user.uid == studentId)
        val token = user.getIdToken(false).await().token ?: error("Your session expired.")
        val url = URI("$endpoint?action=upload&kind=attempts&id=${URLEncoder.encode(attemptId, "UTF-8")}").toURL()
        val connection = url.openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 20_000
            connection.readTimeout = 60_000
            connection.instanceFollowRedirects = false
            connection.doOutput = true
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("Content-Type", if (file.extension.equals("m4a", true)) "audio/mp4" else "audio/wav")
            connection.setFixedLengthStreamingMode(file.length())
            connection.outputStream.use { output -> file.inputStream().use { it.copyTo(output) } }
            val code = connection.responseCode
            val body = (if (code in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader()?.use { it.readText() } ?: "{}"
            val result = JSONObject(body)
            check(code in 200..299) { result.optString("error", "Recording upload failed.") }
            val ref = result.getString("audioRef")
            check(ref == "supabase://harmonia-audio/attempts/$studentId/$attemptId") { "Unexpected audio reference." }
            return ref
        } finally {
            connection.disconnect()
        }
    }

    companion object {
        const val MAX_BYTES = 8L * 1024 * 1024
        fun validEndpoint(value: String): Boolean = runCatching {
            val uri = URI(value)
            uri.scheme == "https" && uri.host?.endsWith(".supabase.co") == true &&
                uri.path == "/functions/v1/audio" && uri.query == null && uri.fragment == null &&
                uri.userInfo == null && uri.port == -1
        }.getOrDefault(false)
    }
}
