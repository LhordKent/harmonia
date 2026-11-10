import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify, randomBytes } from 'node:crypto';
import {
  createAccountsHandler, onboardingState, encryptSecret, decryptSecret, serviceAccountTokenSource, encode, decode,
} from '../functions/accounts/handler.mjs';

const KEY = randomBytes(32).toString('base64');
const PROJECT = 'harmonia-47c73';
const b64url = s => Buffer.from(s).toString('base64url');

/** In-memory stand-in for the Identity Toolkit and Firestore REST endpoints the handler calls. */
function fakeFirebase() {
  let clock = 1_700_000_000_000;
  let nextUid = 1;
  const accounts = new Map(); // uid -> { email, password, passwordUpdatedAt, disabled }
  const docs = new Map(); // path -> fields (decoded)
  const tokens = new Map(); // token -> { uid, authTime(ms) }
  const failures = { commitMatching: null, adminUpdate: false, deleteAccount: false };
  const calls = [];
  const tick = (ms = 1000) => (clock += ms);
  const addAccount = (email, password, uid = `u${nextUid++}`) => {
    accounts.set(uid, { email, password, passwordUpdatedAt: tick(), disabled: false });
    return uid;
  };
  const signIn = uid => {
    const authTime = tick();
    const token = `h.${b64url(JSON.stringify({ sub: uid, auth_time: Math.floor(authTime / 1000) }))}.s${tokens.size}`;
    tokens.set(token, { uid, authTime });
    return token;
  };
  const prefix = `projects/${PROJECT}/databases/(default)/documents/`;
  const res = (data, status = 200) => Response.json(data, { status });
  const user = (uid, a) => ({ localId: uid, email: a.email, passwordUpdatedAt: a.passwordUpdatedAt, disabled: a.disabled });

  async function fetcher(url, options = {}) {
    const body = options.body ? JSON.parse(options.body) : {};
    calls.push({ url, body });
    if (url.includes('/v1/accounts:lookup?key=')) {
      const t = tokens.get(body.idToken);
      const a = t && accounts.get(t.uid);
      // Password changes revoke older sessions (Firebase validSince).
      if (!a || t.authTime < a.passwordUpdatedAt) return res({ error: { message: 'INVALID_ID_TOKEN' } }, 400);
      return res({ users: [user(t.uid, a)] });
    }
    if (url.includes('/v1/accounts:signInWithPassword')) {
      const entry = [...accounts.entries()].find(([, a]) => a.email === body.email);
      if (!entry) return res({ error: { message: 'EMAIL_NOT_FOUND' } }, 400);
      return entry[1].password === body.password ? res({ localId: entry[0] }) : res({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }, 400);
    }
    if (url.endsWith(`/projects/${PROJECT}/accounts:lookup`)) {
      if (body.localId) return res({ users: body.localId.filter(id => accounts.has(id)).map(id => user(id, accounts.get(id))) });
      const found = [...accounts.entries()].filter(([, a]) => body.email.includes(a.email));
      return res(found.length ? { users: found.map(([id, a]) => user(id, a)) } : {});
    }
    if (url.endsWith(`/projects/${PROJECT}/accounts`)) {
      if ([...accounts.values()].some(a => a.email === body.email)) return res({ error: { message: 'EMAIL_EXISTS' } }, 400);
      return res({ localId: addAccount(body.email, body.password) });
    }
    if (url.endsWith('/accounts:update')) {
      if (failures.adminUpdate) return res({}, 500);
      const a = accounts.get(body.localId); a.password = body.password; a.passwordUpdatedAt = tick();
      return res({ localId: body.localId });
    }
    if (url.endsWith('/accounts:delete')) {
      if (failures.deleteAccount) return res({}, 500);
      accounts.delete(body.localId); return res({});
    }
    if (url.endsWith('documents:commit')) {
      const paths = body.writes.map(w => w.update.name.replace(prefix, ''));
      if (failures.commitMatching && paths.some(p => failures.commitMatching.test(p))) return res({ error: { status: 'UNAVAILABLE' } }, 503);
      for (const w of body.writes) {
        const path = w.update.name.replace(prefix, '');
        const exists = docs.has(path);
        if (w.currentDocument && w.currentDocument.exists !== exists) return res({ error: { status: exists ? 'ALREADY_EXISTS' : 'NOT_FOUND' } }, exists ? 409 : 404);
      }
      for (const w of body.writes) {
        const path = w.update.name.replace(prefix, '');
        const fields = Object.fromEntries(Object.entries(w.update.fields).map(([k, v]) => [k, decode(v)]));
        docs.set(path, w.updateMask ? { ...(docs.get(path) || {}), ...fields } : fields);
      }
      return res({});
    }
    if (url.includes('/documents/')) {
      const path = url.split('/documents/')[1];
      return docs.has(path) ? res({ fields: Object.fromEntries(Object.entries(docs.get(path)).map(([k, v]) => [k, encode(v)])) }) : res({}, 404);
    }
    throw new Error(`Unexpected fetch ${url}`);
  }
  return { fetcher, accounts, docs, tokens, failures, calls, addAccount, signIn, tick, now: () => clock };
}

