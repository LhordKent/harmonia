// Sets the accounts function secrets from a downloaded Firebase Admin SDK key file.
//
//   node supabase/scripts/set-accounts-secrets.mjs <path-to-service-account.json>
//
// - FIREBASE_SERVICE_ACCOUNT: the key file contents (compact JSON).
// - SCHOOL_PASSWORD_KEY: a random AES-256 key, generated ONLY if the project does not have one yet.
//   Replacing it would make every stored school base password unreadable, so it is never rotated here.
// No secret value is printed. The temporary env file is deleted even if the command fails.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const PROJECT_REF = 'ztrnmbtdaruyffjqjejz';
const keyPath = process.argv[2];
if (!keyPath || !fs.existsSync(keyPath)) {
  console.error('Usage: node supabase/scripts/set-accounts-secrets.mjs <path-to-service-account.json>');
  process.exit(1);
}
const account = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
if (account.type !== 'service_account' || account.project_id !== 'harmonia-47c73' || !account.private_key || !account.client_email) {
  console.error('This is not a service-account key for the harmonia-47c73 Firebase project.');
  process.exit(1);
}

// Interactive commands inherit the terminal so the Supabase CLI can ask for production confirmation.
const supabase = (args, interactive = false) => spawnSync('npx', ['supabase', ...args, '--project-ref', PROJECT_REF],
  { encoding: 'utf8', shell: process.platform === 'win32', stdio: interactive ? 'inherit' : 'pipe' });
const listed = supabase(['secrets', 'list']);
if (listed.status !== 0) {
  console.error('Could not list Supabase secrets. Run `npx supabase login` first.');
  process.exit(1);
}
const hasEncryptionKey = /"SCHOOL_PASSWORD_KEY"/.test(listed.stdout);

const lines = [`FIREBASE_SERVICE_ACCOUNT='${JSON.stringify(account)}'`];
if (!hasEncryptionKey) lines.push(`SCHOOL_PASSWORD_KEY='${crypto.randomBytes(32).toString('base64')}'`);
const envFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'harmonia-secrets-')), 'accounts.env');
try {
  fs.writeFileSync(envFile, lines.join('\n') + '\n', { mode: 0o600 });
  const result = supabase(['secrets', 'set', '--env-file', envFile], true);
  if (result.status !== 0) {
    console.error('Setting secrets failed; nothing else was changed.');
    process.exitCode = 1;
  } else {
    console.log(`Set FIREBASE_SERVICE_ACCOUNT (${account.client_email})` +
      (hasEncryptionKey ? '; kept the existing SCHOOL_PASSWORD_KEY.' : ' and a new SCHOOL_PASSWORD_KEY.'));
    console.log('You can now delete the downloaded key file.');
  }
} finally {
  fs.rmSync(path.dirname(envFile), { recursive: true, force: true });
}
