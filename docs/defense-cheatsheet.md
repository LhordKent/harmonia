# Harmonia
## Defense cheatsheet
Plain-language presenter guide | Implementation snapshot: 11 November 2026

**What to say in one minute**
Harmonia helps student singers practise notes, scales and prepared solo songs. Students record on Android. A pretrained AI estimates the notes they sang, and programmed rules compare those notes with the exercise. The system also provides an experimental indicator of clarity and steadiness. Results appear on the student's phone and synchronize to the coach's web portal. The coach can listen, correct the estimate and explicitly approve advancement or request another attempt. The system supports practice between lessons; the coach retains the final judgment.

**Three facts to remember**
- One active pretrained pitch model. We did not train a new model for this implementation.
- A machine passing score is advice. It does not unlock the next exercise by itself.
- Working software tests do not prove 80-90% accuracy on real singers. That evaluation is still required.

**How to use this guide**
Pages 2-4 explain the purpose and user journey. Pages 5-8 explain AI and scoring. Pages 9-12 explain storage, access, offline use and the demonstration. Pages 13-15 give direct answers to difficult panel questions. Pages 16-18 cover evidence, scope and technical terms.

The active implementation takes precedence over old prototype descriptions. This guide contains no passwords or private student recordings.
---PAGE---
# 2 | Purpose and people
## What problem does it address?
Students need feedback between lessons, while coaches cannot supervise every practice session. Harmonia records what was practised, gives immediate measurable feedback and makes the recording available for later review. It does not establish that a student's overall singing ability improved; that would require an educational study.

## Who uses which part?
| Person | What they do |
| --- | --- |
| Student | Uses Android to register, practise, view results and replay saved recordings. |
| Vocal coach | Uses the website to review assigned students, hear recordings, correct scores and decide advancement. |
| Institution manager | Manages institution-scoped accounts and information through authorized portal features. This role does not grant advancement approval. |
| Administrator | Manages application accounts and can perform authorized review and advancement actions. |

## Where is signup?
Students sign up in Android. Staff accounts are provisioned through authorized account-management flows. The staff website has sign-in rather than public administrator signup. A cloud-project owner and a Harmonia application administrator are different kinds of access.

**Defensible answer:** "The phone is the student's practice tool. The website is the staff's review and management tool. They share authorized records rather than maintaining two independent sets of grades."

New student registration does not automatically assign a coach. Enroll or assign the intended student before demonstrating staff review.
---PAGE---
# 3 | The complete journey
## Explain the system in six steps
| Step | What happens | Why it matters |
| --- | --- | --- |
| 1. Prepare | A coach prepares the exercise, level and expected notes. | The system needs a defined target to judge accuracy. |
| 2. Practise | The student listens to the guide, stops playback and records solo singing. | Background music can confuse pitch estimation. |
| 3. Analyse | The phone estimates pitch and calculates available practice indicators. | Feedback does not require a paid AI call. |
| 4. Save and send | Audio and results are saved locally; authorized synchronization sends shared records and private audio. | Local work survives a failed upload. |
| 5. Review | The assigned coach listens and confirms or corrects the estimates. | Human judgment can address machine limitations. |
| 6. Decide | An explicit approval or repeat decision is downloaded to Android. | Advancement depends on the review, not just an automatic score. |

## A concrete example
A Beginner student sings a prepared C4 exercise. The app shows original pitch and tone indicators. The coach hears the recording and enters corrected scores of 82 and 78 with a comment. Those corrections remain distinguishable from the original machine estimates. The coach then selects **Approve advancement**. After that decision synchronizes, an exercise depending on this one can become available.

Confirming a score and approving advancement are separate actions. A general assessment is also separate and does not unlock an exercise by itself.
---PAGE---
# 4 | Notes, scales and songs
## Supported practice types
| Type | Expected target | What can be assessed |
| --- | --- | --- |
| Single note | One frequency for the exercise. | How much expected singing time is near that pitch. |
| Scale | An approved sequence of timed notes. | Pitch against the sequence, with limited timing flexibility. |
| Full song | Coach-approved timed melody from a solo reference or manual notes. | The prepared melody, within recording and pitch limits. |
| Free vocalising | No required melody. | Live pitch and available experimental tone indicators; no pitch-accuracy grade or automatic pass. |

