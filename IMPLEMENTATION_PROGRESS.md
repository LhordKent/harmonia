# Defense demo implementation progress

## Piece 2: accounts, enrollment, and deployed permissions — completed 10 November 2026

### Implemented and deployed

- Reconciled the deployed institution role with one matching Firestore rule source for web and Android.
- Restricted private account/roster access by role, institution, and coach assignment, including list queries. Inactive students cannot access protected profile/practice data. Students cannot promote themselves, select institution membership, or change coach assignment.
- Enabled independent student signup as a matching user/student batch with an explicit field allowlist and verified identity. Membership and coach assignment remain staff-controlled.
- Updated web roster/session/coach queries to match the rules; preserved institution-manager account administration and admin assessment history.
- Made staff account provisioning use atomic Firestore profile pairs, preserve the signed-in administrator, and roll back the newly created Auth account on profile failure.
- Made status changes update the role/profile records together. Added validated same-institution coach assignment and platform-admin enrollment of independent students.
- Added a pending-enrollment view to the student administration screen. Independent students stay outside institution rosters until approved.
- Applied the same web role/status validation to direct login and restored sessions. Removed public first-admin setup and prototype default passwords. Existing login emails are read-only in account-edit forms to avoid presenting a profile-only edit as an Auth email change.
- Implemented the real mobile password-reset request with input, progress, failure, and truthful completion messaging. Updated mobile signup wording to describe enrollment as a request.

### Live data repair

Verified Auth/profile UID alignment before writing. Created exactly four missing documents: institutions/inst1, the existing coach's profile, and the two existing students' profiles. Preserved existing user records, Auth identities, passwords, and assignments. Re-running the repair produces no proposed writes.

The institution display name is the editable generic "Harmonia Vocal Studio" because no institution document existed. It does not assert an official institution name.

One malformed duplicate admin document has a trailing space in its ID and no matching Auth UID; it was reported and left untouched. Auth-only identities with no authoritative application role were not automatically assigned privileges.

After fixture cleanup, the live default database has five users documents, one coach profile, two student profiles, and one institution. Firebase Auth has the original nine accounts and zero remaining smoke-test identities.

### Verification actually executed

- `npm test`: **29 passing emulator tests**, using Firebase Auth/Firestore emulators and actual web provisioning/roster/assessment services. Includes positive paths, denied cross-scope access, privilege escalation attempts, signup consistency, enrollment, deactivation, rollback, and rule-copy parity.
- Android `:app:testDebugUnitTest assembleDebug`: **22 passing app tests** and a fresh debug APK, including password-reset success/failure coverage.
- `node scripts/live-account-smoke.mjs`: **eight passing live Firebase behavior checks**. Verified admin login, staff provisioning, assigned-coach isolation, student profile retrieval, wrong-password rejection, deactivation, independent signup, and admin enrollment into the coach roster. Removed the five temporary Auth identities and all their fixture document paths; cleanup verified independently.
- `npm run accounts:check`: zero pending repair writes; the malformed legacy duplicate is explicitly ignored.
- `npm run build`: passed. `npm run lint`: passed with warnings.
- Deployed Firestore rules hash matches the tested local source. Released ruleset: `4bd5bac3-64ba-42da-8c3a-f8ed5b55d31c`.
- Deployed the matching web build to https://harmonia-47c73.web.app. Verified HTTP 200 and compared the served JS bundle SHA-256 with the locally built bundle; they match (`index-BYlTVMcP.js`).

Live tests used isolated temporary credentials, not existing users' passwords. Tests exercised SDK/API behavior rather than browser automation or device UI. No computer-use tool was used. Visual layout, physical microphone capture, Android UI interaction, and password-reset email delivery were not tested in this piece.

### Files and repeatable commands

Web test runner: `WEBSITE CAPSTONE/scripts/run-emulator-tests.cjs`; test suites: `tests/accounts.rules.test.mjs` and `tests/accounts.services.test.mjs`. Run `npm test` from the web directory. Uses explicit demo-harmonia emulator endpoints and does not point tests at production.

