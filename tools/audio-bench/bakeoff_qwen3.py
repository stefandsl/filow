"""Does Qwen3-ASR 0.6B (audio.cpp server) beat Filow's phrase recogniser on questions in Romanian,
Russian and Japanese? Item V2 of G:/FILOW/tmp/audiocpp-research/PLAN.md, measurement only.

  python -I bakeoff_qwen3.py                 the bake-off: 48 held-out clean clips per language
  python -I bakeoff_qwen3.py speed <lang>    speed-only re-measure of a candidate language; run with
                                             MIC_BENCH_AFFINITY=16,17,18,19 (MIC-CLEANUP section 5.5)

Inputs are pinned in manifest/bakeoff-qwen3.json (QWEN3_BAKEOFF_MANIFEST overrides the path, for the
tests). The script stops on any hash mismatch: the server zip, the GGUF, and asr.json's archive
hashes against today's stt.js catalogue (the baseline was decoded with those models).

The server runs from the release zip (unpacked under the output folder) with 2 threads on
127.0.0.1:8091; only the process this script started is ever stopped. Peak RAM is the server's
working set sampled every 20 ms from after the warm-up request until the server stops.

Scoring imports normalise and edits from score.py: WER for ro and ru, CER for ja, pooled per
language. Interval: 2000 paired bootstrap draws that resample speakers with replacement (all clips
of a drawn speaker go together, the same draw for both arms), 2.5 and 97.5 percentiles of
(Qwen3 - baseline). Candidate: at least 2 points better with the interval below zero, median
real-time factor at most 0.5, peak RAM at most 1.5 GB (10^9 bytes).
"""
import csv
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
import zipfile
from pathlib import Path

import numpy as np
import psutil
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import HERE, MANIFEST, SEED, read_json, sha256_file, write_json
from score import edits, normalise

# The committed BAKEOFF-QWEN3-2026-11.md is the frozen record of the 2026-11-12 run; reruns write here.
REPORT = Path("G:/FILOW/tmp/audiocpp-bakeoff") / "BAKEOFF-QWEN3-latest.md"
COMMAND = "python -I bakeoff_qwen3.py   (from tools/audio-bench, with G:/FILOW/tmp/mic-cleanup/venv)"
LANG_ORDER = ["ro", "ru", "ja"]


def fail(msg):
    """Stops the run loudly: the message on stderr and a non-zero exit."""
    print(f"bakeoff_qwen3: STOP: {msg}", file=sys.stderr, flush=True)
    raise SystemExit(2)


def load_manifest():
    path = Path(os.environ.get("QWEN3_BAKEOFF_MANIFEST", MANIFEST / "bakeoff-qwen3.json"))
    return read_json(path)


# ---------------------------------------------------------------- pinned inputs

def check_inputs(m):
    """Every pinned file exists and has its recorded SHA-256; returns {name: sha256}."""
    got = {}
    for name in ("server_zip", "model"):
        spec = m[name]
        path = Path(spec["path"])
        if not path.is_file():
            fail(f"{name} is missing: {path}")
        digest = sha256_file(path)
        if digest != spec["sha256"]:
            fail(f"{name} sha256 mismatch: {path} is {digest}, the manifest pins {spec['sha256']}")
        got[name] = digest
    return got


def stt_catalogue(stt_js):
    """archive name -> sha256 from stt.js (each catalogue entry names its archive, then its sha256)."""
    text = Path(stt_js).read_text(encoding="utf-8")
    pairs = re.findall(r'archive:\s*"([^"]+)"[\s\S]*?sha256:\s*"([0-9a-f]{64})"', text)
    return dict(pairs)


