package com.harmonia.app.ui.debug

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.harmonia.app.BuildConfig
import com.harmonia.app.data.repository.AuthRepository
import com.harmonia.app.ui.theme.PrimaryPurple
import com.harmonia.app.ui.theme.PrimaryPurpleLight
import com.harmonia.app.ui.theme.SurfaceCard
import kotlinx.coroutines.launch

// ─────────────────────────────────────────────────────────────────────────────
// DEBUG-ONLY composable. The entire composable is a no-op in release builds.
// It is only included in the UI when called inside an `if (BuildConfig.DEBUG)`
// guard in ProfileScreen.
// ─────────────────────────────────────────────────────────────────────────────

private val DebugAmber = Color(0xFFFFC107)
private val DebugRed = Color(0xFFFF5252)

/**
 * A card that appears only in DEBUG builds, allowing the developer to fetch
 * and copy the current user's Firebase ID token to the system clipboard.
 *
 * The token is:
 *  - Never printed in full to Logcat (only a masked preview is logged).
 *  - Never saved to disk, Room, Firestore, or SharedPreferences.
 *  - Only available when a real Firebase-authenticated user exists
 *    ([FirebaseAuth.currentUser] is non-null).
 */
@Composable
fun DebugTokenPanel(authRepository: AuthRepository) {
    // Guard: compile-time constant — entire block is dead code in release.
    if (!BuildConfig.DEBUG) return

    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var isFetching by remember { mutableStateOf(false) }
    var statusMessage by remember { mutableStateOf<String?>(null) }
    var isError by remember { mutableStateOf(false) }
    var copyConfirmed by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .border(
                width = 1.dp,
                color = DebugAmber.copy(alpha = 0.6f),
                shape = RoundedCornerShape(16.dp)
            ),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = SurfaceCard)
    ) {
        Column(modifier = Modifier.padding(18.dp)) {

            // ── Header ──────────────────────────────────────────────────────
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Default.BugReport,
                    contentDescription = null,
                    tint = DebugAmber,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "DEBUG  •  Firebase ID Token",
                    style = MaterialTheme.typography.titleSmall.copy(
                        color = DebugAmber,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 0.5.sp
                    )
                )
            }

            Spacer(modifier = Modifier.height(4.dp))

            Text(
                text = "Fetches a fresh JWT for the current Firebase user and copies it to the " +
                        "clipboard. Use the token as a Bearer credential in Swagger UI on Render.",
                style = MaterialTheme.typography.bodySmall.copy(
                    color = DebugAmber.copy(alpha = 0.75f)
                )
            )

            Spacer(modifier = Modifier.height(14.dp))

            // ── Status banner ───────────────────────────────────────────────
            AnimatedVisibility(visible = statusMessage != null) {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = if (isError) DebugRed.copy(alpha = 0.12f)
                            else PrimaryPurple.copy(alpha = 0.15f),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 12.dp)
                ) {
                    Text(
                        text = statusMessage ?: "",
                        style = MaterialTheme.typography.bodySmall.copy(
                            color = if (isError) DebugRed else PrimaryPurpleLight,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 11.sp
                        ),
                        modifier = Modifier.padding(10.dp)
                    )
                }
            }

            // ── Action buttons ───────────────────────────────────────────────
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {

                // "Fetch & Copy" button
                Button(
                    onClick = {
                        isFetching = true
                        isError = false
                        copyConfirmed = false
                        statusMessage = "Requesting token from Firebase…"

                        scope.launch {
                            val result = authRepository.getDebugIdToken()
                            isFetching = false

                            result.fold(
                                onSuccess = { token ->
                                    // Copy raw token to clipboard — not saved anywhere else
                                    val clipboard = context.getSystemService(
                                        Context.CLIPBOARD_SERVICE
                                    ) as ClipboardManager
                                    clipboard.setPrimaryClip(
                                        ClipData.newPlainText("firebase_id_token", token)
                                    )
                                    copyConfirmed = true
                                    isError = false
                                    // Show only the character count — never the full token
                                    statusMessage =
                                        "✓ Token copied to clipboard  " +
                                        "(${token.length} chars).\n" +
                                        "Paste it into Swagger → Authorize → " +
                                        "\"Bearer <paste>\"."
                                },
                                onFailure = { e ->
                                    isError = true
                                    statusMessage = "✗ ${e.message}"
                                }
                            )
                        }
                    },
                    enabled = !isFetching,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (copyConfirmed) PrimaryPurple
                                         else DebugAmber.copy(alpha = 0.85f),
                        contentColor = Color.Black
                    ),
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.weight(1f)
                ) {
                    if (isFetching) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            color = Color.Black,
                            strokeWidth = 2.dp
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Fetching…", fontSize = 13.sp)
                    } else if (copyConfirmed) {
                        Icon(Icons.Default.ContentCopy, contentDescription = null,
                             modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Copied!", fontSize = 13.sp, color = Color.White)
                    } else {
                        Icon(Icons.Default.ContentCopy, contentDescription = null,
                             modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Fetch & Copy Token", fontSize = 13.sp)
                    }
                }

                // "Clear" button — resets UI state only; nothing was stored
                OutlinedButton(
                    onClick = {
                        statusMessage = null
                        isError = false
                        copyConfirmed = false
                    },
                    enabled = statusMessage != null && !isFetching,
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = DebugAmber)
                ) {
                    Icon(Icons.Default.Refresh, contentDescription = "Clear",
                         modifier = Modifier.size(16.dp))
                }
            }
        }
    }
}

