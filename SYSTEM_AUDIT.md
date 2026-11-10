# Harmonia system audit

Audit date: 10 November 2026. Scope: Android/Kotlin application, core audio analysis, React dashboard, Firebase rules/configuration, existing tests, and relevant requirements in the supplied proposal. This is a source and local-build audit, not a certification of the deployed Firebase project or real-device audio accuracy. No application source or deployed resources were changed.

## Assessment

The project has substantial reusable implementation, but it is not ready for a reliable end-to-end demonstration with real student data. Integration and authentication defects are more urgent than model training. Replacing a model alone will not fix the disconnected mobile/web workflows.

The audio engine already runs without training at runtime: it uses Kotlin YIN pitch detection, custom acoustic measurements, and two embedded linear classifiers. No executable training pipeline, labeled dataset, model export artifacts, held-out evaluation, or supporting benchmark recordings were found in the supplied source tree. This does not prove the coefficients were never trained elsewhere; their provenance and reported accuracy cannot be established from this handoff.

## Priority findings

P1 means a security, correctness, or integration blocker. P2 means a significant functional or reliability defect. References are relative to the CAPSTONE directory and use one-based source lines.

### 1. P1: Mobile login bypasses password verification

`HarmoniaAppMobile/app/src/main/java/com/harmonia/app/data/repository/AuthRepository.kt:148-156`

Any Firebase sign-in failure, including an incorrect password or disabled account, falls through to a Room lookup by email. If that email exists locally, login succeeds without checking the supplied password or a stored credential. Cloud access may still be denied by Firebase, but local student history and practice functionality become accessible. The database seeds a known student as well. Restrict offline access to a previously authenticated session with an explicit local unlock mechanism; never translate an authentication rejection into a successful offline login.

### 2. P1: Mobile sessions and dashboard sessions have incompatible schemas

`HarmoniaAppMobile/app/src/main/java/com/harmonia/app/data/sync/SyncWorker.kt:102-115`; `WEBSITE CAPSTONE/src/pages/Students.jsx:1088-1109`; `WEBSITE CAPSTONE/src/pages/Reports.jsx:79-88`; `WEBSITE CAPSTONE/src/firebase/feedbackService.js:64-67`.

| Mobile writes | Dashboard expects | Effect |
| --- | --- | --- |
| accuracyScore | pitchAccuracy | Missing/NaN scores or misleading zero feedback |
| toneScore | toneAccuracy | Missing/NaN scores or misleading zero feedback |
| createdAt, numeric milliseconds | timestamp | Invalid dates and sessions excluded from date filters |
| audioStoragePath, download URL | audioStorageRef | Recording playback receives undefined |
| No aiVerdict | aiVerdict | Blank AI verdict; confirmation tries to write undefined |

Session reads return raw Firestore documents without normalizing these fields. A local probe invoking the actual pure feedback function with a mobile-shaped record containing pitch 95 and tone 90 produced feedback saying pitch 0%, tone 0%. Confirming its absent AI verdict also constructs an undefined field, which the current Firestore configuration does not enable ignoring. Establish one canonical session contract, migrate or normalize existing records, and test the full record-to-dashboard flow.

### 3. P1: Mobile student registration does not create a usable web roster entry

`HarmoniaAppMobile/app/src/main/java/com/harmonia/app/data/repository/AuthRepository.kt:46-56,125-141,194-207`; `WEBSITE CAPSTONE/src/firebase/firestore.js:138-147`.

The mobile student profile push omits institutionId and coachId and writes fullName instead of the web's name/firstName/lastName fields. The web queries students by institutionId or coachId, so a newly mobile-registered student is absent from those rosters. Even though a separate users document can carry institutionId, those queries target students. A web-created student logging in on a fresh phone is instead initialized from Firebase Auth displayName/defaults without loading the existing student profile; local institutionId is then null, so uploaded sessions receive an empty institutionId and disappear from institution session queries. Load the authoritative student profile at login and standardize enrollment/profile fields.

### 4. P1: Exercise creation is blocked by Storage rules, then incompatible with mobile

`WEBSITE CAPSTONE/src/pages/Exercises.jsx:119,166-174,190-199`; `WEBSITE CAPSTONE/storage.rules:87`; `HarmoniaAppMobile/app/src/main/java/com/harmonia/app/data/sync/SyncWorker.kt:188-204`.

New exercises require uploaded reference audio. The web uploads to reference_audios/{file}, while the supplied rules allow exercise audio only under exercises/{exerciseId}/{fileName}. There is no rule allowing reference_audios, so deployment of these rules makes creation fail at upload.