def check_baseline_catalogue(asr_json, stt_js):
    """The baseline was decoded with the models of asr.json; they must still be today's stt.js models."""
    cat = stt_catalogue(stt_js)
    checked = []
    for model in read_json(asr_json)["models"]:
        today = cat.get(model["archive"])
        if today != model["archive_sha256_in_stt_js"]:
            fail(f"baseline model {model['key']} ({model['archive']}): asr.json pins {model['archive_sha256_in_stt_js']}, "
                 f"stt.js has {today}. The baseline no longer describes today's Filow; a rerun is a separate decision.")
        checked.append(model["key"])
    return checked


# ---------------------------------------------------------------- server

def unpack_server(zip_path, sha, out_dir):
    """The release zip unpacked once into its own folder, named after the zip's hash."""
    dest = Path(out_dir) / f"bin-{sha[:12]}"
    exe = dest / "audiocpp_server.exe"
    if not exe.is_file():
        dest.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(dest)
    if not exe.is_file():
        fail(f"audiocpp_server.exe not found in {zip_path}")
    return exe


def write_config(m, out_dir):
    s = m["server"]
    cfg = {"host": s["host"], "port": s["port"], "backend": s["backend"], "threads": s["threads"], "lazy_load": False,
           "models": [{"id": s["model_id"], "family": "qwen3_asr", "path": Path(m["model"]["path"]).as_posix(), "task": "asr", "mode": "offline"}]}
    path = Path(out_dir) / "server.json"
    write_json(path, cfg)
    return path, cfg


def port_in_use(host, port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex((host, port)) == 0


def get_json(url, timeout=5):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def stop_server(proc):
    """Stops the one process this script started (never anything else on the port)."""
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=10)


def start_server(cmd, host, port, model_id, timeout_s, cwd=None, log=None):
    """Starts the server and waits until /v1/models lists model_id. Fails loudly (and stops the
    process it started) if the port is taken, the process exits, or the model is not listed in time."""
    if port_in_use(host, port):
        fail(f"port {port} is already in use; this script only uses {port} and stops only the server it starts")
    proc = subprocess.Popen(cmd, cwd=cwd, stdout=log or subprocess.DEVNULL, stderr=subprocess.STDOUT)
    t0 = time.monotonic()
    last = "no answer"
    while time.monotonic() - t0 < timeout_s:
        code = proc.poll()
        if code is not None:
            fail(f"the server exited with code {code} before listing {model_id} ({time.monotonic() - t0:.1f} s)")
        try:
            ids = [e.get("id") for e in get_json(f"http://{host}:{port}/v1/models", timeout=2).get("data", [])]
            if model_id in ids:
                return proc
            last = f"/v1/models lists {ids}"
        except (OSError, ValueError) as e:
            last = str(e)
        time.sleep(0.25)
    stop_server(proc)
    fail(f"the server did not list {model_id} within {timeout_s} s (last: {last})")


