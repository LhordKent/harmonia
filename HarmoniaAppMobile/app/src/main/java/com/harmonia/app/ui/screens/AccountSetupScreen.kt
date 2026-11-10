package com.harmonia.app.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.harmonia.app.data.repository.AuthRepository
import com.harmonia.app.data.repository.AuthState
import com.harmonia.app.ui.theme.*
import kotlinx.coroutines.launch

/**
 * The only screen a pending student can use: change password, recover by email, or sign out.
 * Back closes the app instead of revealing protected screens.
 */
@Composable
fun AccountSetupScreen(
    authRepository: AuthRepository,
    onSignedOut: () -> Unit
) {
    val state by authRepository.authState.collectAsState()
    val student by authRepository.observeCurrentStudent().collectAsState(initial = null)
    val activity = LocalContext.current as? android.app.Activity
    BackHandler { activity?.finish() }

    var current by remember { mutableStateOf("") }
    var new by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var info by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val enrollment = state == AuthState.EnrollmentRequired

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(BackgroundDark, SurfaceDark)))
            .padding(24.dp)
    ) {
        Column(
            modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Icon(Icons.Default.Lock, contentDescription = null, tint = PrimaryPurpleLight, modifier = Modifier.size(40.dp))
            Spacer(Modifier.height(12.dp))
            Text(
                if (enrollment) "School enrollment required" else "Finish account setup",
                style = MaterialTheme.typography.headlineMedium, textAlign = TextAlign.Center
            )
            Spacer(Modifier.height(8.dp))
            Text(
                student?.email?.let { "Signed in as $it" } ?: "",
                style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center
            )
            Spacer(Modifier.height(16.dp))

            if (enrollment) {
                Text(
                    "Your account is not assigned to a school yet. Contact your school; you can practise once they enroll you.",
                    style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center
                )
            } else {
                Text(
                    "Choose your own password before practising. Use at least 8 characters, different from your current password and your school's base password.",
                    style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center
                )
                Spacer(Modifier.height(20.dp))
                listOf(
                    Triple("Current password", current) { v: String -> current = v },
                    Triple("New password", new) { v: String -> new = v },
                    Triple("Confirm new password", confirm) { v: String -> confirm = v }
                ).forEachIndexed { index, (label, value, onChange) ->
                    OutlinedTextField(
                        value = value,
                        onValueChange = { onChange(it); error = null },
                        label = { Text(label) },
                        enabled = !busy,
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp).testTag("setup_field_$index")
                    )
                }
                error?.let { Text(it, color = PitchRed, style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center) }
                info?.let { Text(it, color = PrimaryPurpleLight, style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center) }
                Spacer(Modifier.height(12.dp))
                Button(
                    onClick = {
                        busy = true; error = null; info = null
                        scope.launch {
                            val result = authRepository.changePassword(current, new, confirm)
                            busy = false
                            result.onSuccess { current = ""; new = ""; confirm = "" }
                                .onFailure { error = it.message ?: "Your password could not be changed." }
                        }
                    },
                    enabled = !busy,
                    colors = ButtonDefaults.buttonColors(containerColor = PrimaryPurple),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth().height(52.dp).testTag("setup_submit")
                ) {
                    if (busy) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                    else Text("Change password", style = MaterialTheme.typography.labelLarge)
                }
                Spacer(Modifier.height(16.dp))
                TextButton(enabled = !busy && student != null, onClick = {
                    busy = true; error = null
                    scope.launch {
                        val result = authRepository.resetPassword(student?.email ?: "")
                        busy = false
                        if (result.isSuccess) info = "Reset link sent to your email. After resetting, sign out and sign in with the new password."
                        else error = result.exceptionOrNull()?.message
                    }
                }) { Text("Forgot current password? Email me a reset link", color = PrimaryPurpleLight) }
                TextButton(enabled = !busy, onClick = {
                    busy = true; error = null
                    scope.launch {
                        val result = authRepository.completeOnboarding()
                        busy = false
                        if (result.isFailure) error = result.exceptionOrNull()?.message
                            ?: "We could not confirm a new password yet."
                    }
                }) { Text("I already reset it", color = PrimaryPurpleLight) }
            }
            Spacer(Modifier.height(20.dp))
            OutlinedButton(
                onClick = { authRepository.logout(); onSignedOut() },
                enabled = !busy,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth().height(48.dp)
            ) { Text("Sign out", color = PitchRed) }
        }
    }
}
