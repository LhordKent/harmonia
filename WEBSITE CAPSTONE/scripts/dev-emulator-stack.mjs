// Local, fully isolated browser check: Firebase emulators + the real accounts handler + Vite.
// Run with `npm run dev:emulators`. Nothing here touches the live project.
import http from 'node:http';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createAccountsHandler } from '../../supabase/functions/accounts/handler.mjs';

const PROJECT = 'demo-harmonia';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST;
if (!AUTH || !FIRESTORE) throw new Error('Start through `npm run dev:emulators` (firebase emulators:exec).');
const fixture = JSON.parse(fs.readFileSync(new URL('./emulator-fixtures.json', import.meta.url), 'utf8'));

const handle = createAccountsHandler({
  firebaseProject: PROJECT, firebaseApiKey: 'fake-api-key', encryptionKey: randomBytes(32).toString('base64'),
  identityToolkitUrl: `http://${AUTH}/identitytoolkit.googleapis.com/v1`, firestoreUrl: `http://${FIRESTORE}/v1`,
}, { accessToken: async () => 'owner' });
const server = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const response = await handle(new Request(`http://localhost${req.url}`, { method: req.method, headers: req.headers,
    body: req.method === 'POST' ? Buffer.concat(chunks) : undefined }));
  res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
});
await new Promise(r => server.listen(8789, '127.0.0.1', r));

// Seed the emulator-only platform administrator (see emulator-fixtures.json).
const signUp = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: fixture.platformAdmin.email, password: fixture.platformAdmin.password }) });
const { localId } = await signUp.json();
await fetch(`http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/users/${localId}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
  body: JSON.stringify({ fields: { role: { stringValue: 'admin' }, status: { stringValue: 'active' },
    institutionId: { nullValue: null }, name: { stringValue: 'Local Platform Admin' }, email: { stringValue: fixture.platformAdmin.email } } }) });
await fetch(`http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/appConfig/audio`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
  body: JSON.stringify({ fields: { endpoint: { stringValue: 'http://127.0.0.1:8789/audio-disabled-locally' } } }) });

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5173', '--strictPort'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_EMULATOR_PROJECT: PROJECT, VITE_AUTH_EMULATOR_HOST: AUTH, VITE_FIRESTORE_EMULATOR_HOST: FIRESTORE,
    VITE_ACCOUNTS_ENDPOINT: 'http://127.0.0.1:8789/accounts' },
});
console.log('Local stack ready: http://localhost:5173 (emulators only).');
const stop = () => { vite.kill(); server.close(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
await new Promise(resolve => vite.on('exit', resolve));
server.close();