def transcribe(host, port, model_id, wav_path, language, timeout_s):
    """Multipart POST /v1/audio/transcriptions. Returns (http status or error, text, client wall ms);
    a non-200 or empty answer is an empty hypothesis."""
    boundary = uuid.uuid4().hex
    data = Path(wav_path).read_bytes()
    parts = []
    for k, v in (("model", model_id), ("language", language)):
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode("utf-8"))
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{Path(wav_path).name}"\r\n'
                 f"Content-Type: audio/wav\r\n\r\n".encode("utf-8") + data + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode("utf-8"))
    req = urllib.request.Request(f"http://{host}:{port}/v1/audio/transcriptions", data=b"".join(parts), method="POST",
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as r:
            status, body = r.status, r.read()
    except urllib.error.HTTPError as e:
        status, body = e.code, b""
    except OSError as e:
        status, body = f"error: {e}", b""
    ms = (time.perf_counter() - t0) * 1000
    text = ""
    if status == 200:
        try:
            text = (json.loads(body.decode("utf-8")).get("text") or "").strip()
        except ValueError:
            status = "200 but not JSON"
    return status, text, ms


class RamSampler(threading.Thread):
    """Samples one process's working set every period_ms; each sample carries the current tag."""

    def __init__(self, pid, period_ms):
        super().__init__(daemon=True)
        self.proc = psutil.Process(pid)
        self.period = period_ms / 1000
        self.tag = ""
        self.samples = []  # (seconds since start, bytes, tag)
        self.halt = threading.Event()

    def run(self):
        t0 = time.monotonic()
        while not self.halt.is_set():
            try:
                self.samples.append((time.monotonic() - t0, self.proc.memory_info().rss, self.tag))
            except psutil.Error:
                break
            self.halt.wait(self.period)

    def peak(self, tag=None):
        vals = [b for _, b, t in self.samples if tag is None or t == tag]
        return max(vals) if vals else None


# ---------------------------------------------------------------- scoring

def speaker_draws(n_speakers, B, rng):
    """(B x speakers) multiplicities of one speaker bootstrap: speakers resampled with replacement."""
    return rng.multinomial(n_speakers, [1 / n_speakers] * n_speakers, size=B)


def paired_interval(e_base, e_cand, n, draws):
    """Pooled error rates in percent: (baseline, candidate, candidate - baseline, lo, hi), where lo and
    hi are the 2.5 and 97.5 percentiles of the difference over the SAME speaker draws for both arms."""
    e_base, e_cand, n = (np.asarray(x, float) for x in (e_base, e_cand, n))
    base, cand = 100 * e_base.sum() / n.sum(), 100 * e_cand.sum() / n.sum()
    den = np.maximum(1e-9, draws @ n)
    diff = 100 * (draws @ e_cand) / den - 100 * (draws @ e_base) / den
    lo, hi = np.percentile(diff, [2.5, 97.5])
    return float(base), float(cand), float(cand - base), float(lo), float(hi)


def score_language(clips, refs, hyp_base, hyp_cand, lang, draws):
    speakers = sorted({c["speaker_id"] for c in clips})
    ix = {s: k for k, s in enumerate(speakers)}
    e0, e1, n = np.zeros(len(speakers)), np.zeros(len(speakers)), np.zeros(len(speakers))
    for c in clips:
        ref = normalise(refs[c["utterance_id"]], lang)
        k = ix[c["speaker_id"]]
        n[k] += len(ref)
        e0[k] += sum(edits(ref, normalise(hyp_base[c["clip_id"]], lang)))
        e1[k] += sum(edits(ref, normalise(hyp_cand[c["clip_id"]], lang)))
    return paired_interval(e0, e1, n, draws), len(speakers), int(n.sum())


def decide(diff, hi, median_rtf, peak_bytes, gates):
    """Candidate only if all three gates pass. Returns (yes/no, reasons it failed)."""
    why = []
    if not (diff <= -gates["min_gain_points"] and hi < 0):
        why.append(f"accuracy: {diff:+.2f} pt, interval upper end {hi:+.2f} (needs <= -{gates['min_gain_points']:.0f} pt and below 0)")
    if not median_rtf <= gates["max_median_rtf"]:
        why.append(f"speed: median RTF {median_rtf:.3f} > {gates['max_median_rtf']}")
    if peak_bytes is None or not peak_bytes <= gates["max_peak_ram_gb"] * 1e9:
        why.append(f"memory: peak {('%.2f GB' % (peak_bytes / 1e9)) if peak_bytes else 'not measured'} > {gates['max_peak_ram_gb']} GB")
    return not why, why


# ---------------------------------------------------------------- run

def clips_for(langs):
    with open(MANIFEST / "clips.csv", "r", encoding="utf-8", newline="") as f:
        rows = [r for r in csv.DictReader(f) if r["split"] == "heldout" and r["tier"] == "core" and r["condition"] == "clean" and r["language"] in langs]
    return sorted(rows, key=lambda r: (LANG_ORDER.index(r["language"]), r["clip_id"]))


def hardware(stt_js):
    js = (f"const s=require({json.dumps(str(Path(stt_js)))});const os=require('os');"
          "console.log(JSON.stringify({hardwareOf:s.hardwareOf(),cpu:os.cpus()[0].model.trim(),logical:os.cpus().length}))")
    try:
        out = subprocess.run(["node", "-e", js], capture_output=True, text=True, timeout=60, cwd=str(Path(stt_js).parent))
        return json.loads(out.stdout.strip().splitlines()[-1])
    except (OSError, ValueError, IndexError, subprocess.SubprocessError) as e:
        return {"error": f"stt.hardwareOf() unavailable: {e}"}


def confine():
    """MIC_BENCH_AFFINITY confines this process, and so the server it starts, to those processors."""
    cpus = [int(c) for c in os.environ.get("MIC_BENCH_AFFINITY", "").split(",") if c.strip()]
    if cpus:
        psutil.Process().cpu_affinity(cpus)
    return cpus


def run_server_pass(m, out, exe, cfg_path, clips):
    """Starts the server, warms it up with the first clip, transcribes every clip, stops the server.
    Returns (rows, sampler, health, server affinity)."""
    s = m["server"]
    wav_dir = Path(m["wav_dir"])
    with open(out / "server.log", "ab") as log:
        proc = start_server([str(exe), "--config", str(cfg_path), "--no-ui", "--log"], s["host"], s["port"], s["model_id"],
                            s["start_timeout_s"], cwd=str(exe.parent), log=log)
        sampler = None
        try:
            health = get_json(f"http://{s['host']}:{s['port']}/health")
            try:
                affinity = psutil.Process(proc.pid).cpu_affinity()
            except psutil.Error:
                affinity = None
            first = clips[0]
            status, _, warm_ms = transcribe(s["host"], s["port"], s["model_id"], wav_dir / f"{first['wav_id']}.wav",
                                            m["languages"][first["language"]], s["request_timeout_s"])
            print(f"warm-up ({first['clip_id']}): status {status}, {warm_ms:.0f} ms (discarded)", flush=True)
            sampler = RamSampler(proc.pid, m["ram_sample_ms"])
            sampler.start()
            rows = []
            for i, c in enumerate(clips):
                wav = wav_dir / f"{c['wav_id']}.wav"
                info = sf.info(str(wav))
                sampler.tag = c["language"]
                status, text, ms = transcribe(s["host"], s["port"], s["model_id"], wav, m["languages"][c["language"]], s["request_timeout_s"])
                sampler.tag = ""
                rows.append({"clip_id": c["clip_id"], "language": c["language"], "speaker_id": c["speaker_id"], "status": status, "text": text,
                             "asr_ms": round(ms, 1), "audio_s": round(info.frames / info.samplerate, 3)})
                if (i + 1) % 12 == 0:
                    print(f"{i + 1}/{len(clips)} {c['language']} last {ms:.0f} ms: {text[:60]}", flush=True)
        finally:
            stop_server(proc)
            if sampler is not None:
                sampler.halt.set()
                sampler.join(timeout=5)
    return rows, sampler, health, affinity


def write_jsonl(path, rows):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def write_samples(path, sampler):
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["t_s", "working_set_bytes", "language"])
        for t, b, tag in sampler.samples:
            w.writerow([f"{t:.3f}", b, tag])


