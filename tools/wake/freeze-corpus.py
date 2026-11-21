"""Freeze fresh synthetic calls and six hours of previously unused Common Voice utterances."""
import argparse
import hashlib
import io
import json
import tarfile
from pathlib import Path

import numpy as np
import sherpa_onnx as so
import soundfile as sf
import soxr

# Speakers 5, 6 and 7 never supplied the original takes (0-4) or the bank (8-9).
# All near words differ from the shipped phrase bank within each language.
texts = {
    "en": ("Filow", "Okay Filow", "Hey Filow", ["hello", "philosophy", "willow", "below", "yellow", "hero"]),
    "it": ("Filo", "Ok Filo", "Ehi Filo", ["filosofia", "salve", "profilo", "velo", "fialetta", "cuscino"]),
    "ro": ("Filo", "Okei Filo", "Hei Filo", ["filozofie", "salut", "pernă", "profil", "vioară", "vilos"]),
    "ru": ("Фило", "Окей Фило", "Эй Фило", ["философия", "привет", "подушка", "профиль", "вилла", "мило"]),
    "ja": ("フィロー", "オーケー、フィロー", "ねえ、フィロー", ["ハロー", "哲学", "枕", "フォロー", "フィルム", "疲労"]),
}
minutes = {"en": 90, "it": 90, "ru": 80, "ja": 65, "ro": 35}
parser = argparse.ArgumentParser(description=__doc__)
for arg in ("model", "tar_root", "previous_ids", "out"):
    parser.add_argument(arg, type=Path)
parser.add_argument("--legacy-enrol-only", action="store_true", help="render separate OK enrolment takes with the frozen speakers and enrolment rates")
args = parser.parse_args()
args.out.mkdir(exist_ok=False, parents=True)
manifest = {}
files = {k: str(args.model / f) for k, f in {
    "duration_predictor": "duration_predictor.int8.onnx", "text_encoder": "text_encoder.int8.onnx",
    "vector_estimator": "vector_estimator.int8.onnx", "vocoder": "vocoder.int8.onnx",
    "tts_json": "tts.json", "unicode_indexer": "unicode_indexer.bin", "voice_style": "voice.bin",
}.items()}
tts = so.OfflineTts(so.OfflineTtsConfig(model=so.OfflineTtsModelConfig(
    supertonic=so.OfflineTtsSupertonicModelConfig(**files), num_threads=2)))

def digest(file):
    with file.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()

for lang, (bare, ok, hey, near) in texts.items():
    dest = args.out / lang
    dest.mkdir()
    manifest[lang] = clips = []
    forms = [("enrol", [ok])] if args.legacy_enrol_only else [("enrol", [bare]), ("bare", [bare]), ("ok", [ok]), ("hey", [hey]), ("near", near)]
    for kind, words in forms:
        for i in range(5 if kind == "enrol" else 12 if kind == "near" else 6):
            word = words[i % len(words)]
            sid = 5 + list(texts).index(lang) % 3 if kind != "near" else 5 + (i // len(words) + i) % 3
            cfg = so.GenerationConfig()
            cfg.sid, cfg.speed, cfg.num_steps, cfg.extra = sid, ([.83, .93, 1., 1.09, 1.2][i] if kind == "enrol" else [.86, .95, 1.03, 1.07, 1.14, 1.18][i % 6]), 8, {"lang": lang}
            audio = tts.generate(word, cfg)
            samples = soxr.resample(np.asarray(audio.samples), audio.sample_rate, 16000)
            file = dest / f"{kind}-{i}.wav"
            sf.write(file, .5 * samples / np.max(np.abs(samples)), 16000, subtype="PCM_16")
            clips.append(dict(kind=kind, file=file.name, text=word, sid=sid, speed=cfg.speed, sha256=digest(file)))
    if args.legacy_enrol_only:
        continue
    used = set((args.previous_ids / f"cv_{lang}.clips.txt").read_text().splitlines())
    required = minutes[lang] * 60 * 16000
    speech = dest / "normal.wav"
    ids = []
    with sf.SoundFile(speech, "w", 16000, 1, subtype="PCM_16") as out, tarfile.open(args.tar_root / lang / f"{lang}_dev_0.tar") as archive:
        for member in archive:
            name = Path(member.name).name
            if not name.endswith(".mp3") or name in used:
                continue
            used.add(name)
            audio, rate = sf.read(io.BytesIO(archive.extractfile(member).read()), dtype="float32")
            samples = soxr.resample(audio if audio.ndim == 1 else audio.mean(axis=1), rate, 16000)
            take = min(required, len(samples))
            out.write(samples[:take])
            ids.append(name)
            required -= take
            if required == 0:
                break
    if required:
        raise ValueError(f"{lang} short by {required / 16000} seconds")
    clips.append(dict(kind="normal", file=speech.name, seconds=minutes[lang]*60, sha256=digest(speech), sources=ids))
    print(lang, "frozen", flush=True)
(args.out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf8")
