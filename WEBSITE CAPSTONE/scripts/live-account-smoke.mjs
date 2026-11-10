// Real SDK/API smoke test. Creates isolated fixtures and removes exactly those fixtures in finally.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, deleteUser } from 'firebase/auth';
import { doc, getDocFromServer, getDocs, collection, writeBatch, setLogLevel } from 'firebase/firestore';
import owner from './firebase-owner.cjs';
import { auth, db } from '../src/firebase/config.js';
import { createAccountAuth } from '../src/firebase/auth.js';
import * as service from '../src/firebase/firestore.js';
import { requireWebProfile } from '../src/firebase/access.js';

if (process.env.HARMONIA_EMULATOR_PROJECT) throw new Error('This smoke test targets the confirmed live Harmonia project.');
setLogLevel('silent');
const client = await owner.ownerClient();
const stamp = Date.now().toString(36);
const institutionId = `demo_smoke_${stamp}`;
const password = randomBytes(24).toString('base64url') + '9!aA';
const identities = [];
const paths = new Set([`institutions/${institutionId}`]);
const checks = [];
async function check(name, fn) { await fn(); checks.push(name); console.log(`PASS: ${name}`); }
async function provision(label, role, coachId = null) {
  const email = `harmonia-smoke-${stamp}-${label}@example.test`;
  const save = u => {
    identities.push(u); paths.add(`users/${u.uid}`); paths.add(`${role === 'coach' ? 'coaches' : 'students'}/${u.uid}`);
    return role === 'coach'
      ? service.createCoach({ userId: u.uid, name: 'Smoke Coach', email, institutionId, status: 'active' })
      : service.createStudent({ userId: u.uid, name: 'Smoke Student', email, institutionId, coachId, status: 'active' });
  };
  return createAccountAuth(email, password, save);
}
let failure, independent;
try {
  const admin = (await createUserWithEmailAndPassword(auth, `harmonia-smoke-${stamp}-admin@example.test`, password)).user;
  identities.push(admin); paths.add(`users/${admin.uid}`);
  await client.db.post(`/projects/${owner.PROJECT}/databases/(default)/documents:commit`, { writes: [
    owner.createWrite(`users/${admin.uid}`, { role: 'admin', status: 'active', institutionId, firstName: 'Smoke', lastName: 'Admin', email: admin.email }),
    owner.createWrite(`institutions/${institutionId}`, { name: 'Temporary smoke-test institution', status: 'active' })
  ] });
  await check('real admin login and authoritative web profile', async () => {
    await signInWithEmailAndPassword(auth, admin.email, password);
    assert.equal(requireWebProfile(await service.getUserProfile(admin.uid)).role, 'admin');
  });
  const coach = await provision('coach', 'coach');
  const assigned = await provision('assigned', 'student', coach.uid);
  const unrelated = await provision('unrelated', 'student');
  await check('staff provisioning preserves admin identity and complete roster', async () => {
    assert.equal(auth.currentUser.uid, admin.uid);
    assert.equal((await service.getStudents(institutionId)).length, 2);
    assert.equal((await service.getCoaches(institutionId)).length, 1);
  });
  await check('coach sees only assigned student through actual application services', async () => {
    await signInWithEmailAndPassword(auth, coach.email, password);
    const viewer = { id: coach.uid, role: 'coach', institutionId };
    assert.deepEqual((await service.getStudents(institutionId, viewer)).map(s => s.id), [assigned.uid]);
    assert.equal((await service.getCoaches(institutionId, viewer)).length, 1);
    assert.equal((await service.getSessions(institutionId, viewer)).length, 0);
    await assert.rejects(getDocFromServer(doc(db, 'students', unrelated.uid)), /permission/i);
    await assert.rejects(getDocs(collection(db, 'students')), /permission/i);
  });
  await check('student login obtains the correct mobile profile and rejects web staff access', async () => {
    await signInWithEmailAndPassword(auth, assigned.email, password);
    const user = await service.getUserProfile(assigned.uid);
    const student = (await getDocFromServer(doc(db, 'students', assigned.uid))).data();
    assert.equal(user.status, 'active'); assert.equal(student.institutionId, institutionId);
    assert.equal(student.coachId, coach.uid);
    assert.throws(() => requireWebProfile(user), /mobile/i);
  });
  await check('wrong password is rejected by live Firebase Auth', async () => {
    await assert.rejects(signInWithEmailAndPassword(auth, assigned.email, 'incorrect-password'));
  });
  await check('deactivation synchronizes profiles and blocks student data access', async () => {
    await signInWithEmailAndPassword(auth, admin.email, password);
    await service.deactivateStudent(assigned.uid);
    assert.equal((await service.getUserProfile(assigned.uid)).status, 'inactive');
    await signInWithEmailAndPassword(auth, assigned.email, password);
    assert.equal((await service.getUserProfile(assigned.uid)).status, 'inactive');
    await assert.rejects(getDocFromServer(doc(db, 'students', assigned.uid)), /permission/i);
  });
  await check('live mobile-shaped independent signup creates both profiles', async () => {
    await signOut(auth);
    const u = (await createUserWithEmailAndPassword(auth, `harmonia-smoke-${stamp}-independent@example.test`, password)).user;
    independent = u;
    identities.push(u); paths.add(`users/${u.uid}`); paths.add(`students/${u.uid}`);
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', u.uid), { uid: u.uid, firstName: 'Smoke', lastName: 'Independent', email: u.email, role: 'student', status: 'active', institutionId: null, createdAt: 1, updatedAt: 1 });
    batch.set(doc(db, 'students', u.uid), { id: u.uid, userId: u.uid, name: 'Smoke Independent', fullName: 'Smoke Independent', firstName: 'Smoke', lastName: 'Independent', email: u.email, studentType: 'independent', status: 'active', institutionId: null, createdAt: 1, updatedAt: 1 });
    await batch.commit();
    assert.equal((await service.getUserProfile(u.uid)).role, 'student');
    assert.equal((await getDocFromServer(doc(db, 'students', u.uid))).data().institutionId, null);
  });
  await check('admin enrolls an independent signup and the assigned coach can see it', async () => {
    await signInWithEmailAndPassword(auth, admin.email, password);
    assert.ok((await service.getIndependentStudents()).some(s => s.id === independent.uid));
    await service.enrollStudent(independent.uid, institutionId, coach.uid);
    assert.equal((await service.getUserProfile(independent.uid)).institutionId, institutionId);
    await signInWithEmailAndPassword(auth, coach.email, password);
    assert.ok((await service.getStudents(institutionId, { id: coach.uid, role: 'coach', institutionId })).some(s => s.id === independent.uid));
  });
} catch (error) {
  failure = error;
} finally {
  const cleanupFailures = [];
  // Only document paths and Auth objects created in this invocation are eligible for cleanup.
  try {
    await client.db.post(`/projects/${owner.PROJECT}/databases/(default)/documents:commit`, { writes: [...paths].map(p => ({ delete: `${owner.base}/${p}` })) });
  } catch (error) { cleanupFailures.push(`Fixture document cleanup: ${error.message}`); }
  for (const identity of identities) {
    try { await deleteUser(identity); } catch (error) { cleanupFailures.push(`Fixture identity cleanup: ${error.code || error.message}`); }
  }
  await signOut(auth);
  if (cleanupFailures.length) {
    const backup = owner.privateBackup('smoke-cleanup', { createdUids: identities.map(u => u.uid), paths: [...paths], errors: cleanupFailures });
    console.error(`Fixture cleanup needs attention. Private manifest: ${backup}`);
    failure ||= new Error(cleanupFailures.join('; '));
  } else console.log(`PASS: cleaned ${identities.length} temporary Auth identities and ${paths.size} fixture document paths`);
}
if (failure) { console.error(failure.message); process.exitCode = 1; }
else console.log(`Live smoke test: ${checks.length} behavior checks passed.`);
// Firebase's Node transport can retain idle sockets after all operations finish.
await (await import('firebase/firestore')).terminate(db);
