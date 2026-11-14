"""Fetch benchmark assets with explicit destinations and bounded requests."""
import hashlib
import json
import pathlib
import shutil
import subprocess

root = pathlib.Path('G:/FILOW/tmp/voice-natural')
target = root / 'models/full'
target.mkdir(parents=True, exist_ok=True)
for name in ['tts.json', 'unicode_indexer.bin', 'voice.bin']:
    shutil.copy2(root / 'models/int8' / name, target / name)
manifest = []
for name in ['duration_predictor.onnx', 'text_encoder.onnx', 'vector_estimator.onnx', 'vocoder.onnx']:
    url = 'https://huggingface.co/Supertone/supertonic-3/resolve/main/onnx/' + name
    dest = target / name
    result = subprocess.run(['curl.exe', '-L', '--fail', '--max-time', '180', '--retry', '1',
                             url, '-o', str(dest)], timeout=370)
    if result.returncode:
        raise SystemExit(result.returncode)
    manifest.append({'url': url, 'sha256': hashlib.sha256(dest.read_bytes()).hexdigest(), 'bytes': dest.stat().st_size})
    (root / 'full-downloads.json').write_text(json.dumps(manifest, indent=2))
