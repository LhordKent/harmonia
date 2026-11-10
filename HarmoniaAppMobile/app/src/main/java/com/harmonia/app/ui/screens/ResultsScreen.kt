package com.harmonia.app.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
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
import androidx.compose.ui.platform.LocalContext
import com.harmonia.app.data.local.HarmoniaDatabase
import com.harmonia.app.data.local.entity.CoachAssessmentEntity
import com.harmonia.app.data.sync.CoachFeedbackSync
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.harmonia.app.data.local.entity.AnalysisResultEntity
import com.harmonia.app.data.repository.PracticeRepository
import com.harmonia.app.ui.theme.*
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.harmonia.analysis.AnalyzedFrame

@Composable
fun ResultsScreen(
    attemptId: String,
    practiceRepository: PracticeRepository,
    onSaveAndContinue: () -> Unit,
    onRetry: () -> Unit,
    onViewFullReport: () -> Unit
) {
    var result by remember { mutableStateOf<AnalysisResultEntity?>(null) }
    var frames by remember { mutableStateOf<List<AnalyzedFrame>>(emptyList()) }
    val local = HarmoniaDatabase.getInstance(LocalContext.current)
    var assessment by remember(attemptId) { mutableStateOf<CoachAssessmentEntity?>(null) }
    var reviewError by remember(attemptId) { mutableStateOf<String?>(null) }
    var refreshKey by remember { mutableIntStateOf(0) }

    LaunchedEffect(attemptId) {
        practiceRepository.observeResultForAttempt(attemptId).collect { res ->
        result = res
        res?.detectedPitchData?.let { json ->
            try {
                val listType = object : TypeToken<List<AnalyzedFrame>>() {}.type
                frames = Gson().fromJson(json, listType)
            } catch (e: Exception) {
                // Ignore parse errors
            }
        }
        }
    }
    LaunchedEffect(attemptId, refreshKey) {
        reviewError = null
        val attempt = practiceRepository.getAttempt(attemptId) ?: return@LaunchedEffect
        val sync = CoachFeedbackSync(local)
        launch { local.coachAssessmentDao().observe(attempt.studentId).collect { assessment = it } }
        launch {
            try { sync.watch(attempt.studentId) }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { reviewError = "Could not refresh session feedback. Reconnect and try again." }
        }
        launch {
            try { sync.watchAssessments(attempt.studentId) }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { reviewError = "Could not refresh the coach assessment. Reconnect and try again." }
        }
    }

    val overallScore = result?.overallScore ?: 0.0f
    val pitchScore = result?.accuracyScore ?: 0.0f
    val toneScore = result?.toneScore ?: 0.0f
    val evidence = remember(result?.gradingEvidence) { runCatching {
        result?.gradingEvidence?.let { Gson().fromJson(it, com.harmonia.analysis.GradingEvidence::class.java) }
    }.getOrNull() }
    val isPassed = evidence?.automaticPassed ?: (overallScore >= 70.0f && pitchScore >= 70.0f)
    val pitchLabel = if (evidence != null && evidence.pitchScore == null) "—" else "${pitchScore.toInt()}%"
    val toneLabel = if (evidence != null && evidence.toneScore == null) "—" else "${toneScore.toInt()}%"
    val overallLabel = if (evidence != null && evidence.overallScore == null) "—" else "${overallScore.toInt()}%"
    val noVoiceDetected = result?.verdictStatus == "noVoiceDetected"
    val insufficientAudio = result?.verdictStatus == "insufficientAudio"

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(BackgroundDark)
            .padding(horizontal = 20.dp),
        contentPadding = PaddingValues(top = 24.dp, bottom = 48.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        // Title
        item {
            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    text = when {
                        result?.coachVerdict != null -> "Coach Review Received"
                        evidence?.status == "partial" -> "Coach Tone Assessment Needed"
                        insufficientAudio -> "Recording Needs Another Take"
                        noVoiceDetected -> "No Voice Detected"
                        isPassed -> "Practice Target Reached"
                        else -> "Needs Practice"
                    },
                    style = MaterialTheme.typography.headlineMedium.copy(
                        color = when {
                            result?.coachVerdict != null -> PrimaryPurpleLight
                            noVoiceDetected -> Color(0xFFE53935)
                            isPassed -> PitchGreen
                            else -> PitchYellow
                        }
                    )
                )
                Spacer(modifier = Modifier.height(6.dp))
                // Human-In-The-Loop Verdict Badge
                Surface(
                    shape = RoundedCornerShape(20.dp),
                    color = PrimaryPurple.copy(alpha = 0.2f)
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            if (result?.coachVerdict != null) Icons.Default.CheckCircle else Icons.Default.HourglassEmpty,
                            contentDescription = null,
                            tint = PrimaryPurpleLight,
                            modifier = Modifier.size(14.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = if (result?.coachVerdict != null) "Reviewed by coach" else "Practice estimate · Awaiting coach review",
                            style = MaterialTheme.typography.bodySmall.copy(
                                color = PrimaryPurpleLight,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 11.sp
                            )
                        )
                    }
                }
                if (noVoiceDetected || insufficientAudio) {
                    Spacer(modifier = Modifier.height(10.dp))
                    Text(
                        text = if (insufficientAudio) "Sing for the exercise duration, then try again."
                            else "No voice was detected in your recording.\nCheck your microphone and try again in a quiet environment.",
                        style = MaterialTheme.typography.bodyMedium.copy(
                            color = TextMuted,
                            textAlign = TextAlign.Center
                        )
                    )
                }
            }
        }

        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Coach review for this recording", style = MaterialTheme.typography.titleMedium)
                Text(result?.coachVerdict ?: "Your coach has not reviewed this recording yet.")
                result?.coachFeedback?.takeIf { it.isNotBlank() }?.let { Text(it) }
                result?.coachPitchScore?.let { pitch ->
                    Text("Coach scores: pitch ${pitch.toInt()}% · tone ${result?.coachToneScore?.toInt()}%")
                }
                Text(when (result?.advancementDecision) { "approved" -> "Advancement approved by coach."; "repeat" -> "Your coach requested another attempt."; else -> "Advancement awaits explicit coach approval." })
                evidence?.let { Text("${it.policy.difficulty}: ±${it.policy.toleranceCents.toInt()} cents · ${it.policy.passMark.toInt()}% pass mark. Clarity and steadiness are experimental estimates.", style = MaterialTheme.typography.bodySmall, color = TextSecondary) }
                Text("Your original practice scores are shown below. Saved feedback stays available offline.", color = TextSecondary, style = MaterialTheme.typography.bodySmall)
                reviewError?.let {
                    Text(it, color = MaterialTheme.colorScheme.error)
                    TextButton(onClick = { refreshKey++ }) { Text("Refresh feedback") }
                }
            }
        }
        assessment?.let { coachAssessment ->
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Latest general coach assessment", style = MaterialTheme.typography.titleMedium)
                    Text(coachAssessment.coachName.ifBlank { "Vocal coach" }, color = TextSecondary)
                    Text(coachAssessment.verdict.replace('_', ' ').replaceFirstChar { it.uppercase() })
                    if (coachAssessment.feedback.isNotBlank()) Text(coachAssessment.feedback)
                    if (coachAssessment.observations.isNotBlank()) Text(coachAssessment.observations)
                    Text("This assessment applies to your overall progress.", style = MaterialTheme.typography.bodySmall, color = TextSecondary)
                }
            }
        }
        // Circular Score Ring Card
        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(20.dp),
                colors = CardDefaults.cardColors(containerColor = SurfaceCard)
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier.size(140.dp)
                    ) {
                        CircularProgressIndicator(
                            progress = { overallScore / 100.0f },
                            modifier = Modifier.fillMaxSize(),
                            strokeWidth = 12.dp,
                            color = if (isPassed) PitchGreen else PitchYellow,
                            trackColor = SurfaceCardLight
                        )
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                text = overallLabel,
                                style = MaterialTheme.typography.headlineLarge.copy(
                                    fontWeight = FontWeight.ExtraBold,
                                    fontSize = 38.sp
                                )
                            )
                            Text(
                                text = "ORIGINAL",
                                style = MaterialTheme.typography.bodySmall.copy(
                                    letterSpacing = 1.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = TextMuted
                                )
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(24.dp))

                    // Score breakdown row
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceEvenly
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("PITCH ACCURACY", style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp))
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = pitchLabel,
                                style = MaterialTheme.typography.titleLarge.copy(
                                    fontWeight = FontWeight.Bold,
                                    color = PitchGreen
                                )
                            )
                        }

                        Divider(
                            modifier = Modifier
                                .height(36.dp)
                                .width(1.dp),
                            color = SurfaceCardLight
                        )

                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("TONE CLARITY", style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp))
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = toneLabel,
                                style = MaterialTheme.typography.titleLarge.copy(
                                    fontWeight = FontWeight.Bold,
                                    color = AccentCyan
                                )
                            )
                        }
                    }
                }
            }
        }

        // Full Session Pitch Graph
        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = SurfaceCard)
            ) {
                Column(modifier = Modifier.padding(18.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "Session Pitch Graph",
                            style = MaterialTheme.typography.titleMedium
                        )
                        Text(
                            text = "Target Line",
                            style = MaterialTheme.typography.bodySmall.copy(color = PrimaryPurpleLight)
                        )
                    }

                    Spacer(modifier = Modifier.height(14.dp))

                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(100.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(SurfaceDark)
                    ) {
                        Canvas(modifier = Modifier.fillMaxSize().padding(8.dp)) {
                            val w = size.width
                            val h = size.height
                            val mid = h / 2.0f

                            // Target reference line
                            drawLine(
                                color = PrimaryPurpleLight.copy(alpha = 0.6f),
                                start = Offset(0f, mid),
                                end = Offset(w, mid),
                                strokeWidth = 2.dp.toPx()
                            )

                            if (frames.isNotEmpty()) {
                                val step = w / frames.size.coerceAtLeast(1)
                                for (i in 0 until frames.size - 1) {
                                    val f1 = frames[i]
                                    val f2 = frames[i + 1]
                                    val y1 = (mid - (f1.centsDeviation / 100f) * (h * 0.4f)).coerceIn(4f, h - 4f)
                                    val y2 = (mid - (f2.centsDeviation / 100f) * (h * 0.4f)).coerceIn(4f, h - 4f)

                                    drawLine(
                                        color = if (f1.frequencyHz <= 0 || f1.targetFrequencyHz <= 0) TextMuted else if (kotlin.math.abs(f1.centsDeviation) <= (evidence?.policy?.toleranceCents ?: 25f)) PitchGreen else PitchYellow,
                                        start = Offset(i * step, y1),
                                        end = Offset((i + 1) * step, y2),
                                        strokeWidth = 3.dp.toPx()
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }

        // AI Feedback Notes Card
        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = SurfaceCard)
            ) {
                Column(modifier = Modifier.padding(18.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            Icons.Default.AutoAwesome,
                            contentDescription = null,
                            tint = AccentGold,
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "Practice Analysis",
                            style = MaterialTheme.typography.titleMedium
                        )
                    }

                    Spacer(modifier = Modifier.height(10.dp))

                    Text(
                        text = result?.feedbackNotes
                            ?: "Loading saved analysis…",
                        style = MaterialTheme.typography.bodyMedium.copy(lineHeight = 22.sp)
                    )
                }
            }
        }

        // Action Buttons
        item {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Button(
                    onClick = onSaveAndContinue,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(52.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = PrimaryPurple),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text("Save & Continue", style = MaterialTheme.typography.labelLarge)
                }

                OutlinedButton(
                    onClick = onRetry,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(52.dp),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text("Retry Exercise", style = MaterialTheme.typography.labelLarge, color = PrimaryPurpleLight)
                }

                TextButton(
                    onClick = onViewFullReport,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("View Full Progress Report", style = MaterialTheme.typography.bodyMedium.copy(color = TextSecondary))
                }
            }
        }
    }
}