After that is fixed, the web still writes tier, duration, targetPitchData, targetToneData, and referenceAudioRef; mobile reads difficultyLevel, durationSeconds, targetFrequencyHz, targetNote, and orderIndex. Consequently web exercises default to Foundations/A4/440 Hz/15 seconds/order 0. New exercises with order 0 also default to locked because availability starts at orderIndex 1. The mobile pull omits reference-audio fields, and the practice screen has no guide-audio playback implementation. Align the schema, ordering, target definition, and reference playback together.

### 5. P1: Coach confirmation is not an end-to-end workflow

`WEBSITE CAPSTONE/src/pages/Students.jsx:167-200,930-950`; `WEBSITE CAPSTONE/src/firebase/feedbackService.js:246`; `HarmoniaAppMobile/app/src/main/java/com/harmonia/app/data/sync/SyncWorker.kt:131-213`; `HarmoniaAppMobile/app/src/main/java/com/harmonia/app/ui/screens/ResultsScreen.kt:115`.

Web session corrections update the flat practiceSessions collection. Structured evaluations go into coachAssessments. The mobile worker uploads nested analysisResult documents but never downloads either coach assessments or corrected sessions. Mobile results read only Room and always display the pending-coach badge. Progression unlocks immediately from the original machine score in PracticeScreen.kt:442, so a coach's repeat-exercise verdict has no effect. Define how advisory practice scores and official coach evaluations coexist, sync them back, and implement the agreed progression policy.

### 6. P1: Firebase rules do not enforce the advertised coach/institution boundaries

`WEBSITE CAPSTONE/firestore.rules:84,114,198-201,210-223` and corresponding mobile rules.

Although individual student/session get rules check coach assignment, collection list permissions allow every active coach to query students and practiceSessions broadly. A caller can enumerate other students by issuing list queries instead of get requests. Any coach can update any flat practiceSession, and assessment/feedback creation checks only that coachId equals the caller, not that the student is assigned to them. Institution scoping is also absent from staff authorization checks. UI filtering cannot enforce these boundaries. Bind list queries and writes to assignment/institution constraints and test negative cases in a rules emulator.

### 7. P1: Account deactivation and final verdict protection are incomplete

`WEBSITE CAPSTONE/firestore.rules:117-140,194-201`; `HarmoniaAppMobile/app/src/main/java/com/harmonia/app/data/repository/AuthRepository.kt:125-141`.

Student ownership permissions do not check student active/deleted status. A disabled application profile with a still-valid Firebase Auth session can continue writing attempts and uploading recordings. Mobile login does not load/check the authoritative users status. Deleting a student parent leaves ownership-based subcollection writes possible. Students may also create nested analysis results with any initial verdictStatus/coachVerdict, and can modify machine scores after review because only two verdict fields are protected. These rules do not make results authoritative. Enforce status and initial allowed fields, freeze reviewed machine evidence, and explicitly distinguish untrusted client measurements from coach decisions.

### 8. P1: Sync can upload one student's recording into another student's Storage namespace

`HarmoniaAppMobile/app/src/main/java/com/harmonia/app/data/sync/SyncWorker.kt:54-66`; `HarmoniaAppMobile/app/src/main/java/com/harmonia/app/data/local/dao/Daos.kt:120`.

The worker loads unsynced attempts across all local students, then uses the currently signed-in Firebase UID for the recording path. If student A has a pending attempt and student B signs in, A's audio is uploaded under B before the subsequent Firestore write for A is rejected. Filter all work by the authenticated owner, reject UID mismatches before upload, and partition/cancel work appropriately on account changes.

### 9. P1: Flat session sync cannot safely retry partial writes

`HarmoniaAppMobile/app/src/main/java/com/harmonia/app/data/sync/SyncWorker.kt:116-128`; `WEBSITE CAPSTONE/firestore.rules:200-201`.

Students may create flat sessions but cannot update them. If the remote create succeeds and the worker/process stops before markSynced, the next merge becomes an update, is denied, and retries indefinitely. Make creation retries idempotent without allowing students to overwrite coach review fields. Persist upload state/URLs and define conflict handling rather than replaying mutable machine verdicts.

### 10. P1: Scoring claims exceed available evidence

`HarmoniaAppMobile/core-analysis/src/main/kotlin/com/harmonia/analysis/svm/SvmClassifier.kt:69-71,101-149`; `HarmoniaAppMobile/docs/ai-pipeline.md`, sections 3 and 5.