Administrative repair: `npm run accounts:check` is read-only; `node scripts/repair-accounts.cjs --apply` creates missing records only with exists:false preconditions. Administrative scripts use the existing Firebase CLI login on this Windows machine and are outside the hosted dist directory. Before-image data and rule rollback snapshots are stored under the user's private `.codex/private/harmonia` directory, not bundled with the applications.

### Remaining work

The next piece is still the recording/upload/shared-session/coach-review return loop. Storage bucket/setup, reference-audio paths, mobile/web session and exercise schemas, sync ownership/retries, and scoring validity remain open audit findings. No pretrained model was introduced.

Web lint retains existing warnings. Dependency audit reports eight high-severity dependency advisories; no forced dependency downgrade/major migration was applied during this account repair. The historical 14 core-analysis tests were not rerun because analysis code was unchanged.

---

## Piece 1: Android build and authentication — 10 November 2026

### Completed locally

- Verified that the signed-in Firebase CLI account can access project `harmonia-47c73`, matching Android's google-services.json. Project visibility is verified; specific IAM role bindings were not enumerated.
- Corrected the machine-local Android SDK path to `C:/Users/Admin/AppData/Local/Android/Sdk` and built using Android Studio's bundled Java runtime.
- Removed login-by-local-email fallback. Bad credentials and unavailable cloud authentication now return failure rather than granting access to cached student data.
- Login reads both users and students profiles from the server and requires an active student account. It no longer overwrites cloud roles, status, or institution data at login.
- Loaded the cloud profile's display name and institution while preserving device microphone/audio/privacy preferences.
- Signed-out state now has no student identity instead of selecting the seeded student_default record.
- Registration requires Firebase success and atomic cloud profile creation before creating a local student. It no longer fabricates offline student IDs or reports success after an Auth failure. Failed profile writes attempt to remove only the Auth account created by that registration attempt and report actionable failure.
- Added an injectable authentication gateway and 11 regression tests covering cached-email bypass, network failure, cloud profile refresh, account status/role, persistence failure, registration failure, logout, and cancellation.

Changed application files:

- `HarmoniaAppMobile/app/src/main/java/com/harmonia/app/data/repository/AuthRepository.kt`
- `HarmoniaAppMobile/app/src/main/java/com/harmonia/app/data/repository/StudentAuthGateway.kt`
- `HarmoniaAppMobile/app/src/test/java/com/harmonia/app/AuthRepositoryTest.kt`
- `HarmoniaAppMobile/local.properties` (machine-local, ignored by Git)

### Verification

Command, from HarmoniaAppMobile with JAVA_HOME pointing at Android Studio's jbr:

```powershell
.\gradlew.bat :app:testDebugUnitTest assembleDebug --no-configuration-cache --console=plain
```

Result: BUILD SUCCESSFUL. All 21 app unit tests passed (11 new authentication tests plus 10 existing tests). Debug APK: `HarmoniaAppMobile/app/build/outputs/apk/debug/app-debug.apk`.

The existing 14 core-analysis tests passed during the preceding audit. Those tests were not rerun in this piece because the analysis module was unchanged.

No live login/registration, account provisioning, rule deployment, or physical-device UI test was performed. Gateway unit tests substitute cloud calls and do not establish that deployed permissions support every path.

### Live Firebase findings for the next piece

Read-only inspection of deployed Firestore rules found an `institution` role and associated permissions absent from both checked-in rule copies. Do not deploy either local copy as the authoritative baseline before reconciling this difference.

The deployed users-create rule permits admins and institution-managed coach creation, but not student self-registration. As a result, the newly honest registration path will report an enrollment-permission error until enrollment rules/workflow are reconciled. It no longer disguises this failure as a successful offline account.

The default Firestore database's institutions collection returned no documents during inspection. No records were written. Firebase project ownership grants infrastructure access, not an application admin profile automatically.

