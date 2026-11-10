# Harmonia

Android vocal practice and a web portal for coaches and administrators. This repository contains the current defense implementation, the shared backend rules, the private-audio service, and a plain-language defense guide.

**Live website:** https://harmonia-47c73.web.app

## Clone and run

```powershell
git clone https://github.com/LhordKent/harmonia.git
cd harmonia
powershell -ExecutionPolicy Bypass -File .\setup.ps1 -StartWeb
```

Install **Node.js 24 LTS** first (Vite requires a compatible recent Node version; >=22.12 is accepted by this setup). The script runs `npm ci` using the committed lockfile, then starts Vite. On macOS/Linux, run `cd "WEBSITE CAPSTONE" && npm ci && npm run dev` with a supported Node version.

The Firebase web configuration, Android `app/google-services.json`, Gradle wrapper, pinned SwiftF0 model, and model license are included. **No `.env` copy, model training, Supabase service-role key, or Firebase owner credential is required to run the existing clients.** Public client configuration identifies the shared Firebase project; access is enforced by Authentication, Firestore rules, and the audio function. This clone connects to the existing live backend. Use authorized accounts and avoid editing real users during testing.

Dependencies and installed toolchains are required; `.gitignore` cannot install them. First installation requires internet. The repository does not contain user passwords, recorded student audio, signing keys, database exports, or cloud administrator sessions.

### Android

Install current Android Studio and SDK Platform **37**. The app supports Android **10/API 29 or later**. The current successful local build used Android Studio's JBR/JDK 25, Gradle 9.5.0 and AGP 9.3.2; `setup.ps1` locates Android Studio's bundled Java and the normal Windows SDK directory, or respects `JAVA_HOME` and `ANDROID_HOME` / `ANDROID_SDK_ROOT`.

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1 -Android
```

This also installs web dependencies and writes ignored, machine-specific `local.properties` if missing. SDK packages/licenses and any Gradle downloads must be available. Alternatively open `HarmoniaAppMobile` in Android Studio, let it resolve the SDK, then build. Output: `HarmoniaAppMobile/app/build/outputs/apk/debug/app-debug.apk`. Large generated APKs are excluded from Git.

### Accounts

Students register in Android. The web portal accepts active staff accounts (admin, institution manager, coach). Administrators/institution managers provision staff through authorized account-management flows. There is no public administrator signup. A Firebase project-owner invitation alone does not create an application administrator profile. Obtain your own authorized login; no shared password is included here.

## What actually runs

- **One pretrained neural pitch model:** SwiftF0, pinned to revision `d1ba77fe5331310b778ebe126b6cb3656d41d24f`. It runs locally in Android and in a browser worker for proposed reference notes. No project-specific training or paid inference API.
- **Experimental tone indicator:** a programmed clarity/steadiness formula, not a second trained model or a validated artistic/clinical assessment.
- **Four practice types:** single notes, scales, solo songs with approved timed notes, and unscored free vocalising.
- **Grading:** Beginner +/-50 cents/pass 60%; Intermediate +/-35/pass 70%; Advanced +/-25/pass 80%. Composite 60% pitch/40% tone; both components must also meet the pass mark. Missing measurements are unavailable, not zero.
- **Coach authority:** automatic passing does not unlock the next exercise. Explicit assigned-coach/admin advancement approval is required. Corrections are preserved separately from original evidence.
- **Local and cloud:** Room V6 holds recordings/results/received feedback on Android. Firebase Auth handles identity; Firestore stores shared records; a Firebase-token-verifying Supabase function manages private audio. Firebase Storage is not used by the active audio path.
- **Limits:** solo voice, 65-1050 Hz, up to ten minutes, 8 MiB per cloud audio file, finite free-service quotas. No payment gates currently. Real-singer 80-90% accuracy has not been established.

## Repository map

| Location | Purpose |
| --- | --- |
| `HarmoniaAppMobile/` | Kotlin/Compose Android app, core grader, JVM/device tests, Room migrations |
| `WEBSITE CAPSTONE/` | React/Vite staff portal, browser model worker, Firebase rules/services/tests |
| `supabase/` | Private audio function, migration and authorization tests |
| `output/pdf/harmonia-defense-cheatsheet.pdf` | Plain-language guide, defense answers, demo and recovery steps |
| `docs/defense-cheatsheet.md` | Editable guide content |
| `scripts/build_defense_pdf.py` | PDF generator (ReportLab) |
| `AI_IMPLEMENTATION_STATUS.md` | Recorded release evidence and known limits |
| `HarmoniaAppMobile/docs/ai-pipeline.md` | Current architecture and scoring explanation |
| `HarmoniaAppMobile/docs/ai-validation.md` | Test evidence and evaluation still needed |

`SYSTEM_AUDIT.md`, `NEXT_STEP_PLAN.md`, and earlier portions of `IMPLEMENTATION_PROGRESS.md` are historical records, not claims about the current build. The inherited manuscript is deliberately omitted from this source export; it has not been revised to match the new implementation.

## Verification

```powershell
# Web build, lint and isolated Firebase emulator tests (requires Java + Firebase CLI)
cd "WEBSITE CAPSTONE"
npm ci
npm run build
npm run lint
npm test

# Android from the mobile directory, with JAVA_HOME and SDK configured
cd ..\HarmoniaAppMobile
.\gradlew.bat :core-analysis:test :app:testDebugUnitTest assembleDebug --no-configuration-cache

# Private-audio unit checks from repository root
cd ..
node --test supabase/tests/audio.test.mjs
```

Recorded release checks passed: 23 core JVM tests, 43 app JVM tests, 43 Firebase tests, seven distinct Android checks across focused runs, browser model extraction and a separate live private-audio/review rehearsal. Those establish implementation behavior, not measured accuracy on real singers. See the validation document for prerequisites for browser/device tests.

**Live test scripts** (`live-*`, `native-review-smoke.mjs`) create temporary data in the real project using a separately authorized Firebase CLI owner session. They are deliberate maintenance tools, not part of clone/startup, and must not be run against another client's data without authorization.

## Deployment and ownership

Running clients needs no owner session. Deploying rules/hosting, changing cloud audio configuration, and provisioning privileged identities requires separately authorized Firebase/Supabase access. Never commit service-account JSON, service-role keys, Auth refresh tokens, passwords, `.env`, keystores or generated test credentials. Free plans have finite capacity and availability constraints; no perpetual-free production promise is made.

The source is private client work; no new blanket open-source license is asserted. SwiftF0's MIT license and attribution are included next to both model copies. Other dependencies retain their own licenses.
