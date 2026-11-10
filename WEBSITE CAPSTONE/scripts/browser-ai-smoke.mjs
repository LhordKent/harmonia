// Local emulator-only UI test. Storage is mocked; model inference, login, validation and Firestore are real.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, getDocs, collection } from 'firebase/firestore';
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Run through Firebase emulators:exec.');
process.env.HARMONIA_EMULATOR_PROJECT = 'demo-harmonia';
const { auth, db } = await import('../src/firebase/config.js');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const env = await initializeTestEnvironment({ projectId: 'demo-harmonia', firestore: { rules: await fs.readFile('firestore.rules', 'utf8') } });
let browser, page;
try {
  await env.clearFirestore();
  const email = `ai-ui-${Date.now()}@example.test`, password = 'Local-emulator-only-938!';
  const user = (await createUserWithEmailAndPassword(auth, email, password)).user;
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', user.uid), { role: 'coach', status: 'active', institutionId: 'ui-test', firstName: 'Test', lastName: 'Coach', email });
    await setDoc(doc(context.firestore(), 'coaches', user.uid), { userId: user.uid, name: 'Test Coach', institutionId: 'ui-test', status: 'active' });
    await setDoc(doc(context.firestore(), 'appConfig', 'audio'), { endpoint: 'https://ui-test.supabase.co/functions/v1/audio' });
  });
  browser = await playwright.chromium.launch({ channel: 'msedge', headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.setDefaultTimeout(30000);
  const runtimeErrors = [];
  page.on('pageerror', error => { runtimeErrors.push(error.message); console.error('Browser runtime:', error.message); });
  await page.addInitScript(endpoints => { globalThis.process = { env: endpoints }; }, {
    HARMONIA_EMULATOR_PROJECT: 'demo-harmonia', FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST, FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
  });
  await page.route('https://ui-test.supabase.co/functions/v1/audio?**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ audioRef: `supabase://harmonia-audio/references/${user.uid}/ui-test` }) }));
  await page.goto(process.env.HARMONIA_TEST_URL || 'http://127.0.0.1:5174/login');
  await page.getByLabel('Institutional Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  console.log('Browser: submitted emulator coach login.');
  await page.waitForURL('**/dashboard');
  await page.getByRole('link', { name: /Exercises/ }).first().click();
  await page.getByRole('button', { name: 'Create Exercise', exact: true }).first().click();
  await page.getByLabel('Exercise Title', { exact: true }).fill('UI validated full song');
  await page.getByLabel('Practice type').selectOption('song');
  const size = 16000 * 6, wav = Buffer.alloc(44 + size * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(size * 2, 40);
  for (let i = 0; i < size; i++) {
    const phase = 2 * Math.PI * (i < 48000 ? 261.63 : 329.63) * i / 16000;
    wav.writeInt16LE(Math.round(32767 * (.35 * Math.sin(phase) + .15 * Math.sin(2 * phase) + .05 * Math.sin(3 * phase))), 44 + i * 2);
  }
  await page.locator('input[type=file]').setInputFiles({ name: 'solo-reference.wav', mimeType: 'audio/wav', buffer: wav });
  await page.getByRole('button', { name: 'Extract notes from selected audio' }).click();
  console.log('Browser: extracting the reference melody in the model worker.');
  await page.getByLabel(/I have checked and approve/).waitFor({ state: 'visible', timeout: 90000 });
  await page.waitForFunction(() => !document.querySelector('section[aria-label="Target melody"] input[type=checkbox]')?.disabled, null, { timeout: 90000 });
  await page.getByLabel(/I have checked and approve/).check();
  const artifactDir = path.resolve('../artifacts'); await fs.mkdir(artifactDir, { recursive: true });
  await page.screenshot({ path: path.join(artifactDir, 'ai-exercise-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(artifactDir, 'ai-exercise-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.locator('form button[type=submit]').click();
  await page.waitForFunction(() => !document.querySelector('form #title-input'), null, { timeout: 30000 });
  const exercises = await getDocs(collection(db, 'exercises'));
  const saved = exercises.docs.map(d => d.data()).find(d => d.title === 'UI validated full song');
  assert.ok(saved, 'UI did not publish the exercise'); assert.equal(saved.exerciseType, 'song');
  assert.equal(saved.targetApproved, true); assert.ok(saved.targetNotes.length >= 2);
  assert.equal(saved.toleranceCents, 50); assert.equal(saved.passMark, 60);
  assert.deepEqual(runtimeErrors, [], 'Browser runtime errors');
  console.log('PASS: real browser login, worker-based neural reference extraction, coach target approval and Firestore publication; desktop/mobile screenshots captured.');
} catch (error) { console.error(error); if (page) console.error('Browser state:', page.url(), (await page.locator('body').innerText()).slice(0,1200)); process.exitCode = 1; }
finally { await browser?.close(); await env.cleanup(); process.exit(process.exitCode || 0); }
