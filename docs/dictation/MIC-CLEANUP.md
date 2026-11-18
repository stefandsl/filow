# Local microphone cleanup - discovery, frozen benchmark, bake-off (0.9.36 programme, slice 1)

Status: evidence only. No product code was changed in this slice. Tools: `tools/audio-bench/`.
Date of the runs: 2026-11-12. Work folder (not in the repo): `G:\FILOW\tmp\mic-cleanup`.
Result summaries are in `tools/audio-bench/results/`; the per-clip table (5 MB), the transcripts
and all audio stay in the work folder.

Outcome in one line: no candidate passes the frozen gates; most make recognition worse; nothing
here should ship (section 7).

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
  held-out arm: one recognizer process with 2 threads (Filow uses 4 threads on this PC; with 4
  instead of 2 threads 2 of 870 dev transcripts differed). Up to four arms were decoded side by
  side; that changes speed, not text.
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
| RNNoise | xiph/rnnoise `70f1d256` | `rnnoise_data-0a8755f8...tar.gz` from media.xiph.org (hash pinned by `model_version` in the repo; 58.6 MB source, big model compiled in) | 48 kHz | BSD-3-Clause | NOT VERIFIED. The tarball (`src/rnnoise_data.c`, `.h`, `models/*.pth`) carries no licence or copyright text (checked again after unpacking). The only evidence is indirect: the README calls them "the models distributed with RNNoise" and the repository's own script downloads them by hash | C, built here with the MSVC 2019 Build Tools (`build_rnnoise.ps1`, AVX2, no CPU dispatch) |
| GTCRN | Xiaobin-Rong/gtcrn `502ebfab` | `stream/onnx_models/gtcrn_simple.onnx`, 535,190 bytes (the streaming graph, caches carried) | 16 kHz | MIT | In the MIT repository | onnxruntime 1.30.0 |
| DeepFilterNet3 | Rikorose/DeepFilterNet `7b14b895` | `models/DeepFilterNet3_onnx.tar.gz` (lookahead 2+2 frames) and `DeepFilterNet3_ll_onnx.tar.gz` (no lookahead), each with its own `config.ini` | 48 kHz | MIT OR Apache-2.0 | In the dual-licensed repository | The project's own `deep-filter` 0.5.6 Windows binary (libDF + tract), official release asset; it is from 2023, not built from the pinned commit. One process per clip (see the checks below) |
| DPDFNet2 | HF Ceva-IP/DPDFNet `dd6818d0`, code ceva-ip/DPDFNet `9bd9844a` | `onnx/dpdfnet2.onnx` (16 kHz), `onnx/dpdfnet2_48khz_hr.onnx` (48 kHz) | 16 / 48 kHz | Apache-2.0 | Model card licence field: Apache-2.0 | onnxruntime 1.30.0, the author's `StreamEnhancer` loop and initial state |
| DTLN | breizhn/DTLN `1de1f15a` | `pretrained_model/model_1.onnx` + `model_2.onnx` | 16 kHz | MIT | In the MIT repository | onnxruntime 1.30.0, the author's real-time loop (block 512, shift 128) |
| Hush (speaker suppression, optional) | HF weya-ai/hush `a55d932c`, code pulp-vision/Hush `9f6414e9` | `onnx/advanced_dfnet16k_model_best_onnx.tar.gz` | 16 kHz | Apache-2.0 | Model card (`license: apache-2.0` at the pinned revision) and LICENSE: Apache-2.0 | The repository's prebuilt `deployment/lib/weya_nc.dll` (sha256 `633958ef...fa6a32`, in `manifest/models.json`), 10 ms frames, loaded from Python. The DLL has no third-party notice file: what is compiled into it is NOT VERIFIED. See section 6 |

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
| Hush | 10 ms | identical | 10 ms | 20 ms |

