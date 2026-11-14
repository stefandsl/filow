"""DNSMOS P.808 proxy, voiced F0 and silence statistics. No audio output device.

P.808 preprocessing follows Microsoft's DNS-Challenge/DNSMOS/dnsmos_local.py,
CC BY 4.0. This noise-suppression quality proxy is NOT a validated naturalness
ranking for these five languages. Pitch spread alone is not naturalness either.
"""
import json
import os
import pathlib
import sys

ROOT = pathlib.Path('G:/FILOW/tmp/voice-natural')
sys.path.insert(0, str(ROOT / 'python'))
os.environ['NUMBA_CACHE_DIR'] = str(ROOT / 'numba')
import librosa
import numpy as np
import onnxruntime as ort
import soundfile as sf

options = ort.SessionOptions()
options.intra_op_num_threads = 4
session = ort.InferenceSession(str(ROOT / 'dnsmos-p808.onnx'), options, providers=['CPUExecutionProvider'])

def metrics(filename, details):
    signal, rate = sf.read(filename)
    audio = librosa.resample(signal, orig_sr=rate, target_sr=16000).astype(np.float32)
    pitch, voiced, _ = librosa.pyin(audio, fmin=60, fmax=500, sr=16000, frame_length=1024, hop_length=160)
    f0 = pitch[voiced & np.isfinite(pitch)]
    frames = librosa.util.frame(np.pad(audio, (0, 160)), frame_length=160, hop_length=160)
    quiet = np.sqrt(np.mean(frames**2, axis=0)) < 0.003
    transitions = np.diff(np.r_[False, quiet, False].astype(int))
    gaps = (np.where(transitions == -1)[0] - np.where(transitions == 1)[0]) * 10
    gaps = gaps[gaps >= 80]
    padded = audio
    while len(padded) < 144160:
        padded = np.concatenate((padded, padded))
    scores = []
    for offset in range(0, len(padded) - 144160 + 1, 16000):
        part = padded[offset:offset + 144000]
        mel = librosa.feature.melspectrogram(y=part, sr=16000, n_fft=321, hop_length=160, n_mels=120)
        features = ((librosa.power_to_db(mel, ref=np.max) + 40) / 40).T.astype(np.float32)[None]
        scores.append(float(session.run(None, {'input_1': features})[0].flat[0]))
    pieces = []
    start = 0
    for detail in details:
        if 'trimmedSeconds' not in detail:
            continue
        end = start + detail['trimmedSeconds']
        values = pitch[int(start * 100):int(end * 100)]
        values = values[np.isfinite(values)]
        pieces.append({'text': detail['text'], 'stdHz': float(np.std(values)) if len(values) else None,
                       'rangeHz': float(np.ptp(values)) if len(values) else None})
        start = end + detail.get('pauseMs', 0) / 1000
    return {'mosProxy': float(np.mean(scores)), 'f0ByPiece': pieces, 'f0StdHz': float(np.std(f0)) if len(f0) else None,
            'f0RangeHz': float(np.ptp(f0)) if len(f0) else None,
            'f0P95P5Hz': float(np.percentile(f0,95)-np.percentile(f0,5)) if len(f0) else None,
            'pauseCount': len(gaps), 'pauseMedianMs': float(np.median(gaps)) if len(gaps) else 0,
            'pauseTotalMs': int(sum(gaps)), 'peak': float(np.max(np.abs(signal))),
            'clippedFraction': float(np.mean(np.abs(signal) >= 32767/32768))}

for name in sys.argv[1:]:
    rows = json.loads((ROOT / (name + '.json')).read_text(encoding='utf-8'))
    result = []
    for row in rows:
        row.update(metrics(row['wav'], row['detail']))
        result.append(row)
        (ROOT / (name + '-metrics.json')).write_text(json.dumps(result, indent=2), encoding='utf-8')
        print(name, row['lang'], row['index'], round(row['mosProxy'], 3), flush=True)