function setup() {
  const fb = fakeFirebase();
  const handle = createAccountsHandler({ firebaseProject: PROJECT, firebaseApiKey: 'public-key', encryptionKey: KEY },
    { fetch: fb.fetcher, now: fb.now, accessToken: async () => 'admin-access-token' });
  const call = async (token, body) => {
    const response = await handle(new Request('https://example.supabase.co/functions/v1/accounts', {
      method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }));
    return { status: response.status, body: await response.json() };
  };
  const platformAdmin = fb.addAccount('owner@example.test', 'Owner-password-1');
  fb.docs.set(`users/${platformAdmin}`, { role: 'admin', status: 'active', institutionId: null, email: 'owner@example.test' });
  return { fb, call, platformAdmin, adminToken: fb.signIn(platformAdmin) };
}
const newSchool = (overrides = {}) => ({ action: 'createSchool', requestId: 'req12345678', name: 'North School', contactEmail: 'office@north.test',
  basePassword: 'North-Base-2026', adminName: 'Nora Manager', adminEmail: 'Nora@North.test', ...overrides });

async function readySchoolAdmin(ctx) {
  const created = await ctx.call(ctx.adminToken, newSchool());
  const { uid } = created.body.account;
  const token = ctx.fb.signIn(uid);
  const changed = await ctx.call(token, { action: 'changePassword', currentPassword: 'North-Base-2026', newPassword: 'Nora-Own-Pass-9' });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  return { uid, schoolId: created.body.schoolId, token: ctx.fb.signIn(uid) };
}

test('state machine distinguishes pending, enrollment and ready profiles', () => {
  assert.equal(onboardingState(null), 'signedOut');
  assert.equal(onboardingState({ status: 'inactive', role: 'student' }), 'inactive');
  assert.equal(onboardingState({ status: 'active', role: 'student', mustChangePassword: true, institutionId: 's' }), 'passwordChangeRequired');
  assert.equal(onboardingState({ status: 'active', role: 'student', institutionId: null }), 'enrollmentRequired');
  assert.equal(onboardingState({ status: 'active', role: 'admin', institutionId: null }), 'ready');
  assert.equal(onboardingState({ status: 'active', role: 'coach', institutionId: 'school_1', mustChangePassword: false }), 'ready');
});

test('base passwords are encrypted, bound to their school and never stored in plaintext', async () => {
  const sealed = await encryptSecret(KEY, 'North-Base-2026', 'school_a');
  assert.ok(!JSON.stringify(sealed).includes('North-Base-2026'));
  assert.equal(await decryptSecret(KEY, sealed, 'school_a'), 'North-Base-2026');
  await assert.rejects(decryptSecret(KEY, sealed, 'school_b'));
});

test('service-account token source signs a verifiable RS256 assertion and caches the token', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  let posts = 0;
  const source = serviceAccountTokenSource({ client_email: 'svc@example.iam', private_key: pem }, async (url, options) => {
    posts++;
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    const assertion = new URLSearchParams(options.body).get('assertion');
    const [h, p, s] = assertion.split('.');
    assert.ok(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s, 'base64url')));
    assert.equal(JSON.parse(Buffer.from(p, 'base64url')).iss, 'svc@example.iam');
    return Response.json({ access_token: 'ya29.test', expires_in: 3600 });
  }, () => 1_700_000_000_000);
  assert.equal(await source(), 'ya29.test');
  assert.equal(await source(), 'ya29.test');
  assert.equal(posts, 1);
});

