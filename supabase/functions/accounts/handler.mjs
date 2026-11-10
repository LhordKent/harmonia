// Trusted account service for school-managed Harmonia accounts.
//
// Firebase remains the identity provider and database. This function holds the
// only Firebase administrative credentials and the school base-password key;
// neither client receives them. Every operation authenticates the caller with a
// Firebase ID token and reads the caller's canonical users/{uid} profile with
// administrative access, so client-writable data never grants authority.

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
const SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/identitytoolkit',
  'https://www.googleapis.com/auth/datastore',
].join(' ');

export class HttpError extends Error {
  constructor(status, message, code = undefined) { super(message); this.status = status; this.code = code; }
}
const check = (ok, status, message, code) => { if (!ok) throw new HttpError(status, message, code); };

/** The single onboarding state machine shared (by copy) with both clients. */
export function onboardingState(profile) {
  if (!profile) return 'signedOut';
  if (profile.status !== 'active') return 'inactive';
  if (profile.mustChangePassword === true) return 'passwordChangeRequired';
  if (['student', 'coach', 'institution'].includes(profile.role) && !profile.institutionId) return 'enrollmentRequired';
  return 'ready';
}

export function validateNewPassword(password) {
  check(typeof password === 'string' && password.length >= MIN_PASSWORD, 400,
    `Use a password with at least ${MIN_PASSWORD} characters.`, 'WEAK_PASSWORD');
  check(password.length <= MAX_PASSWORD, 400, `Use a password with at most ${MAX_PASSWORD} characters.`, 'WEAK_PASSWORD');
}

export function normalizeEmail(email) {
  const value = typeof email === 'string' ? email.trim().toLowerCase() : '';
  check(EMAIL.test(value) && value.length <= 254, 400, 'Enter a usable email address. Password recovery is sent there.', 'INVALID_EMAIL');
  return value;
}

function cleanName(name) {
  const value = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  check(value.length > 0 && value.length <= 120, 400, 'Enter a name (up to 120 characters).', 'INVALID_NAME');
  return value;
}

// ── Firestore REST value encoding ───────────────────────────────────────────
export class Timestamp { constructor(ms) { this.ms = ms; } }
export function encode(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Timestamp) return { timestampValue: new Date(value.ms).toISOString() };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: value.length ? { values: value.map(encode) } : {} };
  if (typeof value === 'object') return { mapValue: { fields: encodeFields(value) } };
  return { stringValue: String(value) };
}
const encodeFields = data => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, encode(v)]));
export function decode(value) {
  if (!value || 'nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('timestampValue' in value) return Date.parse(value.timestampValue);
  if ('stringValue' in value) return value.stringValue;
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([k, v]) => [k, decode(v)]));
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode);
  return null;
}

// ── Crypto helpers (WebCrypto works in both Deno and Node) ─────────────────
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
const b64url = input => (typeof input === 'string' ? btoa(unescape(encodeURIComponent(input))) : b64(input))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function importAesKey(base64Key) {
  const raw = unb64(base64Key);
  check(raw.length === 32, 503, 'Account service encryption is not configured.');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptSecret(base64Key, plaintext, schoolId) {
  const key = await importAesKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(schoolId) },
    key, new TextEncoder().encode(plaintext));
  return { iv: b64(iv), ciphertext: b64(data), keyVersion: 1 };
}
export async function decryptSecret(base64Key, secret, schoolId) {
  const key = await importAesKey(base64Key);
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(secret.iv), additionalData: new TextEncoder().encode(schoolId) },
    key, unb64(secret.ciphertext));
  return new TextDecoder().decode(data);
}

/** OAuth access token from a service-account key (RS256 JWT bearer grant), cached until near expiry. */
export function serviceAccountTokenSource(serviceAccount, fetcher, now) {
  let cached = null;
  return async () => {
    if (cached && cached.expires > now() + 60_000) return cached.token;
    check(serviceAccount?.client_email && serviceAccount?.private_key, 503, 'Account service credentials are not configured.');
    const pem = serviceAccount.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    const key = await crypto.subtle.importKey('pkcs8', unb64(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const iat = Math.floor(now() / 1000);
    const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({
      iss: serviceAccount.client_email, scope: SCOPES, aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600,
    }))}`;
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
    const response = await fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${unsigned}.${b64url(signature)}`,
    });
    check(response.ok, 503, 'Account service credentials were rejected.');
    const body = await response.json();
    cached = { token: body.access_token, expires: now() + (body.expires_in || 3600) * 1000 };
    return cached.token;
  };
}

