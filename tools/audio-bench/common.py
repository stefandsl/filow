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


def resume_rows(part, wav_dir, order):
    """Rows of an interrupted run that can be kept: whole lines of the part table, in clip order,
    whose wav is on disk. The last 20 are dropped and redone, because what was written in the
    seconds before a crash or power cut may never have reached the disk."""
    if not part.exists():
        return []
    import csv
    text = part.read_bytes().replace(b"\x00", b"").decode("utf-8", errors="ignore")
    rows = list(csv.DictReader(text[:text.rfind("\n") + 1].splitlines()))[:-20]
    keep = []
    for row, wav_id in zip(rows, order):
        wav = wav_dir / f"{wav_id}.wav"
        if row.get("wav_id") != wav_id or None in row.values() or not wav.exists() or wav.stat().st_size <= 44:
            break
        keep.append(row)
    return keep


def write_rows(path, rows, replace=None):
    """Writes a table through a temporary file and a rename, so a table that exists is whole."""
    import csv
    tmp = Path(str(path) + ".tmp")
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()), lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, replace or path)


def read_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path, obj):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
        f.write("\n")