def prepare(m):
    out = Path(m["out_dir"])
    out.mkdir(parents=True, exist_ok=True)
    hashes = check_inputs(m)
    base = m["baseline"]
    asr_json = Path(base.get("asr_json", MANIFEST / "asr.json"))
    checked = check_baseline_catalogue(asr_json, base["stt_js"])
    exe = unpack_server(m["server_zip"]["path"], hashes["server_zip"], out)
    cfg_path, cfg = write_config(m, out)
    return out, hashes, checked, exe, cfg_path, cfg


def main_bakeoff(m):
    out, hashes, checked, exe, cfg_path, cfg = prepare(m)
    langs = list(m["languages"])
    clips = clips_for(langs)
    refs = {u["utterance_id"]: u["text"] for u in read_json(MANIFEST / "corpus.json")["utterances"]}
    base_rows = {}
    with open(m["baseline"]["jsonl"], "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                j = json.loads(line)
                base_rows[j["clip_id"]] = j
    missing = [c["clip_id"] for c in clips if c["clip_id"] not in base_rows]
    if missing:
        fail(f"{len(missing)} clips have no baseline hypothesis, first {missing[0]}")
    t0 = time.time()
    rows, sampler, health, affinity = run_server_pass(m, out, exe, cfg_path, clips)
    write_jsonl(out / "hyp-qwen3-heldout-clean.jsonl", rows)
    write_samples(out / "ram-samples.csv", sampler)
    hyp = {r["clip_id"]: r["text"] for r in rows}
    rng = np.random.default_rng(SEED)
    summary = {"item": "V2", "command": COMMAND, "run_started": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(t0)),
               "wall_s": round(time.time() - t0, 1), "hashes": hashes, "model": {k: m["model"][k] for k in ("repo", "file", "commit")},
               "server_zip_url": m["server_zip"]["url"], "server_health": health, "server_affinity": affinity, "server_config": cfg,
               "baseline_models_checked_against_stt_js": checked, "hardware": hardware(m["baseline"]["stt_js"]),
               "gates": m["gates"], "bootstrap_draws": m["bootstrap_draws"], "seed": SEED, "peak_ram_bytes_all": sampler.peak(),
               "ram_samples": len(sampler.samples), "languages": {}}
    for lang in langs:
        lc = [c for c in clips if c["language"] == lang]
        n_spk = len({c["speaker_id"] for c in lc})
        draws = speaker_draws(n_spk, m["bootstrap_draws"], rng)
        (base, cand, diff, lo, hi), _, tokens = score_language(lc, refs, {k: v["text"] for k, v in base_rows.items()}, hyp, lang, draws)
        rtf = [r["asr_ms"] / (1000 * r["audio_s"]) for r in rows if r["language"] == lang]
        brtf = [base_rows[c["clip_id"]]["asr_ms"] / (1000 * base_rows[c["clip_id"]]["audio_s"]) for c in lc]
        peak = sampler.peak(lang)
        ok, why = decide(diff, hi, float(np.median(rtf)), peak, m["gates"])
        bad = [r["clip_id"] for r in rows if r["language"] == lang and (r["status"] != 200 or not r["text"])]
        summary["languages"][lang] = {
            "metric": "CER" if lang == "ja" else "WER", "clips": len(lc), "speakers": n_spk, "ref_tokens": tokens,
            "baseline_model": sorted({base_rows[c["clip_id"]]["model"] for c in lc}), "baseline": round(base, 2), "qwen3": round(cand, 2),
            "diff": round(diff, 2), "diff_lo": round(lo, 2), "diff_hi": round(hi, 2), "median_rtf": round(float(np.median(rtf)), 4),
            "p90_rtf": round(float(np.percentile(rtf, 90)), 4), "baseline_median_rtf": round(float(np.median(brtf)), 4),
            "peak_ram_bytes": peak, "empty_or_failed": bad, "candidate": ok, "failed_gates": why}
        print(f"{lang}: baseline {base:.2f} qwen3 {cand:.2f} diff {diff:+.2f} [{lo:+.2f}, {hi:+.2f}] median RTF {np.median(rtf):.3f} "
              f"peak {peak / 1e9 if peak else float('nan'):.2f} GB candidate {'yes' if ok else 'no'}", flush=True)
    write_json(out / "summary-qwen3.json", summary)
    write_report(summary, read_speed(out))


