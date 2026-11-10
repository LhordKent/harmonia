// Administrative scripts only. Uses the existing Firebase CLI login; never bundled into either app.
const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const PROJECT = 'harmonia-47c73';
const cliRequire = createRequire(path.join(process.env.APPDATA, 'npm/node_modules/firebase-tools/package.json'));

async function ownerClient() {
  const account = cliRequire('./lib/auth').getGlobalDefaultAccount();
  if (!account) throw new Error('Run firebase login before using administrative scripts.');
  await cliRequire('./lib/requireAuth').requireAuth({ project: PROJECT, user: account.user, tokens: account.tokens });
  const { Client } = cliRequire('./lib/apiv2');
  const db = new Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' });
  const identity = new Client({ urlPrefix: 'https://identitytoolkit.googleapis.com' });
  return { db, identity, rules: cliRequire('./lib/gcp/rules'), auth: cliRequire('./lib/gcp/auth') };
}

const base = `projects/${PROJECT}/databases/(default)/documents`;
function decode(v) {
  if ('nullValue' in v) return null;
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, decode(x)]));
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('integerValue' in v) return Number(v.integerValue);
  return Object.values(v)[0];
}
const unpack = d => ({ id: d.name.split('/').pop(), ...Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, decode(v)])) });
function encode(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  return { stringValue: String(v) };
}
function createWrite(docPath, data) {
  return { update: { name: `${base}/${docPath}`, fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, encode(v)])) }, currentDocument: { exists: false } };
}
async function list(db, collection) {
  const docs = []; let pageToken;
  do {
    const response = await db.get(`/${base}/${collection}`, { queryParams: { pageSize: 100, ...(pageToken ? { pageToken } : {}) } });
    docs.push(...(response.body.documents || [])); pageToken = response.body.nextPageToken;
  } while (pageToken);
  return docs;
}
function privateBackup(label, data) {
  const dir = path.join(os.homedir(), '.codex/private/harmonia', `${new Date().toISOString().replace(/[:.]/g, '-')}-${label}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify(data, null, 2));
  return dir;
}
module.exports = { PROJECT, base, ownerClient, unpack, encode, createWrite, list, privateBackup };
