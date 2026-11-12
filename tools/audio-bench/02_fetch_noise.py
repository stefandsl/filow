"""Step B2: pick and fetch the noise clips (FSD50K, per-clip Creative Commons licences).

Only CC0 and CC-BY clips are used (no NC, no Sampling+). Clips whose labels mention speech, voices
or music are skipped. Per noise type: PER_TYPE clips of at least MIN_S seconds, in hash order; the
first DEV_CLIPS are used for the dev split and the rest for held-out, so noise is split-disjoint too.

Usage: python -I 02_fetch_noise.py
"""
import csv
import subprocess
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import FSD_REPO, MANIFEST, SEED, WORK, read_json, sha256_file, stable_hash, write_json

FSD_REV = "ccf1acaff12f3f4a4c10052dddafbb6d22152c9b"
BASE = f"https://huggingface.co/datasets/{FSD_REPO}/resolve/{FSD_REV}"
TYPES = {
    "keyboard": {"Typing", "Computer_keyboard"},
    "fan": {"Mechanical_fan"},
    "traffic": {"Traffic_noise_and_roadway_noise"},
}
FORBIDDEN = ("speech", "voice", "music", "sing", "conversation", "laugh", "shout", "child", "male", "female",
             "chatter", "crowd", "yell", "scream", "whisper", "cheer", "applause", "siren", "alarm", "bell", "horn")
OK_LICENCES = ("creativecommons.org/publicdomain/zero/1.0", "creativecommons.org/licenses/by/")
PER_TYPE = 6
DEV_CLIPS = 2
MIN_S = 12.0


def get(rel, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        urllib.request.urlretrieve(f"{BASE}/{rel}", str(dest) + ".part")
        Path(str(dest) + ".part").rename(dest)
    return dest


def size_of(rel):
    req = urllib.request.Request(f"{BASE}/{rel}", method="HEAD")
    with urllib.request.urlopen(req) as res:
        return int(res.headers.get("Content-Length") or 0)


def main():
    meta = WORK / "noise" / "meta"
    out = {"dataset": FSD_REPO, "revision": FSD_REV, "seed": SEED,
           "rule": f"labels of the type, none of {FORBIDDEN}; licence CC0 or CC-BY; >= {MIN_S} s; hash order", "clips": []}
    for part in ("dev", "eval"):
        get(f"labels/{part}.csv", meta / f"{part}.csv")
        get(f"metadata/{part}_clips_info_FSD50K.json", meta / f"{part}_clips_info.json")
    info = {part: read_json(meta / f"{part}_clips_info.json") for part in ("dev", "eval")}
    for kind, wanted in TYPES.items():
        cands = []
        for part in ("dev", "eval"):
            with open(meta / f"{part}.csv", "r", encoding="utf-8", newline="") as f:
                for r in csv.DictReader(f):
                    labels = set(r["labels"].split(","))
                    if not (labels & wanted) or any(bad in lab.lower() for lab in labels for bad in FORBIDDEN):
                        continue
                    ci = info[part].get(r["fname"]) or {}
                    lic = ci.get("license") or ""
                    if not any(ok in lic for ok in OK_LICENCES):
                        continue
                    cands.append((part, r["fname"], sorted(labels), lic, ci.get("uploader") or "", ci.get("title") or ""))
        cands.sort(key=lambda c: stable_hash(SEED, kind, c[1]))
        picked = 0
        for part, fname, labels, lic, uploader, title in cands:
            if picked >= PER_TYPE:
                break
            rel = f"clips/{part}/{fname}.wav"
            seconds = (size_of(rel) - 44) / (44100 * 2)
            if seconds < MIN_S:
                continue
            src = get(rel, WORK / "noise" / "src" / kind / f"{fname}.wav")
            wav = WORK / "noise" / "wav48" / f"{kind}-{fname}.wav"
            wav.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(src), "-ac", "1", "-ar", "48000",
                            "-c:a", "pcm_s16le", str(wav)], check=True)
            out["clips"].append({"noise_id": f"{kind}-{fname}", "type": kind, "fsd50k_id": fname, "fsd50k_part": part,
                                 "split": "dev" if picked < DEV_CLIPS else "heldout", "labels": labels, "licence": lic,
                                 "uploader": uploader, "title": title, "seconds": round(seconds, 2),
                                 "source_sha256": sha256_file(src), "wav48_sha256": sha256_file(wav)})
            picked += 1
        print(kind, "candidates", len(cands), "picked", picked, flush=True)
        if picked < PER_TYPE:
            raise SystemExit(f"{kind}: not enough clips")
    write_json(MANIFEST / "noise.json", out)


if __name__ == "__main__":
    main()
