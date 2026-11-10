// Live rehearsal of school-managed accounts against the real project and deployed functions.
// Creates isolated, clearly labelled fixtures (two temporary schools, a temporary platform admin and
// accounts provisioned through the accounts service) and removes exactly those fixtures in finally.
// Requires the separately authorized Firebase CLI owner login. Never run against another client's data.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDocFromServer, getDocs, setDoc, collection, query, where, setLogLevel } from 'firebase/firestore';
import owner from './firebase-owner.cjs';
import { auth, db } from '../src/firebase/config.js';
import * as accounts from '../src/firebase/accountsService.js';
import * as service from '../src/firebase/firestore.js';
import { onboardingState, requireWebProfile } from '../src/firebase/access.js';

if (process.env.HARMONIA_EMULATOR_PROJECT) throw new Error('This rehearsal targets the confirmed live Harmonia project.');
setLogLevel('silent');
const client = await owner.ownerClient();
const AUDIO = 'https://ztrnmbtdaruyffjqjejz.supabase.co/functions/v1/audio';
const stamp = Date.now().toString(36);
const mail = label => `harmonia-rehearsal-${stamp}-${label}@example.test`;
const secret = () => randomBytes(18).toString('base64url') + '9!aA';
const basePassword = secret();
const uids = new Set(); const paths = new Set(); const audioRefs = [];
const checks = [];
async function step(label, promise) { try { return await promise; } catch (e) { e.message = `${label}: ${e.message}`; throw e; } }
async function check(name, fn) { await fn(); checks.push(name); console.log(`PASS: ${name}`); }
const signIn = (email, password) => signInWithEmailAndPassword(auth, email, password);
const denied = p => assert.rejects(p, /permission/i);
const code = async (p, expected) => assert.rejects(p, e => e.code === expected || assert.fail(`${e.code}: ${e.message}`));
const profile = async uid => (await getDocFromServer(doc(db, 'users', uid))).data();
function track(account, role, schoolId) {
  uids.add(account.uid); paths.add(`users/${account.uid}`);
  if (role === 'coach') paths.add(`coaches/${account.uid}`);
  if (role === 'student') paths.add(`students/${account.uid}`);
  if (schoolId) { paths.add(`institutions/${schoolId}`); paths.add(`schoolSecrets/${schoolId}`); }
}
async function audio(action, query, body) {
  const token = await auth.currentUser.getIdToken();
  const response = await fetch(`${AUDIO}?action=${action}&${query}`, { method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'audio/wav' }, body });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}
async function changeAndReauth(email, current, next) {
  await accounts.changeAccountPassword(current, next);
  await signIn(email, next);
  // Mirror the clients: confirm protected access has settled before continuing.
  await accounts.waitForProtectedAccess(() => getDocFromServer(doc(db, 'appConfig', 'audio')));
}

