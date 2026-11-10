import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioHandler, MAX_BYTES } from '../functions/audio/handler.mjs';

const config = { supabaseUrl: 'https://example.supabase.co', serviceKey: 'server-only-secret',
  firebaseProject: 'harmonia-47c73', firebaseApiKey: 'public-firebase-key' };
const document = data => ({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, { stringValue: v }])) });
function setup({ uid = 'student1', role = 'student', active = true, studentActive = true,
  validToken = true, studentRead = true, storageStatus = 200, duplicate = false } = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    const json = (data, status = 200) => Response.json(data, { status });
    if (url.includes('accounts:lookup')) return validToken ? json({ users: [{ localId: uid }] }) : json({}, 400);
    if (url.includes('/documents/users/')) return json(document({ role, status: active ? 'active' : 'inactive' }));
    if (url.includes('/documents/students/')) return studentRead ? json(document({ status: studentActive ? 'active' : 'inactive' })) : json({}, 403);
    if (url.includes('/object/sign/')) return json({ signedURL: '/object/sign/harmonia-audio/attempts/student1/a1?token=short-lived' }, storageStatus);
    if (url.includes('/object/')) return duplicate ? json({ statusCode: '409', error: 'Duplicate' }, 400) : json({}, storageStatus);
    throw new Error(`Unexpected fetch ${url}`);
  };
  return { calls, handle: createAudioHandler(config, fetcher) };
}
function request(query = 'action=upload&kind=attempts&id=a1', { token = 'firebase-token', type = 'audio/wav', body = 'wav-data', ...rest } = {}) {
  return new Request(`https://example.supabase.co/functions/v1/audio?${query}`, {
    method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': type }, body, ...rest,
  });
}
test('preflight succeeds without exposing secrets or requiring authentication', async () => {
  const { handle, calls } = setup();
  const response = await handle(new Request('https://example.test', { method: 'OPTIONS' }));
  assert.equal(response.status, 204); assert.equal(calls.length, 0);
});
test('missing and invalid Firebase tokens never reach Storage', async () => {
  for (const validToken of [true, false]) {
    const { handle, calls } = setup({ validToken });
    assert.equal((await handle(request(undefined, { token: validToken ? null : 'forged' }))).status, 401);
    assert.ok(calls.every(c => !c.url.includes('/storage/')));
  }
});
test('inactive user and inactive student cannot upload', async () => {
  for (const option of [{ active: false }, { studentActive: false }]) {
    const { handle, calls } = setup(option);
    assert.equal((await handle(request())).status, 403);
    assert.ok(calls.every(c => !c.url.includes('/storage/')));
  }
});
test('student upload uses verified UID, immutable path and server-only credentials', async () => {
  const { handle, calls } = setup();
  const response = await handle(request('action=upload&kind=attempts&id=a1&uid=victim'));
  assert.deepEqual(await response.json(), { audioRef: 'supabase://harmonia-audio/attempts/student1/a1' });
  const upload = calls.find(c => c.url.includes('/storage/'));
  assert.ok(upload.url.endsWith('/attempts/student1/a1'));
  assert.equal(upload.options.headers['x-upsert'], 'false');
  assert.equal(await upload.options.body.text(), 'wav-data');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});
test('retry recognizes an existing immutable upload', async () => {
  const { handle } = setup({ duplicate: true });
  assert.equal((await handle(request())).status, 200);
});
test('empty, unsupported, oversized and path traversal uploads are rejected', async () => {
  for (const [query, options, status] of [
    [undefined, { body: '' }, 400], [undefined, { type: 'text/html' }, 415],
    [undefined, { body: new Uint8Array(MAX_BYTES + 1) }, 413],
    ['action=upload&kind=attempts&id=..%2Fvictim', {}, 400],
    ['action=upload&kind=unknown&id=a1', {}, 400],
  ]) {
    const { handle, calls } = setup();
    assert.equal((await handle(request(query, options))).status, status);
    assert.ok(calls.every(c => !c.url.includes('/storage/')));
  }
});
test('a coach cannot impersonate a student upload', async () => {
  const { handle } = setup({ uid: 'coach1', role: 'coach' });
  assert.equal((await handle(request())).status, 403);
});
test('reference uploads require staff', async () => {
  for (const role of ['admin', 'coach', 'institution', 'student']) {
    const { handle } = setup({ role });
    assert.equal((await handle(request('action=upload&kind=references&id=ref1'))).status, role === 'student' ? 403 : 200);
  }
});
test('playback checks current Firestore permissions before signing for five minutes', async () => {
  const { handle, calls } = setup({ role: 'coach', uid: 'coach1' });
  const response = await handle(request('action=playback&ref=supabase://harmonia-audio/attempts/student1/a1'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).expiresIn, 300);
  const check = calls.find(c => c.url.includes('/documents/students/student1'));
  assert.equal(check.options.headers.Authorization, 'Bearer firebase-token');
  const sign = calls.find(c => c.url.includes('/object/sign/'));
  assert.equal(JSON.parse(sign.options.body).expiresIn, 300);
});
test('unassigned coach and another student cannot obtain playback links', async () => {
  for (const option of [{ role: 'coach', uid: 'coach1', studentRead: false }, { uid: 'student2' }]) {
    const { handle, calls } = setup(option);
    assert.equal((await handle(request('action=playback&ref=supabase://harmonia-audio/attempts/student1/a1'))).status, 403);
    assert.ok(calls.every(c => !c.url.includes('/storage/')));
  }
});
test('malformed references and arbitrary URLs are rejected', async () => {
  for (const ref of ['https://evil.test', 'supabase://public/attempts/student1/a1', 'supabase://harmonia-audio/attempts/student1/../a1']) {
    const { handle } = setup();
    assert.equal((await handle(request(`action=playback&ref=${encodeURIComponent(ref)}`))).status, 400);
  }
});
test('upstream errors do not leak secrets', async () => {
  const { handle } = setup({ storageStatus: 500 });
  const response = await handle(request());
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes(config.serviceKey));
});
test('missing deployment configuration fails closed', async () => {
  const response = await createAudioHandler({})(request());
  assert.equal(response.status, 503);
});

test('only admins can delete a validated audio reference', async () => {
  for (const role of ['student', 'coach', 'institution', 'admin']) {
    const { handle, calls } = setup({ role });
    const response = await handle(request('action=delete&ref=supabase://harmonia-audio/attempts/student1/a1'));
    assert.equal(response.status, role === 'admin' ? 200 : 403);
    if (role === 'admin') {
      const removal = calls.find(c => c.options.method === 'DELETE');
      assert.deepEqual(JSON.parse(removal.options.body), { prefixes: ['attempts/student1/a1'] });
    }
  }
});
