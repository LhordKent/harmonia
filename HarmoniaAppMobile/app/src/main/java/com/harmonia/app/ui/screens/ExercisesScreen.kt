package com.harmonia.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.harmonia.app.data.repository.AuthRepository
import com.harmonia.app.data.repository.ExerciseRepository
import com.harmonia.app.data.repository.ExerciseUiItem
import com.harmonia.app.ui.theme.*

@Composable
fun ExercisesScreen(
    authRepository: AuthRepository,
    exerciseRepository: ExerciseRepository,
    onSelectExercise: (exerciseId: String) -> Unit
) {
    val currentStudent by authRepository.observeCurrentStudent().collectAsState(initial = null)
    val studentId = currentStudent?.id ?: ""
    val context = androidx.compose.ui.platform.LocalContext.current
    LaunchedEffect(studentId) {
        if (studentId.isNotBlank()) try {
            com.harmonia.app.data.sync.CoachFeedbackSync(com.harmonia.app.data.local.HarmoniaDatabase.getInstance(context)).watch(studentId)
        } catch (e: kotlinx.coroutines.CancellationException) { throw e }
        catch (e: Exception) { android.util.Log.w("Exercises", "Using saved coach approval while offline.", e) }
    }

    var selectedTab by remember { mutableStateOf(0) }
    val tabs = listOf("Foundations", "Pitch Training", "Advanced")

    val currentDifficulty = tabs[selectedTab]
    val exercises by exerciseRepository.observeExercisesForStudent(studentId, currentDifficulty)
        .collectAsState(initial = emptyList())

    val allExercises by exerciseRepository.observeExercisesForStudent(studentId, null)
        .collectAsState(initial = emptyList())

    val completedCount = allExercises.count { it.status == "completed" }
    val totalCount = allExercises.size.coerceAtLeast(1)
    val progressPercent = (completedCount.toFloat() / totalCount).coerceIn(0.0f, 1.0f)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(BackgroundDark)
            .padding(horizontal = 20.dp)
    ) {
        Spacer(modifier = Modifier.height(24.dp))

        // Title
        Text(
            text = "Exercise Library",
            style = MaterialTheme.typography.headlineMedium
        )
        Text(
            text = "Master each level to unlock advanced vocal techniques",
            style = MaterialTheme.typography.bodyMedium
        )

        Spacer(modifier = Modifier.height(20.dp))

        // Overall Completion Progress Card
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = SurfaceCard)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Library Completion",
                        style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold)
                    )
                    Text(
                        text = "$completedCount / $totalCount Completed",
                        style = MaterialTheme.typography.bodySmall.copy(color = PrimaryPurpleLight)
                    )
                }

                Spacer(modifier = Modifier.height(10.dp))

                LinearProgressIndicator(
                    progress = { progressPercent },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(8.dp)
                        .clip(RoundedCornerShape(4.dp)),
                    color = PrimaryPurple,
                    trackColor = SurfaceCardLight
                )
            }
        }

        Spacer(modifier = Modifier.height(20.dp))

        // Difficulty Category Tabs
        TabRow(
            selectedTabIndex = selectedTab,
            containerColor = SurfaceDark,
            contentColor = PrimaryPurpleLight,
            indicator = {},
            divider = {}
        ) {
            tabs.forEachIndexed { index, title ->
                val isSelected = selectedTab == index
                Tab(
                    selected = isSelected,
                    onClick = { selectedTab = index },
                    modifier = Modifier
                        .padding(4.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(if (isSelected) PrimaryPurple else SurfaceCard)
                ) {
                    Text(
                        text = title,
                        modifier = Modifier.padding(vertical = 10.dp),
                        style = MaterialTheme.typography.labelLarge.copy(
                            fontSize = 13.sp,
                            color = if (isSelected) TextPrimary else TextSecondary
                        )
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Exercise List
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = 100.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            items(exercises, key = { it.exercise.id }) { item ->
                ExerciseCard(
                    item = item,
                    onClick = {
                        if (item.status != "locked") {
                            onSelectExercise(item.exercise.id)
                        }
                    }
                )
            }
        }
    }
}

@Composable
fun ExerciseCard(
    item: ExerciseUiItem,
    onClick: () -> Unit
) {
    val isLocked = item.status == "locked"
    val isCompleted = item.status == "completed"

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .clickable(enabled = !isLocked) { onClick() },
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isLocked) SurfaceCard.copy(alpha = 0.5f) else SurfaceCard
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Status Icon Box
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(
                        when {
                            isCompleted -> PitchGreen.copy(alpha = 0.15f)
                            isLocked -> SurfaceCardLight
                            else -> PrimaryPurple.copy(alpha = 0.2f)
                        }
                    ),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = when {
                        isCompleted -> Icons.Default.CheckCircle
                        isLocked -> Icons.Default.Lock
                        else -> Icons.Default.PlayArrow
                    },
                    contentDescription = item.status,
                    tint = when {
                        isCompleted -> PitchGreen
                        isLocked -> TextMuted
                        else -> PrimaryPurpleLight
                    },
                    modifier = Modifier.size(24.dp)
                )
            }

            Spacer(modifier = Modifier.width(16.dp))

            // Exercise Details
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = item.exercise.title,
                    style = MaterialTheme.typography.titleMedium.copy(
                        color = if (isLocked) TextMuted else TextPrimary
                    )
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = item.exercise.description,
                    style = MaterialTheme.typography.bodySmall.copy(
                        color = if (isLocked) TextMuted.copy(alpha = 0.7f) else TextSecondary
                    ),
                    maxLines = 2
                )
                Spacer(modifier = Modifier.height(6.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = "Target: ${item.exercise.targetNote}",
                        style = MaterialTheme.typography.bodySmall.copy(
                            fontWeight = FontWeight.Bold,
                            color = if (isLocked) TextMuted else PrimaryPurpleLight
                        )
                    )
                    Spacer(modifier = Modifier.width(12.dp))
                    Text(
                        text = "${item.exercise.durationSeconds}s",
                        style = MaterialTheme.typography.bodySmall.copy(color = TextMuted)
                    )
                    if (isCompleted && item.bestScore > 0) {
                        Spacer(modifier = Modifier.width(12.dp))
                        Text(
                            text = "Best: ${item.bestScore.toInt()}%",
                            style = MaterialTheme.typography.bodySmall.copy(
                                color = PitchGreen,
                                fontWeight = FontWeight.Bold
                            )
                        )
                    }
                }
            }
        }
    }
}