let failure;
const pw = { admin: secret(), nora: secret(), carl: secret(), sam: secret(), ray: secret() };
const ctx = {};
try {
  const adminUser = (await createUserWithEmailAndPassword(auth, mail('platform-admin'), pw.admin)).user;
  uids.add(adminUser.uid); paths.add(`users/${adminUser.uid}`);
  await client.db.post(`/projects/${owner.PROJECT}/databases/(default)/documents:commit`, { writes: [
    owner.createWrite(`users/${adminUser.uid}`, { role: 'admin', status: 'active', institutionId: null, name: 'Rehearsal Platform Admin', email: adminUser.email }),
  ] });

  await check('1. platform admin creates a school and receives a temporary password for its administrator', async () => {
    await signIn(adminUser.email, pw.admin);
    assert.equal(requireWebProfile(await profile(adminUser.uid)).role, 'admin');
    const result = await accounts.createSchool({ requestId: accounts.newRequestId(), name: `Rehearsal North ${stamp}`,
      basePassword, adminName: 'Nora Rehearsal', adminEmail: mail('nora') });
    ctx.north = result.schoolId; ctx.nora = result.account.uid; track(result.account, 'institution', ctx.north);
    assert.equal(result.account.temporaryPassword, basePassword);
    assert.equal(auth.currentUser.uid, adminUser.uid);
    const school = await getDocFromServer(doc(db, 'institutions', ctx.north));
    assert.equal(school.data().basePasswordSet, true);
    await denied(getDocFromServer(doc(db, 'schoolSecrets', ctx.north)));
  });

  await check('1. pending school administrator is confined until changing the temporary password', async () => {
    await step('nora sign-in', signIn(mail('nora'), basePassword));
    assert.equal(onboardingState(await step('nora reads own profile', profile(ctx.nora))), 'passwordChangeRequired');
    await denied(getDocFromServer(doc(db, 'institutions', ctx.north)));
    await code(accounts.createSchoolAccount({ role: 'coach', name: 'Early', email: mail('early') }), 'SETUP_REQUIRED');
    await code(accounts.changeAccountPassword('wrong-password', pw.nora), 'WRONG_PASSWORD');
    await code(accounts.changeAccountPassword(basePassword, basePassword), 'SAME_PASSWORD');
    await code(accounts.changeAccountPassword(basePassword, 'short'), 'WEAK_PASSWORD');
    await step('nora change+reauth', changeAndReauth(mail('nora'), basePassword, pw.nora));
    assert.equal(onboardingState(await step('nora profile after change', profile(ctx.nora))), 'ready');
    // Same brief wait the clients apply after setup completes.
    assert.ok((await step('nora reads own school', accounts.waitForProtectedAccess(() => getDocFromServer(doc(db, 'institutions', ctx.north))))).exists());
    await assert.rejects(signIn(mail('nora'), basePassword));
    await signIn(mail('nora'), pw.nora);
  });

  await check('2. school administrator creates a coach and student who start pending', async () => {
    const coach = await accounts.createSchoolAccount({ role: 'coach', name: 'Carl Rehearsal', email: mail('carl') });
    track(coach, 'coach'); ctx.carl = coach.uid;
    const student = await accounts.createSchoolAccount({ role: 'student', name: 'Sam Rehearsal', email: mail('sam'), coachId: coach.uid });
    track(student, 'student'); ctx.sam = student.uid;
    assert.equal(student.temporaryPassword, basePassword);
    const roster = await service.getStudents(ctx.north, { role: 'institution' });
    assert.deepEqual(roster.map(s => s.id), [student.uid]);
    assert.equal((await service.getCoaches(ctx.north, { role: 'institution' })).length, 1);
  });

  await check('2/5. pending student cannot read data, write practice or upload audio (direct calls)', async () => {
    await signIn(mail('sam'), basePassword);
    assert.equal(onboardingState(await profile(ctx.sam)), 'passwordChangeRequired');
    await denied(getDocFromServer(doc(db, 'students', ctx.sam)));
    await denied(setDoc(doc(db, 'practiceSessions', `rehearsal-${stamp}-pending`), { studentId: ctx.sam, institutionId: ctx.north, verdictStatus: 'aiPending' }));
    await denied(setDoc(doc(db, 'users', ctx.sam), { mustChangePassword: false }, { merge: true }));
    const upload = await audio('upload', `kind=attempts&id=rehearsal${stamp}pending`, 'RIFFpending');
    assert.equal(upload.status, 403);
  });

  await check('2/8. after changing passwords, the student records/uploads and the coach reviews', async () => {
    await changeAndReauth(mail('sam'), basePassword, pw.sam);
    const sessionId = `rehearsal-${stamp}-attempt`; paths.add(`practiceSessions/${sessionId}`);
    const upload = await audio('upload', `kind=attempts&id=rehearsal${stamp}ok`, 'RIFFrehearsal-audio-bytes');
    assert.equal(upload.status, 200, JSON.stringify(upload.body));
    audioRefs.push(upload.body.audioRef);
    await setDoc(doc(db, 'practiceSessions', sessionId), { studentId: ctx.sam, institutionId: ctx.north, verdictStatus: 'aiPending',
      accuracyScore: 72, toneScore: 68, audioRecordingUrl: upload.body.audioRef, createdAt: Date.now() });

    await signIn(mail('carl'), basePassword);
    await denied(getDocs(query(collection(db, 'students'), where('coachId', '==', ctx.carl), where('institutionId', '==', ctx.north))));
    await changeAndReauth(mail('carl'), basePassword, pw.carl);
    const viewer = { id: ctx.carl, role: 'coach', institutionId: ctx.north };
    assert.deepEqual((await service.getStudents(ctx.north, viewer)).map(s => s.id), [ctx.sam]);
    const playback = await audio('playback', `ref=${encodeURIComponent(upload.body.audioRef)}`);
    assert.equal(playback.status, 200);
    await service.updateSession(sessionId, { coachVerdict: 'Good stability', coachFeedback: 'Rehearsal feedback.', coachPitchScore: 75, coachToneScore: 70 });

    await signIn(mail('sam'), pw.sam);
    const reviewed = (await getDocFromServer(doc(db, 'practiceSessions', sessionId))).data();
    assert.equal(reviewed.coachFeedback, 'Rehearsal feedback.');
    assert.equal(reviewed.accuracyScore, 72);
  });

  await check('4. an out-of-band password change (as after email recovery) completes setup only after re-authentication', async () => {
    await signIn(mail('nora'), pw.nora);
    const ray = await accounts.createSchoolAccount({ role: 'student', name: 'Ray Rehearsal', email: mail('ray') });
    track(ray, 'student'); ctx.ray = ray.uid;
    await signIn(mail('ray'), basePassword);
    await code(accounts.completeAccountOnboarding(), 'PASSWORD_NOT_CHANGED');
    // The owner session stands in for the emailed reset link (no inbox exists for example.test).
    await client.identity.post(`/v1/projects/${owner.PROJECT}/accounts:update`, { localId: ray.uid, password: pw.ray });
    await signIn(mail('ray'), pw.ray);
    assert.equal((await accounts.completeAccountOnboarding()).state, 'ready');
    assert.equal(onboardingState(await profile(ray.uid)), 'ready');
  });

  await check('6. one school cannot provision into or read another school', async () => {
    await signIn(adminUser.email, pw.admin);
    const south = await accounts.createSchool({ requestId: accounts.newRequestId(), name: `Rehearsal South ${stamp}`,
      basePassword: secret(), adminName: 'Sol Rehearsal', adminEmail: mail('sol') });
    ctx.south = south.schoolId; track(south.account, 'institution', ctx.south);
    await signIn(mail('nora'), pw.nora);
    await code(accounts.createSchoolAccount({ role: 'student', name: 'Intruder', email: mail('intruder'), schoolId: ctx.south }), 'FORBIDDEN');
    await code(accounts.setSchoolBasePassword(ctx.south, secret()), 'FORBIDDEN');
    await denied(getDocFromServer(doc(db, 'institutions', ctx.south)));
  });

  await check('7. duplicate email and lost-response retry are recoverable and never reset an account', async () => {
    await code(accounts.createSchoolAccount({ role: 'student', name: 'Dup', email: mail('sam').toUpperCase() }), 'EMAIL_EXISTS');
    await signIn(mail('sam'), pw.sam);
  });

  await check('5. an older client cannot self-register a profile', async () => {
    const selfUser = (await createUserWithEmailAndPassword(auth, mail('self-signup'), secret())).user;
    uids.add(selfUser.uid); paths.add(`users/${selfUser.uid}`); paths.add(`students/${selfUser.uid}`);
    await denied(setDoc(doc(db, 'users', selfUser.uid), { uid: selfUser.uid, role: 'student', status: 'active', institutionId: null, email: selfUser.email }));
    await code(accounts.callAccounts('status'), 'NO_PROFILE');
  });
} catch (error) {
  failure = error;
} finally {
  const cleanup = [];
  try {
    if (audioRefs.length) {
      // The temporary platform admin is the only account allowed to delete audio objects.
      await signIn(mail('platform-admin'), pw.admin);
      for (const ref of audioRefs) {
        const result = await audio('delete', `ref=${encodeURIComponent(ref)}`);
        if (result.status !== 200) cleanup.push(`audio ${result.status}`);
      }
    }
  } catch (e) { cleanup.push(`audio: ${e.message}`); }
  await signOut(auth).catch(() => {});
  try {
    const writes = [...paths].map(p => ({ delete: `${owner.base}/${p}` }));
    if (writes.length) await client.db.post(`/projects/${owner.PROJECT}/databases/(default)/documents:commit`, { writes });
  } catch (e) { cleanup.push(`documents: ${e.message}`); }
  for (const uid of uids) {
    try { await client.identity.post(`/v1/projects/${owner.PROJECT}/accounts:delete`, { localId: uid }); }
    catch (e) { cleanup.push(`identity ${uid}: ${e.message}`); }
  }
  console.log(JSON.stringify({ passed: checks.length, removedDocuments: paths.size, removedIdentities: uids.size,
    removedAudio: audioRefs.length, cleanupProblems: cleanup }, null, 2));
  if (failure) { console.error('FAILED:', failure.stack); process.exitCode = 1; }
  if (cleanup.length) process.exitCode = 1;
}
