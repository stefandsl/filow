"""Runs one noise-suppression candidate over the benchmark clips, checks it, or times it.

  python -I enhance.py run <engine> <dev|heldout> [threads]   writes WORK/enh/<engine>/<wav_id>.wav (16 kHz) and
                                                             WORK/results/enh-<engine>-<split>.csv (per-clip timings)
  python -I enhance.py check <engine>                        chunk-invariance (whole, 128, 160, 480, random), measured
                                                             content delay (cross-correlation on clean speech), latency
  python -I enhance.py perf <engine> <threads> [busy]        per-hop percentiles, RTF, CPU of one core, added memory on
                                                             a fixed set of held-out clips; "busy" = while asr.mjs runs

Engines: gtcrn, dtln, dpdfnet2 (16 kHz), dpdfnet2_48k (48 kHz in, 16 kHz out to the recognizer).
The 48 kHz engine reads the 48 kHz master of the same clip; everything else reads the 16 kHz copy.
"""
import csv
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import psutil
import soundfile as sf
from scipy import signal

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import HERE, MANIFEST, SEED, WORK
from engines import ONNX_ENGINES

PROC = psutil.Process()


def content_delay(x, y, max_lag):
    """Lag (samples) at which y best matches x: positive when y is late."""
    n = min(len(x), len(y))
    c = signal.correlate(y[:n], x[:n], mode="full", method="fft")
    lags = np.arange(-n + 1, n)
    keep = np.abs(lags) <= max_lag
    return int(lags[keep][np.argmax(c[keep])])


def read(wav_id, sr):
    x, got = sf.read(str(WORK / "mix" / ("48k" if sr == 48000 else "16k") / f"{wav_id}.wav"), dtype="float32")
    assert got == sr
    return x


def run_stream(engine, x, chunk=None, rng=None):
    """Feeds x (plus a silent tail so the delayed end comes out) and returns the raw stream output."""
    tail = np.zeros(int(0.2 * engine.sr), np.float32)
    data = np.concatenate([x, tail])
    out, at = [], 0
    while at < len(data):
        n = engine.hop if chunk is None else (int(rng.integers(1, 1000)) if chunk == "random" else chunk)
        out.append(engine.push(data[at:at + n]))
        at += n
    return np.concatenate(out)


