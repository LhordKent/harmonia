// End-to-end: the real accounts Edge Function handler, served locally, against the Firebase
// Auth + Firestore emulators and the deployed rules, driven by the real web service modules.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, setDoc, getDocFromServer, getDocs, collection, query, where } from 'firebase/firestore';
import { createAccountsHandler } from '../../supabase/functions/accounts/handler.mjs';

process.env.HARMONIA_EMULATOR_PROJECT = 'demo-harmonia';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST;
if (!AUTH || !FIRESTORE) throw new Error('Run these tests through emulators:exec.');

let server, env, svc, access, authApi, db, auth;
const PROJECT = 'demo-harmonia';
const OWNER_PASSWORD = 'Platform-owner-pass-1';

async function rest(path, body, base = `http://${AUTH}/identitytoolkit.googleapis.com/v1`) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }, body: JSON.stringify(body) });
  return { ok: response.ok, body: await response.json().catch(() => ({})) };
}
const signIn = (email, password) => signInWithEmailAndPassword(auth, email, password);
const expectDenied = promise => assert.rejects(promise, /permission/i);
const expectCode = async (promise, code) => { await assert.rejects(promise, e => { assert.equal(e.code, code, e.message); return true; }); };
const profile = async uid => (await getDocFromServer(doc(db, 'users', uid))).data();