Initial login now requires a connection to verify current status. Recording and local analysis remain available after a successful login while the app session stays active; authenticated offline session restoration across app restarts is not implemented in this piece.

### Next piece

1. Reconcile local Firestore rules with deployed institution permissions; add permission tests for enrollment and staff/student boundaries.
2. Establish the institution and role profiles needed for demo accounts through a trusted provisioning path.
3. Exercise real login/registration against the intended rules, then address the shared student/session/exercise schemas and sync loop.

Remaining audit findings are tracked in SYSTEM_AUDIT.md; this piece does not resolve the overall system security or demo readiness assessment.

## Supabase audio integration — November 10, 2026

Completed the recording-storage piece. This does not mark the entire defense workflow finished.

- Created Harmonia Audio (`ztrnmbtdaruyffjqjejz`) in the user-selected LhordKent organization, Singapore region. The organization reports `plan: free` and `tier: tier_free`.
- Deployed a private `harmonia-audio` bucket with an 8 MiB per-file limit and audio MIME allowlist. No public/anonymous Storage access policies were added.
- Deployed the `audio` Edge Function. It validates Firebase ID tokens through Google, requires active profiles, and uses the caller's Firebase token when reading protected student records. Supabase's service-role credential stays in the function environment.
- Playback links expire after five minutes. Previously issued links remain usable until expiry; new links use current coach assignments and account status.
- Android sync now uploads WAVs through Supabase and stores durable references in Firestore. Pending attempts/results/reports are filtered to the signed-in student's UID; signing out no longer substitutes another local account's UID for uploads. Local WAV files remain available locally.
- Web reference uploads and student-recording playback now use Supabase, including clear upload/playback errors and support for existing HTTPS references. Removed the mock upload fallback and unused Firebase Storage initialization/dependency.
- Stored the public function endpoint in `appConfig/audio` with active-account reads and admin-only writes. No secret keys are stored in the apps or Firestore. The endpoint configuration script backs up its prior document outside the workspace.
- Preserved the preceding scoring changes: short/sparse recordings cannot pass; the result screen distinguishes insufficient audio from no detected voice. Both rule copies accept the insufficientAudio status for syncing.
- Deployed the updated Firebase rules and website. The hosted JavaScript hash matches the final local build (`/assets/index-DWiZK7Nc.js`).

Verification:

- 14 local Edge Function tests passed.
- 31 Firebase Auth/Firestore emulator rules and service tests passed.
- 9 live checks passed against real Firebase and deployed Supabase: WAV upload, immutable retry, byte-identical student/coach playback, unauthorized/private URL denial, reference audio, immediate reassignment enforcement, actual web audio service configuration/upload/playback, and inactive-account denial.
- All 5 temporary Auth accounts, 7 fixture documents and 3 audio objects from the final smoke run were removed. Independent checks confirmed 0 Storage objects and 0 audio-test identities/profiles remaining; original counts remain 9 Auth accounts and 5 user profiles.
- 23 Android app tests and 18 core-analysis tests passed; the debug APK rebuilt successfully.
- Website production build and lint passed (existing warnings remain). Supabase's security advisor returned no findings.

No physical Android microphone/UI test was performed. The remaining session-schema normalization, recording lifecycle issues, and coach-feedback return path still need their own work. This integration does not establish full-system defense readiness.

Implementation and deployment notes: `supabase/README.md`. APK: `HarmoniaAppMobile/app/build/outputs/apk/debug/app-debug.apk`.

## Coach feedback return flow — November 10, 2026

Completed the coach-review return path and verified the real Android implementation against the live backend.