def main_speed(m, langs):
    cpus = confine()
    out, hashes, checked, exe, cfg_path, cfg = prepare(m)
    clips = clips_for(langs)
    rows, sampler, health, affinity = run_server_pass(m, out, exe, cfg_path, clips)
    tag = "-".join(langs)
    write_jsonl(out / f"speed-{tag}-affinity.jsonl", rows)
    res = {"affinity_requested": cpus, "server_affinity": affinity, "machine": os.environ.get("MIC_BENCH_MACHINE", ""), "languages": {}}
    for lang in langs:
        rtf = [r["asr_ms"] / (1000 * r["audio_s"]) for r in rows if r["language"] == lang]
        res["languages"][lang] = {"clips": len(rtf), "median_rtf": round(float(np.median(rtf)), 4), "p90_rtf": round(float(np.percentile(rtf, 90)), 4),
                                  "peak_ram_bytes": sampler.peak(lang)}
        print(f"{lang} on {cpus}: median RTF {np.median(rtf):.3f}", flush=True)
    write_json(out / f"speed-{tag}-affinity.json", res)
    summary_path = out / "summary-qwen3.json"
    if summary_path.exists():
        write_report(read_json(summary_path), read_speed(out))


def read_speed(out):
    return {p.name: read_json(p) for p in sorted(Path(out).glob("speed-*-affinity.json"))}


