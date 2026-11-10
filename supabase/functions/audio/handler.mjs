export const BUCKET = 'harmonia-audio';
export const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = new Set(['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm']);
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function check(ok, status, message) { if (!ok) throw new HttpError(status, message); }
function field(doc, key) { return doc?.fields?.[key]?.stringValue ?? null; }

// Dependency injection lets tests exercise the real HTTP boundary without any
// production credentials. Neither client receives the Storage service key.
export function createAudioHandler(config, fetcher = fetch) {
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
  return async function handle(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      check(request.method === 'POST', 405, 'Use POST.');
      check(config.supabaseUrl && config.serviceKey, 503, 'Audio storage is not configured.');
      const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
      check(token, 401, 'Sign in before accessing audio.');
      // Google verifies token signature, issuer, expiry and account status.
      const identity = await fetcher(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${config.firebaseApiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }),
      });
      check(identity.ok, 401, 'Your session expired. Sign in again.');
      const account = (await identity.json()).users?.[0];
      const uid = account?.localId;
      check(uid && ID.test(uid) && !account.disabled, 401, 'Invalid account.');
      const getDoc = async (collection, id) => {
        check(ID.test(id), 400, 'Invalid document ID.');
        const response = await fetcher(`https://firestore.googleapis.com/v1/projects/${config.firebaseProject}/databases/(default)/documents/${collection}/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        check(response.ok, response.status === 404 ? 404 : response.status === 403 ? 403 : 503,
          response.status === 404 ? 'Audio owner was not found.' : 'Audio access was denied.');
        return response.json();
      };
      const profile = await getDoc('users', uid);
      check(field(profile, 'status') === 'active', 403, 'This account is inactive.');
      const role = field(profile, 'role');
      const params = new URL(request.url).searchParams;
      const action = params.get('action');
      let path;
      if (action === 'upload') {
        const id = params.get('id');
        const kind = params.get('kind');
        check(id && ID.test(id), 400, 'Invalid recording ID.');
        check(kind === 'attempts' || kind === 'references', 400, 'Invalid audio category.');
        if (kind === 'attempts') {
          check(role === 'student', 403, 'Only students can upload practice recordings.');
          const student = await getDoc('students', uid);
          check(field(student, 'status') === 'active', 403, 'This student is inactive.');
        } else {
          check(['admin', 'coach', 'institution'].includes(role), 403, 'Only staff can upload reference audio.');
        }
        path = `${kind}/${uid}/${id}`;
        const type = request.headers.get('content-type')?.split(';')[0].trim();
        check(TYPES.has(type), 415, 'Choose a WAV, MP3, M4A, OGG or WebM audio file.');
        const length = Number(request.headers.get('content-length'));
        check(Number.isFinite(length) && length <= MAX_BYTES, 413, 'Audio must be at most 8 MB.');
        const reader = request.body?.getReader();
        check(reader, 400, 'An audio file is required.');
        const chunks = []; let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BYTES) { await reader.cancel(); throw new HttpError(413, 'Audio must be at most 8 MB.'); }
          chunks.push(value);
        }
        check(size > 0, 400, 'The audio file is empty.');
        const result = await fetcher(`${config.supabaseUrl}/storage/v1/object/${BUCKET}/${path}`, {
          method: 'POST', headers: { Authorization: `Bearer ${config.serviceKey}`, apikey: config.serviceKey,
            'Content-Type': type, 'x-upsert': 'false' }, body: new Blob(chunks, { type }),
        });
        if (!result.ok) {
          const error = await result.json().catch(() => ({}));
          // Immutable paths make a retried upload safe after a lost response.
          check(result.status === 409 || error.statusCode === '409' || error.error === 'Duplicate',
            502, 'Audio upload failed. Please retry.');
        }
        return json({ audioRef: `supabase://${BUCKET}/${path}` });
      }
      check(action === 'playback' || action === 'delete', 400, 'Invalid audio action.');
      if (action === 'delete') check(role === 'admin', 403, 'Only administrators can delete audio.');
      const ref = params.get('ref') ?? '';
      const match = ref.match(/^supabase:\/\/harmonia-audio\/(attempts|references)\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})$/);
      check(match, 400, 'Invalid audio reference.');
      const [, kind, owner, id] = match;
      if (kind === 'attempts') {
        // Firestore evaluates current assignment/institution and active status;
        // a coach's old assignment never grants access indefinitely.
        await getDoc('students', owner);
        check(role !== 'student' || uid === owner, 403, 'Audio access was denied.');
      } else {
        check(['student', 'coach', 'institution', 'admin'].includes(role), 403, 'Audio access was denied.');
      }
      path = `${kind}/${owner}/${id}`;
      if (action === 'delete') {
        const result = await fetcher(`${config.supabaseUrl}/storage/v1/object/${BUCKET}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${config.serviceKey}`, apikey: config.serviceKey,
            'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [path] }),
        });
        check(result.ok, 502, 'Audio could not be deleted.');
        return json({ deleted: true });
      }
      const result = await fetcher(`${config.supabaseUrl}/storage/v1/object/sign/${BUCKET}/${path}`, {
        method: 'POST', headers: { Authorization: `Bearer ${config.serviceKey}`, apikey: config.serviceKey,
          'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 300 }),
      });
      check(result.ok, result.status === 404 ? 404 : 502, 'Recording is unavailable.');
      const signed = (await result.json()).signedURL;
      check(typeof signed === 'string' && signed.startsWith('/object/sign/'), 502, 'Playback link could not be created.');
      return json({ url: `${config.supabaseUrl}/storage/v1${signed}`, expiresIn: 300 });
    } catch (error) {
      // Never log bearer tokens, service keys, signed URLs or raw upstream errors.
      return json({ error: error instanceof HttpError ? error.message : 'Audio service is temporarily unavailable.' },
        error instanceof HttpError ? error.status : 503);
    }
  };
}
