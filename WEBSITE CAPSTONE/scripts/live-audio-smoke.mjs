// Exercises deployed Supabase audio + real Firebase authorization. All fixtures
// are unique to this run, and only those identities/documents/files are removed.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, deleteUser } from 'firebase/auth';
import owner from './firebase-owner.cjs';
import { auth } from '../src/firebase/config.js';

const endpoint = process.argv[2];
const { validateAudioEndpoint, uploadReferenceAudio, resolveAudioUrl } = await import('../src/firebase/audioService.js');
validateAudioEndpoint(endpoint);
const client = await owner.ownerClient();
const stamp = `audio_${Date.now().toString(36)}`;
const password = randomBytes(24).toString('base64url') + '9!aA';
const accounts = []; const paths = []; const audioRefs = [];
let admin, failure, count = 0;
async function create(label, role) {
  const user = (await createUserWithEmailAndPassword(auth, `harmonia-${stamp}-${label}@example.test`, password)).user;
  accounts.push(user);
  const token = await user.getIdToken();
  const data = { role, status: 'active', institutionId: stamp, firstName: 'Audio', lastName: label, email: user.email };
  paths.push(`users/${user.uid}`);
  await client.db.post(`/${owner.base}:commit`, { writes: [owner.createWrite(`users/${user.uid}`, data)] });
  return { user, token };
}
async function api(actor, params, body) {
  const url = new URL(endpoint); url.search = new URLSearchParams(params).toString();
  return fetch(url, { method: 'POST', headers: { ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
    ...(body ? { 'Content-Type': 'audio/wav' } : {}) }, body });
}
async function check(name, fn) { await fn(); count++; console.log(`PASS: ${name}`); }
// 2 seconds of valid mono PCM WAV, not a renamed arbitrary file.
const wav = Buffer.alloc(44 + 44100 * 2 * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(88200, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
for (let i = 0; i < 88200; i++) wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / 44100) * 12000), 44 + i * 2);

