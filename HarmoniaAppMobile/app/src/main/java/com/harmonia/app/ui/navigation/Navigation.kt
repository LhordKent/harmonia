package com.harmonia.app.ui.navigation

sealed class Screen(val route: String) {
    object Onboarding : Screen("onboarding")
    object Login : Screen("login")
    object SignUp : Screen("signup")
    object Dashboard : Screen("dashboard")
    object Practice : Screen("practice/{exerciseId}") {
        fun createRoute(exerciseId: String) = "practice/$exerciseId"
    }
    object Results : Screen("results/{attemptId}") {
        fun createRoute(attemptId: String) = "results/$attemptId"
    }
    object Exercises : Screen("exercises")
    object Progress : Screen("progress")
    object Notifications : Screen("notifications")
    object Profile : Screen("profile")
}
