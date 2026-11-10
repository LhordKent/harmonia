// Live integration test: the actual Android worker uploads, the actual website
// service reviews, then Android's real listeners persist both kinds of feedback.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, deleteUser } from 'firebase/auth';
import { auth } from '../src/firebase/config.js';
import { uploadReferenceAudio, resolveAudioUrl } from '../src/firebase/audioService.js';
import { updateSession, createExercise } from '../src/firebase/firestore.js';
import { saveCoachAssessment } from '../src/firebase/feedbackService.js';
import owner from './firebase-owner.cjs';

const defense = process.argv.includes('--defense');
const audioRefs = [];
const mobile = fileURLToPath(new URL('../../HarmoniaAppMobile/', import.meta.url));
const asset = path.join(mobile, 'app/src/androidTest/assets/review-e2e.local.json');
const logPath = path.join(os.tmpdir(), 'harmonia-native-review-test.log');
const stamp = `native_${Date.now().toString(36)}`, attemptId = `${stamp}_attempt`;
const password = randomBytes(24).toString('base64url') + '9!aA';
const client = await owner.ownerClient();
const accounts = [], paths = new Set();
let admin, student, failure, child, output = '', completed = false, assetWritten = false, exerciseId = null;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function account(label, role) {
  const user = (await createUserWithEmailAndPassword(auth, `harmonia-${stamp}-${label}@example.test`, password)).user;
  accounts.push(user); paths.add(`users/${user.uid}`);
  await client.db.post(`/${owner.base}:commit`, { writes: [owner.createWrite(`users/${user.uid}`, {
    role, status: 'active', institutionId: stamp, firstName: 'Native', lastName: label, email: user.email,
  })] });
  return { user, token: await user.getIdToken() };
}
try {
  if (fs.existsSync(asset)) throw Error('An existing local test fixture needs cleanup before this test can run.');
  admin = await account('admin', 'admin');
  const coach = await account('coach', 'coach');
  student = await account('student', 'student');
  paths.add(`coaches/${coach.user.uid}`); paths.add(`students/${student.user.uid}`);
  paths.add(`practiceSessions/${attemptId}`);
  paths.add(`students/${student.user.uid}/practiceAttempts/${attemptId}`);
  paths.add(`students/${student.user.uid}/practiceAttempts/${attemptId}/analysisResult/result_${attemptId}`);
  await client.db.post(`/${owner.base}:commit`, { writes: [
    owner.createWrite(`coaches/${coach.user.uid}`, { userId: coach.user.uid, institutionId: stamp, status: 'active', name: 'Native Coach' }),
    owner.createWrite(`students/${student.user.uid}`, { userId: student.user.uid, institutionId: stamp, coachId: coach.user.uid, status: 'active', name: 'Native Student' }),
  ] });
  if (defense) {
    await signInWithEmailAndPassword(auth, coach.user.email, password);
    const wav = Buffer.alloc(44 + 44100 * 3 * 2);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(88200, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
    for (let i = 0; i < 44100 * 3; i++) wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 261.63 * i / 44100) * 12000), 44 + i * 2);
    const refId = `${stamp}_reference`;
    audioRefs.push(`supabase://harmonia-audio/references/${coach.user.uid}/${refId}`);
    const referenceAudioRef = await uploadReferenceAudio(new Blob([wav], { type: 'audio/wav' }), refId);
    const exercise = await createExercise({ title: 'Defense C4 sustain', tier: 'Beginner', duration: 3, targetPitchData: 261.63,
      referenceAudioRef, targetToneData: null, coachId: coach.user.uid, institutionId: stamp, unlockCriteria: 'None' });
    exerciseId = exercise.id; paths.add(`exercises/${exerciseId}`);
  }
  fs.mkdirSync(path.dirname(asset), { recursive: true });
  fs.writeFileSync(asset, JSON.stringify({ studentId: student.user.uid, studentEmail: student.user.email, password, institutionId: stamp, attemptId, exerciseId }));
  assetWritten = true;
  console.log('Provisioned isolated fixtures; starting Android worker/listener and migration tests on emulator-5580.');
  const env = { ...process.env, JAVA_HOME: 'C:\\Program Files\\Android\\Android Studio\\jbr', ANDROID_SERIAL: 'emulator-5580' };
  const existingPath = Object.keys(env).find(key => key.toLowerCase() === 'path');
  env[existingPath || 'Path'] = `${env.JAVA_HOME}\\bin;${env[existingPath || 'Path'] || ''}`;
  const testClass = defense ? 'DefenseRehearsalInstrumentedTest' : 'CoachReviewInstrumentedTest';
  child = spawn('powershell.exe', ['-NoProfile', '-Command', `.\\gradlew.bat :app:connectedDebugAndroidTest '-Pandroid.testInstrumentationRunnerArguments.class=com.harmonia.app.${testClass}' --no-configuration-cache --console=plain`], { cwd: mobile, env, windowsHide: true });
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  let exitCode;
  child.on('error', error => { failure = error; completed = true; });
  child.on('exit', code => { exitCode = code; completed = true; });
  let published = false;
  const deadline = Date.now() + 480_000;
  while (!completed && Date.now() < deadline) {
    if (!published) {
      let session;
      try {
        if (defense) session = (await owner.list(client.db, 'practiceSessions')).find(doc => owner.unpack(doc).studentId === student.user.uid);
        else session = (await client.db.get(`/${owner.base}/practiceSessions/${attemptId}`)).body;
      }
      catch (error) { if (error.status !== 404) throw error; }
      if (session) {
        const data = owner.unpack(session);
        assert.equal(data.studentId, student.user.uid);
        if (defense) assert.ok(data.accuracyScore > 90, 'C4 analysis did not use the web exercise target');
        else assert.equal(data.accuracyScore, 45);
        const sessionId = data.id; paths.add(`practiceSessions/${sessionId}`); audioRefs.push(data.audioStoragePath);
        assert.ok(data.audioStoragePath.startsWith('supabase://harmonia-audio/attempts/'));
        console.log('PASS: actual Android SyncWorker uploaded private audio and atomically wrote the session.');
        await signInWithEmailAndPassword(auth, coach.user.email, password);
        if (defense) {
          assert.equal(data.gradingEvidence.engine, 'swiftf0-d1ba77fe');
          assert.equal(data.gradingEvidence.policy.passMark, 60);
          const audio = await fetch(await resolveAudioUrl(data.audioStoragePath));
          assert.ok(audio.ok); assert.equal(audio.headers.get('content-type')?.split(';')[0], 'audio/mp4');
          assert.equal(Buffer.from(await audio.arrayBuffer()).subarray(4, 8).toString(), 'ftyp');
          console.log('PASS: assigned coach can fetch the actual AAC/M4A recording from private storage.');
        }
        await updateSession(sessionId, { coachVerdict: 'Good stability', coachPitchScore: 82, coachToneScore: 78, coachFeedback: 'Native roundtrip feedback', advancementDecision: 'approved' });
        const assessment = await saveCoachAssessment({ studentId: student.user.uid, coachId: coach.user.uid, coachName: 'Native Coach', institutionId: stamp,
          coachFeedback: 'Native general assessment', finalVerdict: 'approved', status: 'finalized' });
        paths.add(`coachAssessments/${assessment.id}`);
        published = true;
        console.log('PASS: actual website services published coach correction and finalized general assessment.');
      }
    }
    await sleep(1000);
  }
  if (!completed) throw Error('Native review test exceeded eight minutes.');
  fs.writeFileSync(logPath, output);
  if (failure) throw failure;
  assert.equal(exitCode, 0, `Android test failed. Log: ${logPath}\n${output.slice(-7000)}`);
  assert.ok(published, 'Android did not upload its test session.');
  console.log(defense ? 'PASS: Android microphone lifecycle and complete C4 defense rehearsal, including visible coach feedback and offline cache.'
    : 'PASS: real Android Room migration, live feedback listeners and offline cached feedback assertions.');
} catch (error) { failure = error; }
finally {
  if (child && !completed) {
    child.kill();
    // Stop only this test package before removing its temporary cloud fixtures.
    await new Promise(resolve => {
      const stop = spawn('C:\\Users\\Admin\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe', ['-s', 'emulator-5580', 'shell', 'am', 'force-stop', 'com.harmonia.app'], { windowsHide: true });
      stop.on('exit', resolve); stop.on('error', resolve);
    });
  }
  fs.writeFileSync(logPath, output);
  if (assetWritten && fs.existsSync(asset)) fs.unlinkSync(asset);
  const errors = [];
  if (student) {
    try {
      for (const attempt of await owner.list(client.db, `students/${student.user.uid}/practiceAttempts`)) {
        const data = owner.unpack(attempt); const id = data.id;
        if (data.audioRecordingUrl?.startsWith('supabase://')) audioRefs.push(data.audioRecordingUrl);
        paths.add(`practiceSessions/${id}`);
        paths.add(`students/${student.user.uid}/practiceAttempts/${id}`);
        for (const result of await owner.list(client.db, `students/${student.user.uid}/practiceAttempts/${id}/analysisResult`)) paths.add(`students/${student.user.uid}/practiceAttempts/${id}/analysisResult/${owner.unpack(result).id}`);
      }
      for (const report of await owner.list(client.db, `students/${student.user.uid}/progressReports`)) paths.add(`students/${student.user.uid}/progressReports/${owner.unpack(report).id}`);
    } catch (error) { errors.push(`Nested fixture cleanup: ${error.message}`); }
  }
  if (student && admin) {
    try {
      for (const ref of new Set([...audioRefs, `supabase://harmonia-audio/attempts/${student.user.uid}/${attemptId}`])) {
      const result = await fetch('https://ztrnmbtdaruyffjqjejz.supabase.co/functions/v1/audio?action=delete&ref=' + encodeURIComponent(ref), {
        method: 'POST', headers: { Authorization: `Bearer ${admin.token}` },
      });
      if (!result.ok) errors.push(`Audio cleanup HTTP ${result.status}`);
      }
    } catch (error) { errors.push(error.message); }
  }
  try { if (paths.size) await client.db.post(`/${owner.base}:commit`, { writes: [...paths].map(p => ({ delete: `${owner.base}/${p}` })) }); }
  catch (error) { errors.push(error.message); }
  for (const user of accounts) { try { await deleteUser(user); } catch (error) { errors.push(error.code || error.message); } }
  console.log(`Cleaned ${accounts.length} temporary identities, ${paths.size} document paths, recording and local credential asset.`);
  if (errors.length) failure = new AggregateError([failure, ...errors].filter(Boolean), 'Native smoke cleanup failed');
}
if (failure) { console.error(failure); process.exit(1); }
console.log(`Native feedback roundtrip passed. Test log: ${logPath}`);
process.exit(0);