"Latency before a sample can come out" = the worst wait between a sample arriving and its cleaned
version being available with no processing time: content delay plus filling one hop. "Added delay
p95" in the gates = this latency plus the 95th percentile of the per-hop processing time.
Not done: a comparison of each wrapper with an independent offline implementation of the same
network (no offline ONNX graph is published for GTCRN, DTLN needs TensorFlow, DPDFNet's offline
path uses a centred STFT and is documented by its author as not bit-identical). Done for two:
GTCRN, where the wrapper's output on the author's own example matches the author's enhanced file
(difference 2.4e-4 RMS against a signal of 6.4e-2); and Hush, where the repository's own example
script (`deployment/examples/python/denoise_ctypes.py`) run on four held-out clips (clean, quiet,
fan, competing voice) gives the wrapper's stored output to within one 16-bit step. The DTLN and
DPDFNet2 wrappers follow their authors' streaming loops but were not checked against an author
output; RNNoise and DeepFilterNet3 run the projects' own code.

Two things found while running, both fixed before any held-out number was read:

- The `deep-filter` binary keeps its internal state from one file to the next when it is given
  several files at once. The same clip cleaned alone and cleaned as the 2nd of a batch came out
  only 10 dB apart. Every other engine starts each clip with fresh state, as a new recording
  would, so DeepFilterNet3 is run as one process per clip (`external.py`). The first held-out
  output of DeepFilterNet3, made in batches of 40, was thrown away unread.
- A power cut stopped the first held-out run. `verify_outputs.py` checked everything that had
  finished before it: inputs against their sha256, every enhanced clip for format and length, and
  a fresh run of 80 or more clips per engine compared sample by sample (GTCRN, DTLN, DPDFNet2
  16 kHz, RNNoise, Hush: identical). Unfinished engines were run again from the start.

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

Speaker isolation gate (Hush), written on 2026-11-12 at 09:10, after the noise candidates' first
held-out numbers were seen but before any Hush transcript was scored (the commit that adds this
paragraph has no Hush result in it):

- Competing voice (same and other language, SIR 0 and 12 dB, pooled): macro error rate at least
  5 % lower than raw, relative, with the 95 % interval of the difference entirely below zero.
- And the same clean, quiet-words, slice and noise-only gates as above, and the quality-mode
  resource limits. Speaker isolation stays off by default whatever the result.

To be exact about the timing: the Hush clips had been cleaned at 02:27 and their decoding started
at 09:00:47; the paragraph was committed at 09:10:31 (`fedd2e1`); the Hush transcript file
appeared at 09:14:07 and was scored after that.

Correction to a sentence in the slice gate above, written after the runs (the gate itself is
unchanged): "every such slice has under 500 reference tokens" is true of the noisy, competing
voice and echo slices (12 utterances each) but not of all clean and quiet slices, which have 48
utterances; Japanese clean and quiet have 1309 reference characters each. `score.py` flags the
low-count slices one by one and applies the rule as written (more than 1 point worse and an
interval that excludes zero) to every slice.

How the dev rule was actually applied (written after the runs, the rule above is unchanged): dev
was decoded for raw and GTCRN only. GTCRN did not lower the noisy error rate on dev (25.2 -> 32.2),
so by the rule it is "failed on dev"; it was run on held-out all the same and its held-out numbers
are shown. The other arms were not decoded on dev (compute time), so the dev rule removed none of
them and every one faces the held-out gates above, which are untouched. Nothing was tuned on
either split.

## 5. Results on the held-out core tier

Recognizer: the models Filow uses for dictation and OK Filow questions on this PC (Parakeet for
en, it, ru, ro; ReazonSpeech for ja). 1560 speech clips and 36 noise-only clips per arm.

