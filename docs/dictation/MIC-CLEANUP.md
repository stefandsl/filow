# Local microphone cleanup - discovery, frozen benchmark, bake-off (0.9.36 programme, slice 1)

Status: evidence only. No product code was changed in this slice. Tools: `tools/audio-bench/`.
Date of the runs: 2026-11-12. Work folder (not in the repo): `G:\FILOW\tmp\mic-cleanup`.

The question this slice answers: does cleaning the microphone sound on the PC, before Filow's own
local speech recognition, give better text? A quieter recording is not the goal: the recognizer's
error rate decides. Krisp: rejected, proprietary.

## 1. Discovery: who owns the microphone, and where a shared stage could sit

### 1.1 The three paths

| Path | Who opens the microphone | Constraints asked | Rate and block | How audio reaches the recognizer |
|---|---|---|---|---|
| Dictation into other apps | The hidden OK Filow panel renderer (`apps/desktop/dictation.js:4-5` says so; `dictation.js` never touches audio). `apps/web/app/okfilow/panel/page.tsx:564` `startListening`, dictation is `why === "dictate"` (`:594`) | `page.tsx:619`: `echoCancellation: true, noiseSuppression: true, channelCount: 1`, `deviceId: { exact }` when a microphone is chosen. `autoGainControl` and `sampleRate` are not set (browser defaults) | `page.tsx:620` `new AudioContext({ sampleRate: 16000 })` (Chromium resamples); `page.tsx:622` `createScriptProcessor(2048, 1, 1)`: 2048 Float32 samples, 128 ms | `page.tsx:625` `b.stt.feed(samples)` -> IPC `okfilow:stt:feed` (`apps/desktop/okfilow-preload.js:93-96`) -> `apps/desktop/okfilow.js:1031` `stt.feed(...)` -> `SttSession.feed` (`apps/desktop/stt.js:557`) -> worker `apps/desktop/stt-worker.js:86` `feed()` |
| OK Filow questions (talk, hands-free) | Same code as dictation, `why` is `"talk"` or `"handsfree"` | Same | Same | Same session: `okfilow.js:1022` `new sttLocal.SttSession(...)` on the "questions" models (`apps/desktop/main.js:1542`, `stt.js:599-608`) |
| Takes / teleprompter tracking | `packages/stt/src/mic.ts:29-96` `startMic` (from `Teleprompter.tsx:442-446`) | `mic.ts:37`: `channelCount: 1, echoCancellation: true, noiseSuppression: true` plus the saved device (`micDevice.ts:51`). `autoGainControl` not set | `mic.ts:72` `new AudioContext({ sampleRate })` (16 kHz for the local engines); `apps/web/public/mic-worklet.js:7` 100 ms chunks, Float32 -> Int16 (`:24-26`) | Local sherpa: `packages/stt/src/sherpa.ts:105-108` Int16 -> Float32, `window.filow.stt.feed` -> IPC `stt:feed` (`apps/desktop/preload.js:116`) -> `main.js:1674` -> `SttSession.feed` of the "tracking" session (`main.js:1666`). Whisper in the browser: `packages/stt/src/whisper.ts` + `whisper.worker.ts` (transformers.js). Web Speech (`browser.ts:19-22`) opens the microphone itself |

All capture is renderer `getUserMedia`; there is no native capture module. The welcome microphone
test asks for something else (`apps/desktop/welcome.ts:161`: echo and noise processing off, gain on).

Important for reading the results below: both capture paths already ask Chromium for its built-in
noise suppression and echo cancellation. The benchmark's "raw" arm is the clip without any
processing, so it is not exactly what Filow hears today (see "Not measured").

### 1.2 Recognizers, voice detector, gates already in the path

- Engines (`apps/desktop/stt.js:44-122`): Nemotron 3.5 streaming (`online`), Parakeet TDT 0.6b v3,
  ReazonSpeech Japanese and Dolphin (`offline`, phrase by phrase), Vosk small Russian (`online`).
  Choice per use, tier and language: `stt.js:129-167`. On this PC (tier "standard"): takes use
  Nemotron for en, it, ru, ja and Parakeet for ro; dictation and questions use Parakeet for
  en, it, ru, ro and ReazonSpeech for ja.
