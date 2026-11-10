# Harmonia AI implementation status

Completed implementation and automated verification: 10 November 2026.

## Delivered behavior

- One bundled pretrained SwiftF0 pitch model, pinned and checksum-verified. No training from scratch or paid inference API.
- Beginner +/-50 cents / 60%, Intermediate +/-35 cents / 70%, Advanced +/-25 cents / 80%.
- Automatic experimental clarity/steadiness scoring; rule-based, measurement-linked feedback. This is not a second trained tone model.
- Single notes, manually authored scales, coach-approved reference melodies for songs, and unscored free vocalising.
- Browser-based neural extraction of proposed reference notes, manual note editing, prerequisite cycle validation, and explicit target approval.
- Up to ten minutes of disk-backed recording; compressed private AAC/M4A uploads, legacy WAV support, retry/recovery, local replay and cached feedback.
- Versioned grading evidence, original target snapshot and settings, model hash, unavailable-score handling, and non-destructive Room migration to V6.
- Automatic scores do not complete exercises. Explicit assigned-coach/admin approval is synchronized before dependent exercises unlock. Coach corrections remain separate from original scores.
- All existing features remain free to access; no payments, subscriptions, paid hosting upgrade or cloud AI service was activated.
- Fixed a browser login crash caused by the stale administrator-bootstrap control. Public administrator bootstrap remains removed.

## Verified evidence

| Check | Result |
| --- | --- |
| Core analysis JVM tests | 23 passed, zero failures |
| Android app JVM tests | 43 passed, zero failures |
| Firebase emulator rules/services and grading contracts | 43 passed, zero failures |
| Android device checks | 7 distinct checks passed across focused runs: model, melody/rests, ten-minute encoding, ten-minute analysis, migration, native microphone, live recording/review workflow |
| Browser workflow | Actual login, neural reference extraction in a worker, target approval, and Firestore publication passed; audio transport mocked explicitly in this UI test |
| Live audio/review workflow | Actual private AAC/M4A upload, assigned-coach playback (audio/mp4 and MP4 container header verified), coach corrections, explicit advancement approval, mobile listeners, visible feedback, offline cache passed |
| Reference parity | Kotlin/JVM output matches pinned upstream Python output, including silence and the 30-second processing boundary |
| Long-clip analysis | Ten-minute synthetic recording analysed in 20,589 ms on the dedicated API 35 emulator; whole-clip trace checked |
| Migration | V4-to-V6 SQL matches generated Room schema; original rows and scores preserved |
| Web build and lint | Passed; inherited warnings remain |
| Hosting | Final hosted script bytes match the local build; hosted model checksum verified |
| Fixture cleanup | Three temporary identities per live rehearsal removed; final cloud baseline restored to 5 user documents, 0 exercises, 0 practice sessions, no temporary user profiles; local credential fixture removed |

## Build and deployment

- Website: https://harmonia-47c73.web.app
- Hosted application script: `/assets/index-DBbtIOnF.js`.
- Demo APK: `HarmoniaAppMobile/app/build/outputs/apk/debug/app-debug.apk`.
- APK SHA-256: `639B55476FB4AE2349CDE1B8E5E05A217781AC41F6999545F917B99AA0DA8EE4`.
- SwiftF0 model SHA-256: `6385e8c2ebc3872e82c9ff5946228de44cd3be77a750ea53698b7dbfe94b0a22`.
- Main APK verified to contain the correct model and no temporary credential fixture.
- Firestore approval protections and website were deployed. No Supabase service/billing change was needed for AAC because audio/mp4 was already supported.

## Practical limits

- This is not a measured 80–90% accuracy claim on real singers. Automated scoring checks use generated audio. Physical-phone singing and independent annotations/coach judgments are still needed.
- Tone scoring is an experimental clarity/steadiness indicator, not a validated assessment of vocal technique, beauty, health or artistic expression.
- Prepared solo targets and solo student recordings are required. Mixed accompaniment, automatic lyrics grading, source-identity/anti-replay verification and arbitrary song separation are not provided.
- Song recordings are limited to ten minutes, references to the existing 8 MiB upload cap, and scored pitches to 65–1050 Hz. Free cloud quotas are finite; local recordings are preserved if upload fails.
- No permanent demo identities were created and existing students were not reassigned to coaches. Assign the intended demo student through the authorized roster workflow before rehearsal.
- Existing dependency audit findings in Firebase/gRPC, Vite, re2js and source-map-js remain outside this AI implementation; no forced major-version dependency replacement was attempted.
- These changes do not close every finding in the original full-system audit.

Reproduction details: `HarmoniaAppMobile/docs/ai-validation.md`. Current architecture: `HarmoniaAppMobile/docs/ai-pipeline.md`. Demo steps: `DEFENSE_DEMO_CHECKLIST.md`.
