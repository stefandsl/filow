"""Render paired offline wake benchmarks with local Supertonic 3 int8 weights."""
import argparse
from pathlib import Path

import numpy as np
import sherpa_onnx as so
import soundfile as sf
import soxr

parser = argparse.ArgumentParser()
parser.add_argument("model", type=Path)
parser.add_argument("out", type=Path)
group = parser.add_mutually_exclusive_group()
group.add_argument("--training-bank", action="store_true")
group.add_argument("--training-calls", action="store_true")
args = parser.parse_args()
files = {k: str(args.model / f) for k, f in {
    "duration_predictor": "duration_predictor.int8.onnx", "text_encoder": "text_encoder.int8.onnx",
    "vector_estimator": "vector_estimator.int8.onnx", "vocoder": "vocoder.int8.onnx",
    "tts_json": "tts.json", "unicode_indexer": "unicode_indexer.bin", "voice_style": "voice.bin",
}.items()}
model = so.OfflineTtsModelConfig(supertonic=so.OfflineTtsSupertonicModelConfig(**files), num_threads=2)
tts = so.OfflineTts(so.OfflineTtsConfig(model=model, max_num_sentences=1))
phrases = {
    "en": ("Filow", "Okay Filow", "Hey Filow", ["follow", "fellow", "pillow", "video"]),
    "it": ("Filo", "Ok Filo", "Ehi Filo", ["figlio", "fila", "video", "fieno"]),
    "ro": ("Filo", "Okei Filo", "Hei Filo", ["filă", "firul", "video", "fulg"]),
    "ru": ("Фило", "Окей Фило", "Эй Фило", ["филе", "фильм", "видео", "филин"]),
    "ja": ("フィロー", "オーケー、フィロー", "ねえ、フィロー", ["ヒーロー", "広い", "ビデオ", "黄色"]),
}
for sid, (lang, (bare, ok, hey, near)) in enumerate(phrases.items()):
    dest = args.out / lang
    dest.mkdir(parents=True, exist_ok=True)
    for kind, text in [("bare", bare), ("ok", ok), ("hey", hey), *[(f"near{i}", t) for i, t in enumerate(near)]]:
        if args.training_calls:
            if kind not in ("ok", "hey"):
                continue
            rates = [.88, 1., 1.15, 1.22]
        elif args.training_bank:
            sid = 8 if lang in ("en", "ro", "ja") else 9
            if kind == "bare":
                continue
            if kind in ("ok", "hey"):
                text = text.replace(bare, "").strip(" ,、")
            rates = [1.]
        else:
            rates = [.82, .91, 1.02, 1.12, 1.21, .87, 1., 1.16] if kind in ("ok", "bare") else [1.]
        for i, rate in enumerate(rates):
            if args.training_calls:
                sid = 8 + i % 2
            cfg = so.GenerationConfig()
            cfg.sid, cfg.speed, cfg.num_steps, cfg.extra = sid, rate, 8, {"lang": lang}
            audio = tts.generate(text, cfg)
            samples = soxr.resample(np.array(audio.samples), audio.sample_rate, 16000)
            sf.write(dest / f"{kind}-{i}.wav", .5 * samples / np.max(np.abs(samples)), 16000, subtype="PCM_16")