The code applies a plain sigmoid to an SVM margin and calls it calibrated Platt probability, then labels that value accuracy and uses it to unlock exercises. There are no fitted calibration parameters or calibration records. SVM class probability is also not the percentage of time sung in tune. The documentation's numerical agreement and latency claims lack a runnable reference comparison or benchmark fixture in the handoff. Remove unsupported claims or supply their original artifacts; show directly defined pitch measurements separately from any model confidence. Scikit-learn documents calibration as a fitted procedure: https://scikit-learn.org/1.5/modules/svm.html#scores-and-probabilities.

### 11. P2: Tone features do not implement the claimed cycle-level measurement

`HarmoniaAppMobile/core-analysis/src/main/kotlin/com/harmonia/analysis/dsp/VoiceQualityExtractor.kt:36-49,74,100-107,126,157`.

Jitter compares pitch estimates from overlapping frames, not individually located glottal cycles. Shimmer uses fixed windows based on the clip's average pitch period instead of tracking cycle boundaries. Short inputs receive hardcoded healthy baselines. HNR analyzes only the first 4096 samples, about 93 ms at 44.1 kHz, so leading silence can dominate the tone feature despite a good later sustain. These implementation choices invalidate the unqualified Praat-equivalence claim and weaken the meaning of a tone percentage. Treat current outputs as experimental indicators, implement/validate the intended measurements, or let the coach assess tone.

### 12. P2: Very brief voiced sounds can pass long exercises

`HarmoniaAppMobile/core-analysis/src/main/kotlin/com/harmonia/analysis/PitchToneAnalyzer.kt:106-139,166-167`; `HarmoniaAppMobile/app/src/main/java/com/harmonia/app/ui/screens/PracticeScreen.kt:429-446`.

Pitch statistics exclude unvoiced frames and there is no minimum voiced coverage or exercise-duration requirement before passing. A probe against the freshly compiled core reproduced this: a 0.2-second 440 Hz sine scored 99.51% and passed; a 15-second clip containing that tone followed by silence scored 99.51% and also passed. Stability is computed on absolute cents errors, hiding alternation between equally sharp and flat errors; onsetLatency is first detected voice rather than first stable correct pitch. Add minimum usable audio/voiced duration, duration completion, and correct metric definitions.

### 13. P2: Sign-up can falsely succeed and strand local practice under a non-cloud ID

`HarmoniaAppMobile/app/src/main/java/com/harmonia/app/data/repository/AuthRepository.kt:180-214`.

All Firebase registration errors are converted into successful local registration, including email-in-use and invalid credentials. The generated student_* ID is not a Firebase UID. No later migration links that identity, recordings, results, and progression to a real authenticated account. Fail clearly for authentication errors; make any offline guest mode explicit and provide a controlled migration.

### 14. P2: The two Firestore rule copies disagree; initial admin bootstrap cannot work under these rules

`WEBSITE CAPSTONE/firestore.rules:86`; `HarmoniaAppMobile/firebase/firestore.rules:86-90`; `WEBSITE CAPSTONE/src/firebase/seedAdmin.js:15-25,55-68`.

The web rules allow users creation only by an existing admin; mobile additionally allows constrained self-registration as student. Deploying the web configuration blocks mobile users-document creation. Both prohibit the initial browser admin bootstrap: its existence query is unauthorized before login, errors are interpreted as admin-exists, and a first admin cannot write an admin role while unauthenticated. Establish one rules source and a trusted administrative provisioning command/process; do not reopen public admin creation.

### 15. P2: Coach assessment reads are incompatible with their security rules

`WEBSITE CAPSTONE/src/firebase/feedbackService.js:186-239`; `WEBSITE CAPSTONE/firestore.rules:219-223`.

Non-admin coaches may read only assessments whose coachId is theirs, but getCoachAssessment and history query only studentId. The query does not guarantee the required coachId condition; retrying without orderBy does not solve authorization. Failures are swallowed into null/empty history. Add the authorized scope to the query and the necessary indexes; current indexes contain no coachAssessments or coachFeedback ordered-query definitions. Verify actual deployed indexes separately.

### 16. P2: Notifications and badge management are disconnected across clients

`WEBSITE CAPSTONE/src/pages/Students.jsx:309-318`; `WEBSITE CAPSTONE/src/pages/Settings.jsx:146-163`; `HarmoniaAppMobile/app/src/main/java/com/harmonia/app/data/repository/NotificationRepository.kt:12-41`; `HarmoniaAppMobile/app/src/main/java/com/harmonia/app/data/sync/SyncWorker.kt`.

The student reminder button only displays a success toast; it does not call a persistence or messaging service. Announcements are written to Firestore, but mobile never downloads them or top-level notifications. Local badge definitions/awards are not synchronized with web badge configuration or students.badges. Daily local WorkManager reminders are implemented, but are separate from coach messages. Implement the shared paths or clearly remove the unsupported controls from the deliverable.

