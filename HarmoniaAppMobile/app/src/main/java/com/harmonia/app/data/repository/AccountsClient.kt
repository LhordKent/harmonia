package com.harmonia.app.data.repository

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI

/**
 * Calls the trusted accounts Edge Function with the student's Firebase ID token.
 * The endpoint is public configuration; administrative credentials stay on the server.
 */
class AccountsClient(private val endpoint: String = ENDPOINT) {
    suspend fun call(idToken: String, action: String, body: JSONObject = JSONObject()): JSONObject =
        withContext(Dispatchers.IO) {
            val connection = try {
                URI(endpoint).toURL().openConnection() as HttpURLConnection
            } catch (e: IOException) { throw OfflineException(e) }
            try {
                connection.requestMethod = "POST"
                connection.connectTimeout = 20_000
                connection.readTimeout = 30_000
                connection.instanceFollowRedirects = false
                connection.doOutput = true
                connection.setRequestProperty("Authorization", "Bearer $idToken")
                connection.setRequestProperty("Content-Type", "application/json")
                val payload = body.put("action", action).toString().toByteArray()
                connection.setFixedLengthStreamingMode(payload.size)
                connection.outputStream.use { it.write(payload) }
                val code = connection.responseCode
                val text = (if (code in 200..299) connection.inputStream else connection.errorStream)
                    ?.bufferedReader()?.use { it.readText() } ?: "{}"
                val result = runCatching { JSONObject(text) }.getOrDefault(JSONObject())
                if (code !in 200..299) {
                    throw AccountServiceException(
                        result.optString("error", "The account service is temporarily unavailable."),
                        result.optString("code").takeIf { it.isNotBlank() }
                    )
                }
                result
            } catch (e: IOException) {
                throw OfflineException(e)
            } finally {
                connection.disconnect()
            }
        }

    companion object {
        const val ENDPOINT = "https://ztrnmbtdaruyffjqjejz.supabase.co/functions/v1/accounts"
    }
}