- Decoding (`stt.js:450-462`): 16 kHz, 80 mel bins, `greedy_search`, CPU, threads
  `max(2, min(4, cpus - 2))` (`stt.js:484-486`); streaming endpoint rules 2.4 s / 1.2 s / 20 s.
- Voice detector: Silero VAD, only in front of the phrase models (`stt-worker.js:45-51`, threshold
  0.2, min silence 0.4 s, max phrase 8 s, 512-sample windows). It cuts phrases; it does not clean.
- Whisper in the browser drops 4 s windows under RMS 0.004 (`packages/stt/src/whisper.ts:10,74`):
  the only gate that removes audio today.
- `apps/web/lib/buddy/listen.ts:24-50` `createVad`: an energy end-of-speech detector driven by the
  panel's level meter (`page.tsx:581, 789-796`); it decides when to stop, never changes the audio.
- `packages/stt/src/silence.ts:1-9`: a "microphone is silent" warning only.
- Hands-free / wake: there is no wake-word detector. Hands-free is switched by a key gesture
  (`apps/desktop/okfilow-gestures.js:10,105`, `okfilow.js:671-675`) and then reuses the same
  capture and the same recognizer; no separate detector or second stream.
- No noise suppression model exists anywhere in the repository today.

### 1.3 Where one shared stage could sit

| Point | Location | Audio there | Covers |
|---|---|---|---|
| A (recommended) | `apps/desktop/stt-worker.js:86` `feed()`, before the VAD (`:81`) / `acceptWaveform` (`:90`) | Float32 mono 16 kHz; 2048-sample blocks (panel) or 1600 (takes) | Dictation, questions, sherpa takes; off the main thread; one bypass flag in the init message |
| B | `SttSession.feed` `stt.js:557` | same | same, but on the main thread |
| D + E | `mic-worklet.js:11-31` and `page.tsx:623-624` | Float32 at the context rate, 128-sample quanta / 2048 blocks | D also covers Whisper-in-browser and the cloud engines; two places to keep in step |

Point A is the single place all three local paths already share. Two facts shape the engine choice:
the audio there is 16 kHz (a 48 kHz model would need the capture rate changed in both renderers and
a resampler), and `sherpa-onnx-node` and `onnxruntime-node` cannot live in one process (the
punctuation model already runs in its own `utilityProcess` for that reason,
`apps/desktop/truecase-worker.js:1-4,21,26`; confirmed here: loading `onnxruntime-node` after
`sherpa-onnx-node` fails with ERR_DLOPEN_FAILED). So an onnxruntime engine needs its own process
and an extra hop per block, while `sherpa-onnx-node` 2.0.1 already exports
`OnlineSpeechDenoiser` / `OfflineSpeechDenoiser` and could run a supported model inside the worker
with nothing new in the installer (not tried in this slice).

### 1.4 This PC and the shipped runtimes

Intel Core i9-13900KF (24 cores, 32 threads), 128 GB RAM, NVIDIA RTX 3070 (not used: everything
here ran on the CPU), Windows 11 Pro 26300. Shipped: Electron 45.3.0, `onnxruntime-node` 1.30.0
(punctuation model, own process), `sherpa-onnx-node` 2.0.1 (bundles its own onnxruntime),
`@huggingface/transformers` 4.3.2 (with `onnxruntime-web` 1.31.0-dev for Whisper in the browser).

## 2. The frozen benchmark (`tools/audio-bench/`)

Manifests are committed (`tools/audio-bench/manifest/`), audio is not.

- Clean speech: Mozilla Common Voice 22.0, CC0-1.0, from the Hugging Face mirror
  `fsicoli/common_voice_22_0` at revision `ae911de250fe9375d08e2daa2105b671d659d446`, the "dev"
  split of each language. 5 languages x 72 utterances (3.5-9 s, at least 2 up-votes, no down-vote):
  it, ru, ro, ja: 9 speakers x 8 utterances; en: 24 speakers x 3 (no English speaker has more
  than 3 clips in that split, and the "test" split has at most 5 per speaker in any language).
  Benchmark splits are speaker-disjoint: dev = 3 speakers (en: 8), held-out = 6 speakers (en: 16)
  per language. `manifest/corpus.json` has every file with its sha256. Common Voice audio is 48 kHz
  MP3, so both 16 kHz and 48 kHz engines get real material.
