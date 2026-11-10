import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, setDoc, getDocFromServer, collection, getDocs, writeBatch, runTransaction, query, where } from 'firebase/firestore';
import { normalizeSession, reviewFields } from '../src/firebase/sessionModel.js';
import { exerciseFields } from '../src/firebase/exerciseModel.js';

process.env.HARMONIA_EMULATOR_PROJECT = 'demo-harmonia';
if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run these tests through emulators:exec.');
const { auth, db } = await import('../src/firebase/config.js');
const { createAccountAuth } = await import('../src/firebase/auth.js');
const service = await import('../src/firebase/firestore.js');
const feedback = await import('../src/firebase/feedbackService.js');
const { requireWebProfile } = await import('../src/firebase/access.js');
let env, admin, coach, student, unrelated;
const password = 'Only-for-local-emulator-492!';

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-harmonia', firestore: { rules: await fs.readFile('firestore.rules', 'utf8') } });
  await env.clearFirestore();
  admin = (await createUserWithEmailAndPassword(auth, 'admin-service@example.test', password)).user;
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'users', admin.uid), { role: 'admin', status: 'active', institutionId: 'inst1', firstName: 'Admin', lastName: 'Test', email: admin.email });
  });
});
after(async () => { await signOut(auth); await env?.cleanup(); });

test('actual staff provisioning preserves admin session and commits role/profile together', async () => {
  coach = await createAccountAuth('coach-service@example.test', password, u => service.createCoach({ userId: u.uid, name: 'Coach Test', email: u.email, institutionId: 'inst1', status: 'active' }));
  assert.equal(auth.currentUser.uid, admin.uid);
  assert.equal((await service.getUserProfile(coach.uid)).role, 'coach');
  assert.equal((await service.getCoachById(coach.uid)).userId, coach.uid);
  student = await createAccountAuth('student-service@example.test', password, u => service.createStudent({ userId: u.uid, name: 'Student Test', email: u.email, institutionId: 'inst1', coachId: coach.uid, status: 'active' }));
  unrelated = await createAccountAuth('unrelated-service@example.test', password, u => service.createStudent({ userId: u.uid, name: 'Unrelated', email: u.email, institutionId: 'inst1', status: 'active' }));
  assert.equal(auth.currentUser.uid, admin.uid);
  assert.equal((await service.getUserProfile(student.uid)).role, 'student');
});

test('failed profile provisioning removes only the newly created Auth account', async () => {
  await assert.rejects(createAccountAuth('failed-service@example.test', password, async () => { throw new Error('Injected profile failure'); }), /Injected profile failure/);
  assert.equal(auth.currentUser.uid, admin.uid);
  // The sign-in endpoint independently proves the failed account cannot authenticate.
  const signIn = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'failed-service@example.test', password, returnSecureToken: true }) });
  assert.equal(signIn.ok, false);
});

test('actual scoped service queries return only the assigned student and sessions', async () => {
  await setDoc(doc(db, 'practiceSessions', 'service-session'), { studentId: student.uid, institutionId: 'inst1', verdictStatus: 'aiPending' });
  await signInWithEmailAndPassword(auth, coach.email, password);
  const viewer = { id: coach.uid, role: 'coach', institutionId: 'inst1' };
  const roster = await service.getStudents('inst1', viewer);
  assert.deepEqual(roster.map(s => s.id), [student.uid]);
  assert.equal((await service.getCoaches('inst1', viewer)).length, 1);
  assert.equal((await service.getSessions('inst1', viewer)).length, 1);
  await assert.rejects(getDocFromServer(doc(db, 'students', unrelated.uid)), /permission/i);
  await assert.rejects(getDocs(collection(db, 'students')), /permission/i);
});

test('student credentials authenticate but cannot enter web staff session', async () => {
  await signInWithEmailAndPassword(auth, student.email, password);
  const profile = await service.getUserProfile(student.uid);
  assert.throws(() => requireWebProfile(profile), /mobile/i);
  assert.equal((await getDocFromServer(doc(db, 'students', student.uid))).data().name, 'Student Test');
  await assert.rejects(signInWithEmailAndPassword(auth, student.email, 'incorrect-password'));
});