test('missing, forged and inactive callers are rejected before any change', async () => {
  const ctx = setup();
  assert.equal((await ctx.call(null, { action: 'status' })).status, 401);
  assert.equal((await ctx.call('forged', { action: 'status' })).status, 401);
  const uid = ctx.fb.addAccount('gone@example.test', 'x-password-1');
  ctx.fb.docs.set(`users/${uid}`, { role: 'coach', status: 'inactive', institutionId: 'school_x' });
  assert.equal((await ctx.call(ctx.fb.signIn(uid), { action: 'status' })).status, 403);
  assert.equal((await ctx.call(ctx.adminToken, { action: 'dropEverything' })).status, 400);
});

test('journey 1: platform admin creates a school whose administrator must change the temporary password', async () => {
  const ctx = setup();
  const created = await ctx.call(ctx.adminToken, newSchool());
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const { schoolId, account } = created.body;
  assert.equal(schoolId, 'school_req12345678');
  assert.equal(account.email, 'nora@north.test');
  assert.equal(account.temporaryPassword, 'North-Base-2026');
  assert.equal(ctx.fb.docs.get(`institutions/${schoolId}`).basePasswordSet, true);
  assert.ok(!JSON.stringify(ctx.fb.docs.get(`schoolSecrets/${schoolId}`)).includes('North-Base-2026'));
  const profile = ctx.fb.docs.get(`users/${account.uid}`);
  assert.equal(profile.role, 'institution');
  assert.equal(profile.mustChangePassword, true);
  assert.equal(profile.passwordUpdatedAtBaseline, ctx.fb.accounts.get(account.uid).passwordUpdatedAt);

  const pendingToken = ctx.fb.signIn(account.uid);
  assert.equal((await ctx.call(pendingToken, { action: 'status' })).body.state, 'passwordChangeRequired');
  const blocked = await ctx.call(pendingToken, { action: 'createAccount', role: 'coach', name: 'Too Early', email: 'early@north.test' });
  assert.equal(blocked.body.code, 'SETUP_REQUIRED');

  const changed = await ctx.call(pendingToken, { action: 'changePassword', currentPassword: 'North-Base-2026', newPassword: 'Nora-Own-Pass-9' });
  assert.deepEqual(changed.body, { state: 'ready' });
  assert.equal(ctx.fb.accounts.get(account.uid).password, 'Nora-Own-Pass-9');
  assert.equal(ctx.fb.docs.get(`users/${account.uid}`).mustChangePassword, false);
  // The pre-change session is revoked; the client re-authenticates with the new password.
  assert.equal((await ctx.call(pendingToken, { action: 'status' })).status, 401);
  assert.equal((await ctx.call(ctx.fb.signIn(account.uid), { action: 'status' })).body.state, 'ready');
});

test('only platform admins create schools; retries neither duplicate nor reset accounts', async () => {
  const ctx = setup();
  // A lost-response retry while the administrator is still pending reports the same account.
  const first = await ctx.call(ctx.adminToken, newSchool({ requestId: 'pend12345678', adminEmail: 'pat@pending.test' }));
  const again = await ctx.call(ctx.adminToken, newSchool({ requestId: 'pend12345678', adminEmail: 'pat@pending.test' }));
  assert.equal(again.status, 200);
  assert.equal(again.body.account.alreadyExisted, true);
  assert.equal(again.body.account.uid, first.body.account.uid);
  assert.equal(again.body.account.temporaryPassword, undefined);

  const school = await readySchoolAdmin(ctx);
  assert.equal((await ctx.call(school.token, newSchool({ requestId: 'other1234567' }))).status, 403);
  // The administrator already changed the password, so the retry must refuse rather than reset it.
  const retry = await ctx.call(ctx.adminToken, newSchool());
  assert.equal(retry.body.code, 'EMAIL_EXISTS');
  assert.equal(ctx.fb.accounts.get(school.uid).password, 'Nora-Own-Pass-9');
  assert.equal([...ctx.fb.accounts.values()].filter(a => a.email === 'nora@north.test').length, 1);
});

