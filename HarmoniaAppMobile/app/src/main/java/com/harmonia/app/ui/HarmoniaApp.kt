package com.harmonia.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Alignment
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

    val authRepository = remember {
        AuthRepository(database.studentDao(), onboardingCache = SharedPrefsOnboardingCache(context.applicationContext))
    }
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

    // Restore a persisted session first; the server profile (or, offline, a prior online
    // verification on this device) decides which screen may open.
    var restoredState by remember { mutableStateOf<AuthState?>(null) }
    LaunchedEffect(Unit) { restoredState = authRepository.restoreSession() }
    val startState = restoredState
    if (startState == null) {
        HarmoniaTheme {
            Box(Modifier.fillMaxSize().background(BackgroundDark), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = PrimaryPurpleLight)
            }
        }
        return
    }
    val authState by authRepository.authState.collectAsState()

    val navController = rememberNavController()
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = navBackStackEntry?.destination?.route
    val publicRoutes = setOf(Screen.Onboarding.route, Screen.Login.route)

    // Single gate for every state change (login, password change, logout, restore).
    LaunchedEffect(authState, currentRoute) {
        if (currentRoute == null) return@LaunchedEffect
        when (authState) {
            AuthState.PasswordChangeRequired, AuthState.EnrollmentRequired ->
                if (currentRoute != Screen.AccountSetup.route) navController.navigate(Screen.AccountSetup.route) {
                    popUpTo(0) { inclusive = true }
                }
            AuthState.Ready ->
                if (currentRoute in publicRoutes || currentRoute == Screen.AccountSetup.route) {
                    SyncWorker.enqueue(context)
                    navController.navigate(Screen.Dashboard.route) { popUpTo(0) { inclusive = true } }
                }
            AuthState.SignedOut ->
                if (currentRoute !in publicRoutes) navController.navigate(Screen.Login.route) {
                    popUpTo(0) { inclusive = true }
                }
        }
    }

    // Navigate to initialRoute (e.g. from a notification tap) only for a fully set-up account.
    LaunchedEffect(initialRoute, authState) {
        if (!initialRoute.isNullOrBlank() && authState == AuthState.Ready) {
            navController.navigate(initialRoute) { launchSingleTop = true }
        }
    }

    // Protected screens render nothing unless the account is ready, even for a stale back stack entry.
    @Composable
    fun Protected(content: @Composable () -> Unit) {
        if (authState == AuthState.Ready) content()
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
                startDestination = when (startState) {
                    AuthState.Ready -> Screen.Dashboard.route
                    AuthState.PasswordChangeRequired, AuthState.EnrollmentRequired -> Screen.AccountSetup.route
                    AuthState.SignedOut -> Screen.Onboarding.route
                },
                modifier = Modifier.padding(innerPadding)
            ) {
                // 1. Onboarding
                composable(Screen.Onboarding.route) {
                    OnboardingScreen(
                        onNavigateToLogin = { navController.navigate(Screen.Login.route) }
                    )
                }

                // 2. Login
                composable(Screen.Login.route) {
                    // Navigation after sign-in is decided by the auth-state gate above.
                    LoginScreen(authRepository = authRepository, onLoginSuccess = {})
                }

                // 3. Account setup (password change / enrollment) — the only screen for pending accounts
                composable(Screen.AccountSetup.route) {
                    AccountSetupScreen(authRepository = authRepository, onSignedOut = {})
                }

                // 4. Main Dashboard
                composable(Screen.Dashboard.route) {
                    Protected {
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
                }

                // 5. Practice / Recording Screen
                composable(
                    route = Screen.Practice.route,
                    arguments = listOf(navArgument("exerciseId") { type = NavType.StringType })
                ) { backStackEntry ->
                    val exerciseId = backStackEntry.arguments?.getString("exerciseId") ?: "ex_f1"
                    Protected {
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
                }

                // 6. Results Screen
                composable(
                    route = Screen.Results.route,
                    arguments = listOf(navArgument("attemptId") { type = NavType.StringType })
                ) { backStackEntry ->
                    val attemptId = backStackEntry.arguments?.getString("attemptId") ?: ""
                    Protected {
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
                }

                // 7. Exercises Screen
                composable(Screen.Exercises.route) {
                    Protected {
                        ExercisesScreen(
                            authRepository = authRepository,
                            exerciseRepository = exerciseRepository,
                            onSelectExercise = { exId ->
                                navController.navigate(Screen.Practice.createRoute(exId))
                            }
                        )
                    }
                }

                // 8. Progress Screen
                composable(Screen.Progress.route) {
                    Protected {
                        ProgressScreen(
                            authRepository = authRepository,
                            practiceRepository = practiceRepository,
                            achievementRepository = achievementRepository,
                            onSelectAttempt = { attemptId ->
                                navController.navigate(Screen.Results.createRoute(attemptId))
                            }
                        )
                    }
                }

                // 9. Notifications Screen
                composable(Screen.Notifications.route) {
                    Protected {
                        NotificationsScreen(
                            authRepository = authRepository,
                            notificationRepository = notificationRepository,
                            onNavigateBack = { navController.popBackStack() }
                        )
                    }
                }

                // 10. Profile Screen
                composable(Screen.Profile.route) {
                    Protected {
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
}
