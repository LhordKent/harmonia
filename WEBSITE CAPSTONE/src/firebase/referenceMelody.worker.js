import * as ort from 'onnxruntime-web/wasm';
import runtimeModuleUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url';
import runtimeBinaryUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';

ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = { mjs: runtimeModuleUrl, wasm: runtimeBinaryUrl };
self.onmessage = async ({ data: samples }) => {
  try {
    const response = await fetch('/models/swiftf0.onnx');
    if (!response.ok) throw new Error('Pitch model could not be loaded.');
    const bytes = await response.arrayBuffer();
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
    if (digest !== '6385e8c2ebc3872e82c9ff5946228de44cd3be77a750ea53698b7dbfe94b0a22') throw new Error('Pitch model verification failed.');
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
    const frames = [];
    try {
      const count = Math.max(1, Math.floor(samples.length / 256));
      for (let start = 0; start < count; start += 1875) {
        const end = Math.min(start + 1875, count), left = Math.max(0, start - 11);
        const window = samples.slice(left * 256, end < count ? Math.min(samples.length, (end + 10) * 256) : samples.length);
        const inputs = { audio: new ort.Tensor('float32', window, [1, window.length]),
          fmin: new ort.Tensor('float32', new Float32Array([65]), []), fmax: new ort.Tensor('float32', new Float32Array([1050]), []) };
        const output = await session.run(inputs);
        for (let i = start; i < end; i++) {
          let peak = 0;
          for (let j = i * 256; j < Math.min(samples.length, (i + 1) * 256); j++) peak = Math.max(peak, Math.abs(samples[j]));
          const hz = Number(output.pitch.data[i - left]);
          frames.push(peak >= .001 && output.confidence.data[i - left] >= .5 && hz >= 65 && hz <= 1050 ? Math.round(69 + 12 * Math.log2(hz / 440)) : null);
        }
        Object.values(inputs).forEach(t => t.dispose()); Object.values(output).forEach(t => t.dispose());
      }
    } finally { await session.release(); }
    const smoothed = frames.map((n, i) => i > 0 && i < frames.length - 1 && frames[i - 1] === frames[i + 1] ? frames[i - 1] : n);
    const notes = []; let start = 0;
    for (let i = 1; i <= smoothed.length; i++) if (i === smoothed.length || smoothed[i] !== smoothed[start]) {
      if (smoothed[start] !== null && (i - start) * .016 >= .12) notes.push({ startSeconds: +(start * .016).toFixed(3),
        endSeconds: +(i * .016).toFixed(3), frequencyHz: +(440 * 2 ** ((smoothed[start] - 69) / 12)).toFixed(3) });
      start = i;
    }
    if (!notes.length) throw new Error('No clear solo melody was detected. Enter notes manually or use another recording.');
    self.postMessage({ notes });
  } catch (error) { self.postMessage({ error: error.message || 'Reference analysis failed.' }); }
};