- Normalized Android session fields for the web dashboard: original pitch/tone scores, recorded date, audio reference and estimated verdict. Coach corrections use separate fields, preserving the original analysis.
- Session review saves include validated scores, feedback, reviewer identity and server review time. Firestore permits authorized staff reviews while denying student-forged verdicts, changes to machine scores and forged review provenance.
- Android now saves the attempt, analysis and dashboard session atomically. A retried upload reads existing documents without overwriting them, including coach reviews. Pending analysis from a partially acknowledged older sync is retried too.
- Added separate local review fields and a table for the latest finalized general assessment. Added a non-destructive Room migration from version 4 to version 5; removed the destructive migration fallback.
- Results display live session-specific coach notes/corrections and the latest finalized general assessment. Original practice estimates remain visible separately. Listener subscriptions stop with the screen; saved feedback remains readable offline. Draft general assessments are never exposed to students.
- Added sync on login and a periodic refresh while keeping ownership checks on background work. A signed-out worker does not upload cached accounts' recordings.
- Deployed both the reconciled Firebase rules and updated website. Updated Android APK is available at `HarmoniaAppMobile/app/build/outputs/apk/debug/app-debug.apk`.

Verification:

- 35 Firebase emulator rules/service tests passed, including the actual website review service, student-readable finalized assessments, draft denial, original-score preservation and transaction retries after review.
- 26 Android JVM unit tests passed, including review parsing/validation.
- Two instrumented Android tests passed on a headless Pixel 7 API 35 emulator. One opened a real SQLite V4 database through the Room V5 migration. The other ran the actual SyncWorker to upload a real WAV to Supabase and publish its session, then used the actual web services to save coach feedback and a finalized assessment. Android's actual listeners persisted and displayed the feedback. An actual second worker run after review preserved the remote review timestamp and text. Offline reads retained the downloaded feedback.
- Compose UI assertions confirmed the review heading, feedback and corrected scores were visible. Captured and visually checked the rendered screen at `artifacts/coach-review-android.png`.
- The separate SQLite migration check preserved saved rows in all 16 original tables and matched the generated Room V5 schema.
- Production website build and lint passed; existing unrelated lint warnings remain.
- The live test removed its three temporary identities, nine document paths, uploaded WAV and local credential asset. Verified the original five user profiles and nine Auth identities remain, with no native-test accounts; Supabase Storage returned zero remaining objects after cleanup.

This verifies generated-WAV upload, review synchronization, caching and results rendering on an emulator. It does not verify singing through a physical phone microphone. Remaining recording lifecycle, exercise-schema/reference playback and full defense rehearsal work are separate from this completed review flow.

Reproduce the live native check with `node scripts/native-review-smoke.mjs` from the website directory after starting the configured emulator on port 5580. It uses only disposable test accounts and the existing trusted Firebase CLI owner login. Local SQLite migration check: `python HarmoniaAppMobile/scripts/test_review_migration.py` after building the Android app.

## Recording reliability and defense rehearsal — November 10, 2026

Completed the four planned demo-path tasks: recording lifecycle, exercise/reference compatibility, truthful statistics, and a full automated rehearsal.

- Replaced the recorder's shared mutable sample list with a single-writer PCM capture session. Stop waits for capture completion; repeated stops return one WAV. Startup/read failures release the input and report errors instead of falsely claiming recording is active or spinning on read errors. Partial reads clear the old frame tail.
- Added microphone cleanup on practice/calibration disposal and foreground loss. The record button is disabled during analysis/save. Calibration requests microphone permission, uses raw input, and creates no persistent WAV. Applied calibration gain consistently to the live signal and saved PCM, clipping safely instead of wrapping 16-bit samples.
- Limited capture to 90 seconds at 44.1 kHz mono PCM; automatic analysis at the limit keeps the WAV below the 8 MiB upload cap. Actual sample duration is used in saved metadata.
- Saved attempt, analysis and progress rollup in a Room transaction. Cancellation cleanup checks whether the WAV is referenced by committed data before deleting it. Auxiliary progression/badge errors no longer make a successfully saved recording appear lost.
- Unified web/mobile exercise duration, target frequency/note and tier fields. Invalid or missing targets are rejected rather than silently replaced with A4. Supported whole-second durations are 3–90 and target frequencies match the detector's 65–1050 Hz range. Coach exercises are accessible in the library; reference audio is retained and authenticated native playback is available before recording. The optional tone centroid is labeled as a coach reference, separate from automatic signal-clarity estimates.
- Removed fabricated initial dashboard/profile/progress values, the empty-history 82.5/75 percent defaults, forced minimum streak, fixed positive weekly-change claim and website trend interpolation. Totals use the recorded history; weekly trends are chronological and unrecorded web weeks have no plotted score.
- Progression now respects the analyzer's pitch requirement even when the composite score exceeds 70. Saved pitch-graph samples cover the whole recording instead of truncating its first 100 frames.
- Delayed the periodic refresh's first run so a login/practice-triggered sync does not immediately start a duplicate upload.

