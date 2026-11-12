# Qwen3-ASR 0.6B (audio.cpp) against Filow's phrase recogniser, questions, 2026-11

Item V2 of `G:/FILOW/tmp/audiocpp-research/PLAN.md`, measurement only. This file is written by
`bakeoff_qwen3.py`; rerun the command below to regenerate it.

Command: `python -I bakeoff_qwen3.py   (from tools/audio-bench, with G:/FILOW/tmp/mic-cleanup/venv)`

Run started 2026-11-12 21:14:22, wall time 298 s.

## Inputs

- Server: `audio-v0.9.4-bin-windows-x64-cpu.zip` from https://github.com/0xShug0/audio.cpp/releases/download/v0.9.4/audio-v0.9.4-bin-windows-x64-cpu.zip, sha256 `596ef1d6ed5113f3a4f5194c8c00e02be5748d7dfb09e7f270168e6ec5c8e0cf`; /health: version 0.9.4, git f7ac446f (2026-11-04).
- Model: `Qwen3-ASR-0.6B-GGUF/qwen3-asr-0.6b-q8_0.gguf` from Hugging Face `audio-cpp/audio.cpp-gguf` at commit `73ce4162f6cce370dd533c6782b772135c1b2a8e`, sha256 `5c53bbb9a6b2ade85c16c290c560658ca18b78a23c323378528f1f945683fcbe`.
- Server config: cpu, 2 threads, lazy_load false, 127.0.0.1:8091, model id `qwen3-0.6b`, offline. Each clip is a multipart POST /v1/audio/transcriptions with `language` = Romanian, Russian or Japanese; one discarded warm-up request first.
- Clips: `manifest/clips.csv`, split heldout, tier core, condition clean, 48 per language (6 speakers each); WAVs from `G:/FILOW/tmp/mic-cleanup/mix/16k`.
- Baseline: `asr-questions-raw-heldout-t2.jsonl` (sherpa-onnx, 2 threads, VAD phrases); asr.json's archive hashes match today's stt.js for nemotron, parakeet-v3, reazonspeech-ja, silero-vad.
- Hardware: stt.hardwareOf() = {"ramGb": 127.76148986816406, "cores": 32}; CPU 13th Gen Intel(R) Core(TM) i9-13900KF.

Scoring: `normalise` and `edits` from score.py (norm-v1), errors pooled per language (WER; CER for Japanese). Interval: 2000 paired speaker bootstrap draws (seed 20261112), 2.5 to 97.5 percentiles of Qwen3 minus baseline. RTF = client wall ms / (1000 x audio seconds). Peak RAM = largest sampled working set of the server process (every 20 ms) while that language's requests ran; GB = 10^9 bytes.

Gates (candidate only if all pass): at least 2 points better with the interval below 0, median RTF at most 0.5, peak RAM at most 1.5 GB.

## Romanian (ro), WER

| arm | WER % | Qwen3 - baseline (95 % interval) | median RTF (p90) | peak RAM | candidate |
|---|---|---|---|---|---|
| Filow: parakeet-v3 | 11.14 | - | 0.082 | not measured here | - |
| Qwen3-ASR 0.6B q8_0 | 40.49 | +29.35 (+27.08 .. +32.43) | 0.315 (0.360) | 1.88 GB | no |

48 clips, 6 speakers, 368 reference words; empty or failed Qwen3 answers: 0.

Gates not met: accuracy: +29.35 pt, interval upper end +32.43 (needs <= -2 pt and below 0); memory: peak 1.88 GB > 1.5 GB.

## Russian (ru), WER

| arm | WER % | Qwen3 - baseline (95 % interval) | median RTF (p90) | peak RAM | candidate |
|---|---|---|---|---|---|
| Filow: parakeet-v3 | 5.34 | - | 0.093 | not measured here | - |
| Qwen3-ASR 0.6B q8_0 | 7.69 | +2.35 (+1.39 .. +3.59) | 0.319 (0.409) | 1.99 GB | no |

48 clips, 6 speakers, 468 reference words; empty or failed Qwen3 answers: 0.

Gates not met: accuracy: +2.35 pt, interval upper end +3.59 (needs <= -2 pt and below 0); memory: peak 1.99 GB > 1.5 GB.

## Japanese (ja), CER

| arm | CER % | Qwen3 - baseline (95 % interval) | median RTF (p90) | peak RAM | candidate |
|---|---|---|---|---|---|
| Filow: reazonspeech-ja | 23.38 | - | 0.021 | not measured here | - |
| Qwen3-ASR 0.6B q8_0 | 14.59 | -8.79 (-14.68 .. -0.19) | 0.321 (0.434) | 2.00 GB | no |

48 clips, 6 speakers, 1309 reference characters; empty or failed Qwen3 answers: 0.

Gates not met: memory: peak 2.00 GB > 1.5 GB.

## Result

No candidate: Qwen3-ASR 0.6B does not pass every gate in any of the three languages. Filow keeps its recognisers; no efficiency-core re-measure was run (the plan runs it only for a candidate).

Passed accuracy and speed but failed memory only: ja. The working set holds the whole 1.15 GB GGUF plus the runtime; the gate is the plan's own 1.5 GB choice and was not moved after the run.

Outputs in `G:/FILOW/tmp/audiocpp-bakeoff/`: hyp-qwen3-heldout-clean.jsonl (hypotheses, status, timing), ram-samples.csv, summary-qwen3.json, server.json, server.log.