## How does the system know the correct melody?
The coach may enter notes manually or upload a solo reference. The browser uses the pretrained model to propose note timings. A coach must inspect, edit if needed and approve the target before a scale or song is published. Automatic extraction is a draft, not musical ground truth.

## What does "full song" mean here?
A prepared solo melody up to ten minutes, in the supported 65-1050 Hz pitch range. It does not mean any commercial song can be uploaded with a band and instantly graded. Lyrics, pronunciation, emotional interpretation, accompaniment separation and original-key transposition are not graded.

References must fit the 8 MiB upload cap. A coach should choose a comfortable key and use audio they are allowed to use. Rests are represented as gaps between target notes and are excluded from expected singing time.
---PAGE---
# 5 | Which AI actually runs?
## One pretrained model: SwiftF0
SwiftF0 estimates fundamental frequency, commonly called F0: the repetition rate that mainly determines the note we hear. Its output is a changing pitch estimate and confidence value. It does not directly output a student's final grade.

**Pretrained means:** the model's author already trained its numerical settings. Harmonia bundles a fixed copy and runs it. No Harmonia training dataset, training server, fine-tuning or project-specific training session was used.

The model runs through ONNX Runtime in Android. The browser uses the same pinned model to propose reference notes. These are two uses of one model artifact, not two separately trained models. A checksum detects a changed or substituted file.

## What is not a second AI model?
- The live pitch display uses YIN, a signal-processing algorithm for quick guidance.
- Tone indicators use programmed measurements and weights.
- Grade calculation compares measurements with targets and policy.
- Feedback sentences follow measurement-based rules; no chatbot or large language model generates them.

Legacy SVM classes remain in historical source/tests, but are not the active production grader. Old descriptions of two trained SVMs do not describe this build.

**Panel answer:** "We integrated one pretrained pitch estimator. We implemented the exercise comparison, quality checks, local storage, synchronization and coach-review workflow around it."
---PAGE---
# 6 | How pitch grading works
## A note error is measured in cents
A cent is a small musical distance. One semitone, such as C to C-sharp, is 100 cents. The measure is relative to the target, so it makes sense across different notes. It is not a percentage or a loudness unit.

| Level | Allowed pitch error | Passing score |
| --- | --- | --- |
| Beginner | Within +/-50 cents | 60% |
| Intermediate | Within +/-35 cents | 70% |
| Advanced | Within +/-25 cents | 80% |

The grader checks small time slots against the expected notes. Pitch score is the percentage of expected singing time that falls within the allowed error. Missing expected singing counts against the score; reference rests do not. Confidence is used to decide whether a pitch estimate is usable, not to assign skill points.

## Example
If 80 of 100 expected singing slots are within the Beginner tolerance, the pitch score is 80%. That is the practice result for this attempt. It does not mean the AI is 80% accurate or that the singer has mastered 80% of vocal technique.

For scales and songs, a constrained alignment allows modest timing differences while preserving note order. It cannot make a wrong octave correct, freely change the key, or hide skipped phrases. Timing flexibility is limited; this is not unrestricted tempo following.

**If asked for the formula:** cents = 1200 x log2(measured frequency / target frequency). Positive means sharp; negative means flat. You do not need to recite the formula to explain the idea.
---PAGE---
# 7 | Tone and the final estimate
## What tone means in this build
The client described the intended quality as clear and steady singing. Harmonia uses an experimental indicator built from three programmed measurements in sustained note regions:

| Ingredient | Weight | Plain-language meaning |
| --- | --- | --- |
| Periodic clarity | 50% | How regularly the sound repeats, as a rough signal-clarity indicator. |
| Pitch steadiness | 30% | How consistently a sustained note is held. |
| Volume steadiness | 20% | How evenly the sound level is maintained. |

