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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.harmonia.app.data.local.entity.StudentEntity
import com.harmonia.app.data.local.entity.VocalExerciseEntity
import com.harmonia.app.data.repository.AuthRepository
import com.harmonia.app.data.repository.DashboardSummaryStats
import com.harmonia.app.data.repository.ExerciseRepository
import com.harmonia.app.data.repository.NotificationRepository
import com.harmonia.app.data.repository.PracticeRepository
import com.harmonia.app.ui.theme.*

@Composable
fun DashboardScreen(
    authRepository: AuthRepository,
    practiceRepository: PracticeRepository,
    exerciseRepository: ExerciseRepository,
    notificationRepository: NotificationRepository,
    onNavigateToPractice: (exerciseId: String) -> Unit,
    onNavigateToNotifications: () -> Unit,
    onNavigateToExercises: () -> Unit
) {
    val currentStudent by authRepository.observeCurrentStudent().collectAsState(initial = null)
    val unreadCount by notificationRepository.observeUnreadCount(currentStudent?.id ?: "")
        .collectAsState(initial = 0)

    var stats by remember {
        mutableStateOf(
            DashboardSummaryStats(0f, 0, 0, 0, 0f, emptyList())
        )
    }

    var recommendedExercise by remember { mutableStateOf<VocalExerciseEntity?>(null) }

    LaunchedEffect(currentStudent?.id) {
        currentStudent?.id?.let { id ->
            stats = practiceRepository.getDashboardStats(id)
            val exercises = exerciseRepository.getAllExercises()
            recommendedExercise = exercises.firstOrNull()
        }
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(BackgroundDark)
            .padding(horizontal = 20.dp),
        contentPadding = PaddingValues(top = 24.dp, bottom = 100.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp)
    ) {
        // 1. Greeting & Notification Bell Header
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(
                        text = "Hello, ${currentStudent?.fullName?.split(" ")?.firstOrNull() ?: "Singer"}",
                        style = MaterialTheme.typography.headlineMedium
                    )
                    Text(
                        text = "Ready for today's vocal training?",
                        style = MaterialTheme.typography.bodyMedium
                    )
                }

                Box {
                    IconButton(
                        onClick = onNavigateToNotifications,
                        modifier = Modifier
                            .size(48.dp)
                            .clip(CircleShape)
                            .background(SurfaceCard)
                    ) {
                        Icon(
                            Icons.Default.Notifications,
                            contentDescription = "Notifications",
                            tint = TextPrimary
                        )
                    }
                    if (unreadCount > 0) {
                        Box(
                            modifier = Modifier
                                .size(18.dp)
                                .clip(CircleShape)
                                .background(PitchRed)
                                .align(Alignment.TopEnd),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = "$unreadCount",
                                color = Color.White,
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }
            }
        }

        // 2. Weekly Accuracy Summary Card
        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = SurfaceCard)
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(
                            Brush.horizontalGradient(
                                listOf(PrimaryPurple.copy(alpha = 0.25f), SurfaceCard)
                            )
                        )
                        .padding(20.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column {
                            Text(
                                text = "WEEKLY ACCURACY",
                                style = MaterialTheme.typography.bodySmall.copy(
                                    letterSpacing = 1.5.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = PrimaryPurpleLight
                                )
                            )
                            Spacer(modifier = Modifier.height(6.dp))
                            Text(
                                text = if (stats.totalSessionsCompleted == 0) "—" else "${stats.weeklyAccuracyAverage.toInt()}%",
                                style = MaterialTheme.typography.headlineLarge.copy(
                                    fontSize = 42.sp,
                                    fontWeight = FontWeight.ExtraBold,
                                    color = PitchGreen
                                )
                            )
                            Text(
                                text = if (stats.totalSessionsCompleted == 0) "Record your first exercise to see your scores" else "Based on your practice in the last 7 days",
                                style = MaterialTheme.typography.bodySmall.copy(color = TextSecondary)
                            )
                        }

                        Box(
                            modifier = Modifier
                                .size(64.dp)
                                .clip(CircleShape)
                                .background(PitchGreen.copy(alpha = 0.15f)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                Icons.Default.TrendingUp,
                                contentDescription = null,
                                tint = PitchGreen,
                                modifier = Modifier.size(36.dp)
                            )
                        }
                    }
                }
            }
        }

        // 3. Stats Grid (Day streak, practice time, sessions, best score)
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                StatCard(
                    title = "Day Streak",
                    value = "${stats.dayStreak} Days",
                    icon = Icons.Default.LocalFireDepartment,
                    iconTint = AccentGold,
                    modifier = Modifier.weight(1f)
                )
                StatCard(
                    title = "Practice Time",
                    value = "${stats.totalPracticeSeconds / 60}m",
                    icon = Icons.Default.Timer,
                    iconTint = AccentCyan,
                    modifier = Modifier.weight(1f)
                )
            }
            Spacer(modifier = Modifier.height(12.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                StatCard(
                    title = "Sessions",
                    value = "${stats.totalSessionsCompleted}",
                    icon = Icons.Default.Mic,
                    iconTint = PrimaryPurpleLight,
                    modifier = Modifier.weight(1f)
                )
                StatCard(
                    title = "Best Score",
                    value = "${stats.bestScore.toInt()}%",
                    icon = Icons.Default.EmojiEvents,
                    iconTint = AccentGold,
                    modifier = Modifier.weight(1f)
                )
            }
        }

        // 4. Recommended Exercise Card
        item {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable {
                        recommendedExercise?.id?.let { onNavigateToPractice(it) } ?: onNavigateToExercises()
                    },
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = SurfaceCard)
            ) {
                Column(modifier = Modifier.padding(20.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = PrimaryPurple.copy(alpha = 0.2f)
                        ) {
                            Text(
                                text = "RECOMMENDED TODAY",
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                style = MaterialTheme.typography.bodySmall.copy(
                                    color = PrimaryPurpleLight,
                                    fontWeight = FontWeight.Bold
                                )
                            )
                        }
                        Text(
                            text = "${recommendedExercise?.durationSeconds ?: 15}s",
                            style = MaterialTheme.typography.bodySmall
                        )
                    }

                    Spacer(modifier = Modifier.height(12.dp))

                    Text(
                        text = recommendedExercise?.title ?: "Single Tone Sustain (A4)",
                        style = MaterialTheme.typography.titleLarge
                    )

                    Spacer(modifier = Modifier.height(4.dp))

                    Text(
                        text = recommendedExercise?.description ?: "Sustain a clean A4 note with steady breath support.",
                        style = MaterialTheme.typography.bodyMedium
                    )

                    Spacer(modifier = Modifier.height(16.dp))

                    Button(
                        onClick = {
                            recommendedExercise?.id?.let { onNavigateToPractice(it) } ?: onNavigateToExercises()
                        },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(containerColor = PrimaryPurple),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        Icon(Icons.Default.PlayArrow, contentDescription = null)
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Start Exercise Now")
                    }
                }
            }
        }

        // 5. Weekly Accuracy Trend Chart
        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = SurfaceCard)
            ) {
                Column(modifier = Modifier.padding(20.dp)) {
                    Text(
                        text = "Weekly Accuracy Trend",
                        style = MaterialTheme.typography.titleMedium
                    )
                    Spacer(modifier = Modifier.height(16.dp))

                    // Bar Chart Visualization
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(120.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.Bottom
                    ) {
                        stats.weeklyTrend.forEach { (day, accuracy) ->
                            Column(
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.Bottom,
                                modifier = Modifier.weight(1f)
                            ) {
                                val barHeight = (accuracy / 100.0f * 80).dp
                                Box(
                                    modifier = Modifier
                                        .width(18.dp)
                                        .height(barHeight)
                                        .clip(RoundedCornerShape(topStart = 6.dp, topEnd = 6.dp))
                                        .background(
                                            if (accuracy >= 85) PitchGreen
                                            else if (accuracy >= 70) PitchYellow
                                            else PitchRed
                                        )
                                )
                                Spacer(modifier = Modifier.height(8.dp))
                                Text(
                                    text = day,
                                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp)
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun StatCard(
    title: String,
    value: String,
    icon: ImageVector,
    iconTint: Color,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = SurfaceCard)
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(text = title, style = MaterialTheme.typography.bodySmall)
                Icon(icon, contentDescription = null, tint = iconTint, modifier = Modifier.size(20.dp))
            }
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = value,
                style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold)
            )
        }
    }
}
