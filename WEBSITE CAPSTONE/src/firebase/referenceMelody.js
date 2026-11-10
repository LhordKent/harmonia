/** Inference runs in a worker; decoding/resampling uses the browser's offline audio engine. */
export async function extractReferenceMelody(file) {
  if (file.size > 8 * 1024 * 1024) throw new Error('Choose a compressed solo recording of at most 8 MB.');
  const context = new AudioContext(); let decoded;
  try { decoded = await context.decodeAudioData(await file.arrayBuffer()); }
  finally { await context.close(); }
  if (decoded.duration < 3 || decoded.duration > 600) throw new Error('Reference audio must be 3 seconds to 10 minutes long.');
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
  const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
  const rendered = await offline.startRendering(); const samples = rendered.getChannelData(0).slice();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./referenceMelody.worker.js', import.meta.url), { type: 'module' });
    const timeout = setTimeout(() => { worker.terminate(); reject(new Error('Reference analysis timed out. Try a shorter or clearer solo recording.')); }, 180000);
    const finish = () => { clearTimeout(timeout); worker.terminate(); };
    worker.onmessage = ({ data }) => { finish(); data.error ? reject(new Error(data.error)) : resolve({ notes: data.notes, duration: Math.ceil(decoded.duration) }); };
    worker.onerror = () => { finish(); reject(new Error('Reference analysis failed. Try again or enter the notes manually.')); };
    worker.postMessage(samples, [samples.buffer]);
  });
}