test('journey 1-2: school admin creates a coach and student who start pending with the base password', async () => {
  const ctx = setup();
  const school = await readySchoolAdmin(ctx);
  const coach = await ctx.call(school.token, { action: 'createAccount', role: 'coach', name: 'Carl Coach', email: 'carl@north.test' });
  assert.equal(coach.status, 200, JSON.stringify(coach.body));
  assert.equal(coach.body.temporaryPassword, 'North-Base-2026');
  const student = await ctx.call(school.token, { action: 'createAccount', role: 'student', name: 'Sam Student', email: 'sam@north.test', coachId: coach.body.uid });
  assert.equal(student.status, 200, JSON.stringify(student.body));
  assert.equal(ctx.fb.docs.get(`students/${student.body.uid}`).coachId, coach.body.uid);
  assert.equal(ctx.fb.docs.get(`students/${student.body.uid}`).institutionId, school.schoolId);
  assert.equal(ctx.fb.docs.get(`coaches/${coach.body.uid}`).institutionId, school.schoolId);
  for (const uid of [coach.body.uid, student.body.uid]) {
    assert.equal(ctx.fb.docs.get(`users/${uid}`).mustChangePassword, true);
    const token = ctx.fb.signIn(uid);
    assert.equal((await ctx.call(token, { action: 'status' })).body.state, 'passwordChangeRequired');
    const reuseBase = await ctx.call(token, { action: 'changePassword', currentPassword: 'North-Base-2026', newPassword: 'North-Base-2026' });
    assert.equal(reuseBase.body.code, 'SAME_PASSWORD');
    const done = await ctx.call(token, { action: 'changePassword', currentPassword: 'North-Base-2026', newPassword: `Mine-${uid}-pass` });
    assert.equal(done.body.state, 'ready');
  }
  // School administrators cannot create other school administrators.
  assert.equal((await ctx.call(school.token, { action: 'createAccount', role: 'institution', name: 'X', email: 'x@north.test' })).status, 403);
});

test('journey 6: a school cannot provision into, or assign coaches from, another school', async () => {
  const ctx = setup();
  const north = await readySchoolAdmin(ctx);
  const southCreated = await ctx.call(ctx.adminToken, newSchool({ requestId: 'south1234567', name: 'South', adminEmail: 'sol@south.test', basePassword: 'South-Base-2026' }));
  const southCoach = ctx.fb.addAccount('sc@south.test', 'p-assword-1');
  ctx.fb.docs.set(`users/${southCoach}`, { role: 'coach', status: 'active', institutionId: southCreated.body.schoolId });
  const cross = await ctx.call(north.token, { action: 'createAccount', role: 'student', name: 'Intruder', email: 'i@north.test', schoolId: southCreated.body.schoolId });
  assert.equal(cross.status, 403);
  const foreignCoach = await ctx.call(north.token, { action: 'createAccount', role: 'student', name: 'Sam', email: 'sam2@north.test', coachId: southCoach });
  assert.equal(foreignCoach.body.code, 'INVALID_COACH');
  assert.equal((await ctx.call(north.token, { action: 'setBasePassword', schoolId: southCreated.body.schoolId, basePassword: 'Hijack-Pass-1' })).status, 403);
  assert.ok(![...ctx.fb.accounts.values()].some(a => a.email === 'i@north.test' || a.email === 'sam2@north.test'));
});