def clips_of(split):
    seen = {}
    with open(MANIFEST / "clips.csv", "r", encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            if r["split"] == split and r["tier"] == "core":
                seen[r["wav_id"]] = r
    return list(seen.values())


def delay_of(name):
    """Content delay of the engine in samples at its own rate, measured once on a clean dev clip."""
    clean = next(r for r in clips_of("dev") if r["condition"] == "clean")
    e = ONNX_ENGINES[name](1)
    x = read(clean["wav_id"], e.sr)
    y = run_stream(e, x)
    return content_delay(x, y, int(0.2 * e.sr)), e


def run(name, split, threads):
    delay, probe = delay_of(name)
    sr = probe.sr
    out_dir = WORK / "enh" / name
    out_dir.mkdir(parents=True, exist_ok=True)
    rss0 = PROC.memory_info().rss
    rows = []
    todo = clips_of(split)
    for i, r in enumerate(todo):
        x = read(r["wav_id"], sr)
        e = ONNX_ENGINES[name](threads)  # fresh state per clip, as a new recording would have
        cpu0 = time.process_time()
        y = run_stream(e, x)
        cpu = time.process_time() - cpu0
        y = y[delay:delay + len(x)]
        if sr == 48000:
            y = signal.resample_poly(y, 1, 3)
        sf.write(str(out_dir / f"{r['wav_id']}.wav"), np.clip(y, -1, 1), 16000, subtype="PCM_16")
        h = np.array(e.hop_ms)
        dur = len(x) / sr
        latency_ms = (e.worst_wait + delay) / sr * 1000
        rows.append({"wav_id": r["wav_id"], "engine": name, "threads": threads, "dsp_p50_ms": round(float(np.percentile(h, 50)), 4),
                     "dsp_p95_ms": round(float(np.percentile(h, 95)), 4), "dsp_p99_ms": round(float(np.percentile(h, 99)), 4),
                     "rtf": round(float(h.sum() / 1000 / dur), 5), "added_delay_ms": round(latency_ms + float(np.percentile(h, 95)), 3),
                     "cpu_pct": round(cpu / dur * 100, 2), "rss_mib": round((PROC.memory_info().rss - rss0) / 2 ** 20, 1)})
        if (i + 1) % 200 == 0:
            print(i + 1, "of", len(todo), flush=True)
    with open(WORK / "results" / f"enh-{name}-{split}.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()), lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    print("done", name, split, len(rows), "clips; content delay", delay, "samples; mean RTF", round(float(np.mean([r["rtf"] for r in rows])), 4))


def check(name):
    noisy = next(r for r in clips_of("dev") if r["condition"] == "fan" and r["snr_db"] == "5")
    e = ONNX_ENGINES[name](1)
    x = read(noisy["wav_id"], e.sr)
    ref = run_stream(e, x)
    worst = 0.0
    for chunk in (128, 160, 480, "random"):
        y = run_stream(ONNX_ENGINES[name](1), x, chunk, np.random.default_rng(SEED))
        n = min(len(ref), len(y))
        diff = float(np.max(np.abs(ref[:n] - y[:n]))) if n else 1.0
        worst = max(worst, diff)
        print(f"chunk {chunk}: max abs difference {diff:.2e} over {n} samples (lengths {len(ref)} / {len(y)})")
    delay, probe = delay_of(name)
    # feed in small pieces so the wait for a full hop shows up in worst_wait
    fine = ONNX_ENGINES[name](1)
    run_stream(fine, x, 32 if fine.sr == 16000 else 96, None)
    latency = (fine.worst_wait + delay) / fine.sr * 1000
    print(f"{name}: hop {fine.hop} samples ({fine.hop / fine.sr * 1000:.1f} ms), content delay {delay} samples ({delay / fine.sr * 1000:.1f} ms), "
          f"latency before a sample can come out {latency:.1f} ms; chunk invariance {'PASS' if worst < 1e-6 else 'FAIL'} ({worst:.2e})")
    out_rms = float(np.sqrt(np.mean(ref ** 2)))
    print(f"input rms {float(np.sqrt(np.mean(x ** 2))):.4f}, output rms {out_rms:.4f} (noisy clip, SNR 5 fan)")


def perf(name, threads, busy):
    held = [r for r in clips_of("heldout") if r["condition"] in ("fan", "keyboard", "traffic") and r["snr_db"] == "5"]
    held = sorted(held, key=lambda r: r["wav_id"])[:40]
    asr = None
    if busy:
        lst = WORK / "results" / "list-perf-busy.tsv"
        rows = [r for r in clips_of("heldout") if r["condition"] == "clean" and r["language"] == "en"]
        lst.write_text("\n".join(f"busy{i}-{r['wav_id']}\t{WORK / 'mix' / '16k' / (r['wav_id'] + '.wav')}\ten" for i in range(8) for r in rows) + "\n", encoding="utf-8")
        out = WORK / "results" / "asr-perf-busy.jsonl"
        if out.exists():
            out.unlink()
        asr = subprocess.Popen(["node", str(HERE / "asr.mjs"), "--list", str(lst), "--out", str(out), "--use", "tracking"], stdout=subprocess.DEVNULL)
        time.sleep(8)  # model load
    rss0 = PROC.memory_info().rss
    e0 = ONNX_ENGINES[name](threads)
    sr = e0.sr
    hops, audio, cpu = [], 0.0, 0.0
    load0 = psutil.cpu_percent(interval=None)
    for r in held:
        x = read(r["wav_id"], sr)
        e = ONNX_ENGINES[name](threads)
        c0 = time.process_time()
        run_stream(e, x)
        cpu += time.process_time() - c0
        hops += e.hop_ms
        audio += len(x) / sr
    rss = (PROC.memory_info().rss - rss0) / 2 ** 20
    machine = psutil.cpu_percent(interval=None)
    alive = asr is not None and asr.poll() is None
    if asr is not None:
        asr.kill()
    h = np.array(hops)
    hop_ms = e0.hop / sr * 1000
    print(f"PERF,{name},{threads},{'asr-running' if busy else 'alone'},{hop_ms:.1f},{np.percentile(h, 50):.3f},{np.percentile(h, 95):.3f},"
          f"{np.percentile(h, 99):.3f},{h.max():.3f},{h.sum() / 1000 / audio:.4f},{cpu / audio * 100:.1f},{rss:.1f},{machine:.0f},{audio:.0f},{int(alive)}")


if __name__ == "__main__":
    mode, name = sys.argv[1], sys.argv[2]
    if mode == "run":
        run(name, sys.argv[3], int(sys.argv[4]) if len(sys.argv) > 4 else 1)
    elif mode == "check":
        check(name)
    else:
        perf(name, int(sys.argv[3]), len(sys.argv) > 4 and sys.argv[4] == "busy")
