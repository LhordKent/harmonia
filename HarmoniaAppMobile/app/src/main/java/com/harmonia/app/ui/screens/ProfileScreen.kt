package com.harmonia.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.harmonia.app.BuildConfig
import com.harmonia.app.data.local.HarmoniaDatabase
import com.harmonia.app.data.local.entity.ReminderSettingsEntity
import com.harmonia.app.data.repository.AuthRepository
import com.harmonia.app.data.repository.DashboardSummaryStats
import com.harmonia.app.data.repository.PracticeRepository
import com.harmonia.app.data.sync.ReminderScheduler
import com.harmonia.app.ui.audio.AudioRecorder
import com.harmonia.app.ui.debug.DebugTokenPanel
import com.harmonia.app.ui.theme.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun ProfileScreen(
    authRepository: AuthRepository,
    practiceRepository: PracticeRepository,
    onLogout: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val student by authRepository.observeCurrentStudent().collectAsState(initial = null)
    val studentId = student?.id ?: ""

    var stats by remember {
        mutableStateOf(
            DashboardSummaryStats(0f, 0, 0, 0, 0f, emptyList())
        )
    }

    var isCalibrating by remember { mutableStateOf(false) }
    var calibrationMessage by remember { mutableStateOf<String?>(null) }
    var showAboutDialog by remember { mutableStateOf(false) }
    val calibrationRecorder = remember { AudioRecorder(context) }
    var calibrationJob by remember { mutableStateOf<Job?>(null) }
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(calibrationRecorder, lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) { calibrationJob?.cancel(); calibrationRecorder.cancelRecording() }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer); calibrationJob?.cancel(); calibrationRecorder.cancelRecording() }
    }
    val calibrate: () -> Unit = {
        calibrationJob = scope.launch {
            isCalibrating = true
            calibrationMessage = "Listening for 3 seconds..."
            try {
                calibrationRecorder.startRecording(this, 440f, 1f)
                check(calibrationRecorder.liveState.value.isRecording) { calibrationRecorder.liveState.value.errorMessage ?: "Microphone unavailable." }
                delay(3000)
                val (sample, _) = calibrationRecorder.stopRecording(saveFile = false)
                val rms = kotlin.math.sqrt(sample.samples.map { it.toDouble() * it }.average()).toFloat()
                val factor = (.15f / rms.coerceAtLeast(.02f)).coerceIn(.5f, 2.5f)
                authRepository.updateMicSensitivity(factor)
                calibrationMessage = "Calibration complete. Input gain: ${String.format("%.2f", factor)}x"
            } catch (e: CancellationException) { calibrationMessage = "Calibration cancelled. Try again when ready."; throw e }
            catch (e: Exception) { calibrationMessage = e.message ?: "Calibration failed. Check microphone access and try again." }
            finally { calibrationRecorder.cancelRecording(); isCalibrating = false }
        }
    }
    val microphonePermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) calibrate() else calibrationMessage = "Microphone permission is required for calibration."
    }


    // ── Reminder settings ─────────────────────────────────────────────────────
    val reminderDao = remember { HarmoniaDatabase.getInstance(context).reminderSettingsDao() }
    val reminderSettings by reminderDao.observe(studentId)
        .collectAsState(initial = null)
    val reminderEnabled  = reminderSettings?.enabled ?: false
    val reminderHour     = reminderSettings?.hourOfDay ?: 9
    val reminderMinute   = reminderSettings?.minuteOfHour ?: 0
    var showTimePicker by remember { mutableStateOf(false) }

    // Android 13+ runtime permission for POST_NOTIFICATIONS
    val notifPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            scope.launch {
                val updated = ReminderSettingsEntity(
                    studentId     = studentId,
                    enabled       = true,
                    hourOfDay     = reminderHour,
                    minuteOfHour  = reminderMinute
                )
                reminderDao.upsert(updated)
                ReminderScheduler.schedule(context, studentId, reminderHour, reminderMinute)
            }
        }
    }

    LaunchedEffect(studentId) {
        stats = practiceRepository.getDashboardStats(studentId)
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(BackgroundDark)
            .padding(horizontal = 20.dp),
        contentPadding = PaddingValues(top = 24.dp, bottom = 100.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        // 1. Profile Header Card
        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(20.dp),
                colors = CardDefaults.cardColors(containerColor = SurfaceCard)
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(
                            Brush.verticalGradient(
                                listOf(PrimaryPurple.copy(alpha = 0.2f), SurfaceCard)
                            )
                        )
                        .padding(20.dp)
                ) {
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Box(
                            modifier = Modifier
                                .size(76.dp)
                                .clip(CircleShape)
                                .background(PrimaryPurple),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = student?.fullName?.take(2)?.uppercase() ?: "MS",
                                style = MaterialTheme.typography.headlineMedium.copy(
                                    fontWeight = FontWeight.Bold,
                                    color = Color.White
                                )
                            )
                        }

                        Spacer(modifier = Modifier.height(12.dp))

                        Text(
                            text = student?.fullName ?: "Maria Santos",
                            style = MaterialTheme.typography.headlineSmall
                        )

                        Surface(
                            shape = RoundedCornerShape(12.dp),
                            color = PrimaryPurple.copy(alpha = 0.25f),
                            modifier = Modifier.padding(top = 4.dp)
                        ) {
                            Text(
                                text = "Student Singer • ${student?.studentType?.replaceFirstChar { it.uppercase() } ?: "Collaborated"}",
                                style = MaterialTheme.typography.bodySmall.copy(
                                    color = PrimaryPurpleLight,
                                    fontWeight = FontWeight.SemiBold
                                ),
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
                            )
                        }

                        Text(
                            text = student?.email ?: "maria.santos@uc.edu.ph",
                            style = MaterialTheme.typography.bodySmall.copy(color = TextMuted),
                            modifier = Modifier.padding(top = 4.dp)
                        )
                    }
                }
            }
        }

        // 2. Summary Stats Card
        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = SurfaceCard)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(18.dp),
                    horizontalArrangement = Arrangement.SpaceAround,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("SESSIONS", style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp))
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "${stats.totalSessionsCompleted}",
                            style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold)
                        )
                    }

                    Divider(
                        modifier = Modifier
                            .height(32.dp)
                            .width(1.dp),
                        color = SurfaceCardLight
                    )

                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("AVG ACCURACY", style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp))
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "${stats.weeklyAccuracyAverage.toInt()}%",
                            style = MaterialTheme.typography.titleLarge.copy(
                                fontWeight = FontWeight.Bold,
                                color = PitchGreen
                            )
                        )
                    }

                    Divider(
                        modifier = Modifier
                            .height(32.dp)
                            .width(1.dp),
                        color = SurfaceCardLight
                    )

                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("BEST SCORE", style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp))
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "${stats.bestScore.toInt()}%",
                            style = MaterialTheme.typography.titleLarge.copy(
                                fontWeight = FontWeight.Bold,
                                color = AccentGold
                            )
                        )
                    }
                }
            }
        }

        // 3. Microphone Calibration Tool (Section 4 & 6.1)
        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = SurfaceCard)
            ) {
                Column(modifier = Modifier.padding(18.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            Icons.Default.Mic,
                            contentDescription = null,
                            tint = PrimaryPurpleLight,
                            modifier = Modifier.size(22.dp)
                        )
                        Spacer(modifier = Modifier.width(10.dp))
                        Text(
                            text = "Microphone Calibration",
                            style = MaterialTheme.typography.titleMedium
                        )
                    }

                    Spacer(modifier = Modifier.height(6.dp))

                    Text(
                        text = "Current Sensitivity Factor: ${String.format("%.2f", student?.micSensitivity ?: 1.0f)}x",
                        style = MaterialTheme.typography.bodySmall.copy(color = TextSecondary)
                    )

                    Spacer(modifier = Modifier.height(12.dp))

                    if (calibrationMessage != null) {
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = PitchGreen.copy(alpha = 0.15f),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                text = calibrationMessage ?: "",
                                style = MaterialTheme.typography.bodySmall.copy(color = PitchGreen),
                                modifier = Modifier.padding(10.dp)
                            )
                        }
                        Spacer(modifier = Modifier.height(10.dp))
                    }

                    Button(
                        onClick = {
                            if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) calibrate()
                            else microphonePermission.launch(Manifest.permission.RECORD_AUDIO)
                        },
                        enabled = !isCalibrating,
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(containerColor = PrimaryPurple),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        if (isCalibrating) {
                            CircularProgressIndicator(modifier = Modifier.size(20.dp), color = Color.White)
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Calibrating (3s)...")
                        } else {
                            Icon(Icons.Default.Tune, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Calibrate Microphone")
                        }
                    }
                }
            }
        }

        // 4. Audio & Privacy Settings
        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = SurfaceCard)
            ) {
                Column(modifier = Modifier.padding(18.dp)) {
                    Text(
                        text = "Preferences & Privacy",
                        style = MaterialTheme.typography.titleMedium
                    )

                    Spacer(modifier = Modifier.height(14.dp))

                    // Audio Quality
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column {
                            Text("High Audio Quality (44.1 kHz PCM)", style = MaterialTheme.typography.bodyMedium)
                            Text("Captures studio-grade spectral features", style = MaterialTheme.typography.bodySmall)
                        }
                        Switch(
                            checked = student?.audioQuality == "high",
                            onCheckedChange = { isHigh ->
                                scope.launch {
                                    authRepository.updateAudioSettings(
                                        if (isHigh) "high" else "standard",
                                        student?.dataPrivacyOptOut ?: false
                                    )
                                }
                            },
                            colors = SwitchDefaults.colors(checkedThumbColor = PrimaryPurple)
                        )
                    }

                    Divider(modifier = Modifier.padding(vertical = 12.dp), color = SurfaceCardLight)

                    // Data Privacy Opt-Out (Section 7)
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Data Privacy Opt-Out", style = MaterialTheme.typography.bodyMedium)
                            Text("Exclude singing recordings from anonymized research analytics", style = MaterialTheme.typography.bodySmall)
                        }
                        Spacer(modifier = Modifier.width(12.dp))
                        Switch(
                            checked = student?.dataPrivacyOptOut ?: false,
                            onCheckedChange = { optOut ->
                                scope.launch {
                                    authRepository.updateAudioSettings(
                                        student?.audioQuality ?: "high",
                                        optOut
                                    )
                                }
                            },
                            colors = SwitchDefaults.colors(checkedThumbColor = PrimaryPurple)
                        )
                    }
                }
            }
        }

        // 5. Daily Practice Reminders
        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = SurfaceCard)
            ) {
                Column(modifier = Modifier.padding(18.dp)) {
                    Text("Daily Practice Reminder", style = MaterialTheme.typography.titleMedium)
                    Spacer(modifier = Modifier.height(14.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Enable daily reminder", style = MaterialTheme.typography.bodyMedium)
                            Text(
                                text = "%02d:%02d".format(reminderHour, reminderMinute),
                                style = MaterialTheme.typography.bodySmall,
                                color = TextMuted
                            )
                        }
                        Spacer(modifier = Modifier.width(12.dp))
                        Switch(
                            checked = reminderEnabled,
                            onCheckedChange = { enable ->
                                scope.launch {
                                    if (enable) {
                                        val hasPermission = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                                            ContextCompat.checkSelfPermission(
                                                context, Manifest.permission.POST_NOTIFICATIONS
                                            ) == PackageManager.PERMISSION_GRANTED
                                        if (hasPermission) {
                                            reminderDao.upsert(ReminderSettingsEntity(
                                                studentId    = studentId,
                                                enabled      = true,
                                                hourOfDay    = reminderHour,
                                                minuteOfHour = reminderMinute
                                            ))
                                            ReminderScheduler.schedule(context, studentId, reminderHour, reminderMinute)
                                        } else {
                                            notifPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                                        }
                                    } else {
                                        reminderDao.upsert(ReminderSettingsEntity(
                                            studentId    = studentId,
                                            enabled      = false,
                                            hourOfDay    = reminderHour,
                                            minuteOfHour = reminderMinute
                                        ))
                                        ReminderScheduler.cancel(context)
                                    }
                                }
                            },
                            colors = SwitchDefaults.colors(checkedThumbColor = PrimaryPurple)
                        )
                    }
                    if (reminderEnabled) {
                        Divider(modifier = Modifier.padding(vertical = 12.dp), color = SurfaceCardLight)
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { showTimePicker = true },
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                Text("Reminder time", style = MaterialTheme.typography.bodyMedium)
                                Text(
                                    text = "%02d:%02d".format(reminderHour, reminderMinute),
                                    style = MaterialTheme.typography.titleMedium.copy(
                                        color = PrimaryPurpleLight,
                                        fontWeight = FontWeight.Bold
                                    )
                                )
                            }
                            Icon(
                                Icons.Default.Alarm,
                                contentDescription = "Change time",
                                tint = PrimaryPurpleLight
                            )
                        }
                    }
                }
            }
        }

        // 6. [DEBUG] Firebase ID Token Panel — visible only in debug builds
        if (BuildConfig.DEBUG) {
            item {
                DebugTokenPanel(authRepository = authRepository)
            }
        }

        // 7. About & Log Out Actions
        item {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedButton(
                    onClick = { showAboutDialog = true },
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Icon(Icons.Default.Info, contentDescription = null, tint = PrimaryPurpleLight)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("About Harmonia", color = PrimaryPurpleLight)
                }

                Button(
                    onClick = {
                        authRepository.logout()
                        onLogout()
                    },
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = PitchRed.copy(alpha = 0.2f)),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Icon(Icons.Default.ExitToApp, contentDescription = null, tint = PitchRed)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Log Out", color = PitchRed, fontWeight = FontWeight.Bold)
                }
            }
        }
    }

    // Time-picker dialog for daily reminder
    if (showTimePicker) {
        androidx.compose.runtime.DisposableEffect(Unit) {
            val dialog = android.app.TimePickerDialog(
                context,
                { _, h, m ->
                    scope.launch {
                        reminderDao.upsert(
                            ReminderSettingsEntity(
                                studentId    = studentId,
                                enabled      = true,
                                hourOfDay    = h,
                                minuteOfHour = m
                            )
                        )
                        ReminderScheduler.schedule(context, studentId, h, m)
                    }
                    showTimePicker = false
                },
                reminderHour,
                reminderMinute,
                true  // 24-hour clock
            )
            dialog.setOnDismissListener { showTimePicker = false }
            dialog.show()
            onDispose { if (dialog.isShowing) dialog.dismiss() }
        }
    }

    if (showAboutDialog) {
        AlertDialog(
            onDismissRequest = { showAboutDialog = false },
            title = { Text("About Harmonia") },
            text = {
                Text(
                    "Harmonia: An Application for Student Singers to Improve Pitch, Tone, and Performance Skills.\n\n" +
                    "Approved Capstone Research, College of Computer Studies, University of Cebu – Banilad, 2026.\n\n" +
                    "Built with Kotlin, Jetpack Compose, on-device YIN DSP pitch tracking, and offline-first Room database."
                )
            },
            confirmButton = {
                TextButton(onClick = { showAboutDialog = false }) {
                    Text("Close", color = PrimaryPurpleLight)
                }
            }
        )
    }
}