before(async () => {
  const handle = createAccountsHandler({
    firebaseProject: PROJECT, firebaseApiKey: 'fake-api-key', encryptionKey: randomBytes(32).toString('base64'),
    identityToolkitUrl: `http://${AUTH}/identitytoolkit.googleapis.com/v1`, firestoreUrl: `http://${FIRESTORE}/v1`,
  }, { accessToken: async () => 'owner' });
  server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const response = await handle(new Request(`http://localhost${req.url}`, { method: req.method, headers: req.headers,
      body: req.method === 'POST' ? Buffer.concat(chunks) : undefined }));
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  process.env.HARMONIA_ACCOUNTS_ENDPOINT = `http://127.0.0.1:${server.address().port}/accounts`;
  ({ auth, db } = await import('../src/firebase/config.js'));
  svc = await import('../src/firebase/accountsService.js');
  access = await import('../src/firebase/access.js');
  authApi = await import('../src/firebase/auth.js');
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: await fs.readFile('firestore.rules', 'utf8') } });
  await env.clearFirestore();
  await fetch(`http://${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  const owner = await rest('/accounts:signUp?key=fake', { email: 'owner@platform.test', password: OWNER_PASSWORD });
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'users', owner.body.localId),
    { role: 'admin', status: 'active', institutionId: null, email: 'owner@platform.test', name: 'Platform Owner' }));
});
after(async () => { await signOut(auth).catch(() => {}); await env?.cleanup(); server?.close(); });

const north = {}, south = {};

test('journey 1: platform admin creates a school; its administrator is confined until changing the temporary password', async () => {
  await signIn('owner@platform.test', OWNER_PASSWORD);
  const result = await svc.createSchool({ requestId: svc.newRequestId(), name: 'North Academy', contactEmail: 'office@north.test',
    basePassword: 'North-Base-2026', adminName: 'Nora Admin', adminEmail: 'nora@north.test' });
  Object.assign(north, { schoolId: result.schoolId, adminUid: result.account.uid });
  assert.equal(result.account.temporaryPassword, 'North-Base-2026');
  assert.equal(auth.currentUser.email, 'owner@platform.test', 'the platform admin session is preserved');

  await signIn('nora@north.test', 'North-Base-2026');
  assert.equal(access.onboardingState(await profile(north.adminUid)), 'passwordChangeRequired');
  await expectDenied(getDocFromServer(doc(db, 'institutions', north.schoolId)));
  await expectCode(svc.createSchoolAccount({ role: 'coach', name: 'Too Early', email: 'early@north.test' }), 'SETUP_REQUIRED');
  await expectCode(svc.changeAccountPassword('wrong-password', 'Nora-Own-Pass-1'), 'WRONG_PASSWORD');
  await expectCode(svc.changeAccountPassword('North-Base-2026', 'North-Base-2026'), 'SAME_PASSWORD');

  await svc.changeAccountPassword('North-Base-2026', 'Nora-Own-Pass-1');
  await authApi.reauthenticateWithNewPassword('nora@north.test', 'Nora-Own-Pass-1');
  assert.equal(access.onboardingState(await profile(north.adminUid)), 'ready');
  assert.equal((await getDocFromServer(doc(db, 'institutions', north.schoolId))).data().name, 'North Academy');
  await assert.rejects(signIn('nora@north.test', 'North-Base-2026'), 'the temporary password no longer works');
});

test('journey 1-2: school admin creates a coach and student who must also change passwords first', async () => {
  await signIn('nora@north.test', 'Nora-Own-Pass-1');
  const coach = await svc.createSchoolAccount({ role: 'coach', name: 'Carl Coach', email: 'carl@north.test' });
  const student = await svc.createSchoolAccount({ role: 'student', name: 'Sam Student', email: 'sam@north.test', coachId: coach.uid });
  Object.assign(north, { coachUid: coach.uid, studentUid: student.uid });
  assert.equal(coach.temporaryPassword, 'North-Base-2026');
  const roster = await getDocs(query(collection(db, 'students'), where('institutionId', '==', north.schoolId)));
  assert.deepEqual(roster.docs.map(d => d.id), [student.uid]);

  await signIn('sam@north.test', 'North-Base-2026');
  assert.equal(access.onboardingState(await profile(student.uid)), 'passwordChangeRequired');
  await expectDenied(getDocFromServer(doc(db, 'students', student.uid)));
  await expectDenied(setDoc(doc(db, 'practiceSessions', 'pending-attempt'), { studentId: student.uid, institutionId: north.schoolId, verdictStatus: 'aiPending' }));
  await svc.changeAccountPassword('North-Base-2026', 'Sam-Own-Pass-1');
  await authApi.reauthenticateWithNewPassword('sam@north.test', 'Sam-Own-Pass-1');
  assert.equal((await getDocFromServer(doc(db, 'students', student.uid))).data().coachId, coach.uid);
  await setDoc(doc(db, 'practiceSessions', 'ready-attempt'), { studentId: student.uid, institutionId: north.schoolId, verdictStatus: 'aiPending', accuracyScore: 70 });

  await signIn('carl@north.test', 'North-Base-2026');
  await expectDenied(getDocs(query(collection(db, 'students'), where('coachId', '==', coach.uid), where('institutionId', '==', north.schoolId))));
  await svc.changeAccountPassword('North-Base-2026', 'Carl-Own-Pass-1');
  await authApi.reauthenticateWithNewPassword('carl@north.test', 'Carl-Own-Pass-1');
  const assigned = await getDocs(query(collection(db, 'students'), where('coachId', '==', coach.uid), where('institutionId', '==', north.schoolId)));
  assert.equal(assigned.size, 1);
});

test('journey 6: one school cannot provision into or read another school', async () => {
  await signIn('owner@platform.test', OWNER_PASSWORD);
  const result = await svc.createSchool({ requestId: svc.newRequestId(), name: 'South Academy', basePassword: 'South-Base-2026',
    adminName: 'Sol Admin', adminEmail: 'sol@south.test' });
  south.schoolId = result.schoolId;
  await signIn('nora@north.test', 'Nora-Own-Pass-1');
  await expectCode(svc.createSchoolAccount({ role: 'student', name: 'Intruder', email: 'intruder@north.test', schoolId: south.schoolId }), 'FORBIDDEN');
  await expectCode(svc.setSchoolBasePassword(south.schoolId, 'Hijack-Pass-1'), 'FORBIDDEN');
  await expectDenied(getDocFromServer(doc(db, 'institutions', south.schoolId)));
  await expectDenied(getDocs(collection(db, 'institutions')));
  await expectDenied(getDocFromServer(doc(db, 'schoolSecrets', north.schoolId)));
});

test('journey 7: duplicate emails and retries are recoverable and never reset an account', async () => {
  await signIn('nora@north.test', 'Nora-Own-Pass-1');
  await expectCode(svc.createSchoolAccount({ role: 'student', name: 'Dup', email: 'SAM@north.test' }), 'EMAIL_EXISTS');
  const first = await svc.createSchoolAccount({ role: 'student', name: 'Retry Ray', email: 'ray@north.test' });
  const again = await svc.createSchoolAccount({ role: 'student', name: 'Retry Ray', email: 'ray@north.test' });
  assert.equal(again.uid, first.uid);
  assert.equal(again.alreadyExisted, true);
  await signIn('sam@north.test', 'Sam-Own-Pass-1'); // untouched by the duplicate attempt
});

test('base-password change applies to future accounts only', async () => {
  await signIn('nora@north.test', 'Nora-Own-Pass-1');
  await svc.setSchoolBasePassword(north.schoolId, 'North-Base-2027');
  const late = await svc.createSchoolAccount({ role: 'coach', name: 'Late Coach', email: 'late@north.test' });
  assert.equal(late.temporaryPassword, 'North-Base-2027');
  await signIn('ray@north.test', 'North-Base-2026');
  await expectCode(svc.changeAccountPassword('North-Base-2026', 'North-Base-2027'), 'BASE_PASSWORD');
});

test('journey 4: email recovery completes setup for pending accounts and keeps onboarded accounts ready', async () => {
  await svc.callAccounts('status', {}, null).catch(() => {});
  await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=fake`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestType: 'PASSWORD_RESET', email: 'ray@north.test' }) });
  const codes = await (await fetch(`http://${AUTH}/emulator/v1/projects/${PROJECT}/oobCodes`)).json();
  const code = codes.oobCodes.filter(c => c.email === 'ray@north.test').pop().oobCode;
  assert.ok((await rest('/accounts:resetPassword?key=fake', { oobCode: code, newPassword: 'Ray-Recovered-1' })).ok);
  await signIn('ray@north.test', 'Ray-Recovered-1');
  assert.equal(access.onboardingState(await profile(auth.currentUser.uid)), 'passwordChangeRequired');
  assert.equal((await svc.completeAccountOnboarding()).state, 'ready');
  assert.equal(access.onboardingState(await profile(auth.currentUser.uid)), 'ready');

  // Already onboarded: recovery simply works and the account stays ready.
  await authApi.resetUserPassword('sam@north.test');
  const samCodes = await (await fetch(`http://${AUTH}/emulator/v1/projects/${PROJECT}/oobCodes`)).json();
  const samCode = samCodes.oobCodes.filter(c => c.email === 'sam@north.test').pop().oobCode;
  await rest('/accounts:resetPassword?key=fake', { oobCode: samCode, newPassword: 'Sam-Recovered-2' });
  await signIn('sam@north.test', 'Sam-Recovered-2');
  assert.equal(access.onboardingState(await profile(north.studentUid)), 'ready');
});