- Noise: FSD50K clips (mirror `Fhrozen/FSD50k` at `ccf1acaff12f3f4a4c10052dddafbb6d22152c9b`), only
  clips whose own licence is CC0 or CC-BY, labels free of speech and music: 6 keyboard / typing,
  6 mechanical fan, 6 traffic; 2 of each for dev and 4 for held-out. `manifest/noise.json` lists
  licence, uploader, title and sha256 of each. (The keyboard set includes a typewriter and a
  calculator: harsher clicks than a laptop keyboard.)
- Conditions (`03_mix.py`, fixed seed 20261112, mixed at 48 kHz, then a 16 kHz copy): clean
  (speech at -26 dBFS active level); quiet (-20 dB gain); keyboard, fan, traffic at SNR 0, 5, 10,
  20 dB; a competing voice in the same language and in another language at SIR 0 and 12 dB; echo
  (other speech through a synthetic small room: 20-60 ms delay, RT60 0.25 s, 200-6000 Hz) at SIR 0
  and 12 dB; noise-only clips (10 s at the level noise has at SNR 5) to count invented text.
  Every utterance has clean and quiet. Each noisy condition has 24 held-out utterances per language
  mixed; the first 12 (hash order) are the "core" tier every arm was scored on, the other 12
  ("extra") are mixed and listed for a later, larger run (compute time on a shared PC). Dev: 6.
  Held-out core: 1560 speech clips + 36 noise-only clips (each scored once per language).
- Recognizer: exactly what Filow ships. `asr.mjs` takes the model choice and configuration from
  `apps/desktop/stt.js` (`chooseModels`, `recognizerConfig`) and decodes inside the shipped
  `apps/desktop/stt-worker.js`, fed in the app's block size. Model files: the pinned archives of
  `stt.js`, copied from an earlier test profile on G: (`manifest/asr.json`, sha256 per file).
  Main table: the "questions" models (dictation and OK Filow questions). Same settings for every
  arm: 2 processes x 2 threads (Filow uses 4 threads on this PC; with 4 instead of 2 threads 2 of
  870 dev transcripts differed).
- Scoring (`score.py`, normalisation "norm-v1"): NFKC, case-folded, punctuation and symbols
  removed; Romanian cedilla letters and Russian yo unified; Japanese per character (CER), the
  others per word (WER); substitutions, deletions, insertions per clip. Macro error rate = mean of
  the five per-language pooled rates. Intervals: 2000 bootstrap draws resampling speakers inside
  each language, paired with raw.
- Arms: raw; each candidate alone. Candidates at 16 kHz read the 16 kHz copy (what the app's
  16 kHz AudioContext delivers); candidates at 48 kHz read the 48 kHz master and their output is
  resampled to 16 kHz for the recognizer.

## 3. Candidates (pinned 2026-11-12, `manifest/models.json` has sizes and sha256 computed here)

All six starting revisions from the owner's research were found and checked out.

| Candidate | Source and revision | File(s) used | Rate | Code licence | Weight licence evidence | Runtime in this bench |
|---|---|---|---|---|---|---|
| RNNoise | xiph/rnnoise `70f1d256` | `rnnoise_data-0a8755f8...tar.gz` from media.xiph.org (hash pinned by `model_version` in the repo; 58.6 MB source, big model compiled in) | 48 kHz | BSD-3-Clause | The tarball carries no licence text of its own; the README calls them "the models distributed with RNNoise" and the build downloads them. Weaker evidence than the others: owner to accept | C, built here with the MSVC 2019 Build Tools (`build_rnnoise.ps1`, AVX2, no CPU dispatch) |
| GTCRN | Xiaobin-Rong/gtcrn `502ebfab` | `stream/onnx_models/gtcrn_simple.onnx`, 535,190 bytes (the streaming graph, caches carried) | 16 kHz | MIT | In the MIT repository | onnxruntime 1.30.0 |
| DeepFilterNet3 | Rikorose/DeepFilterNet `7b14b895` | `models/DeepFilterNet3_onnx.tar.gz` (lookahead 2+2 frames) and `DeepFilterNet3_ll_onnx.tar.gz` (no lookahead), each with its own `config.ini` | 48 kHz | MIT OR Apache-2.0 | In the dual-licensed repository | The project's own `deep-filter` 0.5.6 Windows binary (libDF + tract), official release asset; it is from 2023, not built from the pinned commit |
| DPDFNet2 | HF Ceva-IP/DPDFNet `dd6818d0`, code ceva-ip/DPDFNet `9bd9844a` | `onnx/dpdfnet2.onnx` (16 kHz), `onnx/dpdfnet2_48khz_hr.onnx` (48 kHz) | 16 / 48 kHz | Apache-2.0 | Model card licence field: Apache-2.0 | onnxruntime 1.30.0, the author's `StreamEnhancer` loop and initial state |
| DTLN | breizhn/DTLN `1de1f15a` | `pretrained_model/model_1.onnx` + `model_2.onnx` | 16 kHz | MIT | In the MIT repository | onnxruntime 1.30.0, the author's real-time loop (block 512, shift 128) |
| Hush (speaker suppression, optional) | HF weya-ai/hush `a55d932c`, code pulp-vision/Hush `9f6414e9` | `onnx/advanced_dfnet16k_model_best_onnx.tar.gz` | 16 kHz | Apache-2.0 | Model card and LICENSE: Apache-2.0 | Not run, see section 6 |

