"""The two candidates that do not run through onnxruntime: RNNoise (C, built here) and
DeepFilterNet3 (the project's own deep-filter binary, which carries libDF's STFT/ERB processing).

  python -I external.py run <rnnoise|dfn3|dfn3_ll> <dev|heldout>
  python -I external.py probe <engine>      content delay on clean speech (cross-correlation)
  python -I external.py perf <engine> [busy]

Both work at 48 kHz on the 48 kHz master of each clip; the result is resampled to 16 kHz for the
recognizer. deep-filter exposes no per-hop timing, so its per-hop columns stay empty and its speed
is the wall time of a whole batch (model load included) divided by the audio length.
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
from common import HERE, WORK
from enhance import clips_of, content_delay

RNNOISE = WORK / "build" / "rnnoise" / "rnnoise_cli.exe"
DF = WORK / "models" / "dfn3" / "deep-filter-0.5.6-x86_64-pc-windows-msvc.exe"
DF_MODEL = {"dfn3": WORK / "models" / "dfn3" / "DeepFilterNet3_onnx.tar.gz", "dfn3_ll": WORK / "models" / "dfn3" / "DeepFilterNet3_ll_onnx.tar.gz"}
TMP = WORK / "cache" / "tmp"
SR = 48000
HOP = 480


def watch(proc):
    """Waits for proc; returns (cpu seconds, peak RSS MiB) sampled while it ran."""
    p = psutil.Process(proc.pid)
    cpu, rss = 0.0, 0.0
    while proc.poll() is None:
        try:
            t = p.cpu_times()
            cpu = t.user + t.system
            rss = max(rss, p.memory_info().rss / 2 ** 20)
        except psutil.Error:
            break
        time.sleep(0.02)
    return cpu, rss


def rnnoise_file(x, tag):
    raw_in, raw_out, times = TMP / f"rn-{tag}-in.raw", TMP / f"rn-{tag}-out.raw", TMP / f"rn-{tag}-t.f32"
    pad = np.concatenate([x, np.zeros(SR // 5, np.float32)])
    (np.clip(pad, -1, 1) * 32767).astype("<i2").tofile(raw_in)
    proc = subprocess.Popen([str(RNNOISE), str(raw_in), str(raw_out), str(times)])
    cpu, rss = watch(proc)
    if proc.returncode:
        raise SystemExit("rnnoise_cli failed")
    y = np.fromfile(raw_out, "<i2").astype(np.float32) / 32767
    t = np.fromfile(times, "<f4")
    for f in (raw_in, raw_out, times):
        f.unlink()
    return y, t, cpu, rss


def df_batch(name, wav_ids, out_dir, compensate=True):
    out_dir.mkdir(parents=True, exist_ok=True)
    files = [str(WORK / "mix" / "48k" / f"{w}.wav") for w in wav_ids]
    cmd = [str(DF), "-m", str(DF_MODEL[name]), "-o", str(out_dir)] + (["-D"] if compensate else []) + files
    t0 = time.perf_counter()
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=str(TMP))
    cpu, rss = watch(proc)
    if proc.returncode:
        raise SystemExit(f"deep-filter failed with {proc.returncode}")
    return time.perf_counter() - t0, cpu, rss


def read48(wav_id):
    x, sr = sf.read(str(WORK / "mix" / "48k" / f"{wav_id}.wav"), dtype="float32")
    assert sr == SR
    return x


def probe(name):
    clean = next(r for r in clips_of("dev") if r["condition"] == "clean")
    x = read48(clean["wav_id"])
    if name == "rnnoise":
        y, _, _, _ = rnnoise_file(x, "probe")
    else:
        out = TMP / f"df-probe-{name}"
        df_batch(name, [clean["wav_id"]], out, compensate=False)
        y, _ = sf.read(str(out / f"{clean['wav_id']}.wav"), dtype="float32")
    return content_delay(x, y, SR // 5)


def run(name, split):
    delay = probe(name)
    out_dir = WORK / "enh" / name
    out_dir.mkdir(parents=True, exist_ok=True)
    todo = clips_of(split)
    rows = []
    latency_ms = (delay + HOP) / SR * 1000  # content delay plus the wait for a full 10 ms frame
    if name == "rnnoise":
        for i, r in enumerate(todo):
            x = read48(r["wav_id"])
            y, t, cpu, rss = rnnoise_file(x, split)
            y = signal.resample_poly(y[delay:delay + len(x)], 1, 3)
            sf.write(str(out_dir / f"{r['wav_id']}.wav"), np.clip(y, -1, 1), 16000, subtype="PCM_16")
            dur = len(x) / SR
            rows.append({"wav_id": r["wav_id"], "engine": name, "threads": 1, "dsp_p50_ms": round(float(np.percentile(t, 50)), 4),
                         "dsp_p95_ms": round(float(np.percentile(t, 95)), 4), "dsp_p99_ms": round(float(np.percentile(t, 99)), 4),
                         "rtf": round(float(t.sum() / 1000 / dur), 5), "added_delay_ms": round(latency_ms + float(np.percentile(t, 95)), 3),
                         "cpu_pct": round(float(t.sum() / 1000 / dur) * 100, 2), "rss_mib": round(rss, 1)})
            if (i + 1) % 200 == 0:
                print(i + 1, "of", len(todo), flush=True)
    else:
        stage = WORK / "enh" / f"{name}-48k"
        for at in range(0, len(todo), 40):
            batch = todo[at:at + 40]
            wall, cpu, rss = df_batch(name, [r["wav_id"] for r in batch], stage)
            audio = 0.0
            for r in batch:
                y, sr = sf.read(str(stage / f"{r['wav_id']}.wav"), dtype="float32")
                audio += len(y) / sr
                sf.write(str(out_dir / f"{r['wav_id']}.wav"), np.clip(signal.resample_poly(y, 1, 3), -1, 1), 16000, subtype="PCM_16")
                (stage / f"{r['wav_id']}.wav").unlink()
            for r in batch:
                rows.append({"wav_id": r["wav_id"], "engine": name, "threads": 1, "dsp_p50_ms": "", "dsp_p95_ms": "", "dsp_p99_ms": "",
                             "rtf": round(wall / audio, 5), "added_delay_ms": round(latency_ms, 3), "cpu_pct": round(cpu / audio * 100, 2), "rss_mib": round(rss, 1)})
            print(at + len(batch), "of", len(todo), flush=True)
    with open(WORK / "results" / f"enh-{name}-{split}.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()), lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    print("done", name, split, len(rows), "clips; content delay", delay, "samples at 48 kHz")


def perf(name, busy):
    held = sorted([r for r in clips_of("heldout") if r["condition"] in ("fan", "keyboard", "traffic") and r["snr_db"] == "5"], key=lambda r: r["wav_id"])[:40]
    asr = None
    if busy:
        lst = WORK / "results" / "list-perf-busy.tsv"
        rows = [r for r in clips_of("heldout") if r["condition"] == "clean" and r["language"] == "en"]
        lst.write_text("\n".join(f"busy{i}-{r['wav_id']}\t{WORK / 'mix' / '16k' / (r['wav_id'] + '.wav')}\ten" for i in range(8) for r in rows) + "\n", encoding="utf-8")
        out = WORK / "results" / "asr-perf-busy.jsonl"
        if out.exists():
            out.unlink()
        asr = subprocess.Popen(["node", str(HERE / "asr.mjs"), "--list", str(lst), "--out", str(out), "--use", "tracking"], stdout=subprocess.DEVNULL)
        time.sleep(8)
    psutil.cpu_percent(interval=None)
    if name == "rnnoise":
        ts, audio, rss = [], 0.0, 0.0
        for r in held:
            x = read48(r["wav_id"])
            _, t, _, m = rnnoise_file(x, "perf")
            ts.append(t)
            audio += len(x) / SR
            rss = max(rss, m)
        h = np.concatenate(ts)
        line = f"{np.percentile(h, 50):.3f},{np.percentile(h, 95):.3f},{np.percentile(h, 99):.3f},{h.max():.3f},{h.sum() / 1000 / audio:.4f},{h.sum() / 1000 / audio * 100:.1f},{rss:.1f}"
    else:
        wall, cpu, rss = df_batch(name, [r["wav_id"] for r in held], TMP / f"df-perf-{name}")
        audio = sum(len(read48(r["wav_id"])) for r in held) / SR
        line = f",,,,{wall / audio:.4f},{cpu / audio * 100:.1f},{rss:.1f}"
    machine = psutil.cpu_percent(interval=None)
    alive = asr is not None and asr.poll() is None
    if asr is not None:
        asr.kill()
    print(f"PERF,{name},1,{'asr-running' if busy else 'alone'},10.0,{line},{machine:.0f},{audio:.0f},{int(alive)}")


if __name__ == "__main__":
    mode, name = sys.argv[1], sys.argv[2]
    if mode == "run":
        run(name, sys.argv[3])
    elif mode == "probe":
        print(name, "content delay", probe(name), "samples at 48 kHz")
    else:
        perf(name, len(sys.argv) > 3 and sys.argv[3] == "busy")
