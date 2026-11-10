import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection, query, where, updateDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { requireWebProfile } from '../src/firebase/access.js';

let env;
const dbFor = uid => env.authenticatedContext(uid, { email: `${uid}@example.test` }).firestore();
const user = (role, institutionId = 'inst1', status = 'active') => ({ role, institutionId, status, firstName: role, lastName: 'Test', email: 'fixture@example.test' });
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-harmonia', firestore: { rules: await fs.readFile('firestore.rules', 'utf8') } });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    const batch = writeBatch(db);
    for (const [id, data] of Object.entries({ admin: user('admin'), c1: user('coach'), c2: user('coach'), c3: user('coach', 'inst2'), manager: user('institution'), manager2: user('institution', 'inst2'), s1: user('student'), s2: user('student'), s3: user('student', 'inst2'), inactive: user('student', 'inst1', 'inactive'), deleted: user('student', null, 'deleted'),
      pendingS: { ...user('student'), mustChangePassword: true, passwordUpdatedAtBaseline: 5 }, pendingC: { ...user('coach'), mustChangePassword: true },
      pendingM: { ...user('institution'), mustChangePassword: true }, loner: user('student', null) })) batch.set(doc(db, 'users', id), data);
    for (const [id, coachId, institutionId] of [['s1', 'c1', 'inst1'], ['s2', 'c2', 'inst1'], ['s3', 'c3', 'inst2'], ['inactive', 'c1', 'inst1'], ['pendingS', 'c1', 'inst1'], ['loner', null, null]]) batch.set(doc(db, 'students', id), { userId: id, name: id, email: `${id}@example.test`, coachId, institutionId, status: 'active' });
    for (const [id, institutionId] of [['c1', 'inst1'], ['c2', 'inst1'], ['c3', 'inst2'], ['pendingC', 'inst1']]) batch.set(doc(db, 'coaches', id), { userId: id, name: id, institutionId, status: 'active' });
    for (const id of ['s1', 's2', 's3']) batch.set(doc(db, 'practiceSessions', id), { studentId: id, institutionId: id === 's3' ? 'inst2' : 'inst1', verdictStatus: 'aiPending', accuracyScore: 80, toneScore: 85 });
    batch.set(doc(db, 'institutions', 'inst1'), { name: 'School 1', status: 'active', basePasswordSet: true });
    batch.set(doc(db, 'coachAssessments', 'assessment1'), { studentId: 's1', coachId: 'c1', status: 'draft', updatedAt: 1 });
    await batch.commit();
  });
});
after(async () => { await env?.cleanup(); });

test('advancement requires explicit assigned-coach review and cannot be forged by the student', async () => {
  const review = { coachVerdict: 'Good stability', coachFeedback: 'Ready for the next exercise.', coachPitchScore: null,
    coachToneScore: null, verdictStatus: 'reviewed', advancementDecision: 'approved', reviewedBy: 'c1', reviewedAt: serverTimestamp() };
  await assertFails(updateDoc(doc(dbFor('s1'), 'practiceSessions', 's1'), review));
  await assertFails(updateDoc(doc(dbFor('c2'), 'practiceSessions', 's1'), { ...review, reviewedBy: 'c2' }));
  await assertSucceeds(updateDoc(doc(dbFor('c1'), 'practiceSessions', 's1'), review));
  await assertFails(setDoc(doc(dbFor('s1'), 'practiceSessions', 'forgedApproval'), {
    studentId: 's1', institutionId: 'inst1', verdictStatus: 'aiPending', advancementDecision: 'approved' }));
  await assertFails(setDoc(doc(dbFor('manager'), 'practiceSessions', 'forgedStaffApproval'), {
    studentId: 's1', institutionId: 'inst1', verdictStatus: 'reviewed', advancementDecision: 'approved', reviewedBy: 'manager', reviewedAt: serverTimestamp() }));
});

function independentSignup(uid, overrides = {}, profileOverrides = {}) {
  const db = dbFor(uid); const batch = writeBatch(db);
  batch.set(doc(db, 'users', uid), { uid, firstName: 'New', lastName: 'Student', email: `${uid}@example.test`, role: 'student', status: 'active', institutionId: null, createdAt: 1, updatedAt: 1, ...overrides });
  batch.set(doc(db, 'students', uid), { id: uid, userId: uid, name: 'New Student', fullName: 'New Student', firstName: 'New', lastName: 'Student', email: `${uid}@example.test`, studentType: 'independent', status: 'active', institutionId: null, createdAt: 1, updatedAt: 1, ...profileOverrides });
  return batch.commit();
}