test('journey 7: wrong, short, reused-base passwords and duplicate emails give recoverable errors', async () => {
  const ctx = setup();
  const school = await readySchoolAdmin(ctx);
  const coach = await ctx.call(school.token, { action: 'createAccount', role: 'coach', name: 'Carl', email: 'carl@north.test' });
  const token = ctx.fb.signIn(coach.body.uid);
  assert.equal((await ctx.call(token, { action: 'changePassword', currentPassword: 'wrong-one', newPassword: 'Fresh-Pass-12' })).body.code, 'WRONG_PASSWORD');
  assert.equal((await ctx.call(token, { action: 'changePassword', currentPassword: 'North-Base-2026', newPassword: 'short' })).body.code, 'WEAK_PASSWORD');
  // The school base password changed since this account was created; reusing it is still refused.
  await ctx.call(school.token, { action: 'setBasePassword', schoolId: school.schoolId, basePassword: 'North-Base-2027' });
  assert.equal((await ctx.call(token, { action: 'changePassword', currentPassword: 'North-Base-2026', newPassword: 'North-Base-2027' })).body.code, 'BASE_PASSWORD');
  assert.equal(ctx.fb.docs.get(`users/${coach.body.uid}`).mustChangePassword, true);
  const dup = await ctx.call(school.token, { action: 'createAccount', role: 'student', name: 'Dup', email: 'CARL@north.test' });
  assert.equal(dup.body.code, 'EMAIL_EXISTS');
  assert.equal(ctx.fb.accounts.get(coach.body.uid).password, 'North-Base-2026');
  assert.equal((await ctx.call(school.token, { action: 'createAccount', role: 'student', name: 'Bad', email: 'not-an-email' })).body.code, 'INVALID_EMAIL');
});

test('changing the base password affects only future accounts', async () => {
  const ctx = setup();
  const school = await readySchoolAdmin(ctx);
  const before = await ctx.call(school.token, { action: 'createAccount', role: 'student', name: 'Early', email: 'early@north.test' });
  await ctx.call(school.token, { action: 'setBasePassword', schoolId: school.schoolId, basePassword: 'Second-Base-77' });
  const after = await ctx.call(school.token, { action: 'createAccount', role: 'student', name: 'Late', email: 'late@north.test' });
  assert.equal(after.body.temporaryPassword, 'Second-Base-77');
  assert.equal(ctx.fb.accounts.get(before.body.uid).password, 'North-Base-2026');
  assert.equal(ctx.fb.accounts.get(school.uid).password, 'Nora-Own-Pass-9');
  assert.equal((await ctx.call(school.token, { action: 'setBasePassword', schoolId: school.schoolId, basePassword: 'short' })).body.code, 'WEAK_PASSWORD');
});

test('interrupted provisioning rolls back only the identity it created; a lost-response retry is safe', async () => {
  const ctx = setup();
  const school = await readySchoolAdmin(ctx);
  ctx.fb.failures.commitMatching = /^students\//;
  const failed = await ctx.call(school.token, { action: 'createAccount', role: 'student', name: 'Flaky', email: 'flaky@north.test' });
  assert.equal(failed.status, 503);
  assert.match(failed.body.error, /No account was created/);
  assert.ok(![...ctx.fb.accounts.values()].some(a => a.email === 'flaky@north.test'));
  ctx.fb.failures.commitMatching = null;
  const ok = await ctx.call(school.token, { action: 'createAccount', role: 'student', name: 'Flaky', email: 'flaky@north.test' });
  assert.equal(ok.status, 200);
  const retry = await ctx.call(school.token, { action: 'createAccount', role: 'student', name: 'Flaky', email: 'flaky@north.test' });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.alreadyExisted, true);
  assert.equal(retry.body.uid, ok.body.uid);
  assert.equal(retry.body.temporaryPassword, undefined);

  ctx.fb.failures.commitMatching = /^users\//;
  ctx.fb.failures.deleteAccount = true;
  const stuck = await ctx.call(school.token, { action: 'createAccount', role: 'coach', name: 'Stuck', email: 'stuck@north.test' });
  assert.equal(stuck.body.code, 'ROLLBACK_FAILED');
});

test('journey 3: an existing migrated user changes the current password and an older change cannot satisfy it', async () => {
  const ctx = setup();
  const uid = ctx.fb.addAccount('legacy@example.test', 'Legacy-pass-1');
  ctx.fb.tick();
  ctx.fb.accounts.get(uid).passwordUpdatedAt = ctx.fb.tick(); // changed before the rollout
  ctx.fb.docs.set(`users/${uid}`, { role: 'student', status: 'active', institutionId: 'inst1', mustChangePassword: true,
    passwordUpdatedAtBaseline: ctx.fb.accounts.get(uid).passwordUpdatedAt });
  const token = ctx.fb.signIn(uid);
  assert.equal((await ctx.call(token, { action: 'completeOnboarding' })).body.code, 'PASSWORD_NOT_CHANGED');
  const done = await ctx.call(token, { action: 'changePassword', currentPassword: 'Legacy-pass-1', newPassword: 'Legacy-pass-2' });
  assert.equal(done.body.state, 'ready');
});