How to read the first table: each cell is the arm's macro error rate in percent, then in brackets
the difference from raw in points and the 95 % interval of that difference. Lower is better; a
plus sign means the cleaned sound was recognised worse than the untouched sound. `dfn3_ll` is
DeepFilterNet3 low latency, `dpdfnet2_48k` the 48 kHz DPDFNet2. Rows ending in `_warm` are the
diagnostic of 5.4 and stand outside the frozen protocol. Columns: `noisy_env_all` = keyboard, fan,
traffic at all four SNR (the gate); `hard_env_snr0_5` = the same at SNR 0 and 5; `voice_same` /
`voice_diff` = a competing voice in the same / another language; `quiet dels` = words lost on
quiet speech, percent of reference tokens.

[Question error rates, condition breakdowns and gate results](../../tools/audio-bench/results/summary-questions-heldout.md).

### 5.1 Per language

A star marks a difference from raw whose 95 % interval excludes zero. Each language has 6
held-out speakers (English 16), so the intervals are wide.

[Language breakdowns, confidence intervals and tokens invented on noise](../../tools/audio-bench/results/report-questions-heldout.md).

### 5.2 What the engines do to the sound itself

The table reports median output minus input in dB, with the lowest and highest values for each kind of clip.
[Held-out output levels by engine](../../tools/audio-bench/results/levels-heldout.md).

Every engine turns the noise-only clips down by 22 to 62 dB (median): as noise suppressors they
work. The recognizers still read the cleaned speech worse. The likely reason, not tested here:
these recognizers were trained on noisy speech and lose more from what the processing does to the
voice than they gain from the missing noise. DPDFNet2 is the only family that does not make noisy
speech worse.