Attacks, transitions and rests are excluded from these sustained-region measurements. Small regular pitch motion is tolerated. This is not a clinical voice assessment or a validated measure of beauty, breath support, emotion or overall technique. Microphone position and the room can affect it.

## Composite score
Composite = 60% pitch + 40% tone. An automatic pass requires **both component scores and the composite** to meet the level's pass mark.

**Passing example:** Beginner pitch 80, tone 70 gives composite 76. All meet 60, so the automatic estimate passes. Coach approval is still needed for advancement.

**Important counterexample:** Beginner pitch 95 and tone 50 gives composite 77. The high average does not override the low tone component; automatic passing is false.

The tone weights and score mappings are engineering defaults. We need independent coach-rated recordings before claiming that these numerical indicators agree with expert grading.
---PAGE---
# 8 | When the app should withhold a grade
## Recording checks protect against misleading results
The current grader requires enough usable pitched sound and enough of the expected performance. It checks for a recording that is too quiet, clipped, incomplete or missing too much expected singing.

| Result state | Meaning | What the student should do |
| --- | --- | --- |
| Scored | Pitch and tone are available. | Read feedback; wait for coach review. |
| Partial | Pitch can be measured but sustained regions are insufficient for tone. | The coach can review; an unavailable tone is not zero. |
| Needs recording | Recording-quality or coverage checks failed. | Follow the reason and record again. |
| Unscored | Valid free vocalising has no required melody grade. | Use it for practice, not automatic passing. |

## If the panel asks for thresholds
Normal target-based grading requires at least 80% usable target coverage, at least 80% of the planned duration and at least 1.5 seconds of usable pitched material. Model confidence below 0.5 is not usable pitch. More than 1% near-full-scale samples triggers clipping; very low overall signal level also triggers a retry. These are practical safeguards, not proof that every noisy recording is detected.

The app should explain missing measurements instead of inventing a grade. Very fast notes may permit pitch grading without enough sustained material for tone. A failure to run the neural model preserves the audio for recovery rather than silently substituting a different final grader.
---PAGE---
# 9 | What the coach controls
## Original evidence and human review are separate
Original machine measurements retain the target snapshot, scoring version, model identifier, policy and available scores. A coach review records corrections and feedback separately. This helps explain disagreements without pretending the original estimate never existed.

The staff member should listen before deciding whether a grade is reasonable. A score alone cannot reveal all musical or recording problems.

## Three different actions
- **Confirm or correct:** records the coach's view of the attempt's estimate.
- **Approve advancement or request repeat:** explicitly decides progression for that exercise. Only the assigned active coach or administrator can perform this protected approval action.
- **General assessment:** a broader evaluation. Finalized assessments become visible to the student; drafts remain staff work. This does not independently unlock exercises.

## What happens next?
Android receives reviewed feedback and stores it locally. Progression uses explicit reviewed decisions; a recent repeat decision can require another attempt. Dependent exercises become available after the necessary approval synchronizes. An old automatic completion is not treated as a new coach approval.

**Panel answer:** "The system gives consistent initial measurements, while the coach makes the educational decision. Keeping the two records separate lets us inspect where the machine and coach disagree."

This workflow reduces over-reliance on the estimate. It does not by itself prove the estimate is correct, and it does not replace independent validation.
---PAGE---
# 10 | How the phone and website connect
## Think of three different storage jobs
| Component | Plain-language job | What it holds |
| --- | --- | --- |
| Android Room database and private files | The phone's local notebook and recordings folder. | Saved attempts, measurements, local audio and downloaded feedback. |
| Firebase Authentication + Firestore | Identity check and shared record book. | Accounts, exercises, assignments, attempt records, review decisions and audio references. |
| Supabase private audio service | Controlled audio filing cabinet. | Student audio and reference audio objects. |

