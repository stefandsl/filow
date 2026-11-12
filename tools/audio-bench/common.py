"""Shared paths and helpers for the microphone cleanup benchmark (tools/audio-bench).

Nothing here touches C:. Every artefact (audio, models, caches, results) lives under WORK.
Only the manifests under tools/audio-bench/manifest are committed; audio never is.
"""
import hashlib
import json
import os
from pathlib import Path

WORK = Path(os.environ.get("MIC_BENCH_WORK", "G:/FILOW/tmp/mic-cleanup"))
HERE = Path(__file__).resolve().parent
MANIFEST = HERE / "manifest"
LANGS = ["en", "it", "ru", "ro", "ja"]
SEED = 20261112

# Common Voice 22.0 (CC0-1.0), fetched from a Hugging Face mirror at a pinned revision.
CV_REPO = "fsicoli/common_voice_22_0"
CV_REV = "ae911de250fe9375d08e2daa2105b671d659d446"
# FSD50K (per-clip Creative Commons licences), fetched from a Hugging Face mirror at a pinned revision.
FSD_REPO = "Fhrozen/FSD50k"


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def stable_hash(*parts):
    return hashlib.sha256("|".join(str(p) for p in parts).encode("utf-8")).hexdigest()


def read_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path, obj):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
        f.write("\n")
