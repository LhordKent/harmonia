const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const globalCli = path.join(process.env.APPDATA || '', 'npm/node_modules/firebase-tools/lib/bin/firebase.js');
if (!fs.existsSync(globalCli)) throw new Error('Install the Firebase CLI (firebase-tools) to run emulator tests.');
const env = { ...process.env };
if (!env.JAVA_HOME) {
  const jdks = path.join(os.homedir(), '.gradle/jdks');
  const java = fs.existsSync(jdks) && fs.readdirSync(jdks).find(name => fs.existsSync(path.join(jdks, name, 'bin/java.exe')));
  if (java) env.JAVA_HOME = path.join(jdks, java);
}
const oldPath = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] || '';
for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
env.Path = [path.dirname(process.execPath), ...(env.JAVA_HOME ? [path.join(env.JAVA_HOME, 'bin')] : []), oldPath].join(path.delimiter);
const command = process.argv.includes('--browser') ? 'node scripts/browser-ai-smoke.mjs' : 'node --test --test-concurrency=1 tests/accounts.rules.test.mjs tests/accounts.services.test.mjs tests/grading.contract.test.mjs';
const result = spawnSync(process.execPath, [globalCli, 'emulators:exec', '--config', 'firebase.emulators.json', '--project', 'demo-harmonia', '--only', 'auth,firestore', command], { stdio: 'inherit', env });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