function tokenClaims(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(part + '='.repeat((4 - part.length % 4) % 4)))));
  } catch { return {}; }
}

export function createAccountsHandler(config, deps = {}) {
  const fetcher = deps.fetch ?? fetch;
  const now = deps.now ?? (() => Date.now());
  const accessToken = deps.accessToken ?? serviceAccountTokenSource(config.serviceAccount, fetcher, now);
  const project = config.firebaseProject;
  // Base URLs are overridable only so integration tests can target the Firebase emulators.
  const publicIdt = config.identityToolkitUrl ?? 'https://identitytoolkit.googleapis.com/v1';
  const firestoreUrl = config.firestoreUrl ?? 'https://firestore.googleapis.com/v1';
  const docsBase = `${firestoreUrl}/projects/${project}/databases/(default)/documents`;
  const docName = path => `projects/${project}/databases/(default)/documents/${path}`;
  const idt = `${publicIdt}/projects/${project}`;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

  async function admin(url, body, method = 'POST') {
    const response = await fetcher(url, {
      method, headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  }
  async function getDoc(path) {
    const segments = path.split('/');
    check(segments.length % 2 === 0 && segments.every(s => ID.test(s)), 400, 'Invalid record identifier.');
    const response = await fetcher(`${docsBase}/${path}`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
    if (response.status === 404) return null;
    check(response.ok, 503, 'Account records are temporarily unavailable.');
    const doc = await response.json();
    return Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, decode(v)]));
  }
  async function commit(writes) {
    const result = await admin(`${docsBase}:commit`, { writes });
    if (!result.ok) {
      const conflict = result.status === 409 || /ALREADY_EXISTS|FAILED_PRECONDITION/.test(result.data?.error?.status || '');
      throw new HttpError(conflict ? 409 : 503, conflict ? 'These records changed during the operation. Please retry.' : 'Account records could not be saved.', conflict ? 'CONFLICT' : 'WRITE_FAILED');
    }
  }
  const create = (path, data) => ({ update: { name: docName(path), fields: encodeFields(data) }, currentDocument: { exists: false } });
  const patch = (path, data, exists = true) => ({ update: { name: docName(path), fields: encodeFields(data) },
    updateMask: { fieldPaths: Object.keys(data) }, ...(exists === null ? {} : { currentDocument: { exists } }) });

  async function lookupUid(uid) {
    const result = await admin(`${idt}/accounts:lookup`, { localId: [uid] });
    check(result.ok, 503, 'Sign-in records are temporarily unavailable.');
    return result.data.users?.[0] ?? null;
  }
  async function lookupEmail(email) {
    const result = await admin(`${idt}/accounts:lookup`, { email: [email] });
    check(result.ok, 503, 'Sign-in records are temporarily unavailable.');
    return result.data.users?.[0] ?? null;
  }
  /** True only when Firebase accepts this exact email/password pair. */
  async function passwordMatches(email, password) {
    const response = await fetcher(`${publicIdt}/accounts:signInWithPassword?key=${config.firebaseApiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: false }),
    });
    if (response.ok) return true;
    const message = (await response.json().catch(() => ({})))?.error?.message || '';
    check(!message.startsWith('TOO_MANY_ATTEMPTS'), 429, 'Too many password attempts. Wait a few minutes, then retry.', 'TOO_MANY_ATTEMPTS');
    check(/INVALID_PASSWORD|INVALID_LOGIN_CREDENTIALS|EMAIL_NOT_FOUND/.test(message), 503, 'Password could not be verified. Please retry.');
    return false;
  }
  async function schoolBasePassword(schoolId) {
    if (!schoolId || !ID.test(schoolId)) return null;
    const secret = await getDoc(`schoolSecrets/${schoolId}`);
    if (!secret?.ciphertext) return null;
    check(config.encryptionKey, 503, 'Account service encryption is not configured.');
    return decryptSecret(config.encryptionKey, secret, schoolId);
  }
  /** Stores the encrypted base password; newSchool (if given) is created in the same atomic commit. */
  async function storeBasePassword(schoolId, password, actor, newSchool = null) {
    validateNewPassword(password);
    check(config.encryptionKey, 503, 'Account service encryption is not configured.');
    const sealed = await encryptSecret(config.encryptionKey, password, schoolId);
    const at = new Timestamp(now());
    const marker = { basePasswordSet: true, basePasswordUpdatedAt: at, updatedAt: at };
    await commit([
      newSchool ? create(`institutions/${schoolId}`, { ...newSchool, ...marker, createdAt: at }) : patch(`institutions/${schoolId}`, marker),
      { update: { name: docName(`schoolSecrets/${schoolId}`), fields: encodeFields({ ...sealed, updatedAt: at, updatedBy: actor }) } },
    ]);
  }

  /** Clears the requirement only after Firebase proves the password changed after the recorded baseline. */
  async function finalizePasswordChange(uid, profile) {
    const account = await lookupUid(uid);
    const updatedAt = Number(account?.passwordUpdatedAt || 0);
    const baseline = Number(profile.passwordUpdatedAtBaseline || 0);
    check(updatedAt > baseline, 409, 'Your password has not been changed yet.', 'PASSWORD_NOT_CHANGED');
    const at = new Timestamp(now());
    const fields = { passwordChangedAt: at, updatedAt: at };
    if (profile.mustChangePassword === true) fields.mustChangePassword = false;
    await commit([patch(`users/${uid}`, fields)]);
    return onboardingState({ ...profile, mustChangePassword: false });
  }

  async function provision({ schoolId, role, name, email, coachId = null, actor, basePassword }) {
    const existing = await lookupEmail(email);
    if (existing) {
      // A retry after a lost response: report the existing pending account, never reset it.
      const profile = await getDoc(`users/${existing.localId}`);
      check(profile && profile.role === role && profile.institutionId === schoolId && profile.mustChangePassword === true
        && profile.provisionedBy, 409, 'An account with this email already exists.', 'EMAIL_EXISTS');
      return { uid: existing.localId, email, role, schoolId, alreadyExisted: true };
    }
    const created = await admin(`${idt}/accounts`, { email, password: basePassword, displayName: name, emailVerified: false });
    if (!created.ok) {
      check(!/EMAIL_EXISTS/.test(created.data?.error?.message || ''), 409, 'An account with this email already exists.', 'EMAIL_EXISTS');
      throw new HttpError(502, 'The sign-in account could not be created. Nothing was saved; please retry.', 'CREATE_FAILED');
    }
    const uid = created.data.localId;
    try {
      const account = await lookupUid(uid);
      const at = new Timestamp(now());
      const [firstName, ...rest] = name.split(' ');
      const lastName = rest.join(' ');
      const writes = [create(`users/${uid}`, {
        uid, name, firstName, lastName, email, role, status: 'active', institutionId: schoolId,
        mustChangePassword: true, passwordChangeRequiredAt: at,
        passwordUpdatedAtBaseline: Number(account?.passwordUpdatedAt || 0), passwordChangedAt: null,
        provisionedBy: actor, createdAt: at, updatedAt: at,
      })];
      if (role === 'coach') writes.push(create(`coaches/${uid}`, {
        userId: uid, name, firstName, lastName, email, institutionId: schoolId, status: 'active', createdAt: at, updatedAt: at,
      }));
      if (role === 'student') writes.push(create(`students/${uid}`, {
        id: uid, userId: uid, name, fullName: name, firstName, lastName, email, institutionId: schoolId, coachId,
        studentType: 'collaborated', status: 'active', badges: [], createdAt: at, updatedAt: at,
      }));
      await commit(writes);
      return { uid, email, role, schoolId, temporaryPassword: basePassword, alreadyExisted: false };
    } catch (error) {
      // Roll back only the identity this operation created.
      const removed = await admin(`${idt}/accounts:delete`, { localId: uid }).catch(() => ({ ok: false }));
      if (!removed.ok) throw new HttpError(500, 'Profile setup failed and the new sign-in account could not be removed. Contact the platform administrator before retrying.', 'ROLLBACK_FAILED');
      if (error instanceof HttpError && error.code !== 'CONFLICT') throw new HttpError(error.status, `${error.message} No account was created; please retry.`, error.code);
      throw new HttpError(503, 'Account setup failed. No account was created; please retry.', 'PROFILE_FAILED');
    }
  }

  const actions = {
    async status({ uid, profile }) {
      return { uid, role: profile.role, institutionId: profile.institutionId ?? null, state: onboardingState(profile) };
    },

    async changePassword({ uid, email, profile }, body) {
      const { currentPassword, newPassword } = body;
      check(typeof currentPassword === 'string' && currentPassword.length > 0, 400, 'Enter your current password.', 'MISSING_PASSWORD');
      validateNewPassword(newPassword);
      check(newPassword !== currentPassword, 400, 'Your new password must be different from your current password.', 'SAME_PASSWORD');
      check(await passwordMatches(email, currentPassword), 400, 'Your current password is incorrect.', 'WRONG_PASSWORD');
      const base = await schoolBasePassword(profile.institutionId);
      check(base === null || newPassword !== base, 400, "Your new password must be different from your school's base password.", 'BASE_PASSWORD');
      const updated = await admin(`${idt}/accounts:update`, { localId: uid, password: newPassword });
      check(updated.ok, 502, 'Your password could not be changed. Your current password still works; please retry.', 'UPDATE_FAILED');
      try {
        return { state: await finalizePasswordChange(uid, profile) };
      } catch {
        throw new HttpError(500, 'Your new password is active, but account setup could not be completed. Sign in with your new password to finish.', 'PROFILE_PENDING');
      }
    },

    async completeOnboarding({ uid, email, profile, claims }) {
      if (profile.mustChangePassword !== true) return { state: onboardingState(profile) };
      const account = await lookupUid(uid);
      const updatedAt = Number(account?.passwordUpdatedAt || 0);
      check(updatedAt > Number(profile.passwordUpdatedAtBaseline || 0), 409, 'Your password has not been changed yet.', 'PASSWORD_NOT_CHANGED');
      // The caller must have signed in with the replacement password, not an older session.
      check(Number(claims.auth_time || 0) * 1000 + 1000 >= updatedAt, 401, 'Sign in again with your new password to finish setup.', 'REAUTHENTICATE');
      const base = await schoolBasePassword(profile.institutionId);
      check(base === null || !(await passwordMatches(email, base)), 400, "Your new password must be different from your school's base password.", 'BASE_PASSWORD');
      return { state: await finalizePasswordChange(uid, profile) };
    },

    async createSchool({ uid, profile }, body) {
      check(profile.role === 'admin', 403, 'Only platform administrators can create schools.', 'FORBIDDEN');
      check(typeof body.requestId === 'string' && /^[A-Za-z0-9]{8,64}$/.test(body.requestId), 400, 'Invalid request identifier.');
      const name = cleanName(body.name);
      const contactEmail = body.contactEmail ? normalizeEmail(body.contactEmail) : '';
      const adminName = cleanName(body.adminName);
      const adminEmail = normalizeEmail(body.adminEmail);
      const schoolId = `school_${body.requestId}`;
      const school = await getDoc(`institutions/${schoolId}`);
      if (!school) {
        await storeBasePassword(schoolId, body.basePassword, uid, {
          name, contactEmail, status: 'active', timeZone: 'Asia/Manila', academicYear: '2026-2027', createdBy: uid,
        });
      }
      const basePassword = await schoolBasePassword(schoolId);
      check(basePassword, 409, "Set the school's base password first.", 'NO_BASE_PASSWORD');
      const account = await provision({ schoolId, role: 'institution', name: adminName, email: adminEmail, actor: uid, basePassword });
      return { schoolId, account };
    },

    async setBasePassword({ uid, profile }, body) {
      const schoolId = body.schoolId;
      check(typeof schoolId === 'string' && ID.test(schoolId), 400, 'Choose a school.');
      check(profile.role === 'admin' || (profile.role === 'institution' && profile.institutionId === schoolId), 403,
        "You can only manage your own school's settings.", 'FORBIDDEN');
      check(await getDoc(`institutions/${schoolId}`), 404, 'School not found.', 'NOT_FOUND');
      await storeBasePassword(schoolId, body.basePassword, uid);
      return { schoolId, basePasswordSet: true };
    },

    async createAccount({ uid, profile }, body) {
      const role = body.role;
      let schoolId;
      if (profile.role === 'admin') {
        check(['coach', 'student', 'institution'].includes(role), 400, 'Choose coach, student or school administrator.');
        schoolId = body.schoolId;
      } else {
        check(profile.role === 'institution', 403, 'Only school administrators can create accounts.', 'FORBIDDEN');
        check(['coach', 'student'].includes(role), 403, 'School administrators can create coaches and students.', 'FORBIDDEN');
        check(!body.schoolId || body.schoolId === profile.institutionId, 403, 'You can only create accounts for your own school.', 'FORBIDDEN');
        schoolId = profile.institutionId;
      }
      check(typeof schoolId === 'string' && ID.test(schoolId), 400, 'Choose a school.');
      const school = await getDoc(`institutions/${schoolId}`);
      check(school && school.status !== 'inactive', 404, 'School not found.', 'NOT_FOUND');
      const name = cleanName(body.name);
      const email = normalizeEmail(body.email);
      let coachId = null;
      if (role === 'student' && body.coachId) {
        check(ID.test(body.coachId), 400, 'Select an active coach from this school.');
        const coach = await getDoc(`users/${body.coachId}`);
        check(coach?.role === 'coach' && coach.status === 'active' && coach.institutionId === schoolId, 400,
          'Select an active coach from this school.', 'INVALID_COACH');
        coachId = body.coachId;
      }
      const basePassword = await schoolBasePassword(schoolId);
      check(basePassword, 409, "Set the school's base password before creating accounts.", 'NO_BASE_PASSWORD');
      return provision({ schoolId, role, name, email, coachId, actor: uid, basePassword });
    },
  };

  return async function handle(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      check(request.method === 'POST', 405, 'Use POST.');
      const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
      check(token, 401, 'Sign in first.', 'UNAUTHENTICATED');
      const body = await request.json().catch(() => ({}));
      const action = actions[body?.action];
      check(action && Object.hasOwn(actions, body.action), 400, 'Unknown account action.');
      // Google verifies the token signature, issuer, expiry, revocation (validSince) and account status.
      const identity = await fetcher(`${publicIdt}/accounts:lookup?key=${config.firebaseApiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }),
      });
      check(identity.ok, 401, 'Your session expired. Sign in again.', 'UNAUTHENTICATED');
      const account = (await identity.json()).users?.[0];
      const uid = account?.localId;
      check(uid && ID.test(uid) && !account.disabled && account.email, 401, 'Invalid account.', 'UNAUTHENTICATED');
      const profile = await getDoc(`users/${uid}`);
      check(profile, 403, 'Your account profile is missing. Contact your school.', 'NO_PROFILE');
      check(profile.status === 'active', 403, 'This account is inactive. Contact your school.', 'INACTIVE');
      const pendingAllowed = ['status', 'changePassword', 'completeOnboarding'];
      if (!pendingAllowed.includes(body.action)) {
        check(onboardingState(profile) === 'ready', 403, 'Finish account setup before managing accounts.', 'SETUP_REQUIRED');
      }
      return json(await action({ uid, email: account.email.toLowerCase(), profile, claims: tokenClaims(token) }, body));
    } catch (error) {
      // Never log tokens, passwords, keys or raw upstream responses.
      if (error instanceof HttpError) return json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status);
      return json({ error: 'Account service is temporarily unavailable.' }, 503);
    }
  };
}
