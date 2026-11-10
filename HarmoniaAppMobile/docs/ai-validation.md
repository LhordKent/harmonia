# AI validation and release evidence

The production pitch estimator is pretrained SwiftF0, pinned to revision
`d1ba77fe5331310b778ebe126b6cb3656d41d24f`. No Harmonia training or fine-tuning has been performed.
The shipped model's SHA-256 and license are in `app/src/main/assets/models/manifest.json`.

## What automated tests establish

- JVM inference is compared frame-by-frame with the pinned author's Python implementation, including silence and a 30-second processing boundary.
- Pitch preservation is tested at 16, 44.1 and 48 kHz. Tests reject a substituted model artifact.
- The same bundled model is exercised on Android with generated harmonic audio.
- Grader tests cover difficulty policies, wrong octaves, missing audio, clipping, rests, omitted phrases and free practice.
- A ten-minute WAV is encoded on Android and verified as a playable AAC container below the existing 8 MiB storage limit.
- Android SQLite migration preserves original scores and coach feedback while adding versioned grading fields.
- Firebase emulator tests reject student-forged advancement and unauthorized coach approval.
- Browser tests exercise actual local model inference and target publication; their private audio transport is mocked explicitly.
- The live native rehearsal separately tests actual Firebase/Supabase upload and coach review. All identities and records used by that rehearsal are disposable.

These are software/integration checks. Synthetic audio is not evidence of a 90% real-singer success rate.

## Evaluation still required before an accuracy claim

Use independent, appropriately licensed audio with frame-level pitch annotations. Split by singer/source recording, not randomly by frame. Exclude known training overlap from claims about unseen data. Match timestamps before comparison.

Report correct pitch within 50 cents over ALL annotated voiced frames, including model misses; also report false voiced detections, octave errors, per-recording results, recording counts, singer counts, and performance on the intended physical phone. Do not calculate accuracy only over frames the model chose to voice. Report grade availability as well as correctness so rejecting difficult recordings cannot inflate the result.

Aim for at least 90% correct voiced-frame pitch on the stated test conditions. Do not describe that as 90% accuracy on all singing, a calibrated probability, or agreement with vocal coaches.

Tone scores are experimental clarity/steadiness indicators. Their numerical mappings are engineering defaults, not a fitted expert rubric. Public synthesis-quality MOS labels do not validate student technique grading. Coach-rated local examples are needed to establish agreement with vocal coaching judgments.

## Reproduce

1. Run `gradlew :core-analysis:test :app:testDebugUnitTest assembleDebug` with the project's JDK.
2. Run `python scripts/generate_pitch_parity.py` only when intentionally reproducing the checked-in golden fixture (numpy/onnxruntime required).
3. On an Android emulator/device, run `NativeAiInstrumentedTest` and the migration method in `CoachReviewInstrumentedTest`.
4. In the web project run `npm test` for emulator-backed rules/services/contracts.
5. Run Vite on localhost port 5174, then `node scripts/run-emulator-tests.cjs --browser` for the browser test. Playwright and Edge are required.
6. For the isolated live integration test, start an emulator on port 5580 and run `node scripts/native-review-smoke.mjs --defense` in the web project. It requires the existing trusted Firebase owner CLI session and cleans up its test identities, documents and audio.