The website and Android use the same Firebase project and shared exercise/session structures. Supabase handles audio because Firebase Storage was unavailable in this project's billing setup. We did not enable Firebase billing to solve that blocker.

## What gets sent?
The phone saves an attempt locally, compresses audio to AAC/M4A and synchronizes authorized records. Firestore stores metadata and stable audio references; audio bytes are stored privately in Supabase. A background worker retries eligible unsynced work when connectivity returns.

The website obtains a temporary playback link after an access check. Review changes then travel back through Firestore to Android's listeners and local cache.

Synchronization can be delayed by connectivity or background scheduling. The correct claim is that the workflow is connected and tested, not that every device updates instantly under every network condition.
---PAGE---
# 11 | Offline use and access
## What works without internet?
Saved local recordings and previously downloaded results/feedback remain accessible to the signed-in student. The pitch model is bundled locally. Newly downloaded exercises, remote reference playback, uploads, new staff feedback and fresh sign-in depend on connectivity. The website is not offered as a fully offline application.

If analysis or encoding is interrupted, the practice screen can offer recovery of an eligible saved recording. Leaving the screen or backgrounding cancels unfinished capture and releases the microphone; a nonempty capture may be recoverable. It does not continue secretly recording.

## Recording limits
Capture streams to disk instead of accumulating the whole recording in memory. Exercises support up to ten minutes. Compressed uploads must fit the 8 MiB per-file cap; legacy WAV is supported. Failed upload does not mean the student should delete local audio. Ten-minute support does not guarantee all phones have sufficient disk space or identical processing speed.

## Who can hear a recording?
Access checks require a valid Firebase identity, an active application profile and appropriate ownership/assignment. An unrelated coach must not gain access merely by knowing a student name. The Supabase bucket is private; the function holds its powerful service credential server-side.

Playback links expire after five minutes. An already issued link can remain usable until it expires. Do not describe this as end-to-end encryption or claim that disabling an account instantly invalidates every issued link.
---PAGE---
# 12 | A short, reliable defense demo
## Prepare before the panel arrives
- Install the current APK on the intended Android phone. Allow microphone access and rehearse in the presentation room.
- Use authorized staff and student accounts. Assign the student to the reviewing coach.
- Prepare a Beginner exercise: comfortable single note, about 15 seconds, approved target and no prerequisite. Keep a dependent exercise ready if demonstrating unlocks.
- Check internet, reference playback and the coach's ability to open the student session. Keep the phone charged and free storage available.

## Show the flow in about six minutes
1. Website: show the exercise's level, target and duration. Explain that a song requires approved target notes.
2. Android: open that exercise, play the reference and stop playback before recording.
3. Sing solo, stop and show the result. Explain pitch, experimental tone and any unavailable measurement honestly.
4. Website: open the uploaded attempt and play the actual recording.
5. Save feedback or corrected scores. Select **Approve advancement** explicitly.
6. Android: show the received review and progression decision. Open a dependent exercise if applicable.
7. Briefly disconnect the phone and show already saved audio/feedback. Reconnect afterward.

**Backup plan:** keep a genuine earlier saved attempt available for reviewing if the network fails. Label it as a previous attempt. Do not present a prepared result as if it were the failed live recording. A test-generated tone demonstrates the data path, not genuine singing accuracy.
---PAGE---
# 13 | Questions: AI and originality
## "Did your team train the AI?"
No. This implementation integrates a fixed pretrained SwiftF0 pitch model. We implemented the practice comparison, recording/recovery, grading policy, evidence storage and coach-review integration. Training a new model is not required to demonstrate those system functions.

## "Why use a pretrained model?"
It avoids pretending that a small or unverified project dataset is enough to train a reliable pitch estimator. It lets us focus on the supported workflow and test the integration. It still needs evaluation on the intended singers, phones and rooms.

## "How many models are there?"
One active pretrained model, used on Android and for browser reference extraction. Tone is an experimental programmed formula. YIN is live signal processing, and feedback uses rules. Historical SVM files do not make two SVM models active in the deployed grading flow.