test('coach and admin can load permitted assessment history through the actual service', async () => {
  await signInWithEmailAndPassword(auth, coach.email, password);
  const saved = await feedback.saveCoachAssessment({ studentId: student.uid, coachId: coach.uid, coachName: 'Coach Test', institutionId: 'inst1', coachFeedback: 'Practice steadily.', status: 'draft' });
  assert.equal((await feedback.getCoachAssessment(student.uid)).id, saved.id);
  await signInWithEmailAndPassword(auth, admin.email, password);
  assert.equal((await feedback.getCoachAssessment(student.uid)).id, saved.id);
  assert.equal((await feedback.getCoachAssessmentHistory(student.uid)).length, 1);
});

test('admin deactivation updates both profiles and denies an existing student session', async () => {
  await signInWithEmailAndPassword(auth, admin.email, password);
  await service.deactivateStudent(student.uid);
  assert.equal((await service.getUserProfile(student.uid)).status, 'inactive');
  assert.equal((await getDocFromServer(doc(db, 'students', student.uid))).data().status, 'inactive');
  await signInWithEmailAndPassword(auth, student.email, password);
  const inactiveProfile = await service.getUserProfile(student.uid);
  assert.throws(() => requireWebProfile(inactiveProfile), /inactive/i);
  await assert.rejects(getDocFromServer(doc(db, 'students', student.uid)), /permission/i);
});

test('mobile-shaped signup succeeds against actual Auth and Firestore emulator services', async () => {
  await signOut(auth);
  const newUser = (await createUserWithEmailAndPassword(auth, 'independent-service@example.test', password)).user;
  const batch = writeBatch(db);
  batch.set(doc(db, 'users', newUser.uid), { uid: newUser.uid, firstName: 'Independent', lastName: 'Student', email: newUser.email, role: 'student', status: 'active', institutionId: null, createdAt: 1, updatedAt: 1 });
  batch.set(doc(db, 'students', newUser.uid), { id: newUser.uid, userId: newUser.uid, name: 'Independent Student', fullName: 'Independent Student', firstName: 'Independent', lastName: 'Student', email: newUser.email, studentType: 'independent', status: 'active', institutionId: null, createdAt: 1, updatedAt: 1 });
  await batch.commit();
  assert.equal((await service.getUserProfile(newUser.uid)).role, 'student');
  assert.equal((await getDocFromServer(doc(db, 'students', newUser.uid))).data().institutionId, null);
  await signInWithEmailAndPassword(auth, admin.email, password);
  const pending = await service.getIndependentStudents();
  assert.ok(pending.some(s => s.id === newUser.uid));
  await service.enrollStudent(newUser.uid, 'inst1', coach.uid);
  assert.equal((await service.getUserProfile(newUser.uid)).institutionId, 'inst1');
  await signInWithEmailAndPassword(auth, coach.email, password);
  const roster = await service.getStudents('inst1', { id: coach.uid, role: 'coach', institutionId: 'inst1' });
  assert.ok(roster.some(s => s.id === newUser.uid));
});