test('journey 3/8: a migrated existing student keeps history and regains practice access after changing the current password', async () => {
  const legacy = await rest('/accounts:signUp?key=fake', { email: 'legacy@north.test', password: 'Legacy-pass-1' });
  const uid = legacy.body.localId;
  const lookup = await rest(`/projects/${PROJECT}/accounts:lookup`, { localId: [uid] });
  await env.withSecurityRulesDisabled(async ctx => {
    const fdb = ctx.firestore();
    await setDoc(doc(fdb, 'users', uid), { role: 'student', status: 'active', institutionId: north.schoolId, email: 'legacy@north.test',
      mustChangePassword: true, passwordChangeRequiredAt: new Date(), passwordUpdatedAtBaseline: Number(lookup.body.users[0].passwordUpdatedAt) });
    await setDoc(doc(fdb, 'students', uid), { userId: uid, name: 'Legacy', institutionId: north.schoolId, coachId: north.coachUid, status: 'active' });
    await setDoc(doc(fdb, 'practiceSessions', 'legacy-history'), { studentId: uid, institutionId: north.schoolId, verdictStatus: 'aiPending', accuracyScore: 64 });
  });
  await signIn('legacy@north.test', 'Legacy-pass-1');
  await expectCode(svc.completeAccountOnboarding(), 'PASSWORD_NOT_CHANGED');
  await expectDenied(getDocFromServer(doc(db, 'practiceSessions', 'legacy-history')));
  await svc.changeAccountPassword('Legacy-pass-1', 'Legacy-pass-2');
  await authApi.reauthenticateWithNewPassword('legacy@north.test', 'Legacy-pass-2');
  assert.equal((await getDocFromServer(doc(db, 'practiceSessions', 'legacy-history'))).data().accuracyScore, 64);
  await setDoc(doc(db, 'practiceSessions', 'legacy-new'), { studentId: uid, institutionId: north.schoolId, verdictStatus: 'aiPending' });
  // The assigned coach still sees the student's history.
  await signIn('carl@north.test', 'Carl-Own-Pass-1');
  const sessions = await getDocs(query(collection(db, 'practiceSessions'), where('studentId', '==', uid)));
  assert.equal(sessions.size, 2);
});

test('journey 5: an older client cannot self-register or clear its own requirement', async () => {
  await signIn('late@north.test', 'North-Base-2027');
  const uid = auth.currentUser.uid;
  await expectDenied(setDoc(doc(db, 'users', uid), { mustChangePassword: false }, { merge: true }));
  await signOut(auth);
  const fresh = await rest('/accounts:signUp?key=fake', { email: 'selfsignup@north.test', password: 'Self-signup-1' });
  assert.ok(fresh.ok);
  await signIn('selfsignup@north.test', 'Self-signup-1');
  await expectDenied(setDoc(doc(db, 'users', auth.currentUser.uid), { uid: auth.currentUser.uid, role: 'student', status: 'active', institutionId: null, email: 'selfsignup@north.test' }));
  await expectCode(svc.callAccounts('status'), 'NO_PROFILE');
});