## "Is using an existing model still a valid project contribution?"
The contribution is the integrated application and its evaluated behavior, not a claim to have invented SwiftF0. We credit the model and retain its license. Whether that contribution satisfies the institution's research criteria must match the approved scope and revised manuscript.

## "Does AI confidence mean the student is correct?"
No. Confidence concerns the pitch estimate. A very clear wrong note can have high confidence and a low accuracy grade. Correctness comes from comparison with the exercise's target.

## "Why not let a chatbot grade the audio?"
The current system uses reproducible measurements and explicit rules. It has no conversational model or paid audio-grading API. Adding one is outside this implementation and would need its own evidence.
---PAGE---
# 14 | Questions: scores and trust
## "Is the system 90% accurate?"
We cannot claim that yet. The software and integration tests passed, but most scoring checks used generated audio. A defensible real-singer accuracy claim requires independent recordings with reference labels and a clearly defined metric. A target of 90% is not a measured result.

## "Is an 80% practice grade the AI's accuracy?"
No. The practice grade describes this attempt against the target. Model accuracy describes how often the estimator matches independently labeled pitch over an evaluation dataset. Those are different denominators and different questions.

## "Why those passing thresholds?"
The client requested progressively tighter pitch tolerances and higher pass marks: 50/60 for Beginner, 35/70 for Intermediate and 25/80 for Advanced. They are configured policy, not thresholds discovered through a validated learning study.

## "Can the coach disagree?"
Yes. Coaches can listen, enter corrections and decide advancement. Original measurements remain separate. We can later use appropriately consented independent coach ratings to study agreement; no such completed validation is claimed here.

## "Can a piano tone or replay trick it?"
Pitch tracking is not singer-identity verification. The system does not reliably distinguish every live human voice from a played tone or replay. Use supervised assessment and coach listening where authenticity matters.

## "What if tone is missing?"
Do not turn missing evidence into zero or declare a full automatic pass. A pitch-only result may still be useful to the coach. Tone needs sufficient sustained material, and its current numerical meaning is experimental.
---PAGE---
# 15 | Questions: operations and failure
## "Can it grade any song?"
It supports prepared solo melodies within ten minutes and 65-1050 Hz, with approved timed targets. It does not separate a voice from accompaniment or grade lyrics and emotion. Transposing the performance away from the target is not automatically accepted.

## "Is it completely free?"
All current features are accessible without payment gates. Inference runs locally, so there is no paid AI request per recording. Cloud storage, bandwidth and availability still have free-plan limits; unlimited scale and permanent zero cost are not promised.

## "What if the website cannot see the recording?"
Check that the phone and portal use the intended accounts, that the student is assigned to the coach and that upload has completed. Keep internet available and retry synchronization. A record on the phone does not prove cloud upload succeeded. Preserve the local file.

## "What if playback says access denied or expired?"
Confirm the account is active and authorized. Reopen the recording to request a fresh playback link. Do not solve an assignment problem by making the audio bucket public.

## "What if the student cannot advance after passing?"
Check for explicit **Approve advancement**, not only score confirmation or a general assessment. Let the reviewed decision synchronize. Also verify the prerequisite exercise ID and any later repeat decision.

## "What if the room is noisy or the model fails?"
Move to a quieter spot, stop guide playback, keep microphone distance steady and retry according to the reason. Recovery preserves eligible audio. State the failure honestly; the system is not foolproof and unsupported conditions should not be hidden.
---PAGE---
# 16 | What the evidence establishes
## Recorded implementation checks
The release report records these checks from the completed implementation work. They are not a newly measured human evaluation and should not be described as one.

| Check | Recorded result / meaning |
| --- | --- |
| Core analysis | 23 passing JVM tests for grading behavior and model-related cases. |
| Android app | 43 passing JVM tests for app behavior. |
| Firebase | 43 passing emulator rules/services/contracts tests. |
| Android device checks | Seven distinct focused checks including model, recording, long clips, migration and review workflow. |
| Browser flow | Real local model extraction and exercise publication; private audio transport mocked in that UI test. |
| Separate live rehearsal | Real private M4A upload/playback, coach corrections, advancement and mobile feedback/cache. |
| Long synthetic clip | Ten-minute analysis took 20,589 ms on the dedicated API 35 emulator. This is one setup, not a phone-wide speed guarantee. |