test('journey 4: email recovery satisfies the requirement only after re-authentication with a non-base password', async () => {
  const ctx = setup();
  const school = await readySchoolAdmin(ctx);
  const student = await ctx.call(school.token, { action: 'createAccount', role: 'student', name: 'Rae', email: 'rae@north.test' });
  const uid = student.body.uid;
  const oldToken = ctx.fb.signIn(uid);
  // Simulated Firebase email reset back to the base password: verified, but refused.
  Object.assign(ctx.fb.accounts.get(uid), { password: 'North-Base-2026', passwordUpdatedAt: ctx.fb.tick() });
  assert.equal((await ctx.call(oldToken, { action: 'completeOnboarding' })).status, 401);
  assert.equal((await ctx.call(ctx.fb.signIn(uid), { action: 'completeOnboarding' })).body.code, 'BASE_PASSWORD');
  Object.assign(ctx.fb.accounts.get(uid), { password: 'Recovered-pass-5', passwordUpdatedAt: ctx.fb.tick() });
  const done = await ctx.call(ctx.fb.signIn(uid), { action: 'completeOnboarding' });
  assert.equal(done.body.state, 'ready');
  // Already onboarded accounts: completion is idempotent and recovery leaves them ready.
  Object.assign(ctx.fb.accounts.get(uid), { password: 'Recovered-pass-6', passwordUpdatedAt: ctx.fb.tick() });
  assert.equal((await ctx.call(ctx.fb.signIn(uid), { action: 'completeOnboarding' })).body.state, 'ready');
});

test('a failed profile completion after a successful password change can resume after signing in', async () => {
  const ctx = setup();
  const school = await readySchoolAdmin(ctx);
  const coach = await ctx.call(school.token, { action: 'createAccount', role: 'coach', name: 'Kim', email: 'kim@north.test' });
  ctx.fb.failures.commitMatching = /^users\//;
  const partial = await ctx.call(ctx.fb.signIn(coach.body.uid), { action: 'changePassword', currentPassword: 'North-Base-2026', newPassword: 'Kim-New-Pass-1' });
  assert.equal(partial.body.code, 'PROFILE_PENDING');
  assert.match(partial.body.error, /new password is active/);
  ctx.fb.failures.commitMatching = null;
  assert.equal(ctx.fb.docs.get(`users/${coach.body.uid}`).mustChangePassword, true);
  const resumed = await ctx.call(ctx.fb.signIn(coach.body.uid), { action: 'completeOnboarding' });
  assert.equal(resumed.body.state, 'ready');
});

test('a failed Firebase password update leaves the current password and requirement intact', async () => {
  const ctx = setup();
  const school = await readySchoolAdmin(ctx);
  const coach = await ctx.call(school.token, { action: 'createAccount', role: 'coach', name: 'Lee', email: 'lee@north.test' });
  ctx.fb.failures.adminUpdate = true;
  const failed = await ctx.call(ctx.fb.signIn(coach.body.uid), { action: 'changePassword', currentPassword: 'North-Base-2026', newPassword: 'Lee-New-Pass-1' });
  assert.equal(failed.body.code, 'UPDATE_FAILED');
  assert.equal(ctx.fb.accounts.get(coach.body.uid).password, 'North-Base-2026');
  assert.equal(ctx.fb.docs.get(`users/${coach.body.uid}`).mustChangePassword, true);
});

test('responses never echo passwords except the temporary password returned to the provisioning administrator', async () => {
  const ctx = setup();
  const school = await readySchoolAdmin(ctx);
  const token = school.token;
  const response = await ctx.call(token, { action: 'changePassword', currentPassword: 'Nora-Own-Pass-9', newPassword: 'Nora-Own-Pass-10' });
  assert.ok(!JSON.stringify(response.body).includes('Nora-Own-Pass'));
  assert.ok(ctx.fb.calls.every(c => !c.url.includes('Nora')));
});
