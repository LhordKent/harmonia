package com.harmonia.app.ui.screens

import android.media.MediaPlayer
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.harmonia.app.data.repository.AchievementRepository
import com.harmonia.app.data.repository.AchievementUiItem
import com.harmonia.app.data.repository.AuthRepository
import com.harmonia.app.data.repository.DashboardSummaryStats
import com.harmonia.app.data.repository.PracticeHistoryItem
import com.harmonia.app.data.repository.PracticeRepository
import com.harmonia.app.ui.theme.*
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.delay

@Composable
fun ProgressScreen(
    authRepository: AuthRepository,
    practiceRepository: PracticeRepository,
    achievementRepository: AchievementRepository,
    onSelectAttempt: (attemptId: String) -> Unit
) {
    val currentStudent by authRepository.observeCurrentStudent().collectAsState(initial = null)
    val studentId = currentStudent?.id ?: ""

    var stats by remember {
        mutableStateOf(
            DashboardSummaryStats(0f, 0, 0, 0, 0f, emptyList())
        )
    }

    val historyItems by practiceRepository.observeHistory(studentId)
        .collectAsState(initial = emptyList())
    val achievements by achievementRepository.observeAchievementsForStudent(studentId)
        .collectAsState(initial = emptyList())

    LaunchedEffect(studentId, historyItems.size) {
        stats = practiceRepository.getDashboardStats(studentId)
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(BackgroundDark)
            .padding(horizontal = 20.dp),
        contentPadding = PaddingValues(top = 24.dp, bottom = 100.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp)
    ) {
        // Title
        item {
            Text(
                text = "Progress & Achievements",
                style = MaterialTheme.typography.headlineMedium
            )
            Text(
                text = "Your vocal performance analytics and earned milestones",
                style = MaterialTheme.typography.bodyMedium
            )
        }

        // Summary Cards Row
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Card(
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = SurfaceCard)
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text("WEEKLY AVERAGE", style = MaterialTheme.typography.bodySmall.copy(fontSize = 10.sp))
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "${stats.weeklyAccuracyAverage.toInt()}%",
                            style = MaterialTheme.typography.headlineMedium.copy(
                                fontWeight = FontWeight.Bold,
                                color = PitchGreen
                            )
                        )
                    }
                }

                Card(
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = SurfaceCard)
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text("ALL-TIME BEST", style = MaterialTheme.typography.bodySmall.copy(fontSize = 10.sp))
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "${stats.bestScore.toInt()}%",
                            style = MaterialTheme.typography.headlineMedium.copy(
                                fontWeight = FontWeight.Bold,
                                color = AccentGold
                            )
                        )
                    }
                }
            }
        }

        // Achievement Badges Section
        item {
            Column {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Vocal Badges",
                        style = MaterialTheme.typography.titleMedium
                    )
                    Text(
                        text = "${achievements.count { it.isEarned }} of ${achievements.size} Earned",
                        style = MaterialTheme.typography.bodySmall.copy(color = PrimaryPurpleLight)
                    )
                }

                Spacer(modifier = Modifier.height(12.dp))

                LazyRow(
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    items(achievements) { item ->
                        BadgeCard(item = item)
                    }
                }
            }
        }

        // Session History List Section
        item {
            Text(
                text = "Session History",
                style = MaterialTheme.typography.titleMedium
            )
        }

        if (historyItems.isEmpty()) {
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(containerColor = SurfaceCard)
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(24.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "No practice sessions recorded yet. Start practicing today!",
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextMuted
                        )
                    }
                }
            }
        } else {
            items(historyItems) { historyItem ->
                HistoryItemCard(
                    item = historyItem,
                    onClick = { onSelectAttempt(historyItem.attempt.id) }
                )
            }
        }
    }
}

@Composable
fun BadgeCard(item: AchievementUiItem) {
    Card(
        modifier = Modifier
            .width(130.dp)
            .height(150.dp),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (item.isEarned) SurfaceCard else SurfaceDark
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(
                        if (item.isEarned) AccentGold.copy(alpha = 0.2f) else SurfaceCardLight
                    ),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = if (item.isEarned) Icons.Default.MilitaryTech else Icons.Default.Lock,
                    contentDescription = null,
                    tint = if (item.isEarned) AccentGold else TextMuted,
                    modifier = Modifier.size(28.dp)
                )
            }

            Spacer(modifier = Modifier.height(10.dp))

            Text(
                text = item.achievement.title,
                style = MaterialTheme.typography.labelLarge.copy(
                    fontSize = 12.sp,
                    color = if (item.isEarned) TextPrimary else TextMuted
                ),
                maxLines = 1
            )

            Spacer(modifier = Modifier.height(2.dp))

            Text(
                text = if (item.isEarned) "Unlocked" else "Locked",
                style = MaterialTheme.typography.bodySmall.copy(
                    fontSize = 10.sp,
                    color = if (item.isEarned) PitchGreen else TextMuted
                )
            )
        }
    }
}