try {
  admin = await create('admin', 'admin');
  const coach = await create('coach', 'coach');
  const otherCoach = await create('othercoach', 'coach');
  const student = await create('student', 'student');
  const otherStudent = await create('otherstudent', 'student');
  for (const actor of [student, otherStudent]) {
    const path = `students/${actor.user.uid}`; paths.push(path);
    await client.db.post(`/${owner.base}:commit`, { writes: [owner.createWrite(path, {
      userId: actor.user.uid, status: 'active', institutionId: stamp, coachId: actor === student ? coach.user.uid : otherCoach.user.uid,
    })] });
  }
  const id = `${stamp}_attempt`;
  const ref = `supabase://harmonia-audio/attempts/${student.user.uid}/${id}`;
  // Track before sending: even a lost HTTP response must not leave a fixture.
  audioRefs.push(ref);
  await check('student uploads a real WAV to the private bucket', async () => {
    const result = await api(student, { action: 'upload', kind: 'attempts', id }, wav);
    const data = await result.json(); assert.equal(result.status, 200, JSON.stringify(data)); assert.equal(data.audioRef, ref);
  });
  await check('a retried upload succeeds without replacing the original', async () => {
    const result = await api(student, { action: 'upload', kind: 'attempts', id }, wav);
    assert.equal(result.status, 200, await result.text());
  });
  await check('student and assigned coach receive working short-lived playback links', async () => {
    for (const actor of [student, coach]) {
      const result = await api(actor, { action: 'playback', ref });
      const data = await result.json(); assert.equal(result.status, 200, JSON.stringify(data));
      assert.equal(data.expiresIn, 300);
      const download = await fetch(data.url); assert.equal(download.status, 200);
      assert.deepEqual(Buffer.from(await download.arrayBuffer()), wav);
    }
  });
  await check('another coach, another student and signed-out clients cannot play the recording', async () => {
    for (const actor of [otherCoach, otherStudent, null]) {
      const result = await api(actor, { action: 'playback', ref });
      assert.equal(result.status, actor ? 403 : 401, await result.text());
    }
  });
  await check('private recordings are unavailable through a public Storage URL', async () => {
    const url = new URL(endpoint);
    url.pathname = `/storage/v1/object/public/harmonia-audio/attempts/${student.user.uid}/${id}`;
    const response = await fetch(url); assert.ok(!response.ok);
  });
  await check('coach uploads reference audio; student can play but cannot upload references', async () => {
    const id = `${stamp}_reference`;
    const ref = `supabase://harmonia-audio/references/${coach.user.uid}/${id}`; audioRefs.push(ref);
    const upload = await api(coach, { action: 'upload', kind: 'references', id }, wav);
    assert.equal(upload.status, 200, await upload.text());
    const playback = await api(student, { action: 'playback', ref });
    assert.equal(playback.status, 200, await playback.text());
    const denied = await api(student, { action: 'upload', kind: 'references', id: `${id}_forbidden` }, wav);
    assert.equal(denied.status, 403, await denied.text());
  });
  await check('changing coach assignment immediately revokes the old coach access', async () => {
    await client.db.post(`/${owner.base}:commit`, { writes: [{ update: { name: `${owner.base}/students/${student.user.uid}`,
      fields: { coachId: owner.encode(otherCoach.user.uid) } }, updateMask: { fieldPaths: ['coachId'] } }] });
    const denied = await api(coach, { action: 'playback', ref }); assert.equal(denied.status, 403, await denied.text());
    const allowed = await api(otherCoach, { action: 'playback', ref }); assert.equal(allowed.status, 200, await allowed.text());
  });
  await check('the actual web service reads Firebase configuration and uploads/plays reference audio', async () => {
    await signInWithEmailAndPassword(auth, coach.user.email, password);
    const id = `${stamp}_web_reference`;
    const expected = `supabase://harmonia-audio/references/${coach.user.uid}/${id}`;
    audioRefs.push(expected);
    const ref = await uploadReferenceAudio(new Blob([wav], { type: 'audio/wav' }), id);
    assert.equal(ref, expected);
    const download = await fetch(await resolveAudioUrl(ref));
    assert.equal(download.status, 200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), wav);
  });
  await check('inactive accounts cannot obtain fresh playback links', async () => {
    await client.db.post(`/${owner.base}:commit`, { writes: [{ update: { name: `${owner.base}/users/${student.user.uid}`,
      fields: { status: owner.encode('inactive') } }, updateMask: { fieldPaths: ['status'] } }] });
    const denied = await api(student, { action: 'playback', ref }); assert.equal(denied.status, 403, await denied.text());
  });
} catch (error) { failure = error; }
finally {
  const errors = [];
  for (const ref of audioRefs) {
    try {
      const result = await api(admin, { action: 'delete', ref });
      if (!result.ok) errors.push(`Audio cleanup: HTTP ${result.status}`);
    } catch (error) { errors.push(`Audio cleanup: ${error.message}`); }
  }
  try { await client.db.post(`/${owner.base}:commit`, { writes: paths.map(path => ({ delete: `${owner.base}/${path}` })) }); }
  catch (error) { errors.push(`Document cleanup: ${error.message}`); }
  for (const user of accounts) {
    try { await deleteUser(user); } catch (error) { errors.push(`Identity cleanup: ${error.code || error.message}`); }
  }
  console.log(`Cleaned ${accounts.length} temporary identities, ${paths.length} documents and ${audioRefs.length} audio objects.`);
  if (errors.length) failure = new AggregateError([failure, ...errors].filter(Boolean), 'Fixture cleanup failed');
}
if (failure) { console.error(failure); process.exitCode = 1; }
else console.log(`All ${count} live audio checks passed.`);
// Firebase client sockets otherwise keep Node running after all checks finish.
process.exit(process.exitCode || 0);
