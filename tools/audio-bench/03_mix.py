"""Step B3: build the frozen benchmark clips (48 kHz masters and the 16 kHz copies Filow would hear).

Every random choice comes from a hash of the fixed seed and the clip id, so a rerun gives the same
audio (the manifest records the sha256 of each 16 kHz file).

Conditions per utterance:
  clean                       speech at -26 dBFS active level
  quiet                       the same with -20 dB gain
  keyboard|fan|traffic        FSD50K noise at SNR 0, 5, 10, 20 dB
  voice_same|voice_diff       another speaker (same / another language) at SIR 0, 12 dB
  echo                        other speech played back through a short synthetic room (delay 20-60 ms,
                              RT60 0.25 s, 200-6000 Hz small-speaker band) at SIR 0, 12 dB
Every utterance gets clean and quiet; each noisy condition gets PER_COND utterances per language
(hash order). Noise-only clips (10 s, the level noise has at SNR 5) count hallucinated text.

Usage: python -I 03_mix.py
"""
import csv
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import signal

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import LANGS, MANIFEST, SEED, WORK, read_json, sha256_file, stable_hash

SR = 48000
SPEECH_DBFS = -26.0
LEAD_S, TAIL_S = 0.5, 0.3
SNRS = [0, 5, 10, 20]
SIRS = [0, 12]
NOISE_TYPES = ["keyboard", "fan", "traffic"]
VOICE_TYPES = ["voice_same", "voice_diff", "echo"]
PER_COND = {"dev": 6, "heldout": 24}  # utterances per language for each noisy condition
# The first CORE utterances (hash order) of each noisy condition are the "core" tier that every arm is
# scored on; the rest are mixed and listed ("extra") for a later, larger run. Clean and quiet are all core.
CORE = {"dev": 6, "heldout": 12}
NOISE_ONLY_SEGMENTS = 3
NOISE_ONLY_S = 10.0


def rng_for(*parts):
    return np.random.default_rng(int(stable_hash(SEED, *parts)[:16], 16))


