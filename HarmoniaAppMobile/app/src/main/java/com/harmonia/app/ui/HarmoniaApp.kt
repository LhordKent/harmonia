package com.harmonia.app.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavType
import androidx.navigation.compose.*
import androidx.navigation.navArgument
import com.harmonia.app.data.local.HarmoniaDatabase
import com.harmonia.app.data.repository.*
import com.harmonia.app.data.sync.SyncWorker
import com.harmonia.app.ui.navigation.Screen
import com.harmonia.app.ui.screens.*
import com.harmonia.app.ui.theme.*

data class BottomNavItem(
    val route: String,
    val label: String,
    val icon: ImageVector
)

@Composable
fun HarmoniaApp(initialRoute: String? = null) {
    val context = LocalContext.current
    val database = remember { HarmoniaDatabase.getInstance(context) }

    val authRepository = remember { AuthRepository(database.studentDao()) }
    val exerciseRepository = remember {
        ExerciseRepository(database.exerciseDao(), database.practiceSessionDao(), database.notificationDao())
    }
    val practiceRepository = remember {
        PracticeRepository(database.practiceAttemptDao(), database.analysisResultDao(), database.progressReportDao(), database = database)
    }
    val achievementRepository = remember {
        AchievementRepository(database.achievementDao(), database.notificationDao())
    }
    val notificationRepository = remember {
        NotificationRepository(database.notificationDao())
    }

    val navController = rememberNavController()
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = navBackStackEntry?.destination?.route

    // Navigate to initialRoute once on start (e.g. from notification tap)
    LaunchedEffect(initialRoute) {
        if (!initialRoute.isNullOrBlank()) {
            navController.navigate(initialRoute) { launchSingleTop = true }
        }
    }

    val bottomNavItems = listOf(
        BottomNavItem(Screen.Dashboard.route, "Home", Icons.Default.Home),
        BottomNavItem("practice_launcher", "Practice", Icons.Default.Mic),
        BottomNavItem(Screen.Exercises.route, "Exercises", Icons.Default.LibraryMusic),
        BottomNavItem(Screen.Progress.route, "Progress", Icons.Default.Leaderboard),
        BottomNavItem(Screen.Profile.route, "Profile", Icons.Default.Person)
    )

    val showBottomBar = currentRoute in listOf(
        Screen.Dashboard.route,
        Screen.Exercises.route,
        Screen.Progress.route,
        Screen.Profile.route
    )

    HarmoniaTheme {
        Scaffold(
            bottomBar = {
                if (showBottomBar) {
                    NavigationBar(
                        containerColor = SurfaceDark,
                        tonalElevation = 8.dp
                    ) {
                        bottomNavItems.forEach { item ->
                            val isSelected = currentRoute == item.route
                            NavigationBarItem(
                                icon = { Icon(item.icon, contentDescription = item.label) },
                                label = { Text(item.label) },
                                selected = isSelected,
                                colors = NavigationBarItemDefaults.colors(
                                    selectedIconColor = PrimaryPurpleLight,
                                    selectedTextColor = PrimaryPurpleLight,
                                    indicatorColor = PrimaryPurple.copy(alpha = 0.2f),
                                    unselectedIconColor = TextMuted,
                                    unselectedTextColor = TextMuted
                                ),
                                onClick = {
                                    if (item.route == "practice_launcher") {
                                        navController.navigate(Screen.Practice.createRoute("ex_f1"))
                                    } else {
                                        navController.navigate(item.route) {
                                            popUpTo(navController.graph.findStartDestination().id) {
                                                saveState = true
                                            }
                                            launchSingleTop = true
                                            restoreState = true
                                        }
                                    }
                                }
                            )
                        }
                    }
                }
            }
        ) { innerPadding ->
            NavHost(
                navController = navController,
                startDestination = Screen.Onboarding.route,
                modifier = Modifier.padding(innerPadding)
            ) {
                // 1. Onboarding
                composable(Screen.Onboarding.route) {
                    OnboardingScreen(
                        onNavigateToLogin = { navController.navigate(Screen.Login.route) },
                        onNavigateToSignUp = { navController.navigate(Screen.SignUp.route) }
                    )
                }

                // 2. Login
                composable(Screen.Login.route) {
                    LoginScreen(
                        authRepository = authRepository,
                        onLoginSuccess = {
                            SyncWorker.enqueue(context)
                            navController.navigate(Screen.Dashboard.route) {
                                popUpTo(Screen.Onboarding.route) { inclusive = true }
                            }
                        },
                        onNavigateToSignUp = { navController.navigate(Screen.SignUp.route) }
                    )
                }

                // 3. SignUp
                composable(Screen.SignUp.route) {
                    SignUpScreen(
                        authRepository = authRepository,
                        onSignUpSuccess = {
                            // After registration the user must log in explicitly —
                            // do NOT navigate directly to Dashboard.
                            navController.navigate(Screen.Login.route) {
                                popUpTo(Screen.SignUp.route) { inclusive = true }
                            }
                        },
                        onNavigateToLogin = { navController.navigate(Screen.Login.route) }
                    )
                }

                // 4. Main Dashboard
                composable(Screen.Dashboard.route) {
                    DashboardScreen(
                        authRepository = authRepository,
                        practiceRepository = practiceRepository,
                        exerciseRepository = exerciseRepository,
                        notificationRepository = notificationRepository,
                        onNavigateToPractice = { exId ->
                            navController.navigate(Screen.Practice.createRoute(exId))
                        },
                        onNavigateToNotifications = {
                            navController.navigate(Screen.Notifications.route)
                        },
                        onNavigateToExercises = {
                            navController.navigate(Screen.Exercises.route)
                        }
                    )
                }

                // 5. Practice / Recording Screen
                composable(
                    route = Screen.Practice.route,
                    arguments = listOf(navArgument("exerciseId") { type = NavType.StringType })
                ) { backStackEntry ->
                    val exerciseId = backStackEntry.arguments?.getString("exerciseId") ?: "ex_f1"
                    PracticeScreen(
                        exerciseId = exerciseId,
                        authRepository = authRepository,
                        exerciseRepository = exerciseRepository,
                        practiceRepository = practiceRepository,
                        achievementRepository = achievementRepository,
                        onNavigateToResults = { attemptId ->
                            navController.navigate(Screen.Results.createRoute(attemptId))
                        },
                        onNavigateBack = { navController.popBackStack() }
                    )
                }

                // 6. Results Screen
                composable(
                    route = Screen.Results.route,
                    arguments = listOf(navArgument("attemptId") { type = NavType.StringType })
                ) { backStackEntry ->
                    val attemptId = backStackEntry.arguments?.getString("attemptId") ?: ""
                    ResultsScreen(
                        attemptId = attemptId,
                        practiceRepository = practiceRepository,
                        onSaveAndContinue = {
                            navController.navigate(Screen.Exercises.route) {
                                popUpTo(Screen.Dashboard.route)
                            }
                        },
                        onRetry = {
                            navController.popBackStack()
                        },
                        onViewFullReport = {
                            navController.navigate(Screen.Progress.route)
                        }
                    )
                }

                // 7. Exercises Screen
                composable(Screen.Exercises.route) {
                    ExercisesScreen(
                        authRepository = authRepository,
                        exerciseRepository = exerciseRepository,
                        onSelectExercise = { exId ->
                            navController.navigate(Screen.Practice.createRoute(exId))
                        }
                    )
                }

                // 8. Progress Screen
                composable(Screen.Progress.route) {
                    ProgressScreen(
                        authRepository = authRepository,
                        practiceRepository = practiceRepository,
                        achievementRepository = achievementRepository,
                        onSelectAttempt = { attemptId ->
                            navController.navigate(Screen.Results.createRoute(attemptId))
                        }
                    )
                }

                // 9. Notifications Screen
                composable(Screen.Notifications.route) {
                    NotificationsScreen(
                        authRepository = authRepository,
                        notificationRepository = notificationRepository,
                        onNavigateBack = { navController.popBackStack() }
                    )
                }

                // 10. Profile Screen
                composable(Screen.Profile.route) {
                    ProfileScreen(
                        authRepository = authRepository,
                        practiceRepository = practiceRepository,
                        onLogout = {
                            navController.navigate(Screen.Login.route) {
                                popUpTo(Screen.Dashboard.route) { inclusive = true }
                            }
                        }
                    )
                }
            }
        }
    }
}