Verification:

- 40 Android JVM tests passed, including seven recorder cases, three statistics cases, three exercise-mapping cases and the progression regression; the 18 core-analysis tests also pass.
- 36 Firebase rules/service emulator tests passed. Additional boundary checks confirm the exercise validator matches the detector range.
- Two Android instrumented tests passed on the final code on a headless Pixel 7 API 35 emulator: real AudioRecord startup/PCM capture/stop/reopen, and the complete defense rehearsal.
- The rehearsal logged in through real Firebase, imported a real website-created C4 exercise, downloaded and played its private Supabase reference, operated the actual Practice screen with generated C4 PCM, ran the real on-device analyzer (100 percent pitch accuracy), committed local data, uploaded through the actual worker, saved a coach correction/general assessment through actual website services, displayed the feedback on Android and verified offline persistence.
- A final rehearsal initially timed out because the Compose test clock was not mounting ResultsScreen before waiting on its Room flow. Adding an explicit screen-idle wait resolved the test harness issue; no production listener workaround was needed. The final run passed with only the intended immediate sync.
- Website production build/lint passed (existing unrelated warnings remain), and Hosting was deployed. Verified the hosted asset matches the final local build: `/assets/index-xMmH_sF7.js`.
- Verified cleanup: 5 original user profiles, 9 original Auth identities, no native-test identities, zero cloud exercises/sessions and zero Supabase objects. Temporary credential assets were removed.
- The V4-to-V5 SQLite migration check still preserves records in all 16 original tables and matches the generated Room schema.

Artifacts: `DEFENSE_DEMO_CHECKLIST.md`, `artifacts/defense-rehearsal-android.png`, and `HarmoniaAppMobile/app/build/outputs/apk/debug/app-debug.apk`.

The scoring rehearsal uses generated audio for repeatable assertions. Human singing through a physical phone microphone in the presentation room remains unverified. This completes the tested demo path; it does not close every finding in SYSTEM_AUDIT.md or establish production readiness.


## Pretrained AI, melody grading and coach-controlled progression — 10 November 2026

Implemented pinned SwiftF0 inference on Android and in a web worker, versioned difficulty-specific grading and experimental clarity/steadiness scores, scale/song target authoring and approval, ten-minute disk recording with private M4A uploads, recoverable local audio, and explicit coach advancement approval. Preserved original grades and review separation through Room V6 migration and Firestore rules. Fixed a stale bootstrap-control reference that crashed the browser login page.

Verification: 23 core JVM tests, 43 app JVM tests, 43 Firebase/rules/contract tests, seven distinct native checks, and the real-browser target-publication workflow passed. Actual private AAC upload/playback, coach corrections, approval, mobile feedback and offline cache passed with disposable fixtures, subsequently removed. Ten-minute synthetic analysis took 20,589 ms on the dedicated API 35 emulator. Final web/rules deployment and hosted-byte verification passed; the main APK contains no temporary test credentials.

See AI_IMPLEMENTATION_STATUS.md for the exact artifact checksum, deployed script, evidence and remaining limits. No real-singer accuracy percentage or expert-calibrated tone accuracy has been established. No model training, paid inference, billing upgrade, payment feature or permanent demo-account provisioning was performed.