def active_rms(x):
    """RMS over the 20 ms frames within 30 dB of the 95th percentile frame level."""
    n = SR // 50
    frames = x[: len(x) // n * n].reshape(-1, n)
    level = np.sqrt(np.mean(frames ** 2, axis=1) + 1e-12)
    active = frames[level > np.percentile(level, 95) * 10 ** (-30 / 20)]
    return float(np.sqrt(np.mean(active ** 2) + 1e-12))


def load(path):
    x, sr = sf.read(str(path), dtype="float32")
    assert sr == SR and x.ndim == 1, path
    return x


def segment(x, n, rng):
    """n samples of x from a random offset, looping when x is shorter."""
    start = int(rng.integers(0, len(x)))
    reps = int(np.ceil((start + n) / len(x)))
    return np.tile(x, reps)[start:start + n], start / SR


def room(x, rng):
    delay = int(rng.uniform(0.020, 0.060) * SR)
    t = np.arange(int(0.3 * SR)) / SR
    tail = rng.standard_normal(len(t)) * np.exp(-6.91 * t / 0.25)
    tail *= 10 ** (-6 / 20) / np.sqrt(np.sum(tail ** 2))
    ir = np.concatenate([np.zeros(delay), [1.0], tail]).astype(np.float32)
    sos = signal.butter(2, [200, 6000], btype="bandpass", fs=SR, output="sos")
    return signal.sosfilt(sos, signal.fftconvolve(x, ir)[: len(x)]).astype(np.float32)


def main():
    corpus = read_json(MANIFEST / "corpus.json")["utterances"]
    noise = read_json(MANIFEST / "noise.json")["clips"]
    speech_cache = {}

    def speech(u):
        if u["utterance_id"] not in speech_cache:
            x = load(WORK / "corpus" / "wav48" / f"{u['utterance_id']}.wav")
            x = x * (10 ** (SPEECH_DBFS / 20) / active_rms(x))
            speech_cache[u["utterance_id"]] = x
        return speech_cache[u["utterance_id"]]

    noise_audio = {c["noise_id"]: load(WORK / "noise" / "wav48" / f"{c['noise_id']}.wav") for c in noise}
    d48, d16 = WORK / "mix" / "48k", WORK / "mix" / "16k"
    d48.mkdir(parents=True, exist_ok=True)
    d16.mkdir(parents=True, exist_ok=True)
    rows = []

    def emit(wav_id, y):
        peak = float(np.max(np.abs(y)))
        scale = 1.0 if peak <= 0.98 else 0.98 / peak
        y = (y * scale).astype(np.float32)
        sf.write(str(d48 / f"{wav_id}.wav"), y, SR, subtype="PCM_16")
        y16 = signal.resample_poly(y, 1, 3).astype(np.float32)
        sf.write(str(d16 / f"{wav_id}.wav"), y16, 16000, subtype="PCM_16")
        return round(scale, 4), round(len(y) / SR, 3), sha256_file(d16 / f"{wav_id}.wav")

    def row(clip_id, wav_id, u, cond, snr, sir, noise_id, interferer, offset, meta, tier="core"):
        rows.append({"clip_id": clip_id, "wav_id": wav_id, "split": u["split"], "tier": tier, "utterance_id": u.get("utterance_id", ""),
                     "speaker_id": u.get("speaker_id", ""), "language": u["language"], "condition": cond,
                     "snr_db": snr, "sir_db": sir, "noise_id": noise_id, "interferer_id": interferer,
                     "offset_s": offset, "scale": meta[0], "seconds": meta[1], "sha256_16k": meta[2]})

    for split in ("dev", "heldout"):
        utts = [u for u in corpus if u["split"] == split]
        for lang in LANGS:
            mine = [u for u in utts if u["language"] == lang]
            for u in mine:
                s = speech(u)
                padded = np.concatenate([np.zeros(int(LEAD_S * SR), np.float32), s, np.zeros(int(TAIL_S * SR), np.float32)])
                uid = u["utterance_id"]
                row(f"{uid}__clean", f"{uid}__clean", u, "clean", "", "", "", "", "", emit(f"{uid}__clean", padded))
                row(f"{uid}__quiet", f"{uid}__quiet", u, "quiet", "", "", "", "", "", emit(f"{uid}__quiet", padded * 10 ** (-20 / 20)))
            conds = [(t, snr, "") for t in NOISE_TYPES for snr in SNRS] + [(t, "", sir) for t in VOICE_TYPES for sir in SIRS]
            for kind, snr, sir in conds:
                name = f"{kind}_snr{snr}" if snr != "" else f"{kind}_sir{sir}"
                chosen = sorted(mine, key=lambda u: stable_hash(SEED, name, u["utterance_id"]))[: PER_COND[split]]
                for rank, u in enumerate(chosen):
                    uid = u["utterance_id"]
                    rng = rng_for(name, uid)
                    s = speech(u)
                    n = int(LEAD_S * SR) + len(s) + int(TAIL_S * SR)
                    target = 10 ** (SPEECH_DBFS / 20)
                    if kind in NOISE_TYPES:
                        pool = sorted(c["noise_id"] for c in noise if c["type"] == kind and c["split"] == split)
                        nid = pool[int(rng.integers(0, len(pool)))]
                        seg, off = segment(noise_audio[nid], n, rng)
                        seg = seg * (target * 10 ** (-snr / 20) / float(np.sqrt(np.mean(seg ** 2) + 1e-12)))
                        other = ""
                    else:
                        if kind == "voice_same":
                            pool = [v for v in mine if v["speaker_id"] != u["speaker_id"]]
                        elif kind == "voice_diff":
                            pool = [v for v in utts if v["language"] != lang]
                        else:
                            pool = [v for v in utts if v["speaker_id"] != u["speaker_id"]]
                        pool = sorted(pool, key=lambda v: v["utterance_id"])
                        v = pool[int(rng.integers(0, len(pool)))]
                        seg, off = segment(speech(v), n, rng)
                        if kind == "echo":
                            seg = room(seg, rng)
                        seg = seg * (target * 10 ** (-sir / 20) / active_rms(seg))
                        nid, other = "", v["utterance_id"]
                    y = seg.copy()
                    y[int(LEAD_S * SR): int(LEAD_S * SR) + len(s)] += s
                    row(f"{uid}__{name}", f"{uid}__{name}", u, kind, snr, sir, nid, other, round(off, 3), emit(f"{uid}__{name}", y),
                        "core" if rank < CORE[split] else "extra")
            print(split, lang, "rows so far", len(rows), flush=True)
        for c in [c for c in noise if c["split"] == split]:
            for k in range(NOISE_ONLY_SEGMENTS):
                rng = rng_for("noiseonly", c["noise_id"], k)
                seg, off = segment(noise_audio[c["noise_id"]], int(NOISE_ONLY_S * SR), rng)
                seg = seg * (10 ** ((SPEECH_DBFS - 5) / 20) / float(np.sqrt(np.mean(seg ** 2) + 1e-12)))
                wav_id = f"noiseonly__{c['noise_id']}__{k}"
                meta = emit(wav_id, seg)
                for lang in LANGS:
                    row(f"{wav_id}__{lang}", wav_id, {"split": split, "language": lang}, f"noiseonly_{c['type']}", "", "", c["noise_id"], "", round(off, 3), meta)
    with open(MANIFEST / "clips.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()), lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    print("clips", len(rows), "wavs", len({r["wav_id"] for r in rows}), "hours", round(sum(r["seconds"] for r in {r["wav_id"]: r for r in rows}.values()) / 3600, 2))


def tiers():
    """Adds the tier column to an existing clips.csv without mixing again (same hash order as main)."""
    with open(MANIFEST / "clips.csv", "r", encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    groups = {}
    for r in rows:
        if r["condition"] in NOISE_TYPES + VOICE_TYPES:
            name = f"{r['condition']}_snr{r['snr_db']}" if r["snr_db"] != "" else f"{r['condition']}_sir{r['sir_db']}"
            groups.setdefault((r["split"], r["language"], name), []).append(r)
    for (split, _, name), members in groups.items():
        members.sort(key=lambda r: stable_hash(SEED, name, r["utterance_id"]))
        for rank, r in enumerate(members):
            r["tier"] = "core" if rank < CORE[split] else "extra"
    fields = ["clip_id", "wav_id", "split", "tier"] + [k for k in rows[0].keys() if k not in ("clip_id", "wav_id", "split", "tier")]
    with open(MANIFEST / "clips.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        w.writerows({**r, "tier": r.get("tier") or "core"} for r in rows)
    print({t: sum(1 for r in rows if (r.get("tier") or "core") == t and r["split"] == "heldout") for t in ("core", "extra")})


if __name__ == "__main__":
    tiers() if len(sys.argv) > 1 and sys.argv[1] == "tiers" else main()