test('mobile transaction, actual coach correction and retry preserve original analysis and published review', async () => {
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'users', student.uid), { status: 'active' }, { merge: true });
    await setDoc(doc(ctx.firestore(), 'students', student.uid), { status: 'active' }, { merge: true });
  });
  await signInWithEmailAndPassword(auth, student.email, password);
  const ref = doc(db, 'practiceSessions', 'review-roundtrip');
  const attempt = doc(db, 'students', student.uid, 'practiceAttempts', 'review-roundtrip');
  const analysis = doc(attempt, 'analysisResult', 'result');
  const sync = () => runTransaction(db, async tx => {
    const session = await tx.get(ref), a = await tx.get(attempt), r = await tx.get(analysis);
    if (!session.exists()) tx.set(ref, { studentId: student.uid, institutionId: 'inst1', verdictStatus: 'aiPending', accuracyScore: 45, toneScore: 55, overallScore: 49, createdAt: 1700000000000 });
    if (!a.exists()) tx.set(attempt, { studentId: student.uid, exerciseId: 'ex1' });
    if (!r.exists()) tx.set(analysis, { verdictStatus: 'aiPending', accuracyScore: 45, toneScore: 55, overallScore: 49 });
  });
  await sync();
  await assert.rejects(service.updateSession(ref.id, { coachVerdict: 'Good stability' }), /permission/i);
  await signInWithEmailAndPassword(auth, coach.email, password);
  await service.updateSession(ref.id, { coachVerdict: 'Good stability', coachPitchScore: 82, coachToneScore: 78, coachFeedback: 'Keep your vowel steady.' });
  const reviewed = (await getDocFromServer(ref)).data();
  assert.equal(reviewed.accuracyScore, 45); assert.equal(reviewed.toneScore, 55);
  assert.equal(reviewed.reviewedBy, coach.uid); assert.ok(reviewed.reviewedAt.toMillis() > 0);
  const normalized = normalizeSession(reviewed);
  assert.equal(normalized.pitchAccuracy, 82); assert.equal(normalized.toneAccuracy, 78);
  assert.equal(normalized.aiVerdict, 'Requires improvement');
  assert.equal(normalized.timestamp, '2023-11-14T22:13:20.000Z');
  await signInWithEmailAndPassword(auth, student.email, password);
  await sync();
  const replay = (await getDocFromServer(ref)).data();
  assert.equal(replay.coachFeedback, reviewed.coachFeedback);
  assert.equal(replay.reviewedAt.toMillis(), reviewed.reviewedAt.toMillis());
  assert.equal((await getDocFromServer(analysis)).data().accuracyScore, 45);
});

test('students receive finalized assessments while drafts and other students remain private', async () => {
  await signInWithEmailAndPassword(auth, coach.email, password);
  const draft = await feedback.saveCoachAssessment({ studentId: student.uid, coachId: coach.uid, institutionId: 'inst1', coachFeedback: 'Not published yet', status: 'draft' });
  await signInWithEmailAndPassword(auth, student.email, password);
  await assert.rejects(getDocFromServer(doc(db, 'coachAssessments', draft.id)), /permission/i);
  await signInWithEmailAndPassword(auth, coach.email, password);
  await feedback.saveCoachAssessment({ studentId: student.uid, coachId: coach.uid, coachName: 'Coach Test', institutionId: 'inst1', coachFeedback: 'Steady progress.', finalVerdict: 'approved', status: 'finalized' });
  await signInWithEmailAndPassword(auth, student.email, password);
  const published = await getDocs(query(collection(db, 'coachAssessments'), where('studentId', '==', student.uid), where('status', '==', 'finalized')));
  assert.equal(published.size, 1); assert.equal(published.docs[0].data().coachFeedback, 'Steady progress.');
  await signInWithEmailAndPassword(auth, unrelated.email, password);
  await assert.rejects(getDocFromServer(published.docs[0].ref), /permission/i);
});

test('session normalization and review validation handle legacy/missing data and invalid corrections', () => {
  assert.equal(normalizeSession({ pitchAccuracy: 91, toneAccuracy: 89 }).aiVerdict, 'Excellent accuracy');
  assert.equal(normalizeSession({ createdAt: 'invalid' }).timestamp, null);
  for (const patch of [{ coachPitchScore: -1, coachToneScore: 80 }, { coachPitchScore: NaN, coachToneScore: 80 }, { coachPitchScore: 80 }, { coachFeedback: 'x'.repeat(4001) }]) {
    assert.throws(() => reviewFields({ coachVerdict: 'Good stability', ...patch }));
  }
});

test('web-created exercises persist compatible Android targets and reject invalid durations', async () => {
  await signInWithEmailAndPassword(auth, coach.email, password);
  const input = { title: 'C4 sustain', tier: 'Beginner', duration: 15, targetPitchData: 261.63, coachId: coach.uid, institutionId: 'inst1' };
  const saved = await service.createExercise(input);
  const data = (await getDocFromServer(doc(db, 'exercises', saved.id))).data();
  assert.equal(data.targetNote, 'C4'); assert.equal(data.targetFrequencyHz, 261.63); assert.equal(data.durationSeconds, 15);
  assert.equal(data.difficultyLevel, 'Foundations');
  for (const invalid of [{ duration: 601 }, { duration: 1 }, { duration: 3.5 }, { targetPitchData: 0 }, { targetPitchData: Infinity }]) {
    assert.throws(() => exerciseFields({ ...input, ...invalid }));
  }
});
