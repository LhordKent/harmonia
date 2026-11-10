# Harmonia on-device analysis pipeline

Updated 10 November 2026. This document replaces the inherited SVM architecture and unsupported benchmark claims.

## Active pipeline

Microphone -> mono PCM on private device storage -> pretrained SwiftF0 pitch estimates -> timed target comparison -> experimental clarity/steadiness metrics -> versioned practice result -> private audio synchronization -> explicit coach approval.

- One active pretrained neural pitch model; no project-specific model training.
- ONNX Runtime Android 1.23.2 with the pinned model and MIT notice in app assets.
- SwiftF0 source: https://github.com/lars76/swift-f0/tree/d1ba77fe5331310b778ebe126b6cb3656d41d24f
- Production capture is 16 kHz. Legacy higher-rate input uses a low-pass resampler.
- Final inference uses 30-second windows, 11 frames of left context and 10 future frames, matching upstream framing.
- Confidence below 0.5, digital silence, and estimates outside 65..1050 Hz are not usable pitch. Model confidence is never a singing grade.
- YIN supplies low-latency live guidance; its output is not silently substituted for failed neural grading.
- Legacy SVM configurations remain for historical source compatibility and tests; they are not used by production grading and their training provenance is unverified.

## Exercise types

Single-note targets use one frequency. Scales and complete songs use coach-approved ordered target notes with start/end times and gaps representing rests. The web can extract proposed notes from solo audio using the identical model, but the coach must review and approve the target. Manual note editing is supported. There is no automatic extraction from mixed accompaniment.

Free vocalising has a live pitch trace and experimental tone indicators, but no pitch-accuracy grade or automatic pass.

## Grading policy

Beginner: +/-50 cents, pass 60%. Intermediate: +/-35 cents, pass 70%. Advanced: +/-25 cents, pass 80%.

Pitch accuracy is the proportion of expected singing time within tolerance. Skipped singing counts against it; reference rests are excluded. Banded monotonic alignment accommodates modest timing differences without octave folding or pitch transposition. At least 80% usable target coverage and 80% recording duration are required for a normal graded attempt.

Tone uses 50% periodic clarity, 30% pitch steadiness and 20% amplitude steadiness, measured within sustained regions. Regular small pitch motion, including typical vibrato, is tolerated. These are versioned experimental measurements, not clinical measurements, a second learned model or a validated expert technique grade. Very short notes can yield a pitch-only result with tone unavailable; the coach can review it.

The composite is 60% pitch and 40% tone. A machine pass requires both component grades and the composite to meet the difficulty pass mark. It is advisory: progression requires a separate explicit assigned-coach/admin approval. A general assessment does not authorize progression automatically.

## Reliability and history

Recording supports up to ten minutes, streamed to disk. AAC-LC M4A uploads use 64 kbps mono and the existing 8 MiB limit; legacy WAV remains supported. Failed analysis/encoding preserves local audio and allows recovery. No paid inference endpoint is used.

Grading evidence stores the model, scoring version, target version, difficulty, tolerance, pass mark, optional grades, coverage, components, status and retry reasons. Missing grades are unavailable rather than zero. Original scores and coach corrections remain separate. Room V4/V5 upgrades to V6 without destructive migration. Old scoring results are retained as legacy results; old automatic completion flags are not treated as coach approval.

## Evidence limits

See ai-validation.md. Integration tests do not establish real-singer accuracy. No 100% guarantee, real-world 90% result, Praat-equivalence claim or unsupported latency benchmark is asserted here. Quiet solo singing, appropriately prepared targets, and coach review are the supported conditions.
