"""Diagnostic arms "<engine>_warm": the same engine, but each clip is cleaned right after a few
seconds of normal-level clean speech (a fixed dev clip of the same language, another speaker), so
the engine's state is that of a running session and not of a fresh start. The lead-in is cut off
before the recognizer sees the clip.

  python -I warm.py run <dpdfnet2|hush|gtcrn|dtln|dfn3> <dev|heldout> [k n]   (k of n side-by-side shards)
  python -I warm.py merge <engine> <split> <n>

Added after the first held-out numbers showed DeepFilterNet-style engines deleting quiet speech
from a fresh start. These arms are reported next to the frozen fresh-start arms; they were not
part of the frozen protocol and cannot qualify a candidate.
Writes WORK/enh/<engine>_warm/<wav_id>.wav and WORK/results/enh-<engine>_warm-<split>.csv.
"""
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import signal

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import LANGS, WORK, resume_rows, write_rows
from enhance import clips_of, delay_of, read, run_stream
from engines import ONNX_ENGINES


def primers(sr):
    """First clean dev clip of each language, at the engine's rate."""
    out = {}
    for r in clips_of("dev"):
        if r["condition"] == "clean" and r["language"] in LANGS and r["language"] not in out:
            out[r["language"]] = read(r["wav_id"], sr)
    return out


def merge(name, split, n):
    """Joins the tables of n finished shards into the arm's table, in clip order."""
    arm = f"{name}_warm"
    import csv
    got = {}
    for k in range(n):
        with open(WORK / "results" / f"enh-{arm}-{split}.shard{k}of{n}.csv", "r", encoding="utf-8", newline="") as f:
            got.update({r["wav_id"]: r for r in csv.DictReader(f)})
    todo = clips_of(split)
    missing = [r["wav_id"] for r in todo if r["wav_id"] not in got]
    if missing:
        raise SystemExit(f"{len(missing)} clips missing, e.g. {missing[:3]}")
    write_rows(WORK / "results" / f"enh-{arm}-{split}.csv", [got[r["wav_id"]] for r in todo])
    for k in range(n):
        (WORK / "results" / f"enh-{arm}-{split}.shard{k}of{n}.csv").unlink()
    print("merged", arm, split, len(todo), "clips")


def run(name, split, k=None, n=None):
    arm = f"{name}_warm"
    out_dir = WORK / "enh" / arm
    out_dir.mkdir(parents=True, exist_ok=True)
    todo = clips_of(split)
    final = WORK / "results" / f"enh-{arm}-{split}.csv"
    part = WORK / "results" / f"enh-{arm}-{split}.part.csv"
    if n:  # one of n side-by-side processes: every n-th clip, its own table, joined by "merge"
        todo = todo[k::n]
        final = WORK / "results" / f"enh-{arm}-{split}.shard{k}of{n}.csv"
        part = WORK / "results" / f"enh-{arm}-{split}.shard{k}of{n}.part.csv"
    rows = resume_rows(part, out_dir, [r["wav_id"] for r in todo])
    if name == "dfn3":
        from external import DF, DF_MODEL, TMP, watch
        sr, stage = 48000, TMP / "warm-dfn3"
        (stage / "in").mkdir(parents=True, exist_ok=True)
    else:
        delay, probe = delay_of(name)
        sr = probe.sr
    lead = primers(sr)
    for i, r in enumerate(todo):
        if i < len(rows):
            continue
        x = read(r["wav_id"], sr)
        p = lead.get(r["language"], lead["en"])
        both = np.concatenate([p, x])
        if name == "dfn3":
            src = stage / "in" / f"{r['wav_id']}.wav"
            sf.write(str(src), both, sr, subtype="PCM_16")
            proc = subprocess.Popen([str(DF), "-m", str(DF_MODEL[name]), "-o", str(stage), "-D", str(src)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=str(TMP))
            watch(proc)
            if proc.returncode:
                raise SystemExit(f"deep-filter failed with {proc.returncode}")
            y, _ = sf.read(str(stage / f"{r['wav_id']}.wav"), dtype="float32")
            y = y[len(p):len(p) + len(x)]
            src.unlink()
            (stage / f"{r['wav_id']}.wav").unlink()
        else:
            y = run_stream(ONNX_ENGINES[name](1), both)[delay + len(p):delay + len(p) + len(x)]
        if sr == 48000:
            y = signal.resample_poly(y, 1, 3)
        sf.write(str(out_dir / f"{r['wav_id']}.wav"), np.clip(y, -1, 1), 16000, subtype="PCM_16")
        rows.append({"wav_id": r["wav_id"], "engine": arm, "threads": 1, "dsp_p50_ms": "", "dsp_p95_ms": "", "dsp_p99_ms": "",
                     "rtf": "", "added_delay_ms": "", "cpu_pct": "", "rss_mib": ""})
        if (i + 1) % 40 == 0:
            write_rows(part, rows)
        if (i + 1) % 200 == 0:
            print(i + 1, "of", len(todo), flush=True)
    write_rows(part, rows, replace=final)
    if part.exists():
        part.unlink()
    print("done", arm, split, len(rows), "clips")


if __name__ == "__main__":
    if sys.argv[1] == "merge":
        merge(sys.argv[2], sys.argv[3], int(sys.argv[4]))
    elif len(sys.argv) > 5:
        run(sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5]))
    else:
        run(sys.argv[2], sys.argv[3])