@Composable
fun HistoryItemCard(
    item: PracticeHistoryItem,
    onClick: () -> Unit
) {
    val score = item.result?.overallScore ?: 0.0f
    val evidence = remember(item.result?.gradingEvidence) { runCatching { item.result?.gradingEvidence?.let {
        com.google.gson.Gson().fromJson(it, com.harmonia.analysis.GradingEvidence::class.java)
    } }.getOrNull() }
    val scoreAvailable = item.result != null && (evidence == null || evidence.overallScore != null)
    val sdf = SimpleDateFormat("MMM dd, yyyy • h:mm a", Locale.getDefault())
    val dateStr = sdf.format(Date(item.attempt.recordedAt))

    // Audio playback state
    val audioPath = item.attempt.audioRecordingUrl
    val hasAudio = remember(audioPath) { audioPath.isNotBlank() && File(audioPath).exists() }
    var isPlaying by remember { mutableStateOf(false) }
    var playbackProgress by remember { mutableStateOf(0f) }
    val mediaPlayer = remember { MediaPlayer() }

    // Release the MediaPlayer when the card leaves composition
    DisposableEffect(audioPath) {
        onDispose {
            if (mediaPlayer.isPlaying) mediaPlayer.stop()
            mediaPlayer.release()
        }
    }

    // Poll playback position while playing
    LaunchedEffect(isPlaying) {
        if (isPlaying) {
            while (isPlaying && mediaPlayer.isPlaying) {
                val duration = mediaPlayer.duration
                val position = mediaPlayer.currentPosition
                playbackProgress = if (duration > 0) position.toFloat() / duration.toFloat() else 0f
                delay(200)
            }
            // Playback completed naturally
            isPlaying = false
            playbackProgress = 0f
        }
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp)),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = SurfaceCard)
    ) {
        Column {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                // Score badge + meta
                Row(
                    modifier = Modifier.weight(1f),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(
                        modifier = Modifier
                            .size(44.dp)
                            .clip(CircleShape)
                            .background(
                                if (score >= 70) PitchGreen.copy(alpha = 0.15f) else PitchYellow.copy(alpha = 0.15f)
                            ),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = if (scoreAvailable) "${score.toInt()}%" else "—",
                            style = MaterialTheme.typography.labelLarge.copy(
                                fontWeight = FontWeight.Bold,
                                color = if (score >= 70) PitchGreen else PitchYellow
                            )
                        )
                    }

                    Spacer(modifier = Modifier.width(14.dp))

                    Column {
                        Text(
                            text = "Vocal Practice Attempt",
                            style = MaterialTheme.typography.titleMedium.copy(fontSize = 15.sp)
                        )
                        Spacer(modifier = Modifier.height(2.dp))
                        Text(
                            text = "$dateStr • ${item.attempt.durationSeconds}s",
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }

                // Right side: status badge + play button
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = SurfaceDark
                    ) {
                        Text(
                            text = when (item.result?.advancementDecision) { "approved" -> "Coach approved"; "repeat" -> "Repeat requested"; else -> "Awaiting review" },
                            style = MaterialTheme.typography.bodySmall.copy(
                                fontSize = 10.sp,
                                color = PrimaryPurpleLight
                            ),
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                        )
                    }

                    Spacer(modifier = Modifier.width(8.dp))

                    // Play / Stop button
                    IconButton(
                        onClick = {
                            if (!hasAudio) return@IconButton
                            if (isPlaying) {
                                mediaPlayer.pause()
                                isPlaying = false
                            } else {
                                try {
                                    mediaPlayer.reset()
                                    mediaPlayer.setDataSource(audioPath)
                                    mediaPlayer.prepare()
                                    mediaPlayer.start()
                                    isPlaying = true
                                    // Auto-reset when playback ends
                                    mediaPlayer.setOnCompletionListener {
                                        isPlaying = false
                                        playbackProgress = 0f
                                    }
                                } catch (e: Exception) {
                                    isPlaying = false
                                }
                            }
                        },
                        modifier = Modifier
                            .size(36.dp)
                            .clip(CircleShape)
                            .background(
                                if (hasAudio) PrimaryPurple.copy(alpha = 0.15f)
                                else SurfaceCardLight.copy(alpha = 0.4f)
                            )
                    ) {
                        Icon(
                            imageVector = if (isPlaying) Icons.Default.Stop else Icons.Default.PlayArrow,
                            contentDescription = if (isPlaying) "Stop Playback" else "Play Recording",
                            tint = if (hasAudio) PrimaryPurpleLight else TextMuted,
                            modifier = Modifier.size(20.dp)
                        )
                    }
                }
            }

            // Playback progress bar — only visible while playing or after playback started
            if (hasAudio && (isPlaying || playbackProgress > 0f)) {
                LinearProgressIndicator(
                    progress = { playbackProgress },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(3.dp),
                    color = PrimaryPurpleLight,
                    trackColor = SurfaceDark
                )
            }
        }
    }
}