def write_report(s, speed):
    hw = s["hardware"]
    names = {"ro": "Romanian", "ru": "Russian", "ja": "Japanese"}
    o = ["# Qwen3-ASR 0.6B (audio.cpp) against Filow's phrase recogniser, questions, 2026-11", "",
         "Item V2 of `G:/FILOW/tmp/audiocpp-research/PLAN.md`, measurement only. This file is written by",
         "`bakeoff_qwen3.py`; rerun the command below to regenerate it.", "",
         f"Command: `{s['command']}`", "", f"Run started {s['run_started']}, wall time {s['wall_s']:.0f} s.", "",
         "## Inputs", "",
         f"- Server: `{Path(s['server_zip_url']).name}` from {s['server_zip_url']}, sha256 `{s['hashes']['server_zip']}`; "
         f"/health: version {s['server_health'].get('version')}, git {s['server_health'].get('git')} ({s['server_health'].get('git_date')}).",
         f"- Model: `{s['model']['file']}` from Hugging Face `{s['model']['repo']}` at commit `{s['model']['commit']}`, sha256 `{s['hashes']['model']}`.",
         f"- Server config: {s['server_config']['backend']}, {s['server_config']['threads']} threads, lazy_load false, "
         f"{s['server_config']['host']}:{s['server_config']['port']}, model id `{s['server_config']['models'][0]['id']}`, offline. "
         "Each clip is a multipart POST /v1/audio/transcriptions with `language` = Romanian, Russian or Japanese; one discarded warm-up request first.",
         "- Clips: `manifest/clips.csv`, split heldout, tier core, condition clean, 48 per language (6 speakers each); WAVs from `G:/FILOW/tmp/mic-cleanup/mix/16k`.",
         f"- Baseline: `asr-questions-raw-heldout-t2.jsonl` (sherpa-onnx, 2 threads, VAD phrases); asr.json's archive hashes match today's stt.js for "
         f"{', '.join(s['baseline_models_checked_against_stt_js'])}.",
         f"- Hardware: stt.hardwareOf() = {json.dumps(hw.get('hardwareOf', hw))}; CPU {hw.get('cpu', '?')}.", "",
         "Scoring: `normalise` and `edits` from score.py (norm-v1), errors pooled per language (WER; CER for Japanese). Interval: "
         f"{s['bootstrap_draws']} paired speaker bootstrap draws (seed {s['seed']}), 2.5 to 97.5 percentiles of Qwen3 minus baseline. "
         "RTF = client wall ms / (1000 x audio seconds). Peak RAM = largest sampled working set of the server process (every 20 ms) "
         "while that language's requests ran; GB = 10^9 bytes.", "",
         f"Gates (candidate only if all pass): at least {s['gates']['min_gain_points']:.0f} points better with the interval below 0, "
         f"median RTF at most {s['gates']['max_median_rtf']}, peak RAM at most {s['gates']['max_peak_ram_gb']} GB.", ""]
    any_yes = False
    for lang, r in s["languages"].items():
        any_yes |= r["candidate"]
        metric = r["metric"]
        peak = f"{r['peak_ram_bytes'] / 1e9:.2f} GB" if r["peak_ram_bytes"] else "not measured"
        o += [f"## {names.get(lang, lang)} ({lang}), {metric}", "",
              f"| arm | {metric} % | Qwen3 - baseline (95 % interval) | median RTF (p90) | peak RAM | candidate |", "|---|---|---|---|---|---|",
              f"| Filow: {', '.join(r['baseline_model'])} | {r['baseline']:.2f} | - | {r['baseline_median_rtf']:.3f} | not measured here | - |",
              f"| Qwen3-ASR 0.6B q8_0 | {r['qwen3']:.2f} | {r['diff']:+.2f} ({r['diff_lo']:+.2f} .. {r['diff_hi']:+.2f}) | "
              f"{r['median_rtf']:.3f} ({r['p90_rtf']:.3f}) | {peak} | {'yes' if r['candidate'] else 'no'} |", "",
              f"{r['clips']} clips, {r['speakers']} speakers, {r['ref_tokens']} reference {'characters' if metric == 'CER' else 'words'}; "
              f"empty or failed Qwen3 answers: {len(r['empty_or_failed'])}" + (f" ({', '.join(r['empty_or_failed'])})" if r["empty_or_failed"] else "") + ".", ""]
        if r["failed_gates"]:
            o += ["Gates not met: " + "; ".join(r["failed_gates"]) + ".", ""]
    o += ["## Result", "",
          ("At least one language has a candidate; see the efficiency-core re-measure below. It goes to the owner with its cost."
           if any_yes else "No candidate: Qwen3-ASR 0.6B does not pass every gate in any of the three languages. Filow keeps its recognisers; "
           "no efficiency-core re-measure was run (the plan runs it only for a candidate)."), ""]
    only_memory = [lang for lang, r in s["languages"].items() if r["failed_gates"] and all(w.startswith("memory") for w in r["failed_gates"])]
    if only_memory:
        o += [f"Passed accuracy and speed but failed memory only: {', '.join(only_memory)}. The working set holds the whole "
              "1.15 GB GGUF plus the runtime; the gate is the plan's own 1.5 GB choice and was not moved after the run.", ""]
    if speed:
        o += ["## Efficiency-core re-measure (speed only)", "",
              "| run | processors | language | median RTF (p90) | peak RAM |", "|---|---|---|---|---|"]
        for name, sp in speed.items():
            for lang, r in sp["languages"].items():
                peak = f"{r['peak_ram_bytes'] / 1e9:.2f} GB" if r["peak_ram_bytes"] else "-"
                o.append(f"| {name} | {sp['server_affinity']} | {lang} | {r['median_rtf']:.3f} ({r['p90_rtf']:.3f}) | {peak} |")
        o.append("")
    o += ["Outputs in `G:/FILOW/tmp/audiocpp-bakeoff/`: hyp-qwen3-heldout-clean.jsonl (hypotheses, status, timing), ram-samples.csv, "
          "summary-qwen3.json, server.json, server.log.", ""]
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text("\n".join(o), encoding="utf-8", newline="\n")
    print(f"report: {REPORT}", flush=True)


def main():
    for stream in (sys.stdout, sys.stderr):  # progress lines carry Romanian, Russian and Japanese text
        stream.reconfigure(encoding="utf-8", errors="replace")
    m = load_manifest()
    args = sys.argv[1:]
    if args[:1] == ["speed"]:
        langs = args[1:] or fail("speed needs at least one language")
        if any(lang not in m["languages"] for lang in langs):
            fail(f"unknown language in {langs}")
        main_speed(m, langs)
    elif not args:
        main_bakeoff(m)
    else:
        fail(f"unknown arguments {args}")


if __name__ == "__main__":
    main()
