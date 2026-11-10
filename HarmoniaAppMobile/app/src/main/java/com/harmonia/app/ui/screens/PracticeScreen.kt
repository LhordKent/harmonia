package com.harmonia.app.ui.screens

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.harmonia.app.data.local.entity.VocalExerciseEntity
import com.harmonia.app.data.repository.AchievementRepository
import com.harmonia.app.data.repository.AuthRepository
import com.harmonia.app.data.repository.ExerciseRepository
import com.harmonia.app.data.repository.PracticeRepository
import com.harmonia.app.data.sync.SyncWorker
import com.harmonia.app.ui.audio.AudioRecorder
import com.harmonia.app.ui.audio.PcmRecorder
import com.harmonia.app.ui.theme.*
import com.harmonia.analysis.DefaultPitchToneAnalyzer
import com.harmonia.analysis.PitchToneAnalyzer
import com.harmonia.analysis.dsp.PitchColorCategory
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import android.media.MediaPlayer
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.harmonia.app.data.sync.SupabaseAudioStore
import kotlinx.coroutines.Job
import android.Manifest
import android.content.pm.PackageManager
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import kotlin.math.abs

@Composable
fun PracticeScreen(
    exerciseId: String,
    authRepository: AuthRepository,
    exerciseRepository: ExerciseRepository,
    practiceRepository: PracticeRepository,
    achievementRepository: AchievementRepository,
    onNavigateToResults: (attemptId: String) -> Unit,
    onNavigateBack: () -> Unit,
    recorderFactory: (android.content.Context) -> PcmRecorder = { AudioRecorder(it) }
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val student by authRepository.observeCurrentStudent().collectAsState(initial = null)

    var exercise by remember { mutableStateOf<VocalExerciseEntity?>(null) }
    var canPractice by remember { mutableStateOf(false) }
    var isAnalyzing by remember { mutableStateOf(false) }
    var permissionDenied by remember { mutableStateOf(false) }
    var recordingError by remember { mutableStateOf<String?>(null) }
    var canRetryAnalysis by remember { mutableStateOf(false) }
    var recoveredFile by remember { mutableStateOf<File?>(null) }
    var recoveries by remember { mutableStateOf<List<File>>(emptyList()) }

    val audioRecorder = remember { recorderFactory(context) }
    val liveState by audioRecorder.liveState.collectAsState()
    val melody = remember(exercise?.referencePitchData) { runCatching {
        com.google.gson.Gson().fromJson<List<com.harmonia.analysis.TargetNote>>(exercise?.referencePitchData,
            object : com.google.gson.reflect.TypeToken<List<com.harmonia.analysis.TargetNote>>() {}.type)
    }.getOrNull().orEmpty() }
    val targetAtTime: (Double) -> Float? = { time -> when (exercise?.exerciseType) {
        "free" -> null
        "scale", "song" -> melody.firstOrNull { time >= it.startSeconds && time < it.endSeconds }?.frequencyHz
        else -> exercise?.targetFrequencyHz
    } }
    var referencePlayer by remember { mutableStateOf<MediaPlayer?>(null) }
    var referenceJob by remember { mutableStateOf<Job?>(null) }
    var loadingReference by remember { mutableStateOf(false) }
    var playingReference by remember { mutableStateOf(false) }
    val stopReference: () -> Unit = {
        referenceJob?.cancel(); referenceJob = null
        referencePlayer?.let { runCatching { it.release() } }; referencePlayer = null
        loadingReference = false; playingReference = false
    }


    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(audioRecorder, lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) stopReference()
            if (event == Lifecycle.Event.ON_STOP && audioRecorder.liveState.value.hasRecording) {
                audioRecorder.cancelRecording()
                recordingError = "Recording cancelled when practice left the foreground. Tap the microphone to start again."
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer); stopReference(); audioRecorder.cancelRecording() }
    }

    // Real-time rolling pitch history for the canvas
    val pitchHistory = remember { mutableStateListOf<Pair<Float, PitchColorCategory>>() }

    // Runtime permission launcher for RECORD_AUDIO
    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        permissionDenied = !granted
        if (granted && canPractice && student != null) {
            pitchHistory.clear()
            val sensitivity = student?.micSensitivity ?: 1.0f
            audioRecorder.startRecording(
                scope = scope,
                targetFrequencyHz = exercise?.targetFrequencyHz ?: 440f,
                micSensitivity = sensitivity, targetAtTime = targetAtTime, toleranceCents = com.harmonia.analysis.GradingPolicy.forDifficulty(exercise?.difficultyLevel ?: "Foundations").toleranceCents
            )
        }
    }

    LaunchedEffect(exerciseId) {
        audioRecorder.recordingKey = exerciseId
        exercise = exerciseRepository.getExerciseById(exerciseId)
    }
    LaunchedEffect(exerciseId, student?.id) {
        student?.id?.let { id -> exerciseRepository.observeExercisesForStudent(id).collect { list ->
            canPractice = list.firstOrNull { it.exercise.id == exerciseId }?.status != "locked" && list.any { it.exercise.id == exerciseId }
        } }
    }
    LaunchedEffect(exerciseId, liveState.hasRecording) {
        if (!liveState.hasRecording) recoveries = withContext(Dispatchers.IO) {
            audioRecorder.recoveryFiles().filter { !practiceRepository.containsRecording(it.absolutePath) &&
                !practiceRepository.containsRecording(it.resolveSibling(it.nameWithoutExtension + ".m4a").absolutePath) }.take(3)
        }
    }

    LaunchedEffect(liveState.currentPitch, liveState.colorCategory) {
        if (liveState.isRecording) {
            pitchHistory.add(Pair(if (liveState.currentPitch > 50) liveState.centsDeviation else Float.NaN, liveState.colorCategory))
            if (pitchHistory.size > 80) {
                pitchHistory.removeAt(0)
            }
        }
    }

    val infiniteTransition = rememberInfiniteTransition(label = "pulse")
    val pulseScale by infiniteTransition.animateFloat(
        initialValue = 1.0f,
        targetValue = 1.15f,
        animationSpec = infiniteRepeatable(
            animation = tween(800, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulseScale"
    )

    val currentTarget = targetAtTime(liveState.elapsedMs / 1000.0)
    val targetFreq = currentTarget ?: exercise?.targetFrequencyHz ?: 440.0f
    val targetNote = when { exercise?.exerciseType == "free" -> "Free vocalising"; currentTarget == null -> "Rest"; else -> com.harmonia.analysis.dsp.YinPitchDetector.frequencyToNoteName(targetFreq) }

    val finishRecording: () -> Unit = finish@{
        if (isAnalyzing) return@finish
        recordingError = null
        isAnalyzing = true
        scope.launch {
            var pendingAudio: String? = null
            var persisted = false
            try {
                // Move stopRecording() off the main thread so WAV file I/O
                // doesn't block the UI thread or trigger StrictMode violations
                val (audioSample, audioPath) = withContext(Dispatchers.IO) {
                    recoveredFile?.let { file ->
                        com.harmonia.analysis.dsp.AudioSample.fromWavBytes(file.readBytes()) to com.harmonia.app.ui.audio.RecordingCodec.encode(file).absolutePath
                    } ?: audioRecorder.stopRecording()
                }

                pendingAudio = audioPath

                val graded = withContext(Dispatchers.Default) {
                    com.harmonia.app.ui.audio.PracticeAnalysis.analyze(context, audioSample,
                        exercise ?: error("Download the exercise before recording."))
                }
                val analysisResult = graded.result

                val durationSec = audioSample.durationSeconds.toInt().coerceAtLeast(1)
                val studentId = student?.id ?: authRepository.currentStudentId.value
                check(studentId.isNotBlank()) { "Sign in again before saving practice." }

                // Persist attempt & analysis result in Room
                val (attempt, _) = practiceRepository.recordAttemptAndAnalysis(
                    studentId = studentId,
                    exerciseId = exercise?.id ?: "ex_f1",
                    durationSeconds = durationSec,
                    audioPath = audioPath,
                    analysisData = analysisResult,
                    gradingEvidence = graded.evidence
                )

                persisted = true
                canRetryAnalysis = false
                recoveredFile = null
                recoveries = emptyList()
                if (File(audioPath).extension == "m4a") File(audioPath).resolveSibling(File(audioPath).nameWithoutExtension + ".wav").delete()
                try {
                    // Handle progressive unlock
                    exerciseRepository.handleExerciseCompletion(
                        studentId = studentId,
                        exerciseId = exercise?.id ?: "ex_f1",
                        score = analysisResult.overallScore,
                        isPassed = analysisResult.isPassed
                    )

                    // Check achievements
                    val stats = practiceRepository.getDashboardStats(studentId)
                    achievementRepository.checkAndAwardBadges(
                        studentId = studentId,
                        sessionScore = analysisResult.accuracyScore,
                        totalSessions = stats.totalSessionsCompleted,
                        dayStreak = stats.dayStreak
                    )

                } catch (e: CancellationException) { throw e }
                catch (e: Exception) { Log.w("PracticeScreen", "Practice saved; progression or badge update failed.", e) }

                // Enqueue background sync with Firestore
                try {
                    SyncWorker.enqueue(context)
                } catch (e: Exception) {
                    Log.w("PracticeScreen", "SyncWorker enqueue failed: ${e.message}")
                }

                isAnalyzing = false
                onNavigateToResults(attempt.id)
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) {
                Log.e("PracticeScreen", "Error during practice analysis and save", e)
                recordingError = e.message ?: "Could not save this recording. Please try again."
                canRetryAnalysis = pendingAudio != null
            } finally {
                // Keep saved audio on analysis/network failure; retry reuses the same recording.
                isAnalyzing = false
            }
        }
    }
    LaunchedEffect(liveState.limitReached) { if (liveState.limitReached) finishRecording() }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(BackgroundDark)
            .padding(20.dp)
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            // Header
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                IconButton(onClick = onNavigateBack) {
                    Icon(Icons.Default.ArrowBack, contentDescription = "Back", tint = TextPrimary)
                }

                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = exercise?.title ?: "Vocal Practice",
                        style = MaterialTheme.typography.titleMedium
                    )
                    Surface(
                        shape = RoundedCornerShape(6.dp),
                        color = SurfaceCardLight,
                        modifier = Modifier.padding(top = 4.dp)
                    ) {
                        Text(
                            text = exercise?.difficultyLevel ?: "Foundations",
                            style = MaterialTheme.typography.bodySmall.copy(fontSize = 10.sp),
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                        )
                    }
                }

                Box(modifier = Modifier.size(48.dp)) // Spacer for alignment
            }

            Spacer(modifier = Modifier.height(16.dp))

            exercise?.audioSampleUrl?.takeIf { it.isNotBlank() }?.let { reference ->
                OutlinedButton(
                    enabled = !liveState.hasRecording && !isAnalyzing,
                    onClick = {
                        if (loadingReference || playingReference) stopReference()
                        else {
                            loadingReference = true; recordingError = null
                            referenceJob = scope.launch {
                                try {
                                    val url = SupabaseAudioStore(FirebaseFirestore.getInstance(), FirebaseAuth.getInstance()).playbackUrl(reference)
                                    val player = MediaPlayer(); referencePlayer = player
                                    player.setOnPreparedListener {
                                        if (referencePlayer === player) { loadingReference = false; playingReference = true; player.start() }
                                    }
                                    player.setOnCompletionListener { stopReference() }
                                    player.setOnErrorListener { _, _, _ -> stopReference(); recordingError = "Reference audio could not be played. Check your connection and try again."; true }
                                    player.setDataSource(url); player.prepareAsync()
                                } catch (e: CancellationException) { throw e }
                                catch (e: Exception) { stopReference(); recordingError = e.message ?: "Reference audio could not be loaded." }
                            }
                        }
                    }
                ) {
                    Icon(if (playingReference || loadingReference) Icons.Default.Stop else Icons.Default.PlayArrow, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text(if (playingReference) "Stop reference audio" else if (loadingReference) "Cancel reference loading" else "Play reference audio")
                }
            }

            // Target Note & Status Card
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = SurfaceCard)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    horizontalArrangement = Arrangement.SpaceAround,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("TARGET NOTE", style = MaterialTheme.typography.bodySmall)
                        Text(
                            text = if (currentTarget == null) targetNote else "$targetNote (${targetFreq.toInt()} Hz)",
                            style = MaterialTheme.typography.titleLarge.copy(
                                fontWeight = FontWeight.Bold,
                                color = PrimaryPurpleLight
                            )
                        )
                    }

                    Divider(
                        modifier = Modifier
                            .height(40.dp)
                            .width(1.dp),
                        color = SurfaceCardLight
                    )

                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("DETECTED", style = MaterialTheme.typography.bodySmall)
                        val noteText = if (liveState.isRecording && liveState.currentPitch > 50.0f) {
                            "${liveState.noteName} (${liveState.currentPitch.toInt()} Hz)"
                        } else "--"
                        Text(
                            text = noteText,
                            style = MaterialTheme.typography.titleLarge.copy(
                                fontWeight = FontWeight.Bold,
                                color = when (liveState.colorCategory) {
                                    PitchColorCategory.ON_PITCH -> PitchGreen
                                    PitchColorCategory.NEAR_PITCH -> PitchYellow
                                    PitchColorCategory.OFF_PITCH -> PitchRed
                                    else -> TextMuted
                                }
                            )
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Live Pitch-Spectrum Canvas Panel (Target Pitch Line vs User's Pitch)
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = SurfaceDark)
            ) {
                Box(modifier = Modifier.fillMaxSize()) {
                    Canvas(modifier = Modifier.fillMaxSize().padding(16.dp)) {
                        val canvasWidth = size.width
                        val canvasHeight = size.height
                        val midY = canvasHeight / 2.0f

                        // Grid lines
                        drawLine(
                            color = SurfaceCardLight.copy(alpha = 0.5f),
                            start = Offset(0f, canvasHeight * 0.25f),
                            end = Offset(canvasWidth, canvasHeight * 0.25f),
                            strokeWidth = 1.dp.toPx()
                        )
                        drawLine(
                            color = SurfaceCardLight.copy(alpha = 0.5f),
                            start = Offset(0f, canvasHeight * 0.75f),
                            end = Offset(canvasWidth, canvasHeight * 0.75f),
                            strokeWidth = 1.dp.toPx()
                        )

                        // Target Pitch Line (Center Reference)
                        drawLine(
                            color = PrimaryPurpleLight,
                            start = Offset(0f, midY),
                            end = Offset(canvasWidth, midY),
                            strokeWidth = 3.dp.toPx(),
                            pathEffect = PathEffect.dashPathEffect(floatArrayOf(20f, 10f), 0f)
                        )

                        // Draw live pitch points
                        if (pitchHistory.isNotEmpty()) {
                            val stepX = canvasWidth / 80.0f
                            for (i in pitchHistory.indices) {
                                val (cents, category) = pitchHistory[i]
                                if (cents.isFinite()) {
                                    // Map ±100 cents to full height
                                    val y = (midY - (cents / 100.0f) * (canvasHeight * 0.4f)).coerceIn(10f, canvasHeight - 10f)
                                    val x = i * stepX

                                    val dotColor = when (category) {
                                        PitchColorCategory.ON_PITCH -> PitchGreen
                                        PitchColorCategory.NEAR_PITCH -> PitchYellow
                                        PitchColorCategory.OFF_PITCH -> PitchRed
                                        else -> PitchGray
                                    }

                                    drawCircle(
                                        color = dotColor,
                                        radius = 4.dp.toPx(),
                                        center = Offset(x, y)
                                    )
                                }
                            }
                        }
                    }

                    // Live Status Indicator in Canvas
                    val statusText = when {
                        !liveState.isRecording -> "Ready to Record"
                        liveState.currentPitch <= 50.0f -> "Listening for voice..."
                        liveState.colorCategory == PitchColorCategory.ON_PITCH -> "Perfect! On Pitch"
                        liveState.colorCategory == PitchColorCategory.NEAR_PITCH -> {
                            if (liveState.centsDeviation > 0) "Slightly Sharp (+${liveState.centsDeviation.toInt()}c)"
                            else "Slightly Flat (${liveState.centsDeviation.toInt()}c)"
                        }
                        else -> {
                            if (liveState.centsDeviation > 0) "Too Sharp (+${liveState.centsDeviation.toInt()}c)"
                            else "Too Flat (${liveState.centsDeviation.toInt()}c)"
                        }
                    }

                    Surface(
                        modifier = Modifier
                            .align(Alignment.TopCenter)
                            .padding(top = 12.dp),
                        shape = RoundedCornerShape(12.dp),
                        color = SurfaceCard.copy(alpha = 0.9f)
                    ) {
                        Text(
                            text = statusText,
                            style = MaterialTheme.typography.bodyMedium.copy(
                                fontWeight = FontWeight.SemiBold,
                                color = when (liveState.colorCategory) {
                                    PitchColorCategory.ON_PITCH -> PitchGreen
                                    PitchColorCategory.NEAR_PITCH -> PitchYellow
                                    PitchColorCategory.OFF_PITCH -> PitchRed
                                    else -> TextPrimary
                                }
                            ),
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp)
                        )
                    }

                    // Live Cents Deviation Bottom Badge
                    if (liveState.isRecording && liveState.currentPitch > 50.0f) {
                        Surface(
                            modifier = Modifier
                                .align(Alignment.BottomCenter)
                                .padding(bottom = 12.dp),
                            shape = RoundedCornerShape(10.dp),
                            color = SurfaceCard.copy(alpha = 0.9f)
                        ) {
                            Text(
                                text = "Deviation: ${if (liveState.centsDeviation >= 0) "+" else ""}${liveState.centsDeviation.toInt()} cents",
                                style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium),
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(20.dp))

            // Timer & Audio Level Meter
            if (liveState.isRecording) {
                Text(
                    text = String.format("00:%02d / 00:%02d", liveState.durationSeconds, exercise?.durationSeconds ?: 15),
                    style = MaterialTheme.typography.titleMedium.copy(
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 2.sp
                    )
                )
                Spacer(modifier = Modifier.height(8.dp))
                // Visual level bar
                LinearProgressIndicator(
                    progress = { liveState.audioLevel },
                    modifier = Modifier
                        .fillMaxWidth(0.6f)
                        .height(6.dp)
                        .clip(RoundedCornerShape(3.dp)),
                    color = PrimaryPurpleLight,
                    trackColor = SurfaceCard
                )
            } else {
                if (permissionDenied) {
                    Text(
                        text = "⚠ Microphone permission is required. Please grant it in App Settings.",
                        style = MaterialTheme.typography.bodySmall.copy(color = PitchRed),
                        textAlign = TextAlign.Center
                    )
                } else {
                    Text(
                        text = "Tap the microphone to begin singing",
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            }

            (recordingError ?: liveState.errorMessage)?.let { message ->
                Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center)
            }
            if (canRetryAnalysis && !isAnalyzing) TextButton(onClick = finishRecording) { Text("Retry analysis of saved recording") }
            if (!liveState.hasRecording && !isAnalyzing) recoveries.forEach { file ->
                TextButton(onClick = { recoveredFile = file; finishRecording() }) {
                    Text("Recover saved recording · ${java.text.SimpleDateFormat("MMM d, HH:mm", java.util.Locale.getDefault()).format(java.util.Date(file.lastModified()))}")
                }
            }
            Spacer(modifier = Modifier.height(20.dp))

            // Microphone Record/Stop Button
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier.padding(bottom = 24.dp)
            ) {
                if (liveState.isRecording) {
                    Box(
                        modifier = Modifier
                            .size(96.dp)
                            .scale(pulseScale)
                            .clip(CircleShape)
                            .background(PitchRed.copy(alpha = 0.2f))
                    )
                }

                IconButton(
                    enabled = !isAnalyzing && !playingReference && !loadingReference && exercise != null && student != null && canPractice,
                    onClick = {
                        if (!liveState.hasRecording) {
                            recordingError = null
                            // Check / request RECORD_AUDIO permission before starting
                            val granted = ContextCompat.checkSelfPermission(
                                context, Manifest.permission.RECORD_AUDIO
                            ) == PackageManager.PERMISSION_GRANTED

                            if (granted) {
                                pitchHistory.clear()
                                val sensitivity = student?.micSensitivity ?: 1.0f
                                audioRecorder.startRecording(
                                    scope = scope,
                                    targetFrequencyHz = targetFreq,
                                    micSensitivity = sensitivity, targetAtTime = targetAtTime, toleranceCents = com.harmonia.analysis.GradingPolicy.forDifficulty(exercise?.difficultyLevel ?: "Foundations").toleranceCents
                                )
                            } else {
                                permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                            }
                        } else {
                            finishRecording()
                        }
                    },
                    modifier = Modifier
                        .size(76.dp)
                        .clip(CircleShape)
                        .background(if (liveState.isRecording) PitchRed else PrimaryPurple)
                ) {
                    if (isAnalyzing) {
                        CircularProgressIndicator(color = Color.White, modifier = Modifier.size(32.dp))
                    } else {
                        Icon(
                            imageVector = if (liveState.isRecording) Icons.Default.Stop else Icons.Default.Mic,
                            contentDescription = if (liveState.isRecording) "Stop Recording" else "Start Recording",
                            tint = Color.White,
                            modifier = Modifier.size(36.dp)
                        )
                    }
                }
            }
        }
    }
}