Two cautions on reading the tables. The intervals are percentile bootstraps over only 6 speakers
per language (16 for English); such intervals tend to be too narrow, so a star or a "significant"
slice is weaker evidence than it looks, and that also holds for the differences that favour a
candidate. And the noise-only count is fragile: the same 36 noise clips are decoded once per
language, four of them with the same Parakeet model, so one invented word counts four times
(GTCRN's 24 against 19 is one more word and one more Japanese character).

### 5.3 The recognizer used for takes

Nemotron streaming for en, it, ru, ja and Parakeet for ro, same clips. Only raw and DPDFNet2
16 kHz were decoded with it (compute time).

[Tracking error rates and gate results](../../tools/audio-bench/results/summary-tracking-heldout.md).

### 5.4 Fresh start against a running session (diagnostic, not part of the frozen protocol)

Every arm above starts each clip with a fresh engine, as when the microphone has just been opened.
DeepFilterNet3 and Hush from a fresh start turned whole quiet clips down to nothing (section 5.2). A check on dev clips showed why for DeepFilterNet3: the same quiet clip is kept (-0.3 dB)
when the engine has just heard speech at normal level, and can lose up to 61 dB from a fresh
start. So three extra arms were run after the first held-out numbers were seen: `dfn3_warm`,
`dpdfnet2_warm`, `hush_warm` (`warm.py`). Each clip is cleaned right after a clean dev clip of the
same language (another speaker, normal level), and the lead-in is cut off before recognition.
The linked results list these arms separately. They cannot qualify a candidate: the protocol was not frozen for
them and they were added with held-out numbers already on the table.

What they show:

- DeepFilterNet3: the loss of quiet speech is mostly a fresh-start effect (quiet 53.5 from a fresh
  start, 22.6 in a running session, raw 14.9), but it is still 7.8 points worse than raw on quiet
  speech and 4.0 points worse on noisy speech (interval +2.0..+6.2). A running session does not
  rescue it.
- DPDFNet2 16 kHz: the same in both states (noisy -0.2 fresh, -0.5 running; both intervals cross
  zero). Its result does not depend on the starting state.
- Hush: the same in both states. It removes quiet speech because it is quiet, not because it has
  just started (quiet 87.7 fresh, 86.6 running).

### 5.5 Delay, processor and memory

`run_perf.py`: 40 held-out clips at SNR 5 per run (about 4.5 minutes of audio), one engine at a
time. "asr-running" = Filow's streaming recognizer (Nemotron, 3 threads) transcribing as fast as it
can in another process for the whole run, which is harder than live use, where it only keeps up
with the microphone. "CPU % of one core" is processor time divided by audio time.

The modest PC: no second machine was used. Its stand-in is this PC with the engine and the
recognizer together confined to 4 efficiency cores (logical processors 16 to 19 of the
i9-13900KF). Those are Gracemont cores, the core type of an Intel N100 mini PC, but here with a
faster clock, a larger cache and faster memory, so the stand-in flatters a real small PC.
The machine was not idle during these runs (other work on the same PC; "machine CPU %" is the
load of the whole PC during each run), which can only make the timing look worse, not better.

[Per-engine timing, CPU, memory and gates on both hardware configurations](../../tools/audio-bench/results/perf-table.md).

Reading the tables:

- On this PC the four small engines (RNNoise, GTCRN, DTLN, Hush) take 3 to 5 % of one core and
  15 to 42 MiB and add 21 to 34 ms: inside the light-mode limits. DeepFilterNet3 is inside them
  as far as it could be measured (40 ms latency, 10 % of a core, 46 MiB); its program gives no
  per-hop timing, so its p99 gate is "not measured", not passed.
- DPDFNet2 needs about 30 % of one core (16 kHz: 29.8 %, 48 kHz: 29.6 %), over the light limit
  of 25 %, and fits the quality limits on this PC (added delay 64 and 65 ms, 46 and 47 MiB,
  real-time factor 0.33 and 0.42 with the recognizer running). DeepFilterNet3 low latency is over
  the light limits on processor and memory (28.6 %, 167 MiB) and inside the quality limits.
- On the stand-in for a modest PC, with the recognizer running flat out on the same four cores,
  only GTCRN stays inside its limits (and DeepFilterNet3, as far as measured). The per-hop p99
  goes over 80 % of the hop for RNNoise (18.1 ms for a 10 ms hop), DTLN (6.5 for 8), Hush (11.7
  for 10), DPDFNet2 16 kHz (16.3 for 10, real-time factor 0.60) and DPDFNet2 48 kHz (39.7 for
  10, 0.75). DeepFilterNet3 low latency cannot keep up at all there (real-time factor 1.10).
- The recognizer ran to the end in every run. Nothing longer or harsher was tried.
- The first measurement of DeepFilterNet3 low latency and DPDFNet2 48 kHz fell in minutes when
  the whole PC was at 79 to 97 % load; both were measured again (the rows shown). The first rows
  are kept in the work folder (`results/perf-first-run.csv`).
- These limits decide nothing in this slice: no engine reaches them with a passing accuracy
  result (section 7).

## 6. Speaker isolation: Hush and ClearerVoice

Hush (pulp-vision/Hush, model weya-ai/hush) is built to keep the main talker and remove other
voices, with no enrolment of the user's voice. It ran through the same benchmark as a separate
arm, against the speaker isolation gate of section 4.

Result: it fails its gate and every general gate.

- Competing voice, pooled: raw 54.33, Hush 55.36 (1.9 % worse, interval -3.13..+4.84 points).
  The only cells where it helps are a competing voice in the same language (59.35 -> 57.54,
  interval crosses zero) and the echo at 12 dB (30.02 -> 25.19, interval -12.87..+2.12, also
  crossing zero).
- It treats quiet speech as a voice to remove: the quiet condition goes from 14.9 to 87.7, 194 of
  240 quiet clips come out more than 20 dB lower, and even normal-level clean speech loses 6.6 dB
  (median) and 3.3 points of accuracy. Noisy speech gets 9.1 points worse.
- A user who speaks softly, or sits a little further from the microphone, would lose most of
  what they say. That is the opposite of what the feature is for.
- This is the model's behaviour, not a wrapper fault: the repository's own example script, run
  on four held-out clips, gives the same output as the benchmark wrapper to within one 16-bit
  step (clean speech -28.1 dB in, -35.0 dB out; quiet speech -48.1 in, -67.9 out). It was run as
  documented (float samples in -1..1, 16 kHz, 10 ms frames, no attenuation limit). No other
  attenuation limit was tried: that would be tuning on held-out.

ClearerVoice-Studio (modelscope/ClearerVoice-Studio at `6b3774dc`, code Apache-2.0 by the GitHub
licence field; model cards of the four checkpoints looked at say apache-2.0, pinned in
`manifest/models.json`): not run. It publishes PyTorch checkpoints only, with no ONNX export and
no streaming loop; its separation model returns two voices without saying which is the user, and
its target-speaker model needs the speaker's video. Running it would add a PyTorch runtime to the
installer (hundreds of MB), which nothing else in Filow needs. Nothing was downloaded, so there
are no file hashes, and its weights' licences are not verified beyond the model card field.

The `sherpa-onnx-node` binding Filow already ships lists a third denoiser kind, `voxlock`, a
target-speaker model with an enrolment step. It was not in the owner's list and was not looked at.

## 7. Verdict against the frozen gates

**No candidate qualifies. Nothing here should ship as a light or a quality mode, and speaker
isolation fails its separate gate.** The gates were not changed and nothing was tuned.

| Candidate | Noisy speech gate (5 % better, interval below zero) | Clean (<= +0.5) | Slices | Quiet words (<= +0.5) | Noise-only (<= raw 19) | Outcome |
|---|---|---|---|---|---|---|
| RNNoise | FAIL: 33.3 % worse | FAIL +5.33 | FAIL 28 | FAIL +1.65 | FAIL 87 | rejected (and its weights' licence is not verified) |
| GTCRN | FAIL: 20.7 % worse | FAIL +1.13 | FAIL 26 | pass +0.17 | FAIL 24 | rejected (also failed on dev) |
| DTLN | FAIL: 31.6 % worse | pass +0.23 | FAIL 31 | FAIL +3.30 | FAIL 55 | rejected |
| DeepFilterNet3 | FAIL: 25.2 % worse | FAIL +1.91 | FAIL 21 | FAIL +40.14 | pass 13 | rejected |
| DeepFilterNet3 low latency | FAIL: 13.3 % worse | pass +0.45 | FAIL 15 | FAIL +7.00 | pass 19 | rejected |
| DPDFNet2 16 kHz | FAIL: 1.1 % better, interval -1.94..+1.37 | FAIL +1.02 | FAIL 9 | pass -1.55 | pass 6 | not qualified |
| DPDFNet2 48 kHz | FAIL: 4.5 % better, interval -2.64..+0.77 | pass +0.24 | FAIL 11 | pass -1.50 | pass 11 | not qualified |
| Hush (speaker isolation) | FAIL: 44.6 % worse; isolation gate FAIL (1.9 % worse) | FAIL +3.30 | FAIL 40 | FAIL +73.96 | pass 19 | rejected |

"Slices" = language x condition slices more than 1 point worse with an interval that excludes
zero (the full lists are in 5.1). The quality-against-light comparison of section 4 does not
apply: there is no light engine to compare with. The resource gates are in 5.5; they decide
nothing, because no engine reaches them with a passing accuracy result.

What the numbers say in plain words:

- Five of the seven noise arms make Filow's recognizer worse on noisy speech by 2.7 to 6.8 points
  (macro, every interval above zero). The direction is the same in every language; language by
  language not every difference has an interval that excludes zero (5.1). They remove the noise
  (5.2) and damage the speech.
- DPDFNet2 is the only family that does no harm on noisy speech. Its gain is too small to tell
  from zero on this test (0.2 to 0.9 points on 20.4), and it comes with costs that are not small:
  Japanese gets worse in every variant (noisy +3.2 to +5.2 points, interval excluding zero), and speech
  with a second voice behind it gets worse (pooled +4.4 points for the 16 kHz model, interval
  +0.59..+8.20; +3.9 for the 48 kHz model, interval -0.26..+8.71).
- On the takes recognizer DPDFNet2 16 kHz does the same: 1.0 point better on noisy speech
  (interval -2.81..+0.77), 1.3 points worse on clean speech, 5 points worse with a second voice.
- A lead, not a result: without Japanese, DPDFNet2 is better than raw on noisy speech in all four
  other languages (Italian with an interval that excludes zero for the 48 kHz model, -2.2
  points; Romanian -3.7 to -4.0, English and Russian under 2). This was seen after the fact on
  held-out data. It can only become a result on new held-out speakers with the rule written first.

## 8. Where a cleanup stage would plug in, and what it would add to the installer

Nothing in this section was built. It records what a later slice would have to do if a candidate
ever qualifies.

- Place: point A of section 1.3, `apps/desktop/stt-worker.js` `feed()`, before the voice detector
  and the recognizer. One flag in the worker's init message turns it off, and off means the audio
  is passed through untouched (today's path, byte for byte). Audio there is 16 kHz, so only a
  16 kHz engine fits without changing the capture rate in both renderers.
- Route 1, no new runtime: `sherpa-onnx-node` 2.0.1, already shipped, exports
  `OnlineSpeechDenoiser`; its type file lists three model kinds: `gtcrn`, `dpdfnet` and `voxlock`
  (a target-speaker model with an enrolment step) (`node_modules/sherpa-onnx-node/types.js:636-674`).
  The engine would run inside the recognizer's worker, no extra process and no extra hop. Not
  tried: whether sherpa's own loop gives the same output as the reference loops timed here.
- Route 2: `onnxruntime-node` 1.30.0 in its own `utilityProcess`, as the punctuation model already
  does (it cannot share a process with sherpa). The runtime is already in the installer
  (onnxruntime.dll 27.4 MB, DirectML 17.7 MB, dxcompiler 17.2 MB); one more process and one more
  message hop per block, not timed here.
- What each candidate would add to the download:

| Candidate | Model file(s) | New runtime needed |
|---|---|---|
| GTCRN | 0.5 MB | none (route 1 or 2) |
| DTLN | 4.0 MB (two graphs) | none (route 2), plus an FFT in JavaScript |
| DPDFNet2 16 kHz | 10.2 MB | none (route 1 or 2) |
| DPDFNet2 48 kHz | 10.5 MB | none, but capture at 48 kHz and a resampler |
| RNNoise | compiled into the library: 15.1 MB with the large model as built here | a native add-on or a WebAssembly build; capture at 48 kHz |
| DeepFilterNet3 | 8.0 MB (low-latency variant: 36.4 MB) | libDF built as a library (the 26.9 MB `deep-filter` program is a file tool, not a streaming interface); capture at 48 kHz |
| Hush | 8.6 MB | `weya_nc.dll` 14.6 MB (Windows; the repository also has Linux and macOS builds) and a way to call it from Node |

## 9. Not measured, stated plainly

- What Filow hears today. Both capture paths ask Chromium for its own noise suppression and echo
  cancellation. The "raw" arm here is the clip with no processing at all. Whether Chromium's
  processing helps or hurts the recognizer was not measured, and no candidate was tested behind it.
- Real microphones and rooms. All noise was mixed onto read Common Voice speech by a script. No
  laptop microphone, no keyboard on the same desk as the microphone, no real echo from
  loudspeakers, nobody raising their voice over noise. No microphone was opened in this slice.
- Task success per feature (text typed by dictation, a question answered, a take following the
  script) was not measured: only word and character error rates, per language. The takes
  recognizer was run for raw and DPDFNet2 16 kHz only.
- Wake errors: Filow has no wake-word detector (section 1.2), so there is nothing to measure. The
  nearest thing measured is text invented on noise-only clips.
- A modest PC. No second machine: the stand-in is four efficiency cores of this PC (5.5), which
  flatters a real small PC. Stream stability was measured only as per-hop timing over about
  4.5 minutes per run with the recognizer running; no hours-long session, no device change, no
  recovery after an engine crash.
- The route a product would use: the Node binding of onnxruntime, sherpa's own denoiser, the extra
  process hop, a JavaScript FFT. All timing here is Python with the same onnxruntime 1.30.0 native
  library, a C program (RNNoise) and the projects' own binaries (DeepFilterNet3, Hush).
- The second half of the noisy held-out clips (the "extra" tier, already mixed and listed) was
  not decoded. With 6 held-out speakers per language (English 16) the intervals are wide: an
  effect under about 2 points on noisy speech cannot be told from zero here.
- Dev: only raw and GTCRN were decoded on dev. The warm-state arms and the level table were added
  after the first held-out numbers and are diagnostics.
- Whisper in the browser, the cloud engines, Vosk and Dolphin were not run. Other tiers of PC
  (which select other models) were not run.
- ClearerVoice was not run (section 6).
- Wrapper correctness against an author's output was checked for GTCRN and Hush only. DTLN and
  DPDFNet2 follow their authors' streaming loops unchecked; a fault there would make a candidate
  look worse than it is.
- The intervals (percentile bootstrap over 6 speakers per language) are probably too narrow, and
  the noise-only count repeats the same clips per language (5.2).
- Licences. Verified by reading the licence file in the pinned clone: GTCRN (MIT), DTLN (MIT),
  DeepFilterNet (MIT or Apache-2.0), DPDFNet code (Apache-2.0), Hush code (Apache-2.0), RNNoise
  code (BSD-3-Clause). Verified by the model card at the pinned revision: DPDFNet and Hush weights
  (apache-2.0). NOT verified: the RNNoise weights (no licence text in the tarball); what is
  compiled into `weya_nc.dll` and into the `deep-filter` program (no third-party notices read);
  the licences of the data any of these weights were trained on; ClearerVoice beyond its licence
  fields. Krisp: rejected without testing, proprietary.
- Offline installed operation, microphone audio leaving the PC, writes on C: by the product:
  nothing was built, so there is nothing to verify yet. The benchmark itself kept everything
  under `G:\FILOW\tmp\mic-cleanup`.

## 10. Decisions for the owner

1. Accept "none qualifies" for 0.9.36? By the goal's own rule a failed gate is reported, not
   weakened: microphone cleanup does not ship in 0.9.36 as specified, and the off path stays what
   it is today.
2. Measure Chromium's own noise suppression next? It is on today in both capture paths and was
   never measured. Since most of the suppressors tested here made the recognizer worse, switching
   Chromium's off may itself be the gain; that is a guess until measured. This needs real capture (a loudspeaker playing the benchmark into a
   microphone, or recorded sessions), which this slice was not allowed to do.
3. Pursue DPDFNet2 further or stop? If pursued: a new held-out set with new speakers (this one is
   now used up for DPDFNet2), the rule "not for Japanese" written before the run, the extra tier
   decoded to narrow the intervals, and real microphone recordings. sherpa-onnx-node already has
   a `dpdfnet` denoiser, so no new runtime would be needed. If stopped: the benchmark and tools
   stay in the repository for any later candidate.
4. Speaker isolation: drop Hush (it deletes quiet speech). ClearerVoice needs PyTorch in the
   installer and was not run: evaluate it at that cost, or look at the enrolment-based `voxlock`
   model the shipped sherpa binding already lists, or leave speaker isolation out.
5. If RNNoise ever comes back: someone must get the licence of its model files in writing; it is
   not in the download.
6. The modest PC: name a real machine for the next round (for example an Intel N100 mini PC), or
   accept the four-efficiency-core stand-in.