test('signed-out clients cannot read private users or roster', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'users', 's1')));
  await assertFails(getDocs(collection(db, 'students')));
});
test('public and student self-provisioning is denied, including the former Android signup shape', async () => {
  await assertFails(independentSignup('new1'));
  await assertFails(independentSignup('newadmin', { role: 'admin' }));
  await assertFails(independentSignup('newinst', { institutionId: 'inst1' }, { institutionId: 'inst1' }));
  await assertFails(setDoc(doc(dbFor('partial'), 'users', 'partial'), { uid: 'partial', email: 'partial@example.test', role: 'student', status: 'active', institutionId: null }));
});
test('pending users read only their own onboarding profile; protected data stays denied', async () => {
  for (const id of ['pendingS', 'pendingC', 'pendingM']) {
    const db = dbFor(id);
    await assertSucceeds(getDoc(doc(db, 'users', id)));
    await assertFails(getDoc(doc(db, 'appConfig', 'audio')));
    await assertFails(getDoc(doc(db, 'institutions', 'inst1')));
    await assertFails(getDocs(query(collection(db, 'exercises'), where('institutionId', '==', 'inst1'))));
    await assertFails(getDocs(query(collection(db, 'students'), where('institutionId', '==', 'inst1'))));
  }
  const student = dbFor('pendingS');
  await assertFails(getDoc(doc(student, 'students', 'pendingS')));
  await assertFails(setDoc(doc(student, 'practiceSessions', 'pending-session'), { studentId: 'pendingS', institutionId: 'inst1', verdictStatus: 'aiPending' }));
  await assertFails(setDoc(doc(student, 'students', 'pendingS', 'practiceAttempts', 'a1'), { studentId: 'pendingS' }));
  await assertFails(getDoc(doc(dbFor('pendingC'), 'students', 's1')));
});
test('onboarding fields cannot be cleared or forged by any client, including administrators', async () => {
  await assertFails(updateDoc(doc(dbFor('pendingS'), 'users', 'pendingS'), { mustChangePassword: false }));
  await assertFails(updateDoc(doc(dbFor('pendingS'), 'users', 'pendingS'), { passwordUpdatedAtBaseline: 0 }));
  await assertFails(updateDoc(doc(dbFor('manager'), 'users', 'pendingS'), { mustChangePassword: false }));
  await assertFails(updateDoc(doc(dbFor('admin'), 'users', 'pendingS'), { mustChangePassword: false }));
  await assertFails(updateDoc(doc(dbFor('admin'), 'users', 's1'), { mustChangePassword: true }));
  await assertSucceeds(updateDoc(doc(dbFor('s1'), 'users', 's1'), { firstName: 'Renamed' }));
});
test('unenrolled students cannot reach normal data until a school enrolls them', async () => {
  const db = dbFor('loner');
  await assertSucceeds(getDoc(doc(db, 'users', 'loner')));
  await assertFails(getDoc(doc(db, 'students', 'loner')));
  await assertFails(setDoc(doc(db, 'practiceSessions', 'loner-session'), { studentId: 'loner', institutionId: null, verdictStatus: 'aiPending' }));
});
test('school base-password secrets are never readable or writable by clients', async () => {
  for (const id of ['admin', 'manager', 's1']) {
    await assertFails(getDoc(doc(dbFor(id), 'schoolSecrets', 'inst1')));
    await assertFails(setDoc(doc(dbFor(id), 'schoolSecrets', 'inst1'), { ciphertext: 'x' }));
  }
  await assertFails(updateDoc(doc(dbFor('manager'), 'institutions', 'inst1'), { basePasswordSet: false }));
  await assertSucceeds(updateDoc(doc(dbFor('manager'), 'institutions', 'inst1'), { name: 'Renamed School' }));
  await assertFails(updateDoc(doc(dbFor('manager2'), 'institutions', 'inst1'), { name: 'Hijacked' }));
});
test('school administrators manage only their own roster and cannot approve advancement', async () => {
  await assertSucceeds(updateDoc(doc(dbFor('manager'), 'students', 's1'), { coachId: 'c2' }));
  await assertSucceeds(updateDoc(doc(dbFor('manager'), 'students', 's1'), { coachId: 'c1' }));
  await assertSucceeds(updateDoc(doc(dbFor('manager'), 'users', 'c2'), { status: 'inactive' }));
  await assertSucceeds(updateDoc(doc(dbFor('manager'), 'users', 'c2'), { status: 'active' }));
  await assertFails(updateDoc(doc(dbFor('manager'), 'users', 'c2'), { email: 'changed@example.test' }));
  await assertFails(updateDoc(doc(dbFor('manager'), 'students', 's3'), { status: 'inactive' }));
  await assertFails(updateDoc(doc(dbFor('manager2'), 'users', 's1'), { status: 'inactive' }));
  await assertFails(updateDoc(doc(dbFor('manager'), 'practiceSessions', 's2'), { coachVerdict: 'Good stability', coachFeedback: 'x',
    coachPitchScore: null, coachToneScore: null, verdictStatus: 'reviewed', advancementDecision: 'approved', reviewedBy: 'manager', reviewedAt: serverTimestamp() }));
});
test('student can read own profile and cannot read another student', async () => {
  await assertSucceeds(getDoc(doc(dbFor('s1'), 'students', 's1')));
  await assertFails(getDoc(doc(dbFor('s1'), 'students', 's2')));
  await assertFails(getDocs(collection(dbFor('s1'), 'students')));
});
test('student cannot change role, status, membership or coach assignment', async () => {
  const db = dbFor('s1');
  for (const change of [{ role: 'admin' }, { status: 'active', institutionId: 'inst2' }]) await assertFails(updateDoc(doc(db, 'users', 's1'), change));
  for (const change of [{ coachId: 'c2' }, { institutionId: 'inst2' }, { status: 'inactive' }]) await assertFails(updateDoc(doc(db, 'students', 's1'), change));
});
test('coach can query assigned roster with institution constraint', async () => {
  const snap = await assertSucceeds(getDocs(query(collection(dbFor('c1'), 'students'), where('coachId', '==', 'c1'), where('institutionId', '==', 'inst1'))));
  assert.equal(snap.size, 3);
});
test('coach cannot use broad list, wrong institution or another coach roster', async () => {
  const db = dbFor('c1');
  await assertFails(getDocs(collection(db, 'students')));
  await assertFails(getDocs(query(collection(db, 'students'), where('coachId', '==', 'c2'), where('institutionId', '==', 'inst1'))));
  await assertFails(getDoc(doc(db, 'students', 's3')));
});
test('coach cannot reassign students or modify account role/status', async () => {
  await assertFails(updateDoc(doc(dbFor('c1'), 'students', 's1'), { coachId: 'c2' }));
  await assertFails(updateDoc(doc(dbFor('c1'), 'users', 'c1'), { role: 'admin' }));
});
test('coach sessions are scoped by assigned student', async () => {
  await assertSucceeds(getDocs(query(collection(dbFor('c1'), 'practiceSessions'), where('studentId', '==', 's1'))));
  await assertFails(getDocs(collection(dbFor('c1'), 'practiceSessions')));
  await assertFails(getDoc(doc(dbFor('c1'), 'practiceSessions', 's2')));
});
test('coach can read own profile but cannot enumerate other coaches', async () => {
  await assertSucceeds(getDoc(doc(dbFor('c1'), 'coaches', 'c1')));
  await assertFails(getDocs(collection(dbFor('c1'), 'coaches')));
});
test('institution manager roster access stays within own institution', async () => {
  await assertSucceeds(getDocs(query(collection(dbFor('manager'), 'students'), where('institutionId', '==', 'inst1'))));
  await assertFails(getDocs(query(collection(dbFor('manager'), 'students'), where('institutionId', '==', 'inst2'))));
  await assertFails(updateDoc(doc(dbFor('manager'), 'users', 'admin'), { role: 'coach' }));
});
test('admin and institution-manager session queries remain usable and scoped', async () => {
  await assertSucceeds(getDocs(query(collection(dbFor('admin'), 'practiceSessions'), where('institutionId', '==', 'inst1'))));
  await assertSucceeds(getDocs(query(collection(dbFor('manager'), 'practiceSessions'), where('institutionId', '==', 'inst1'))));
  await assertFails(getDocs(query(collection(dbFor('manager'), 'practiceSessions'), where('institutionId', '==', 'inst2'))));
});
test('student session writes cannot forge another institution', async () => {
  await assertFails(setDoc(doc(dbFor('s1'), 'practiceSessions', 'forged-institution'), { studentId: 's1', institutionId: 'inst2', verdictStatus: 'aiPending' }));
});
test('no client, including staff, can create account profiles directly', async () => {
  const db = dbFor('manager'); const batch = writeBatch(db);
  batch.set(doc(db, 'users', 'managed-coach'), user('coach'));
  batch.set(doc(db, 'coaches', 'managed-coach'), { userId: 'managed-coach', institutionId: 'inst1', status: 'active', name: 'Coach' });
  await assertFails(batch.commit());
  await assertFails(setDoc(doc(dbFor('admin'), 'users', 'admin-made'), user('coach')));
  await assertFails(setDoc(doc(dbFor('admin'), 'students', 'admin-made'), { userId: 'admin-made', institutionId: 'inst1', status: 'active' }));
});
test('staff cannot assign a coach from another institution', async () => {
  await assertFails(updateDoc(doc(dbFor('admin'), 'students', 's1'), { coachId: 'c3' }));
});
test('inactive student can read own status but cannot read protected data or write practice', async () => {
  const db = dbFor('inactive');
  await assertSucceeds(getDoc(doc(db, 'users', 'inactive')));
  await assertFails(getDoc(doc(db, 'students', 'inactive')));
  await assertFails(setDoc(doc(db, 'practiceSessions', 'inactive-new'), { studentId: 'inactive', verdictStatus: 'aiPending' }));
});
test('coach assessment queries require coach scope and assignment', async () => {
  await assertSucceeds(getDocs(query(collection(dbFor('c1'), 'coachAssessments'), where('studentId', '==', 's1'), where('coachId', '==', 'c1'))));
  await assertFails(getDocs(query(collection(dbFor('c1'), 'coachAssessments'), where('studentId', '==', 's1'))));
  await assertFails(setDoc(doc(dbFor('c2'), 'coachAssessments', 'forged'), { studentId: 's1', coachId: 'c2' }));
});
test('web role validation is shared by login and restored session paths', () => {
  for (const role of ['admin', 'institution', 'coach']) assert.equal(requireWebProfile({ role, status: 'active', firstName: 'Test' }).name, 'Test');
  for (const profile of [null, { role: 'student', status: 'active' }, { role: 'coach', status: 'inactive' }, { role: 'unknown', status: 'active' }]) assert.throws(() => requireWebProfile(profile));
});
test('mobile and web rules copies are identical', async () => {
  assert.equal(await fs.readFile('firestore.rules', 'utf8'), await fs.readFile('../HarmoniaAppMobile/firebase/firestore.rules', 'utf8'));
});

