"""Step B1: pick the clean-speech subset and fetch it.

Common Voice 22.0, its "dev" split (the "test" split has at most 5 clips per speaker), 5 languages,
9 speakers x 8 utterances each; English has at most 3 clips per speaker there, so 24 speakers x 3.
Selection is deterministic (hash order with a fixed seed). The first DEV speakers of each language
are the dev split, the rest are held-out: the splits are speaker-disjoint.

Usage: python -I 01_select_corpus.py select   (writes manifest/corpus.json from the tsv tables)
       python -I 01_select_corpus.py fetch    (downloads the tars, extracts only the chosen
                                              clips, converts to 48 kHz mono wav, records hashes)
"""
import csv
import subprocess
import sys
import tarfile
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I (isolated mode) drops the script folder
from common import CV_REPO, CV_REV, LANGS, MANIFEST, SEED, WORK, read_json, sha256_file, stable_hash, write_json

# language -> (speakers, dev speakers, utterances per speaker); 72 utterances per language, 24 dev + 48 held-out
PLAN = {lang: (9, 3, 8) for lang in LANGS}
PLAN["en"] = (24, 8, 3)
CV_SPLIT = "dev"
MIN_S, MAX_S = 3.5, 9.0
META = WORK / "corpus" / "cv22-meta"
csv.field_size_limit(1 << 30)


def rows(path):
    with open(path, "r", encoding="utf-8", newline="") as f:
        yield from csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE)


def select():
    out = {"dataset": CV_REPO, "revision": CV_REV, "licence": "CC0-1.0", "split_source": CV_SPLIT, "seed": SEED,
           "plan_speakers_dev_utts": PLAN, "rule": f"speakers with enough clips of {MIN_S}-{MAX_S} s, up_votes >= 2, down_votes == 0; hash order",
           "utterances": []}
    for lang in LANGS:
        SPEAKERS, DEV, UTTS = PLAN[lang]
        dur = {r["clip"]: int(r["duration[ms]"]) / 1000 for r in rows(META / f"{lang}-clip_durations.tsv")}
        by_spk = {}
        for r in rows(META / f"{lang}-{CV_SPLIT}.tsv"):
            d = dur.get(r["path"])
            # the repository bans U+2014: store it as a plain hyphen (scoring removes punctuation anyway)
            text = (r["sentence"] or "").strip().replace("\u2014", "-")
            if d is None or not (MIN_S <= d <= MAX_S) or not text:
                continue
            if int(r["up_votes"] or 0) < 2 or int(r["down_votes"] or 0) != 0:
                continue
            by_spk.setdefault(r["client_id"], []).append((r["path"], text, d, r.get("gender") or ""))
        ok = sorted((s for s, c in by_spk.items() if len(c) >= UTTS), key=lambda s: stable_hash(SEED, lang, s))
        print(lang, "speakers:", len(by_spk), "with enough clips:", len(ok))
        if len(ok) < SPEAKERS:
            raise SystemExit(f"{lang}: only {len(ok)} speakers qualify")
        for i, spk in enumerate(ok[:SPEAKERS]):
            clips = sorted(by_spk[spk], key=lambda c: stable_hash(SEED, c[0]))[:UTTS]
            for path, text, d, gender in clips:
                out["utterances"].append({
                    "utterance_id": path.replace(".mp3", ""), "language": lang,
                    "speaker_id": f"{lang}-{stable_hash(spk)[:10]}", "split": "dev" if i < DEV else "heldout",
                    "source_file": path, "duration_s": round(d, 3), "gender": gender, "text": text})
    write_json(MANIFEST / "corpus.json", out)
    print("utterances:", len(out["utterances"]))


def fetch():
    man = read_json(MANIFEST / "corpus.json")
    wav_dir = WORK / "corpus" / "wav48"
    wav_dir.mkdir(parents=True, exist_ok=True)
    for lang in LANGS:
        want = {u["source_file"]: u for u in man["utterances"] if u["language"] == lang}
        if all((wav_dir / f"{u['utterance_id']}.wav").exists() for u in want.values()):
            continue
        tar_dir = WORK / "corpus" / "tar" / lang
        tar_dir.mkdir(parents=True, exist_ok=True)
        tar_path = tar_dir / f"{lang}_{CV_SPLIT}_0.tar"
        if not tar_path.exists():
            url = f"https://huggingface.co/datasets/{CV_REPO}/resolve/{CV_REV}/audio/{lang}/{CV_SPLIT}/{lang}_{CV_SPLIT}_0.tar"
            print("download", url, flush=True)
            # curl resumes a cut transfer (urlretrieve gave up on a 700 MB file half way)
            subprocess.run(["curl.exe", "-sSL", "--fail", "--retry", "8", "--retry-all-errors", "-C", "-", "-o", str(tar_path) + ".part", url], check=True)
            (tar_dir / f"{lang}_{CV_SPLIT}_0.tar.part").rename(tar_path)
        mp3_dir = WORK / "corpus" / "mp3" / lang
        mp3_dir.mkdir(parents=True, exist_ok=True)
        found = 0
        with tarfile.open(tar_path, "r") as tar:
            for member in tar:
                name = member.name.rsplit("/", 1)[-1]
                if member.isfile() and name in want:
                    with tar.extractfile(member) as src, open(mp3_dir / name, "wb") as dst:
                        dst.write(src.read())
                    found += 1
        print(lang, "extracted", found, "of", len(want), flush=True)
        for name, u in want.items():
            wav = wav_dir / f"{u['utterance_id']}.wav"
            subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(mp3_dir / name), "-ac", "1", "-ar", "48000",
                            "-c:a", "pcm_s16le", str(wav)], check=True)
    for u in man["utterances"]:
        lang = u["language"]
        u["source_sha256"] = sha256_file(WORK / "corpus" / "mp3" / lang / u["source_file"])
        u["wav48_sha256"] = sha256_file(wav_dir / f"{u['utterance_id']}.wav")
    man["tar_sha256"] = {lang: sha256_file(WORK / "corpus" / "tar" / lang / f"{lang}_{CV_SPLIT}_0.tar") for lang in LANGS
                         if (WORK / "corpus" / "tar" / lang / f"{lang}_{CV_SPLIT}_0.tar").exists()} or man.get("tar_sha256", {})
    write_json(MANIFEST / "corpus.json", man)
    print("done")


if __name__ == "__main__":
    {"select": select, "fetch": fetch}[sys.argv[1]]()