## What validation is still needed?
Use independently labeled solo singing, separate singers/recordings across evaluation groups and check for training-source overlap. Count correct pitch over all annotated voiced frames, including model misses. Report false voice detection, octave errors, per-recording results, sample sizes and grade availability. Test the intended physical phone and room.

For tone, collect independent coach ratings using a clear rubric and examine agreement. Do not reuse the same examples to adjust the formula and then call them an independent test. Educational improvement additionally needs a study of student outcomes over time.
---PAGE---
# 17 | Scope, manuscript and honest claims
## What is implemented
- Connected Android practice and staff review, local records, private audio synchronization and received feedback caching.
- One pretrained pitch estimator, target-based policies, experimental tone indicators and measurement-based feedback.
- Notes, scales and prepared solo songs; free vocalising without automatic pitch passing.
- Separate original and corrected scores, explicit protected advancement and recording recovery.

## What must not be claimed
- A team-trained pair of SVM classifiers or a newly invented pitch model.
- Measured 80-90% real-singer accuracy, guaranteed perfect grading or validated vocal-health assessment.
- Arbitrary songs with backing tracks, lyrics grading, identity verification or complete offline cloud synchronization.
- A completed controlled study proving improved singing, unlimited free hosting or closure of every original audit finding.

## What should change in the manuscript?
Update the architecture, model provenance/license, data flow, tone definition, grading rules, test methodology and limitations. Separate implementation tests from scientific evaluation. Replace unsupported benchmark statements with the actual recorded evidence. If the manuscript names Python/Librosa/Praat or two trained SVMs as the runtime pipeline, revise that to match the active on-device SwiftF0 and programmed grader.

The inherited manuscript has not been edited as part of this guide. Coordinate scope and evaluation claims with the project adviser. Historical audit notes identify earlier defects; they are not a current feature list or evidence that all risks are resolved.
---PAGE---
# 18 | Terms and source map
| Term | Meaning you can say aloud |
| --- | --- |
| F0 / Hz | Fundamental frequency; repetitions per second that help identify pitch. |
| Cents | Musical pitch distance; 100 cents is one semitone. |
| Confidence | The model's signal estimate strength, not a singing grade. |
| Inference | Running a trained model on new sound. |
| Target melody | The approved notes and timings used for comparison. |
| Alignment | Limited matching of performance timing to expected note order. |
| Room | Android's local structured database. |
| Firestore | Shared cloud records used by phone and portal. |
| Signed URL | A temporary playback link issued after an access check. |
| AAC/M4A | Compressed audio in a playable container, reducing upload size. |
| Human in the loop | A coach reviews the estimate and controls advancement. |
| Checksum | A file fingerprint used to verify the bundled model copy. |

## Where a technical reviewer can verify details
- Current architecture: HarmoniaAppMobile/docs/ai-pipeline.md.
- Recorded checks and evaluation plan: AI_IMPLEMENTATION_STATUS.md and HarmoniaAppMobile/docs/ai-validation.md.
- Actual formulas and statuses: core-analysis/.../PracticeGrader.kt. Model wrapper: ui/audio/NeuralPitchEstimator.kt.
- Access rules: WEBSITE CAPSTONE/firestore.rules. Private audio: supabase/functions/audio. Model attribution: SWIFTF0-LICENSE.txt beside each model.
- SwiftF0 upstream: https://github.com/lars76/swift-f0, pinned revision d1ba77fe5331310b778ebe126b6cb3656d41d24f.

**Closing line:** "Harmonia provides measurable practice feedback and a connected review workflow. We keep the coach's authority explicit and state the validation that remains before making stronger accuracy claims."
