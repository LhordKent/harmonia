# Harmonia: AI model needs audit

> Historical audit: this records the pre-implementation findings. The pretrained pitch integration and current behavior are documented in HarmoniaAppMobile/docs/ai-pipeline.md and ai-validation.md.

Date: 10 November 2026. Scope: current Android analysis and exercise mapping, web feedback/exercise services, legacy classifiers, and existing analysis tests. This is a source audit and model suitability assessment; no runtime code or deployed service was changed. The original SYSTEM_AUDIT.md describes an earlier implementation and is not a current completion report.

## Decision

The current sustained-note practice and coach-review product requires pitch estimation, a defined comparison with the exercise target, recording-quality checks, and coach assessment. It does not inherently require two trained classifiers.

- Minimum functional system: zero trained models; measured pitch plus advisory signal indicators and coach review.
- If genuine pretrained ML is an agreed delivery requirement: evaluate ONE pretrained monophonic pitch estimator against the existing YIN baseline. Do not make unsupported tone grading the second model merely to match the manuscript.
- A trained tone assessor is a separate future research task unless an existing model has the right output rubric and relevant independent evaluation. No suitable validated tone assessor has been established by this audit.

## Current execution path

PracticeScreen constructs DefaultPitchToneAnalyzer. That analyzer calls YinPitchDetector and VoiceQualityExtractor, calculates scores directly, and chooses feedback with conditional rules. The web generateAIFeedback function similarly formats existing session statistics with rules. Neither uses an LLM or active trained classifier. The legacy pitch and tone SVM configurations remain in source and tests but are absent from the current scoring call path. Their training provenance remains unverified.

## Findings, in priority order

### 1. High: tone percentage is not a validated singing-quality grade

VoiceQualityExtractor.kt:49-59 combines hand-chosen jitter/shimmer penalties and HNR into a score clamped to 10..98. It includes hardcoded baseline feature values when too few observations exist (:74, :126). Jitter uses periods inferred from overlapping pitch-analysis frames, shimmer uses fixed windows based on the average period, and HNR reads at most 4096 samples (:157). These do not establish the claimed Praat-equivalence or a coach-calibrated tone scale.

PitchToneAnalyzer.kt:148-150 gives this tone indicator 40% of the overall score and includes it in the pass decision. Therefore an uncertain tone indicator can affect progression even when pitch is adequate. The current implementation should be described as experimental signal stability, with the coach assessing tone. Before modifying progression, define and test the resulting pitch-only/advisory policy across both clients.

### 2. High: pitched sound is not proof of student singing

YinPitchDetector measures energy and periodicity; it has no singer/source classifier. PitchToneAnalyzer treats detected pitched frames as voiced. The existing synthetic-sine test explicitly expects a passing score. This is useful for numerical testing but means a played guide tone can also satisfy the scorer. The app's reference-player/microphone mutual exclusion helps within the app but cannot prevent another device or room source from being recorded.

Do not describe the result as verified student performance or anti-cheating detection. A speech VAD or pitch neural network should not be assumed to solve source identity either. For the demo, use solo singing in a quiet room with the guide stopped; have the coach listen to the recording.

### 3. Medium: current target contract supports sustained notes, not melody assessment

exerciseModel.js and RemoteExerciseMapper.kt produce one target frequency and duration. PitchToneAnalyzer compares every frame with that single frequency. The reference audio is playable, but the analyzer does not extract and align its melody/timing/timbre with the student recording.

If scales, songs, or melodic imitation are in scope, the missing requirement is a time-varying target contour and alignment policy. Adding an SVM does not supply that contract. A pitch estimator can serve both reference and student audio; alignment and cents-error scoring can remain deterministic.

### 4. Medium: AI wording and historical documentation overstate the active implementation

feedbackService.js:40-46 explicitly implements rule-based feedback, while several strings and stored statuses still call it AI. docs/ai-pipeline.md describes two active SVMs and benchmark numbers not established by this audit. Keep historical data compatibility, but update visible claims and technical documentation to the chosen architecture before defense.

### 5. Verification gap: real-singer evaluation is still required

PitchToneAnalyzerTest covers synthetic notes, silence, short clips, sustained-duration checks, and silence penalties. Those are useful software checks, not evidence of human tone assessment accuracy. Prior automated native integration used generated audio; the separate microphone lifecycle test does not establish real singing accuracy. No new real-device or coach-rated corpus evaluation was performed in this audit.

## Which components need learned models?

| Capability | Model requirement | Decision |
| --- | --- | --- |
| Fundamental pitch estimation | DSP or learned estimator | Keep YIN baseline; optionally evaluate one pretrained estimator |
| Pitch accuracy against target | Defined cents-error calculation | No SVM required |
| Sustaining duration, silence, clipping and level checks | Signal measurements and rules | No trained model required for basic checks |
| Genuine singing/source detection | Separate classification requirement | Not implemented; defer unless explicitly needed |
| Tone quality and vocal technique | Relevant rubric and validated assessment | Coach-led now; do not equate signal clarity with technique |
| Feedback text | Templates from measurements and coach notes | No LLM required |
| Exercise progression and progress charts | Product rules and stored history | No model required |
| Accounts, uploads, synchronization and coach review | Application infrastructure | No model required |

## Pretrained model candidate, if required

CREPE is a pretrained convolutional model for monophonic fundamental-frequency estimation. It is a candidate to compare with YIN, not an already integrated Android solution and not a tone-quality grader. Its original implementation and torchcrepe expose pitch/confidence or periodicity; these are not percentages of singing skill. torchcrepe also documents confidence errors on silence, so explicit silence gating is still needed.

Primary sources checked:
- https://github.com/marl/crepe
- https://github.com/maxrmorrison/torchcrepe
- https://arxiv.org/abs/1802.06182

Before adoption, verify artifact license, Android runtime/export compatibility, input sample rate/resampling, installation size, target-phone latency, offline operation, confidence gating, and consistency with persisted score semantics. Keep the existing working engine available until those checks pass. No cloud GPU or paid inference service is established as necessary.

## Next implementation order

1. Agree on sustained-note scope and the distinction between measured pitch, experimental signal quality, and coach tone assessment.
2. Fix tone labels, unsupported benchmark claims, and the progression policy consistently across mobile and web.
3. Record a small consented, coach-reviewed evaluation set on the target phone: correct/flat/sharp sustained singing, vibrato, breathy/noisy samples, silence, background speech, and a played reference. Record failures as well as successes; do not reuse the same clips for both tuning and final evaluation.
4. Measure cents error, octave errors, false voiced detections, insufficient-audio behavior, and runtime. Assess tone indicators against coach judgment without calling that a trained model evaluation.
5. Only if an ML requirement or observed pitch failures justify it, run one pretrained pitch estimator on the same held-out recordings and integrate it if the evidence supports the change.

No new training, model installation, scoring change, or deployment was performed as part of this audit.