### 17. P2: Settings report changes that were never applied

`WEBSITE CAPSTONE/src/pages/Settings.jsx:85-110`; `WEBSITE CAPSTONE/src/context/AuthContext.jsx:120-125`; `WEBSITE CAPSTONE/src/firebase/firestore.js:105-123,188-203`.

Password input is never sent to Firebase Auth; the UI nevertheless reports password updated. Admin profile update returns immediately because updateProfileData accepts only coaches, yet the page can report success. Admin edits to coach/student email update Firestore only, leaving the login email unchanged. Separate displayed profile data from authentication changes and implement reauthentication/admin identity updates as needed.

### 18. P2: Audio recording has resource and concurrency hazards

`HarmoniaAppMobile/app/src/main/java/com/harmonia/app/ui/audio/AudioRecorder.kt:71-86,124-140`; `HarmoniaAppMobile/app/src/main/java/com/harmonia/app/ui/screens/PracticeScreen.kt:67-68`.

Recorder startup failures are logged but the UI still enters recording state. stopRecording cancels the IO job without waiting for it to finish before converting its mutable sample list and releasing AudioRecord. PracticeScreen has no dispose/finally cleanup to release the recorder when navigating away; coroutine cancellation alone does not release the native resource. Surface startup/read failures and serialize stop/join/release/snapshot, with lifecycle cleanup and bounded recording duration.

### 19. P2: Progress data is fabricated in empty states and can be lost on upgrade

`HarmoniaAppMobile/app/src/main/java/com/harmonia/app/data/repository/PracticeRepository.kt:113,131-152,171`; `HarmoniaAppMobile/app/src/main/java/com/harmonia/app/data/local/HarmoniaDatabase.kt:84`.

No scores produces an 82.5% weekly average and 75% on missing daily points; streak is at least one even with no qualifying practice. These look like measured results. Room enables destructive migration with no schema migration path, risking deletion of unsynced practice history on database version changes. Display no-data states accurately and preserve offline records through migrations.

### 20. P2: Saved evidence is incomplete and multi-record writes are non-atomic

`HarmoniaAppMobile/app/src/main/java/com/harmonia/app/data/repository/PracticeRepository.kt:57-76`; `WEBSITE CAPSTONE/src/firebase/firestore.js:54-96,150-185`.

Only the first 100 pitch frames are retained, about 2.3 seconds with the current hop, even for longer recordings; voice-quality features and model version are not saved alongside the result. Attempts/results/progression are separate non-transactional writes, so failures can leave incomplete practice evidence. Web Auth creation and profile writes also lack recovery for partially provisioned accounts. Preserve complete or explicitly downsampled evidence, save algorithm/model provenance, and use transactions/batches where supported plus recovery across Auth/Firestore.

## Requirement and feature coverage

| Area | Current implementation | Remaining gap |
| --- | --- | --- |
| Recording, live pitch | Native recorder and YIN visualization exist | Lifecycle handling, failure reporting, real-device validation |
| Pitch/tone analysis | Kotlin engine and embedded classifiers exist | Model provenance, measurement/scoring validity, coverage rules |
| Exercise library | Local seeded exercises and web CRUD exist | Shared schema, audio upload/playback, ordering, remote deletions |
| Structured lessons | Entities/DAO exist | No complete lesson authoring and student lesson workflow found |
| Practice history/reports | Room history, React charts and CSV/print controls exist | Shared metrics/dates, complete evidence, cloud restore |
| Coach review | Web correction and assessment UI exists | Permission/query fixes and return sync to mobile |
| Achievements | Local criteria and awards exist | Web configuration and earned-badge synchronization |
| Notifications | Local reminders exist | Actual coach delivery and announcement consumption |
| Privacy settings | Local flag and institution configuration exist | No propagated research opt-out/retention enforcement path found |
| Payments/subscriptions | Data entities/rules exist | No working billing/access lifecycle found; keep out of immediate delivery unless required |

Remote exercise synchronization only upserts; deleted cloud exercises remain locally. It fetches all exercises without institution/coach filtering and is triggered only when a practice is completed, so a new installation does not receive the coach library before its first attempt. The current analyzer compares an entire recording to one fixed target frequency; reference pitch contours and changing-note exercises are not implemented in the scoring path.

The proposal's early objectives can be served by pitch/tone measurements and coach guidance, but its technical sections explicitly describe two trained SVMs and Python/Librosa/Parselmouth. The implementation already differs by using pure Kotlin. Any replacement with rules or a pretrained neural pitch model should be described honestly in the manuscript and agreed as a scope/architecture revision, rather than presented as the original SVM training implementation.

