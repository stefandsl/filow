"""Records which recognizer files the benchmark ran (the models Filow ships, copied from an earlier
test profile on G:, never from the owner's profile) with their sizes and sha256.

Usage: python -I 05_asr_manifest.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import MANIFEST, WORK, sha256_file, write_json

ROOT = WORK / "asr-models"
# archive names and archive hashes as pinned in apps/desktop/stt.js (CATALOGUE)
ARCHIVES = {
    "nemotron": ("sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11", "c6bf5e0df765f9d5b43bc9e0536d4b4b3e7d40bdf5ecf13e45f134c51c05ae3a"),
    "parakeet-v3": ("sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8", "1495e91b59d7fc53ddca91f3431758ec99f8fa253fdb0e1e851be0f72b14b0f9"),
    "reazonspeech-ja": ("sherpa-onnx-zipformer-ja-reazonspeech-2024-08-01", "e0981d0d5d7b446d41010831b59091ebf57d2aa7b79980f67ca37af460b5842d"),
    "silero-vad": ("silero_vad.onnx", "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6"),
}

out = {"runtime": "sherpa-onnx-node 2.0.1 (git af2d8d81), decoding through apps/desktop/stt-worker.js with stt.js recognizerConfig",
       "decoding": "greedy_search, 16 kHz, 80 mel bins; phrase models cut by Silero VAD (threshold 0.2, min silence 0.4 s, max phrase 8 s); "
                   "streaming model with endpoint rules 2.4 / 1.2 / 20 s and a 0.8 s silent tail",
       "threads_per_process": 2, "processes": 2, "note": "Filow uses 4 threads on this PC; 2 of 870 dev texts differed between 4 and 2 threads",
       "models": []}
for key, (archive, archive_sha) in ARCHIVES.items():
    files = sorted((ROOT / key).glob("*"))
    out["models"].append({"key": key, "archive": archive, "archive_sha256_in_stt_js": archive_sha,
                          "files": [{"file": f.name, "bytes": f.stat().st_size, "sha256": sha256_file(f)} for f in files]})
write_json(MANIFEST / "asr.json", out)
print("written", MANIFEST / "asr.json")