test('audio endpoint configuration is readable by active accounts and writable only by admins', async () => {
  await assertSucceeds(setDoc(doc(dbFor('admin'), 'appConfig', 'audio'), { endpoint: 'https://example.supabase.co/functions/v1/audio' }));
  await assertSucceeds(getDoc(doc(dbFor('s1'), 'appConfig', 'audio')));
  await assertSucceeds(getDoc(doc(dbFor('c1'), 'appConfig', 'audio')));
  await assertFails(getDoc(doc(dbFor('inactive'), 'appConfig', 'audio')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'appConfig', 'audio')));
  await assertFails(updateDoc(doc(dbFor('s1'), 'appConfig', 'audio'), { endpoint: 'https://evil.test' }));
  await assertFails(updateDoc(doc(dbFor('c1'), 'appConfig', 'audio'), { endpoint: 'https://evil.test' }));
});

test('mobile can sync an insufficient recording without promoting it to a coach verdict', async () => {
  const db = dbFor('s1');
  await assertSucceeds(setDoc(doc(db, 'practiceSessions', 'short-recording'), {
    studentId: 's1', institutionId: 'inst1', verdictStatus: 'insufficientAudio', accuracyScore: 0, overallScore: 0,
  }));
  await assertSucceeds(setDoc(doc(db, 'students', 's1', 'practiceAttempts', 'short-recording', 'analysisResult', 'result'), {
    verdictStatus: 'insufficientAudio', accuracyScore: 0, overallScore: 0,
  }));
  await assertFails(updateDoc(doc(db, 'practiceSessions', 'short-recording'), { verdictStatus: 'reviewed', coachVerdict: 'pass' }));
});

test('only authorized staff may review; machine evidence, identity and review provenance are protected', async () => {
  const review = { coachVerdict: 'Good stability', coachFeedback: 'Steady breath.', coachPitchScore: 82, coachToneScore: 78,
    verdictStatus: 'reviewed', reviewedBy: 'c1', reviewedAt: serverTimestamp() };
  await assertSucceeds(updateDoc(doc(dbFor('c1'), 'practiceSessions', 's1'), review));
  await assertFails(updateDoc(doc(dbFor('c2'), 'practiceSessions', 's1'), { ...review, reviewedBy: 'c2' }));
  await assertFails(updateDoc(doc(dbFor('s1'), 'practiceSessions', 's1'), review));
  for (const patch of [{ accuracyScore: 99 }, { toneScore: 99 }, { studentId: 's2' }, { reviewedBy: 'c2' }, { coachPitchScore: 101 }, { reviewedAt: 1 }]) {
    await assertFails(updateDoc(doc(dbFor('c1'), 'practiceSessions', 's1'), { ...review, ...patch }));
  }
  await assertFails(setDoc(doc(dbFor('s1'), 'practiceSessions', 'forged-review'), { studentId: 's1', institutionId: 'inst1', ...review }));
});