## Can training be avoided? Can pretrained models help?

Yes. Neither a reliable pitch tracker nor transparent cents-based scoring requires training a custom classifier. Retain YIN as the live baseline, validate it with known-frequency and real vocal recordings, and define scores using voiced coverage, cents error, sustained duration, and stability. Rule-based feedback should be labeled as automated measurement feedback. Tone indicators must not be sold as validated artistic or clinical judgments.

If a pretrained ML component is required, evaluate a published pitch model after recording while preserving YIN live feedback:

| Candidate | Published capability | Fit and integration cost |
| --- | --- | --- |
| CREPE tiny/small | Pretrained monophonic F0 and voicing confidence; vocal/instrument training data; 16 kHz input | Strong candidate for isolated singing. Official package is Python/Keras, not a verified drop-in Android SDK. Conversion/runtime integration, resampling, model licensing checks, and phone latency/accuracy tests remain necessary. |
| SPICE | Pretrained pitch and uncertainty, with an official singing example | Alternative to benchmark. Android runtime/artifact compatibility must be established before committing. |
| Spotify Basic Pitch | Audio-to-MIDI transcription with TensorFlow Lite and ONNX exports | Consider if multi-note transcription is in scope. Its transcription outputs do not supply a calibrated singing-tone score or automatically solve a real-time cents-feedback requirement. |

Official sources: [CREPE](https://github.com/marl/crepe), [CREPE inference/preprocessing](https://github.com/marl/crepe/blob/master/crepe/core.py), [SPICE](https://www.tensorflow.org/hub/tutorials/spice), [Basic Pitch](https://github.com/spotify/basic-pitch).

These are pitch/transcription models, not drop-in replacements for both the existing pitch-accuracy SVM and tone-quality SVM. Estimated F0 still needs comparison with the exercise target and a separately defined score. Confidence in F0 is not singing accuracy. A model trained on speech/noise/emotion should not be repurposed as a validated good/bad singing-tone assessor without task-specific evidence. None of the listed model integrations has been implemented or benchmarked in this audit.

## Validation performed and limits

- Web production build: passed with Vite 8.2.2. Main JS bundle about 1.34 MB before gzip; code splitting would help but is below the integration/security work in priority.
- Web lint: exited successfully with warnings, including hooks/dependencies, unused code, and backup-file warnings. This is not an automated behavior test suite; no web test script is configured.
- Executed the dashboard's actual pure feedback function against a mobile-shaped session and reproduced false zero-score advice.
- Android initial Gradle invocation failed because JAVA_HOME/PATH did not identify a JDK. A second invocation using Android Studio's bundled JDK reached project configuration, then failed because local.properties points at C:/Users/User/... rather than this machine's installed SDK under C:/Users/Admin/....
- Isolated core tests initially blocked offline by uncached dependencies; the online rerun of `:core-analysis:test --rerun-tasks --no-configuration-cache --console=plain` passed all 14 tests, freshly compiling the core and executing its tests. This verifies the existing synthetic/feature tests, not real-world singing accuracy.
- An additional temporary Java probe against the freshly compiled core reproduced the short-tone/silence passing defect in finding 12. The probe was outside the application source tree.
- Existing APK and XML test outputs were present from earlier runs; those are not fresh verification of this audit's working tree.
- Firebase deployed rules/indexes, actual project data, authentication providers, quotas, and Storage configuration were not inspected or modified. Rule findings describe the supplied local rules; no exploit was attempted against the live project.
- No physical-device microphone, background sync/account switching, UI accessibility/layout, or real-singer accuracy evaluation was executed. No unsupported medical or vocal-health conclusions are drawn from the custom acoustic metrics.

## Recommended completion order

1. Repair authentication/status enforcement and unify Firebase rules with negative permission tests.
2. Define canonical student, exercise, session, and evaluation schemas; normalize existing records and make uploads work.
3. Complete recording -> durable local result -> retry-safe owner-scoped sync -> coach playback/review -> student receives evaluation.
4. Replace unsupported percentages/benchmarks with explainable measurements; choose a pretrained pitch experiment only after this path is stable.
5. Finish the required lesson, reference-audio, notification, badge, and report paths; remove or defer controls that only simulate success.
6. Validate a small, documented set of real vocal examples against coach judgments and target-device recordings. Pretrained inference avoids training, not evaluation.

The smallest credible delivery is a reliable student recording/practice flow, interpretable pitch feedback, basic tone indicators, shared progress records, and coach review. Avoid making model integration the critical path until the basic system can demonstrate correct data flowing between both clients.
