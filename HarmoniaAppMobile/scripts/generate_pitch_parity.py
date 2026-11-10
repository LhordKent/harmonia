"""Reproduce the pinned upstream SwiftF0 golden fixture. Requires numpy and onnxruntime."""
import importlib.util
import pathlib
import sys
import tempfile
import urllib.request
import numpy as np

root = pathlib.Path(__file__).resolve().parents[1]
revision = 'd1ba77fe5331310b778ebe126b6cb3656d41d24f'
with tempfile.TemporaryDirectory() as directory:
    directory = pathlib.Path(directory)
    urllib.request.urlretrieve(f'https://raw.githubusercontent.com/lars76/swift-f0/{revision}/swift_f0/core.py', directory / 'core.py')
    (directory / 'model.onnx').write_bytes((root / 'app/src/main/assets/models/swiftf0.onnx').read_bytes())
    spec = importlib.util.spec_from_file_location('swift_reference', directory / 'core.py')
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    times = np.arange(16000 * 32, dtype=np.float64) / 16000
    frequency = np.where(times < 10, 220, np.where(times < 20, 440, 261.63))
    samples = (.35 * np.sin(2 * np.pi * frequency * times) + .08 * np.sin(4 * np.pi * frequency * times)).astype(np.float32)
    samples[(times > 14) & (times < 15)] = 0
    result = module.SwiftF0(threads=2, spin=False).detect(samples, 16000, 65, 1050)
    target = root / 'app/src/test/resources/models'
    target.mkdir(parents=True, exist_ok=True)
    samples.astype('<f4').tofile(target / 'parity.f32')
    np.savetxt(target / 'parity.csv', np.column_stack((result.timestamps, result.pitch_hz, result.confidence)),
               delimiter=',', header='seconds,hz,confidence', comments='')
    print(f'Generated {len(result.timestamps)} reference frames, including silence and the 30-second window boundary.')