The onnxruntime candidates ran in Python onnxruntime 1.30.0, the same native library version as the
`onnxruntime-node` 1.30.0 Filow ships (wrappers in `engines.py`). The Node binding and a JavaScript
FFT were not timed.

Checks before any number was trusted (`enhance.py check`, `external.py probe`):

| Engine | Hop | Chunk invariance (whole vs 128 / 160 / 480 / random chunks) | Content delay (cross-correlation, clean speech) | Latency before a sample can come out |
|---|---|---|---|---|
| GTCRN | 16 ms | identical (max difference 0) | 16 ms | 32 ms |
| DTLN | 8 ms | identical | 24 ms | 32 ms |
| DPDFNet2 16 kHz | 10 ms | identical | 40 ms | 60 ms |
| DPDFNet2 48 kHz | 10 ms | identical | 40 ms | 60 ms |
| RNNoise | 10 ms | file based (10 ms frames inside) | 20 ms | 30 ms |
| DeepFilterNet3 | 10 ms | file based (10 ms frames inside) | 30 ms | 40 ms |
| DeepFilterNet3 low latency | 10 ms | file based | 10 ms | 20 ms |

"Latency before a sample can come out" = the worst wait between a sample arriving and its cleaned
version being available with no processing time: content delay plus filling one hop. "Added delay
p95" in the gates = this latency plus the 95th percentile of the per-hop processing time.
Not done: a comparison of each wrapper with an independent offline implementation of the same
network (no offline ONNX graph is published for GTCRN, DTLN needs TensorFlow, DPDFNet's offline
path uses a centred STFT and is documented by its author as not bit-identical).

## 4. Gates (frozen before the held-out run, applied on the held-out core tier)

- Noisy speech (the 12 keyboard / fan / traffic conditions): macro error rate at least 5 % lower
  than raw, relative, and the 95 % interval of the difference entirely below zero.
- Clean speech: macro error rate at most 0.5 points above raw.
- Slices: no language x condition slice more than 1 point worse. Every such slice has under 500
  reference tokens here (12 utterances), so all are flagged low-count; a slice counts as a failure
  only when it is more than 1 point worse and its interval excludes zero. All slices more than
  1 point worse are listed either way.
- Quiet words: deletions on the quiet condition (macro, percent of reference tokens) at most
  0.5 points above raw.
- Noise-only: no more invented tokens than raw (words; characters for Japanese), summed.
- Light mode: added delay p95 <= 40 ms, <= 25 % of one core, <= 100 MiB. Quality mode: p95 <= 80 ms,
  <= 50 % of one core, <= 250 MiB. Both: per-hop p99 under 80 % of the hop; real-time factor <= 0.5
  while a recognizer runs.
- A quality engine must beat the light engine on the hard slice (keyboard / fan / traffic at
  SNR 0 and 5 dB, macro) with an interval that excludes zero; otherwise one mode ships.
- Competing voice and echo are reported, and count in the slice gate, but are not part of the
  "noisy speech" gate: none of the noise candidates claims to remove a second voice.
- Dev is used to rehearse the pipeline and for one decision only: an arm that does not lower the
  noisy macro error rate on dev at all is not run on held-out and is reported as failed on dev.
