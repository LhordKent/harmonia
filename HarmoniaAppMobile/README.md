# Harmonia Android

Native Kotlin/Jetpack Compose student app. See [the repository quick start](../README.md) and [the current pipeline](docs/ai-pipeline.md).

## Current behavior

- One pinned pretrained SwiftF0 model through ONNX Runtime Android 1.23.2; no project-specific training. YIN is live guidance, not the final neural grader.
- Target-based notes, scales and prepared solo songs; unscored free vocalising.
- Beginner +/-50 cents/pass 60%, Intermediate +/-35/pass 70%, Advanced +/-25/pass 80%.
- Experimental programmed tone indicator: 50% periodic clarity, 30% pitch steadiness, 20% volume steadiness. Composite is 60% pitch/40% tone; passing also requires both components to meet the pass mark.
- Explicit assigned-coach/admin advancement approval; original evidence and coach corrections are separate.
- Room V6 local records and received feedback, disk-backed capture up to ten minutes, compressed M4A private audio synchronization through Supabase. Firebase Auth/Firestore provide identity and shared records. Firebase Storage is not the active audio store.

## Build

Firebase client configuration, Gradle wrapper, model and license are included. Install current Android Studio and SDK Platform 37. Current successful local toolchain: Android Studio JBR/JDK 25, Gradle 9.5.0, AGP 9.3.2. Minimum phone API is 29.

From the repository root on Windows run `powershell -ExecutionPolicy Bypass -File .\setup.ps1 -Android`, or open this directory in Android Studio and build. `local.properties` is generated per machine and ignored.

From this directory: `.\gradlew.bat :core-analysis:test :app:testDebugUnitTest assembleDebug --no-configuration-cache`. APK output is `app/build/outputs/apk/debug/app-debug.apk`.

Legacy SVM implementation files are historical compatibility/test code. They do not describe the active grading path. See [validation and limits](docs/ai-validation.md); software checks do not establish real-singer accuracy.
