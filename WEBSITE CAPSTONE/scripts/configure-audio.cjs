// Stores only a public endpoint. Never write a Supabase secret into Firestore.
const { ownerClient, base, encode, privateBackup } = require('./firebase-owner.cjs');
async function main() {
  const endpoint = process.argv[2];
  const { validateAudioEndpoint } = await import('../src/firebase/audioService.js');
  validateAudioEndpoint(endpoint);
  const { db } = await ownerClient();
  let previous = null;
  try { previous = (await db.get(`/${base}/appConfig/audio`)).body; }
  catch (error) { if (error.status !== 404) throw error; }
  privateBackup('audio-config', { previous });
  await db.post(`/${base}:commit`, { writes: [{ update: { name: `${base}/appConfig/audio`, fields: {
    provider: encode('supabase'), endpoint: encode(endpoint), maxBytes: encode(8388608),
  } } }] });
  console.log('Supabase audio endpoint configured. No secret keys are stored in Firebase.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
