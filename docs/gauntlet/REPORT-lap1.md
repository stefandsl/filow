# Filow — Final plan for real-time local mode on low-spec hardware

Synthesized from 20 proposals, 20 devil's-advocate verdicts and three judges (all three picked #10). Dates: verified 2026-11-02. Latency labels: **M** = measured by a publisher or third party (hardware stated where known), **E** = estimated, must be measured in the gauntlet before shipping.

## 1. Recommended stack for low-spec machines

### STT (primary): Nemotron 3.5 ASR Streaming 0.6B, int8, via sherpa-onnx
- Model: `nvidia/nemotron-3.5-asr-streaming-0.6b` (600M, cache-aware FastConformer RNN-T, OpenMDW-1.1, released 06/04/2026). https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b
- Artifact: `sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11.tar.bz2` (encoder 627 MB + decoder 14 MB + joiner 9.1 MB; also 80/160/1120 ms variants; **no 320 ms export**). https://k2-fsa.github.io/sherpa/onnx/nemo/nemotron-streaming.html
- Runtime: sherpa-onnx (CPU, ONNX Runtime). Default = **sidecar binary spawned by `apps/desktop/main.js` over 127.0.0.1** (same pattern as the servers main.js already spawns; crash isolation, no Electron ABI/asar issues); in-process `sherpa-onnx-node` 2.0.1 (https://www.npmjs.com/package/sherpa-onnx-node) is the alternative if the sidecar adds too much IPC.
- Accuracy (M, publisher, FLEURS): Italian 4.41 % WER at 560 ms chunk (4.47 % auto-detect), English 7.99 %. Punctuation and casing native. Per-stream language `it` / `en` / `auto`.
- Speed: **M** RTF 0.16 on 1 thread for the English sibling model on the sherpa maintainer's Mac (sherpa docs); **M** RTFx 7.25 on a 32-core EPYC (arXiv 2604.14493, Table 14, different export). **E** for a 4-core x86 laptop at 2–4 threads: 90–200 ms compute per 560 ms chunk, words visible ~0.7–0.9 s after they are spoken. Field evidence: OpenWhispr 1.7.6 ships this exact model via sherpa-onnx on Windows/macOS/Linux with "partial text well under a second" on x86 (no numbers published; https://openwhispr.com/blog/local-streaming-speech-to-text).
- Why it wins: the current lag floor is architectural (`packages/stt/src/whisper.ts` WINDOW_S = 4, plus `chunk_length_s: 30` in `whisper.worker.ts`, and transformers.js 4.3.2 pads every call to a 30 s encoder pass regardless of chunk length). A cache-aware streaming RNN-T is the only candidate whose cost scales with audio length and that has first-tier Italian.

### Decision (low-spec CPU): embedding gate + NLI verifier cascade, no LLM
- Stage 1 gate: `Xenova/paraphrase-multilingual-MiniLM-L12-v2`, `onnx/model_int8.onnx` 118.1 MB, transformers.js in a Web Worker (WASM, `numThreads = min(4, cores-1)`), one 5–10 s window embedding per tick, bullets embedded once per section. https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2 (Italian in the 50 training languages, cross-lingual EN bullet vs IT speech is a trained configuration). **E** 50–150 ms per window on WASM; no published transformers.js number.
- Stage 2 verifier (ambiguous band only, max 2 pairs per tick): `onnx-community/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7-ONNX`, `model_int8.onnx` 338 MB (Xenova mirror 317 MB). https://huggingface.co/MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7 (Italian in the 26 fine-tuning languages; XNLI en 0.871, no Italian test split; fp16 unsupported by the model). **E** several hundred ms per pair on WASM; this is the number the gauntlet must settle before the cascade is catalogued.
- Rules carried over from the Clef rubric: cross-bullet normalisation (softmax/margin over open + upcoming bullets), no instant `sureThreshold` flip for this provider, `confirmCalls` 2 kept, no keyword-overlap requirement (kills the cross-lingual case), announcement regex (IT/EN) as a veto only.
- Honest gap: judges rated accuracy of every non-LLM method 2–5/10. The cascade is adopted because nothing else fits an 8 GB CPU box, **not** because it is proven. It ships only after the labelled gauntlet set shows a near-zero false-yes rate.

### Architecture changes (ship regardless of model choice)
1. Catalog truth: `clef-flash` downloadGb 6 → 11, ramGb 16 (tight), no q4 tag exists; whisper-base 150 MB → ~77 MB int8, whisper-small ~249 MB int8; add whisper-tiny (~41 MB).
2. `keep_alive: -1` on `/v1/systemone`, one warm-up call at app start.
3. Non-blocking in-flight guard: a slow decision call never blocks the tick, results tagged with the transcript they judged, answers older than one tick discarded; timeout surfaced as "local model is slow (x s/call)" instead of an error; adaptive tick `max(tickMs, 1.2 × avgMs)`.
4. Real partials from STT into `engine.feed()`, with a debounce so revised hypotheses cannot flip a bullet (a "yes" must survive two consecutive partials or one committed segment).
5. Question cap per call (3–4 undecided bullets, round-robin the rest; `fact_i` gap questions at a 2–3 s cadence).

### Expected end-to-end on an 8 GB / 4-core / no-GPU Windows laptop (all E)
STT lag 0.7–0.9 s (560 ms chunk) → gate 50–150 ms → verifier 0–2 × (unknown, likely 300–900 ms) → total decision loop ≤ 300 ms **only** when the gate alone decides; with the verifier it is 0.5–1.2 s. Today it is 5–7 s STT plus a 9B call that times out at 2.5 s.

## 2. Fallback ladder

| Rung | STT | Decision | Notes |
|---|---|---|---|
| 8 GB, no GPU | Nemotron 3.5 streaming int8, 560 ms (80 ms "fastest" opt-in); Whisper tiny q8 WASM as no-packaging fallback | MiniLM-L12 int8 gate + mDeBERTa int8 verifier (if gauntlet passes); else gate-only with strict thresholds. One harness run of `d1-omni:600m` (0.85 GB, https://ollama.com/library/d1-omni) because it costs nothing, but it is not catalogued unless p95 ≤ 250 ms and Italian false-yes near zero | RAM budget to measure: sherpa ~1–1.5 GB + Electron + 0.5 GB ORT; Clef never loads here |
| 16 GB + iGPU (Arc/Iris/APU) | Nemotron 3.5 streaming int8, 560 ms; Whisper base on WebGPU fp32 as fallback | `d1:3b` (3.7 GB q8_0, Italian listed, Decision Index 48.57, https://ollama.com/library/d1) **after** measuring with `OLLAMA_VULKAN=1 OLLAMA_IGPU_ENABLE=1`; Settings shows "GPU in use: yes/no" from `ollama ps`; gate still in front so d1 sees ≤ 3 questions | d1 on CPU is 1–3 s (E); only the iGPU path can meet the target |
| Dedicated GPU | Nemotron 3.5 streaming (1120 ms "accurate" or 560 ms); Parakeet TDT 0.6B v3 (FLEURS it 3.00 %, MLS it 10.08 %) as optional "accurate" preset later, sharing the sherpa download manager | `clef-flash:9b-q8_0` unchanged, gate optional | Keep Clef where it already works (38.8 ms median on Cloudflare's GPU measurement) |
| macOS Apple Silicon | same as above | `d1:2b-nvfp4` (1.7 GB MLX) on 8–16 GB; clef-flash on 32 GB+ | strands-decider/kev not needed |

## 3. Implementation steps (each ships alone, in this order)

**Step 0 — Gauntlet harness (prerequisite for every model decision)**
- `scripts/gauntlet/` (new): `replay.ts` feeds recorded takes (WAV + labelled bullet-start timestamps, ≥ 200 IT and ≥ 200 EN windows with announced-only, shared-keyword and sibling-bullet hard negatives) through `packages/core/src/engine.ts` with a pluggable decision provider; reports p50/p95 per stage (STT ms/chunk, gate ms, verifier ms, decide ms), false-yes rate at the operating threshold, median detection delay, peak RSS (`Get-Process`).
- Tick logger behind an opt-in flag in `apps/web/app/api/decide/route.ts` writing local JSONL (window, bullets, decisions, manual advance/undo) so labels accumulate on device.
- Run on: the dev PC (Core Ultra 7 155H, Arc iGPU, 32 GB) with Ollama Vulkan on and off, and on one 8 GB / 4-core Windows laptop, with STT running concurrently. Pass criteria: p95 decision ≤ 300 ms, false-yes ≈ 0 on hard negatives, STT lag ≤ 1 s.

**Step 1 — Hygiene (one day, no new runtime)**
- `apps/web/lib/localModels.ts`: clef-flash 11 GB / ramGb 16; `apps/web/app/api/local/status/route.ts` line ~46 recommendation gated on ≥ 20 GB or dGPU.
- `packages/stt/src/whisperModels.ts`: int8 sizes, add `onnx-community/whisper-tiny`; `whisper.worker.ts`: per-device dtype map, pass language; keep MIN_RMS gate.
- `apps/web/lib/decide/clef.ts`: `keep_alive: -1`, warm-up on start, surface `usage.input_tokens` in `DecideResponse`.
- `packages/core/src/engine.ts`: in-flight guard, result tagging, adaptive tick, "slow" state instead of error, question cap.
- `packages/core/src/clef.ts`: 1-question vs N-question A/B (does Ollama re-encode state per question?); only then decide whether rubric-in-state saves tokens.
- i18n strings for the new states in `packages/core/src/i18n.ts` (EN + IT), README/README.it.

**Step 2 — Streaming STT via sherpa-onnx sidecar**
- `apps/desktop/localai.js`: download manager entry for the sherpa tarball (650 MB, progress UI like the Ollama pull), extract to models dir; `apps/desktop/main.js`: spawn the sherpa-onnx streaming server binary on a free loopback port, pass port to the renderer.
- `packages/stt/src/sherpa.ts` (new `SttBackend`): reuse `mic.ts` 16 kHz 100 ms PCM, WebSocket to the sidecar, emit `{partial, committed}` using endpoint rule2 (min_trailing_silence ~1.2 s), chunk size setting (80 "fastest" / 560 "balanced" default / 1120 "accurate"), `num_threads = min(4, cores-2)`.
- `availableBackends()`: sherpa first when the sidecar is up, whisper after. Browser/phone-mirror path keeps Whisper.
- `apps/web/app/settings/local/page.tsx`: STT model picker, chunk size, measured ms/chunk from the Resources panel.
- CI: `.github/workflows/desktop.yml` bundles the sidecar for win-x64, darwin-arm64/x64, linux-x64 (`asarUnpack` not needed for a sidecar).

**Step 3 — Embedding gate**
- `packages/decide-local/` (new) or `packages/stt`-style worker: load MiniLM-L12 int8 via the loader pattern in `whisper.worker.ts` (`env.useBrowserCache`, `wasmPaths=/ort/`), embed bullets on `loadScript`, one window per tick, cosine + margin, bands LOW/HIGH calibrated on the gauntlet set (per-deck z-score, not fixed numbers).
- New `DecisionProviderId` `'local-cascade'` in `packages/core/src/api.ts`; because the worker runs in the renderer, the engine takes an injected `decide()` that bypasses `/api/decide` (and `requireEngine`) for this provider.
- Gate output feeds the existing provider (Clef/d1) with only the ambiguous bullets on GPU/16 GB rungs.

**Step 4 — NLI verifier (only if Step 0 numbers pass)**
- Second worker with mDeBERTa int8, premise = last 1–2 sentences of committed + partial, hypothesis = bullet text, cross-bullet normalisation, cap 2 pairs/tick, contradiction > 0.5 = hard no. Catalog entry: kind `decision`, runtime `browser`, ~0.34 GB, ramGb 2.

**Step 5 — Middle rung**
- Catalog `d1:3b` and (if harness passes) `d1-omni:600m`, with Ollama ≥ 0.35.1 gate, per-model noul threshold map in `parseClefAnswers`, Vulkan env-var diagnostics in Settings.

## 4. Killed by the devil's advocate (do not retry)

- **#1 tev1 0.8B**: autoregressive, re-scores every question with the full prompt (N × prefill), 2K context ceiling, 63.5 % accuracy, English-only training.
- **#3 instruct models + JSON schema (qwen3 0.6b, qwen3.5 0.8b, gemma3 1b/270m)**: 4–8 s per tick on a measured i5 (18–36 tok/s decode, 75–100 output tokens), exceeds the 2500 ms timeout; `num_predict = 8 × bullets` truncates JSON; gemma 1B multilingual near floor.
- **#4 laya / strands-decider / kev**: laya English-only, bf16-only on Windows, 65 % zero-shot with ECE 0.2; the others are MLX-only.
- **#8 EmbeddingGemma**: WebGPU-only (300–700 ms/window on CPU), contends with the Whisper worker that already takes WebGPU fp32, Gemma terms page in the installer, no gain shown over MiniLM.
- **#9 trained classifier head**: no labels exist; position/time features teach advancing on silence. Keep only the tick logger.
- **#11 Parakeet as primary**: not streaming; short-segment RTF 0.325 (sherpa's own number) → 2–3 s end-of-phrase lag; forced-cut dedupe unimplemented. Kept only as a later "accurate" preset.
- **#12/#18 Whisper short hops / chunk_length_s tricks**: transformers.js 4.3.2 pads every call to 30 s, so a 1.5 s hop runs the fixed encoder 2.7× more often; whisper-base Italian WER 31 %, tiny 42 % (Whisper paper, MLS). Only the size fix and VAD-cut commits survive.
- **#13 Nemotron EN-only**: same encoder size and compute as the multilingual export, English alphabet only, gated on the wrong preference.
- **#14 Voxtral Mini 4B Realtime**: measured ~3 tok/s on an M3 Max CPU vs 12.5 needed; 8.9 GB bf16; no Windows path.
- **#15 gate + Clef as stage 2 on CPU**: Clef cannot load on 8 GB and blows the timeout on 16 GB CPU; keyword-overlap HIGH rule kills cross-lingual.
- **#16 prompt diet as the fix**: "12 s becomes 3–4 s" misses the target by 10×; rubric-in-state saving unproven. Hygiene merged, strategy dropped.
- **#17 nimble 9B q4 for < 16 GB**: still 9B, seconds per call, times out every tick, swaps on 8 GB, no Italian evidence.
- **#5 static embeddings as sole judge**: fast but cannot encode announcement/negation; repo has no `model_type` for transformers.js 4.x; potion is fp32-only 512 MB. Allowed only as a cheaper stand-in for the Step 3 gate if MiniLM WASM time is a problem.

## 5. Open questions needing a measurement

1. Nemotron 3.5 int8 per-chunk compute and peak RSS at 2 and 4 threads on a 4-core AVX2 laptop (no VNNI), with the Electron app running. No x86 laptop number exists.
2. Sidecar vs in-process addon: IPC cost of 100 ms PCM over loopback versus `sherpa-onnx-node` ABI/asarUnpack risk on three platforms.
3. MiniLM-L12 int8 and mDeBERTa int8 per-pair latency on ORT WASM (no VNNI, 128-bit SIMD) while STT runs on the same cores; whether shader-f16 WebGPU is available on Iris Xe for a fp16 fallback.
4. Does Ollama's `/v1/systemone` re-encode the shared state per question (1 vs 5 questions on the same payload)? Determines whether rubric-in-state and the question cap help Clef/d1 at all.
5. d1:3b on Intel Arc/Iris via Ollama Vulkan: does it load, does it beat CPU, and does it survive the driver versions users have (ollama/ollama#13023 closed "not planned").
6. Italian false-yes rate of the cascade (and of d1-omni) on the labelled set: announced-only, shared-keyword, sibling-bullet, negation. No Italian decision accuracy is published for any candidate.
7. Partial-hypothesis revision rate of Nemotron on Italian: how often does a committed word change, and is a two-partial debounce enough.
8. RAM headroom on 8 GB with sherpa (~1–1.5 GB E) + Electron/Next standalone + two ORT WASM workers; whether `keep_alive -1` must be dropped when Ollama is also resident.
9. OpenMDW-1.1 (Nemotron) and LFM Open License v1.0 (d1 family) commercial terms, to be read before any catalog entry ships.

## Devil's advocate summary

- #0 d1-omni 600M: smallest GGUF decision model, drop-in for the existing System One call (Ollama library (ollama.com), verified 2026-11-02. Key finding: Filow already calls Ollama's /v1/systemone decision API (packages/core/src/clef.ts builds one `noul` question per bullet; apps/web/lib/decide/clef.ts reads CLEF_MODEL). Since Clef Flash is itself a 9B decision model, the fastest path is not an instruct LLM with JSON output but a smaller DECISION model: zero output tokens, one forward pass, calibrated probability per question, no JSON parsing, and no code change beyond the model name. Ollama now has a "Decision" capability category (ollama.com/search?c=decision) with 12 models; the ones that ship GGUF (q8_0) tags and therefore run through the llama.cpp runner on Windows/Linux are d1-omni (600M), tev1 (0.8B/4B), d1 (3B), d3 (2B+), laya (421M), nimble/clef-flash (9B). strands-decider (2B) and kev (0.8B+) are MLX-only (Apple Silicon). Ollama structured outputs (format: JSON schema, docs.ollama.com/capabilities/structured-outputs) are grammar-constrained and work with any local model, so the instruct-model route (qwen3.5:0.8b, gemma3:1b, qwen3:0.6b) also works, but it pays prefill + autoregressive decode per call and still needs a parser; it is the fallback, not the first choice. Caveats that apply to every row: (1) no publisher reports CPU latency for the small decision models; all CPU figures below are ESTIMATES derived from one measured datapoint (LFM2.5-350M llama.cpp Q4 on an AMD Ryzen AI Max 395+: 2.9K tok/s prefill, 313 tok/s decode, liquid.ai blog) scaled down for a 4-8 core laptop, and must be measured in the gauntlet harness; (2) Filow's request today is roughly 400-900 input tokens (transcript window + covered/upcoming lists + rubric + N noul questions), and Ollama builds the prompt itself, so the main latency lever besides model size is fewer and shorter questions (only undecided bullets, drop the context lists on the CPU rung); (3) the 0.7 noul threshold in parseClefAnswers was tuned for Clef and must be recalibrated per model on labeled Italian/English transcript windows.): refuted · serious
- #1 tev1 0.8B: Qwen3.5-based decision model with a measured accuracy number on Ollama (Ollama library (ollama.com), verified 2026-11-02. Key finding: Filow already calls Ollama's /v1/systemone decision API (packages/core/src/clef.ts builds one `noul` question per bullet; apps/web/lib/decide/clef.ts reads CLEF_MODEL). Since Clef Flash is itself a 9B decision model, the fastest path is not an instruct LLM with JSON output but a smaller DECISION model: zero output tokens, one forward pass, calibrated probability per question, no JSON parsing, and no code change beyond the model name. Ollama now has a "Decision" capability category (ollama.com/search?c=decision) with 12 models; the ones that ship GGUF (q8_0) tags and therefore run through the llama.cpp runner on Windows/Linux are d1-omni (600M), tev1 (0.8B/4B), d1 (3B), d3 (2B+), laya (421M), nimble/clef-flash (9B). strands-decider (2B) and kev (0.8B+) are MLX-only (Apple Silicon). Ollama structured outputs (format: JSON schema, docs.ollama.com/capabilities/structured-outputs) are grammar-constrained and work with any local model, so the instruct-model route (qwen3.5:0.8b, gemma3:1b, qwen3:0.6b) also works, but it pays prefill + autoregressive decode per call and still needs a parser; it is the fallback, not the first choice. Caveats that apply to every row: (1) no publisher reports CPU latency for the small decision models; all CPU figures below are ESTIMATES derived from one measured datapoint (LFM2.5-350M llama.cpp Q4 on an AMD Ryzen AI Max 395+: 2.9K tok/s prefill, 313 tok/s decode, liquid.ai blog) scaled down for a 4-8 core laptop, and must be measured in the gauntlet harness; (2) Filow's request today is roughly 400-900 input tokens (transcript window + covered/upcoming lists + rubric + N noul questions), and Ollama builds the prompt itself, so the main latency lever besides model size is fewer and shorter questions (only undecided bullets, drop the context lists on the CPU rung); (3) the 0.7 noul threshold in parseClefAnswers was tuned for Clef and must be recalibrated per model on labeled Italian/English transcript windows.): refuted · serious
- #2 d1 3B: documented Italian support, best accuracy under 10B, for the 16 GB / integrated-GPU rung (Ollama library (ollama.com), verified 2026-11-02. Key finding: Filow already calls Ollama's /v1/systemone decision API (packages/core/src/clef.ts builds one `noul` question per bullet; apps/web/lib/decide/clef.ts reads CLEF_MODEL). Since Clef Flash is itself a 9B decision model, the fastest path is not an instruct LLM with JSON output but a smaller DECISION model: zero output tokens, one forward pass, calibrated probability per question, no JSON parsing, and no code change beyond the model name. Ollama now has a "Decision" capability category (ollama.com/search?c=decision) with 12 models; the ones that ship GGUF (q8_0) tags and therefore run through the llama.cpp runner on Windows/Linux are d1-omni (600M), tev1 (0.8B/4B), d1 (3B), d3 (2B+), laya (421M), nimble/clef-flash (9B). strands-decider (2B) and kev (0.8B+) are MLX-only (Apple Silicon). Ollama structured outputs (format: JSON schema, docs.ollama.com/capabilities/structured-outputs) are grammar-constrained and work with any local model, so the instruct-model route (qwen3.5:0.8b, gemma3:1b, qwen3:0.6b) also works, but it pays prefill + autoregressive decode per call and still needs a parser; it is the fallback, not the first choice. Caveats that apply to every row: (1) no publisher reports CPU latency for the small decision models; all CPU figures below are ESTIMATES derived from one measured datapoint (LFM2.5-350M llama.cpp Q4 on an AMD Ryzen AI Max 395+: 2.9K tok/s prefill, 313 tok/s decode, liquid.ai blog) scaled down for a 4-8 core laptop, and must be measured in the gauntlet harness; (2) Filow's request today is roughly 400-900 input tokens (transcript window + covered/upcoming lists + rubric + N noul questions), and Ollama builds the prompt itself, so the main latency lever besides model size is fewer and shorter questions (only undecided bullets, drop the context lists on the CPU rung); (3) the 0.7 noul threshold in parseClefAnswers was tuned for Clef and must be recalibrated per model on labeled Italian/English transcript windows.): refuted · serious
- #3 Instruct-model fallback with grammar-constrained JSON: qwen3.5:0.8b, gemma3:1b, qwen3:0.6b (Ollama library (ollama.com), verified 2026-11-02. Key finding: Filow already calls Ollama's /v1/systemone decision API (packages/core/src/clef.ts builds one `noul` question per bullet; apps/web/lib/decide/clef.ts reads CLEF_MODEL). Since Clef Flash is itself a 9B decision model, the fastest path is not an instruct LLM with JSON output but a smaller DECISION model: zero output tokens, one forward pass, calibrated probability per question, no JSON parsing, and no code change beyond the model name. Ollama now has a "Decision" capability category (ollama.com/search?c=decision) with 12 models; the ones that ship GGUF (q8_0) tags and therefore run through the llama.cpp runner on Windows/Linux are d1-omni (600M), tev1 (0.8B/4B), d1 (3B), d3 (2B+), laya (421M), nimble/clef-flash (9B). strands-decider (2B) and kev (0.8B+) are MLX-only (Apple Silicon). Ollama structured outputs (format: JSON schema, docs.ollama.com/capabilities/structured-outputs) are grammar-constrained and work with any local model, so the instruct-model route (qwen3.5:0.8b, gemma3:1b, qwen3:0.6b) also works, but it pays prefill + autoregressive decode per call and still needs a parser; it is the fallback, not the first choice. Caveats that apply to every row: (1) no publisher reports CPU latency for the small decision models; all CPU figures below are ESTIMATES derived from one measured datapoint (LFM2.5-350M llama.cpp Q4 on an AMD Ryzen AI Max 395+: 2.9K tok/s prefill, 313 tok/s decode, liquid.ai blog) scaled down for a 4-8 core laptop, and must be measured in the gauntlet harness; (2) Filow's request today is roughly 400-900 input tokens (transcript window + covered/upcoming lists + rubric + N noul questions), and Ollama builds the prompt itself, so the main latency lever besides model size is fewer and shorter questions (only undecided bullets, drop the context lists on the CPU rung); (3) the 0.7 noul threshold in parseClefAnswers was tuned for Clef and must be recalibrated per model on labeled Italian/English transcript windows.): refuted · serious
- #4 laya 421M (ModernBERT decision head): fastest possible, English only; plus macOS-only MLX deciders (Ollama library (ollama.com), verified 2026-11-02. Key finding: Filow already calls Ollama's /v1/systemone decision API (packages/core/src/clef.ts builds one `noul` question per bullet; apps/web/lib/decide/clef.ts reads CLEF_MODEL). Since Clef Flash is itself a 9B decision model, the fastest path is not an instruct LLM with JSON output but a smaller DECISION model: zero output tokens, one forward pass, calibrated probability per question, no JSON parsing, and no code change beyond the model name. Ollama now has a "Decision" capability category (ollama.com/search?c=decision) with 12 models; the ones that ship GGUF (q8_0) tags and therefore run through the llama.cpp runner on Windows/Linux are d1-omni (600M), tev1 (0.8B/4B), d1 (3B), d3 (2B+), laya (421M), nimble/clef-flash (9B). strands-decider (2B) and kev (0.8B+) are MLX-only (Apple Silicon). Ollama structured outputs (format: JSON schema, docs.ollama.com/capabilities/structured-outputs) are grammar-constrained and work with any local model, so the instruct-model route (qwen3.5:0.8b, gemma3:1b, qwen3:0.6b) also works, but it pays prefill + autoregressive decode per call and still needs a parser; it is the fallback, not the first choice. Caveats that apply to every row: (1) no publisher reports CPU latency for the small decision models; all CPU figures below are ESTIMATES derived from one measured datapoint (LFM2.5-350M llama.cpp Q4 on an AMD Ryzen AI Max 395+: 2.9K tok/s prefill, 313 tok/s decode, liquid.ai blog) scaled down for a 4-8 core laptop, and must be measured in the gauntlet harness; (2) Filow's request today is roughly 400-900 input tokens (transcript window + covered/upcoming lists + rubric + N noul questions), and Ollama builds the prompt itself, so the main latency lever besides model size is fewer and shorter questions (only undecided bullets, drop the context lists on the CPU rung); (3) the 0.7 noul threshold in parseClefAnswers was tuned for Clef and must be recalibrated per model on labeled Italian/English transcript windows.): refuted · serious
- #5 1. Static multilingual embeddings (Model2Vec / sentence-transformers static) + keyword boost + hysteresis: sub-5 ms decision loop on any CPU (Hugging Face, not an LLM: treat "has the speaker STARTED this bullet?" as a multilingual semantic-similarity / NLI problem computed in milliseconds inside Electron (transformers.js, ONNX, WASM/WebGPU), with thresholds, margin-vs-other-bullets, hysteresis and keyword boosts replacing the 9B Clef Flash call. All repo ids below were verified today (2026-11-02) via the Hugging Face API (file sizes read from the repos). Latency figures are marked measured (published by the authors) or estimated (my extrapolation for a 4-core laptop; no on-device benchmark was run). Current code context: packages/core/src/clef.ts builds one noul question per bullet with transcript + covered/upcoming lists; packages/core/src/prompt.ts uses threshold 0.70 and "prefer false 'not started'". The proposals keep that contract (Decision {id, started, confidence}) so apps/web/app/api/decide can switch backends without UI changes.): refuted · serious
- #6 2. Small multilingual transformer embedder (multilingual-e5-small / paraphrase-multilingual-MiniLM-L12-v2, int8 ONNX) as the quality tier, same scoring pipeline (Hugging Face, not an LLM: treat "has the speaker STARTED this bullet?" as a multilingual semantic-similarity / NLI problem computed in milliseconds inside Electron (transformers.js, ONNX, WASM/WebGPU), with thresholds, margin-vs-other-bullets, hysteresis and keyword boosts replacing the 9B Clef Flash call. All repo ids below were verified today (2026-11-02) via the Hugging Face API (file sizes read from the repos). Latency figures are marked measured (published by the authors) or estimated (my extrapolation for a 4-core laptop; no on-device benchmark was run). Current code context: packages/core/src/clef.ts builds one noul question per bullet with transcript + covered/upcoming lists; packages/core/src/prompt.ts uses threshold 0.70 and "prefer false 'not started'". The proposals keep that contract (Decision {id, started, confidence}) so apps/web/app/api/decide can switch backends without UI changes.): refuted · serious
- #7 3. Two-stage cascade: cheap embedding gate, then a multilingual NLI cross-encoder verifies only the ambiguous bullets ('transcript entails the point') (Hugging Face, not an LLM: treat "has the speaker STARTED this bullet?" as a multilingual semantic-similarity / NLI problem computed in milliseconds inside Electron (transformers.js, ONNX, WASM/WebGPU), with thresholds, margin-vs-other-bullets, hysteresis and keyword boosts replacing the 9B Clef Flash call. All repo ids below were verified today (2026-11-02) via the Hugging Face API (file sizes read from the repos). Latency figures are marked measured (published by the authors) or estimated (my extrapolation for a 4-core laptop; no on-device benchmark was run). Current code context: packages/core/src/clef.ts builds one noul question per bullet with transcript + covered/upcoming lists; packages/core/src/prompt.ts uses threshold 0.70 and "prefer false 'not started'". The proposals keep that contract (Decision {id, started, confidence}) so apps/web/app/api/decide can switch backends without UI changes.): refuted · serious
- #8 4. EmbeddingGemma-300m ONNX (q4, Matryoshka 256-d) as the WebGPU-only high-accuracy embedder (Hugging Face, not an LLM: treat "has the speaker STARTED this bullet?" as a multilingual semantic-similarity / NLI problem computed in milliseconds inside Electron (transformers.js, ONNX, WASM/WebGPU), with thresholds, margin-vs-other-bullets, hysteresis and keyword boosts replacing the 9B Clef Flash call. All repo ids below were verified today (2026-11-02) via the Hugging Face API (file sizes read from the repos). Latency figures are marked measured (published by the authors) or estimated (my extrapolation for a 4-core laptop; no on-device benchmark was run). Current code context: packages/core/src/clef.ts builds one noul question per bullet with transcript + covered/upcoming lists; packages/core/src/prompt.ts uses threshold 0.70 and "prefer false 'not started'". The proposals keep that contract (Decision {id, started, confidence}) so apps/web/app/api/decide can switch backends without UI changes.): refuted · serious
- #9 5. Fine-tuned tiny task classifier on Filow logs (features from proposals 1-2) and a fixed-position-aware decision design (Hugging Face, not an LLM: treat "has the speaker STARTED this bullet?" as a multilingual semantic-similarity / NLI problem computed in milliseconds inside Electron (transformers.js, ONNX, WASM/WebGPU), with thresholds, margin-vs-other-bullets, hysteresis and keyword boosts replacing the 9B Clef Flash call. All repo ids below were verified today (2026-11-02) via the Hugging Face API (file sizes read from the repos). Latency figures are marked measured (published by the authors) or estimated (my extrapolation for a 4-core laptop; no on-device benchmark was run). Current code context: packages/core/src/clef.ts builds one noul question per bullet with transcript + covered/upcoming lists; packages/core/src/prompt.ts uses threshold 0.70 and "prefer false 'not started'". The proposals keep that contract (Decision {id, started, confidence}) so apps/web/app/api/decide can switch backends without UI changes.): refuted · serious
- #10 Nemotron 3.5 ASR Streaming 0.6B (int8, sherpa-onnx-node) as the primary local STT: natively streaming, Italian + English, partial words every chunk (Real-time on-device speech-to-text for Italian + English on low-spec laptops (8-16 GB RAM, iGPU or none, 4-8 cores), runnable inside the Filow Electron app. Current state in the repo: packages/stt/src/whisper.worker.ts loads onnx-community/whisper-base|small through transformers.js 4.x with fp32 on WebGPU or q8 on WASM, and packages/stt/src/whisper.ts batches the mic into 4-second windows with chunk_length_s: 30, drops windows when two are in flight, and only emits committed text (no partials). So the "STT lag" users feel is at least 4 s of window + a 30 s-padded Whisper decode on CPU; the model is only half the problem. Candidates eliminated by verification: Moonshine (tiny/base are English-only; the 2025 'Flavors of Moonshine' family adds ar/zh/ja/ko/uk/vi, no Italian: https://arxiv.org/abs/2509.02523), SenseVoice (zh/yue/en/ja/ko only: https://k2-fsa.github.io/sherpa/onnx/sense-voice/index.html), Kyutai STT (stt-1b-en_fr is English+French only: https://github.com/kyutai-labs/delayed-streams-modeling/), distil-whisper (English only, no Italian distil release), sherpa-onnx streaming Zipformer (published models are zh/en, ru, etc., none for Italian), Canary-1B-v2 (1B params, offline, too heavy for the target). Voxtral Mini 4B Realtime 2602 does support Italian and is natively streaming (480 ms delay) but is 4B parameters; no CPU numbers are published and vLLM/MLX are the runtimes, so it is out for this hardware. Verdict: the two models that actually fit are NVIDIA's 0.6B FastConformer family exported to int8 ONNX by sherpa-onnx (both verified to include Italian), run through the sherpa-onnx-node native addon in the Electron main process; Whisper via transformers.js stays only as the zero-packaging fallback, and even there the window/chunk settings must change.): survived · minor
- #11 Parakeet TDT 0.6B v3 (int8, sherpa-onnx) with Silero VAD as the 'accurate' option or as the sole model if the Nemotron addon path has issues: best Italian WER of any small model, 25 European languages (Real-time on-device speech-to-text for Italian + English on low-spec laptops (8-16 GB RAM, iGPU or none, 4-8 cores), runnable inside the Filow Electron app. Current state in the repo: packages/stt/src/whisper.worker.ts loads onnx-community/whisper-base|small through transformers.js 4.x with fp32 on WebGPU or q8 on WASM, and packages/stt/src/whisper.ts batches the mic into 4-second windows with chunk_length_s: 30, drops windows when two are in flight, and only emits committed text (no partials). So the "STT lag" users feel is at least 4 s of window + a 30 s-padded Whisper decode on CPU; the model is only half the problem. Candidates eliminated by verification: Moonshine (tiny/base are English-only; the 2025 'Flavors of Moonshine' family adds ar/zh/ja/ko/uk/vi, no Italian: https://arxiv.org/abs/2509.02523), SenseVoice (zh/yue/en/ja/ko only: https://k2-fsa.github.io/sherpa/onnx/sense-voice/index.html), Kyutai STT (stt-1b-en_fr is English+French only: https://github.com/kyutai-labs/delayed-streams-modeling/), distil-whisper (English only, no Italian distil release), sherpa-onnx streaming Zipformer (published models are zh/en, ru, etc., none for Italian), Canary-1B-v2 (1B params, offline, too heavy for the target). Voxtral Mini 4B Realtime 2602 does support Italian and is natively streaming (480 ms delay) but is 4B parameters; no CPU numbers are published and vLLM/MLX are the runtimes, so it is out for this hardware. Verdict: the two models that actually fit are NVIDIA's 0.6B FastConformer family exported to int8 ONNX by sherpa-onnx (both verified to include Italian), run through the sherpa-onnx-node native addon in the Electron main process; Whisper via transformers.js stays only as the zero-packaging fallback, and even there the window/chunk settings must change.): refuted · serious
- #12 Keep transformers.js Whisper as the zero-packaging fallback, but switch to whisper-tiny/base q8 on WASM and fix the window pipeline (1-2 s hop, chunk_length_s small, partials) (Real-time on-device speech-to-text for Italian + English on low-spec laptops (8-16 GB RAM, iGPU or none, 4-8 cores), runnable inside the Filow Electron app. Current state in the repo: packages/stt/src/whisper.worker.ts loads onnx-community/whisper-base|small through transformers.js 4.x with fp32 on WebGPU or q8 on WASM, and packages/stt/src/whisper.ts batches the mic into 4-second windows with chunk_length_s: 30, drops windows when two are in flight, and only emits committed text (no partials). So the "STT lag" users feel is at least 4 s of window + a 30 s-padded Whisper decode on CPU; the model is only half the problem. Candidates eliminated by verification: Moonshine (tiny/base are English-only; the 2025 'Flavors of Moonshine' family adds ar/zh/ja/ko/uk/vi, no Italian: https://arxiv.org/abs/2509.02523), SenseVoice (zh/yue/en/ja/ko only: https://k2-fsa.github.io/sherpa/onnx/sense-voice/index.html), Kyutai STT (stt-1b-en_fr is English+French only: https://github.com/kyutai-labs/delayed-streams-modeling/), distil-whisper (English only, no Italian distil release), sherpa-onnx streaming Zipformer (published models are zh/en, ru, etc., none for Italian), Canary-1B-v2 (1B params, offline, too heavy for the target). Voxtral Mini 4B Realtime 2602 does support Italian and is natively streaming (480 ms delay) but is 4B parameters; no CPU numbers are published and vLLM/MLX are the runtimes, so it is out for this hardware. Verdict: the two models that actually fit are NVIDIA's 0.6B FastConformer family exported to int8 ONNX by sherpa-onnx (both verified to include Italian), run through the sherpa-onnx-node native addon in the Electron main process; Whisper via transformers.js stays only as the zero-packaging fallback, and even there the window/chunk settings must change.): refuted · serious
- #13 Nemotron Speech Streaming EN 0.6B (int8) as an English-only variant with 80 ms chunks when the talk is in English and the laptop is very weak (Real-time on-device speech-to-text for Italian + English on low-spec laptops (8-16 GB RAM, iGPU or none, 4-8 cores), runnable inside the Filow Electron app. Current state in the repo: packages/stt/src/whisper.worker.ts loads onnx-community/whisper-base|small through transformers.js 4.x with fp32 on WebGPU or q8 on WASM, and packages/stt/src/whisper.ts batches the mic into 4-second windows with chunk_length_s: 30, drops windows when two are in flight, and only emits committed text (no partials). So the "STT lag" users feel is at least 4 s of window + a 30 s-padded Whisper decode on CPU; the model is only half the problem. Candidates eliminated by verification: Moonshine (tiny/base are English-only; the 2025 'Flavors of Moonshine' family adds ar/zh/ja/ko/uk/vi, no Italian: https://arxiv.org/abs/2509.02523), SenseVoice (zh/yue/en/ja/ko only: https://k2-fsa.github.io/sherpa/onnx/sense-voice/index.html), Kyutai STT (stt-1b-en_fr is English+French only: https://github.com/kyutai-labs/delayed-streams-modeling/), distil-whisper (English only, no Italian distil release), sherpa-onnx streaming Zipformer (published models are zh/en, ru, etc., none for Italian), Canary-1B-v2 (1B params, offline, too heavy for the target). Voxtral Mini 4B Realtime 2602 does support Italian and is natively streaming (480 ms delay) but is 4B parameters; no CPU numbers are published and vLLM/MLX are the runtimes, so it is out for this hardware. Verdict: the two models that actually fit are NVIDIA's 0.6B FastConformer family exported to int8 ONNX by sherpa-onnx (both verified to include Italian), run through the sherpa-onnx-node native addon in the Electron main process; Whisper via transformers.js stays only as the zero-packaging fallback, and even there the window/chunk settings must change.): refuted · minor
- #14 Devil's-advocate note on Voxtral Mini 4B Realtime: the only other verified Italian streaming model, rejected for this hardware (Real-time on-device speech-to-text for Italian + English on low-spec laptops (8-16 GB RAM, iGPU or none, 4-8 cores), runnable inside the Filow Electron app. Current state in the repo: packages/stt/src/whisper.worker.ts loads onnx-community/whisper-base|small through transformers.js 4.x with fp32 on WebGPU or q8 on WASM, and packages/stt/src/whisper.ts batches the mic into 4-second windows with chunk_length_s: 30, drops windows when two are in flight, and only emits committed text (no partials). So the "STT lag" users feel is at least 4 s of window + a 30 s-padded Whisper decode on CPU; the model is only half the problem. Candidates eliminated by verification: Moonshine (tiny/base are English-only; the 2025 'Flavors of Moonshine' family adds ar/zh/ja/ko/uk/vi, no Italian: https://arxiv.org/abs/2509.02523), SenseVoice (zh/yue/en/ja/ko only: https://k2-fsa.github.io/sherpa/onnx/sense-voice/index.html), Kyutai STT (stt-1b-en_fr is English+French only: https://github.com/kyutai-labs/delayed-streams-modeling/), distil-whisper (English only, no Italian distil release), sherpa-onnx streaming Zipformer (published models are zh/en, ru, etc., none for Italian), Canary-1B-v2 (1B params, offline, too heavy for the target). Voxtral Mini 4B Realtime 2602 does support Italian and is natively streaming (480 ms delay) but is 4B parameters; no CPU numbers are published and vLLM/MLX are the runtimes, so it is out for this hardware. Verdict: the two models that actually fit are NVIDIA's 0.6B FastConformer family exported to int8 ONNX by sherpa-onnx (both verified to include Italian), run through the sherpa-onnx-node native addon in the Electron main process; Whisper via transformers.js stays only as the zero-packaging fallback, and even there the window/chunk settings must change.): survived · minor
- #15 1. Two-stage gate: multilingual embedding pre-filter, Clef only for the 0–2 ambiguous bullets (Ask the model less: restructure Filow's decision loop (packages/core/src/engine.ts, packages/core/src/clef.ts, apps/web/lib/decide/clef.ts, packages/stt/src/whisper*.ts) so that on a 4–8 core laptop without a dedicated GPU the 9B Clef Flash call is rare, small and never on the critical path, and so that STT feeds partial text early. Verified facts that frame everything (2026-11-02): (a) ollama.com/library/clef-flash/tags lists only clef-flash:latest / :9b (11–12 GB), :9b-q8_0 (11 GB), :9b-mlx-bf16 (19 GB, MLX) and :9b-mxfp8 (12 GB, MLX). There is NO q4_K_M / q3 tag, so the catalog entry in apps/web/lib/localModels.ts (downloadGb: 6, ramGb: 16) understates the download by ~2x and a 9B q8 model (~10 GB of weights) does not fit an 8 GB machine at all. (b) The 38.8 ms median / 122.4 ms p95 on the Ollama page is Cloudflare's own Decision Index measurement on GPU, not a CPU number. (c) Clef is single-pass non-autoregressive (usage.output_tokens is 0–3), so local latency is almost entirely prompt evaluation, which scales with input tokens; the systemone API reference says shared context is counted again when the model scores questions separately, so the number of questions per call is the biggest lever. (d) The engine today re-sends every open bullet, every covered and upcoming point, every on-screen fact and a 60-word rubric per question whenever the 900-char window string differs at all, with a hard 2500 ms timeout (engine.ts timeoutMs) that a CPU-bound 9B call will blow every time, leaving local mode with errors instead of decisions. (e) On-device STT commits whole 4 s windows with no partials (whisper.ts WINDOW_S = 4) and pads each to 30 s (chunk_length_s: 30), so the STT lag floor is 4 s plus inference regardless of model. Estimates below are labeled; nothing was benchmarked on the target hardware in this task.): refuted · serious
- #16 2. Prompt diet, change-gating, keep_alive and a latency-adaptive loop (no new model) (Ask the model less: restructure Filow's decision loop (packages/core/src/engine.ts, packages/core/src/clef.ts, apps/web/lib/decide/clef.ts, packages/stt/src/whisper*.ts) so that on a 4–8 core laptop without a dedicated GPU the 9B Clef Flash call is rare, small and never on the critical path, and so that STT feeds partial text early. Verified facts that frame everything (2026-11-02): (a) ollama.com/library/clef-flash/tags lists only clef-flash:latest / :9b (11–12 GB), :9b-q8_0 (11 GB), :9b-mlx-bf16 (19 GB, MLX) and :9b-mxfp8 (12 GB, MLX). There is NO q4_K_M / q3 tag, so the catalog entry in apps/web/lib/localModels.ts (downloadGb: 6, ramGb: 16) understates the download by ~2x and a 9B q8 model (~10 GB of weights) does not fit an 8 GB machine at all. (b) The 38.8 ms median / 122.4 ms p95 on the Ollama page is Cloudflare's own Decision Index measurement on GPU, not a CPU number. (c) Clef is single-pass non-autoregressive (usage.output_tokens is 0–3), so local latency is almost entirely prompt evaluation, which scales with input tokens; the systemone API reference says shared context is counted again when the model scores questions separately, so the number of questions per call is the biggest lever. (d) The engine today re-sends every open bullet, every covered and upcoming point, every on-screen fact and a 60-word rubric per question whenever the 900-char window string differs at all, with a hard 2500 ms timeout (engine.ts timeoutMs) that a CPU-bound 9B call will blow every time, leaving local mode with errors instead of decisions. (e) On-device STT commits whole 4 s windows with no partials (whisper.ts WINDOW_S = 4) and pads each to 30 s (chunk_length_s: 30), so the STT lag floor is 4 s plus inference regardless of model. Estimates below are labeled; nothing was benchmarked on the target hardware in this task.): refuted · serious
- #17 3. RAM-fit fallback for < 16 GB machines: Nimble 9B q4_K_M, and stop advertising Clef Flash as a 6 GB download (Ask the model less: restructure Filow's decision loop (packages/core/src/engine.ts, packages/core/src/clef.ts, apps/web/lib/decide/clef.ts, packages/stt/src/whisper*.ts) so that on a 4–8 core laptop without a dedicated GPU the 9B Clef Flash call is rare, small and never on the critical path, and so that STT feeds partial text early. Verified facts that frame everything (2026-11-02): (a) ollama.com/library/clef-flash/tags lists only clef-flash:latest / :9b (11–12 GB), :9b-q8_0 (11 GB), :9b-mlx-bf16 (19 GB, MLX) and :9b-mxfp8 (12 GB, MLX). There is NO q4_K_M / q3 tag, so the catalog entry in apps/web/lib/localModels.ts (downloadGb: 6, ramGb: 16) understates the download by ~2x and a 9B q8 model (~10 GB of weights) does not fit an 8 GB machine at all. (b) The 38.8 ms median / 122.4 ms p95 on the Ollama page is Cloudflare's own Decision Index measurement on GPU, not a CPU number. (c) Clef is single-pass non-autoregressive (usage.output_tokens is 0–3), so local latency is almost entirely prompt evaluation, which scales with input tokens; the systemone API reference says shared context is counted again when the model scores questions separately, so the number of questions per call is the biggest lever. (d) The engine today re-sends every open bullet, every covered and upcoming point, every on-screen fact and a 60-word rubric per question whenever the 900-char window string differs at all, with a hard 2500 ms timeout (engine.ts timeoutMs) that a CPU-bound 9B call will blow every time, leaving local mode with errors instead of decisions. (e) On-device STT commits whole 4 s windows with no partials (whisper.ts WINDOW_S = 4) and pads each to 30 s (chunk_length_s: 30), so the STT lag floor is 4 s plus inference regardless of model. Estimates below are labeled; nothing was benchmarked on the target hardware in this task.): refuted · serious
- #18 4. STT: short hop with partials, no 30 s padding waste, int8/q4 ONNX files, decisions on partial text (Ask the model less: restructure Filow's decision loop (packages/core/src/engine.ts, packages/core/src/clef.ts, apps/web/lib/decide/clef.ts, packages/stt/src/whisper*.ts) so that on a 4–8 core laptop without a dedicated GPU the 9B Clef Flash call is rare, small and never on the critical path, and so that STT feeds partial text early. Verified facts that frame everything (2026-11-02): (a) ollama.com/library/clef-flash/tags lists only clef-flash:latest / :9b (11–12 GB), :9b-q8_0 (11 GB), :9b-mlx-bf16 (19 GB, MLX) and :9b-mxfp8 (12 GB, MLX). There is NO q4_K_M / q3 tag, so the catalog entry in apps/web/lib/localModels.ts (downloadGb: 6, ramGb: 16) understates the download by ~2x and a 9B q8 model (~10 GB of weights) does not fit an 8 GB machine at all. (b) The 38.8 ms median / 122.4 ms p95 on the Ollama page is Cloudflare's own Decision Index measurement on GPU, not a CPU number. (c) Clef is single-pass non-autoregressive (usage.output_tokens is 0–3), so local latency is almost entirely prompt evaluation, which scales with input tokens; the systemone API reference says shared context is counted again when the model scores questions separately, so the number of questions per call is the biggest lever. (d) The engine today re-sends every open bullet, every covered and upcoming point, every on-screen fact and a 60-word rubric per question whenever the 900-char window string differs at all, with a hard 2500 ms timeout (engine.ts timeoutMs) that a CPU-bound 9B call will blow every time, leaving local mode with errors instead of decisions. (e) On-device STT commits whole 4 s windows with no partials (whisper.ts WINDOW_S = 4) and pads each to 30 s (chunk_length_s: 30), so the STT lag floor is 4 s plus inference regardless of model. Estimates below are labeled; nothing was benchmarked on the target hardware in this task.): refuted · serious
- #19 5. Replace the generative judge with a 0.3B multilingual NLI pair-classifier on machines that cannot run a 9B model (Ask the model less: restructure Filow's decision loop (packages/core/src/engine.ts, packages/core/src/clef.ts, apps/web/lib/decide/clef.ts, packages/stt/src/whisper*.ts) so that on a 4–8 core laptop without a dedicated GPU the 9B Clef Flash call is rare, small and never on the critical path, and so that STT feeds partial text early. Verified facts that frame everything (2026-11-02): (a) ollama.com/library/clef-flash/tags lists only clef-flash:latest / :9b (11–12 GB), :9b-q8_0 (11 GB), :9b-mlx-bf16 (19 GB, MLX) and :9b-mxfp8 (12 GB, MLX). There is NO q4_K_M / q3 tag, so the catalog entry in apps/web/lib/localModels.ts (downloadGb: 6, ramGb: 16) understates the download by ~2x and a 9B q8 model (~10 GB of weights) does not fit an 8 GB machine at all. (b) The 38.8 ms median / 122.4 ms p95 on the Ollama page is Cloudflare's own Decision Index measurement on GPU, not a CPU number. (c) Clef is single-pass non-autoregressive (usage.output_tokens is 0–3), so local latency is almost entirely prompt evaluation, which scales with input tokens; the systemone API reference says shared context is counted again when the model scores questions separately, so the number of questions per call is the biggest lever. (d) The engine today re-sends every open bullet, every covered and upcoming point, every on-screen fact and a 60-word rubric per question whenever the 900-char window string differs at all, with a hard 2500 ms timeout (engine.ts timeoutMs) that a CPU-bound 9B call will blow every time, leaving local mode with errors instead of decisions. (e) On-device STT commits whole 4 s windows with no partials (whisper.ts WINDOW_S = 4) and pads each to 30 s (chunk_length_s: 30), so the STT lag floor is 4 s plus inference regardless of model. Estimates below are labeled; nothing was benchmarked on the target hardware in this task.): refuted · serious

## Judges

[
  {
    "scores": [
      {
        "index": 0,
        "latency": 4,
        "accuracy": 3,
        "effort": 9,
        "total": 4.65,
        "note": "Drop-in model swap, but the DA shows the trunk is a bidirectional encoder with no prefix cache and the only public CPU datapoint (208 ms for 157 tokens, 3 questions) scales to ~1 s for Filow's 600-1000 token request; Decision Index language sub-score 12.9. Italian analysis built on the wrong model card. Cheap to try, not a plan."
      },
      {
        "index": 1,
        "latency": 3,
        "accuracy": 3,
        "effort": 9,
        "total": 4.2,
        "note": "Autoregressive Qwen fine-tune that re-scores every question with the full prompt (N x prefill), ~2K context ceiling, 63.5% accuracy on in-distribution English sets, zero Italian training. Refuted on its own arithmetic."
      },
      {
        "index": 2,
        "latency": 2,
        "accuracy": 6,
        "effort": 8,
        "total": 4.6,
        "note": "Only small decision model that names Italian and the best under-10B Decision Index, but 1-3 s per call on CPU by its own estimate and the iGPU path depends on opt-in, flaky Ollama Vulkan. Usable only as a 16 GB + working-iGPU middle rung after measurement."
      },
      {
        "index": 3,
        "latency": 1,
        "accuracy": 3,
        "effort": 6,
        "total": 2.7,
        "note": "Instruct models with grammar-constrained JSON: measured CPU decode (18-36 tok/s) plus 75-100 output tokens puts a tick at 4-8 s, beyond the 2500 ms engine timeout; num_predict bug truncates JSON. Gemma 1B unusable for Italian."
      },
      {
        "index": 4,
        "latency": 3,
        "accuracy": 2,
        "effort": 6,
        "total": 3.25,
        "note": "laya is English-only, bf16-only on Windows (no q8 build), 65% zero-shot on held-out families with ECE 0.2; the Mac-only MLX deciders are irrelevant to a Windows-first target. Fastest on paper, unmeasured on CPU."
      },
      {
        "index": 5,
        "latency": 9,
        "accuracy": 2.5,
        "effort": 5,
        "total": 5.93,
        "note": "Static embeddings genuinely run in milliseconds anywhere, which is why latency scores high, but bag-of-words similarity cannot encode announcement/negation/single-keyword rules; thresholds are guesses with no labelled set; transformers.js loading path is untested on 4.x; stack placement (renderer vs /api/decide route) is confused. Valuable only as a pre-filter."
      },
      {
        "index": 6,
        "latency": 6,
        "accuracy": 4,
        "effort": 5,
        "total": 5.1,
        "note": "MiniLM-L12 / e5-small int8 are real, Italian-trained, likely 50-150 ms per window on WASM (unmeasured) and plausibly fit the 300 ms tick if one window per tick. Same semantic weakness (announcement vs coverage) and invented thresholds; no plan for fact_i gap detection. Best embedding-tier candidate for a gate."
      },
      {
        "index": 7,
        "latency": 4,
        "accuracy": 5,
        "effort": 3,
        "total": 4.15,
        "note": "Right instinct (a cross-encoder reads both texts jointly) but the WASM default model has no Italian NLI supervision and the Italian-capable mDeBERTa is 400-900 ms per pair on CPU by the proposal's own estimate; int8-on-WebGPU does not exist; needs an optimum export. Cascade timing is a sum of guesses."
      },
      {
        "index": 8,
        "latency": 3,
        "accuracy": 4,
        "effort": 3,
        "total": 3.35,
        "note": "Self-disqualified: WebGPU-only, 300-700 ms per window on CPU, contends with the Whisper worker that already takes WebGPU, Gemma terms in the installer. Not for the low-spec target."
      },
      {
        "index": 9,
        "latency": 8,
        "accuracy": 3,
        "effort": 2,
        "total": 5.05,
        "note": "A research programme: needs a tick logger, correction UI, thousands of labelled ticks per language, a Python training pipeline, and still learns lexical overlap plus position/time priors that drift. Latency is the one thing it does not need to prove."
      },
      {
        "index": 10,
        "latency": 7,
        "accuracy": 9,
        "effort": 4,
        "total": 7.1,
        "note": "The only proposal the devil's advocate could not refute. Natively streaming cache-aware RNN-T, int8 ONNX exported by sherpa-onnx, Italian first-tier with published FLEURS WER 4.41% at 560 ms, English 7.99%, OpenMDW license, sherpa-onnx-node 2.0.1 on npm, and a shipping Electron product (OpenWhispr) proving the stack on Windows x86. Fixes the real STT floor (4 s window + 30 s padded encoder) rather than tuning around it. Weaknesses are honest: no x86 laptop RTF or RSS measured, 650 MB download, native addon or sidecar packaging on three platforms, partial-hypothesis revisions need a debounce in the decision loop."
      },
      {
        "index": 11,
        "latency": 5,
        "accuracy": 8,
        "effort": 4,
        "total": 5.85,
        "note": "Best Italian WER (FLEURS 3.0%, but MLS 10%) and the same addon cost as #10, but not streaming: pause-gated text, short-segment RTF 0.325 in sherpa's own numbers, forced-cut overlap/dedupe unimplemented, issue #2918 misattributed to a maintainer. A fine 'accurate' option once #10's plumbing exists, not the primary."
      },
      {
        "index": 12,
        "latency": 3,
        "accuracy": 3,
        "effort": 8,
        "total": 4,
        "note": "Honest stop-gap that concedes it misses the target; Italian WER for base/tiny is 31-42% per the Whisper paper, the dtype advice contradicts its own sources, and shorter hops multiply the fixed 30 s encoder cost on WASM. Keep only the catalog size fix and partial emission."
      },
      {
        "index": 13,
        "latency": 7,
        "accuracy": 4,
        "effort": 4,
        "total": 5.35,
        "note": "Same encoder size and cost as the multilingual #10, English-only alphabet, no side-by-side WER, gated on the wrong preference (UI language). Adds a 630 MB download for no measurable gain; drop in favour of #10's chunk-size knob."
      },
      {
        "index": 14,
        "latency": 0,
        "accuracy": 9,
        "effort": 1,
        "total": 3.35,
        "note": "Correct rejection note (Voxtral 4B: 3 tok/s on an M3 Max CPU against the 12.5 tok/s real-time need, 8.9 GB BF16), with factual errors in runtime list and encoder size that the DA corrected. Scored low because it is not a proposal for the target, which is the point."
      },
      {
        "index": 15,
        "latency": 3,
        "accuracy": 5,
        "effort": 6,
        "total": 4.3,
        "note": "Embedding gate is sound, but the second stage is still 9B Clef on a CPU that cannot host it (q8 only, 11 GB) and still blows the 2500 ms timeout; the HIGH-band keyword-overlap rule kills the cross-lingual case it claims as a strength; STT 4 s commits leave the tick-level gain invisible."
      },
      {
        "index": 16,
        "latency": 2,
        "accuracy": 6,
        "effort": 8,
        "total": 4.6,
        "note": "Correct hygiene (catalog fix: clef-flash is 11 GB not 6; keep_alive -1; warm-up; adaptive tick) but the headline token saving is unproven given systemone re-counts shared context per question, and it admits a 12 s call becomes 3-4 s. Sentence gating stacks delay. Merge the hygiene, not the strategy."
      },
      {
        "index": 17,
        "latency": 1,
        "accuracy": 5,
        "effort": 9,
        "total": 4,
        "note": "A catalog bug fix dressed as a low-spec strategy: nimble q4 is still 9B, seconds per call on CPU, would time out every tick, does not really fit 8 GB next to Electron + Whisper, and has no Italian evidence. Keep only the clef-flash size correction."
      },
      {
        "index": 18,
        "latency": 2,
        "accuracy": 3,
        "effort": 7,
        "total": 3.35,
        "note": "Central mechanism is false: in transformers.js 4.3.2 WhisperFeatureExtractor pads every call to 30 s regardless of chunk_length_s, so a 1.5 s hop runs the fixed-cost encoder 2.7x more often on the machines it is meant to help. Keep the int8 size fix and VAD-cut commits only."
      },
      {
        "index": 19,
        "latency": 3,
        "accuracy": 5,
        "effort": 5,
        "total": 4.1,
        "note": "int8 ONNX exists (onnx-community / Xenova mirrors, ~320-340 MB) and Italian is in the 26 fine-tuning languages, but DeBERTa-v3 on ORT WASM with no VNNI is likely several hundred ms per pair, five bullets exceed the tick, and pairwise scoring drops the cross-bullet context that suppresses false positives. Plausible as an ambiguous-band verifier after a benchmark, not as the judge."
      }
    ],
    "pick": 10,
    "rationale": "Judging real-time on 8-16 GB, no-dGPU, 4-8 core laptops above all: the STT side is where the user-visible lag actually lives (4 s window plus a 30 s-padded Whisper encoder on WASM, per the repo), and proposal #10 (Nemotron 3.5 ASR Streaming 0.6B int8 via sherpa-onnx) is the only entry that (a) attacks that floor with a natively streaming architecture whose cost scales with audio length, (b) has first-tier Italian and English with published WER at every chunk size, (c) ships as a verified int8 ONNX export with a current npm addon and a real Electron product already running it on Windows x86, and (d) survived the devil's advocate: the only open items are a measurement on the target laptop and a RAM number, which the fix list (gauntlet run at 2 and 4 threads, sidecar-vs-addon decision, debounce on partial revisions) covers. Every decision-model proposal was refuted on the same point: either the model is a 9B that cannot run on this hardware (#15, #16, #17), or a sub-1B model whose CPU latency is unmeasured and whose accuracy for 'started, not announced, prefer no' is below usable (#0, #1, #4, #3), or a similarity method that cannot express the rubric (#5, #6, #8, #9). None scores above ~5.9, and the highest of those (#5) is high only because static embeddings are trivially fast, not because they decide correctly.\n\nCombinations that work, in order of confidence: (1) STT: #10 as primary (560 ms chunk default, 80 ms 'fastest'), with #11 Parakeet as an optional 'accurate' model sharing the same addon/download manager, and #12/#18's cheap parts (int8 size fix in whisperModels.ts, emit real partials, VAD-cut commits) kept for the zero-packaging Whisper fallback. (2) Decision, low-spec rung: a cascade built from the embedding gate of #6 (Xenova/paraphrase-multilingual-MiniLM-L12-v2 int8, one window per tick, cross-lingual cosine without the keyword-overlap requirement from #15) feeding an ambiguous-band verifier from #19 (mDeBERTa-v3 int8 NLI, capped at 1-2 pairs per tick, cross-bullet normalisation, no instant sureThreshold flip), with #2 d1:3b as the 16 GB + iGPU rung and Clef Flash kept only where a dedicated GPU is detected; #0 d1-omni is worth one harness run on the 8 GB rung because it costs nothing to try. (3) Architecture hygiene from #16 and #17 merged immediately regardless: clef-flash catalog corrected to 11 GB / 16 GB tight, keep_alive -1, warm-up call, adaptive tick, non-blocking in-flight guard with results tagged to the transcript they judged. (4) The gauntlet itself, demanded by nearly every DA: a labelled IT/EN set (200+ windows with announced-only, shared-keyword and sibling-bullet negatives) and a replay script reporting p50/p95 per stage on a real 4-core/8 GB Windows laptop with STT running concurrently; no decision-model rung should be catalogued until it passes p95 <= 300 ms and a false-yes rate near zero on that set."
  },
  {
    "scores": [
      {
        "index": 0,
        "latency": 4,
        "accuracy": 3,
        "effort": 9,
        "total": 4.65,
        "note": "d1-omni 600M: the only public CPU measurement (208 ms for 157 tokens, 3 questions) scales to ~1 s for Filow's 600-1000 token request with no prefix cache (bidirectional encoder). Decision Index Language sub-score 12.9; dev.to test shows 0.9 confidence on garbage input. Italian lineage misread (trunk is LFM2.5-Encoder, Italian listed, but decision head untested). Cheapest thing to try, but as a judge it will fire false 'started' on keyword overlap."
      },
      {
        "index": 1,
        "latency": 3,
        "accuracy": 3,
        "effort": 9,
        "total": 4.2,
        "note": "tev1 0.8B: autoregressive Qwen fine-tune, scores every question with the full prompt (N x prefill), 2K working context, 63.5% on in-distribution English sets, all training data English. Lowest accuracy of any decision model on Ollama; DA's arithmetic (seconds per tick on 4 cores) stands unanswered."
      },
      {
        "index": 2,
        "latency": 2,
        "accuracy": 7,
        "effort": 8,
        "total": 4.95,
        "note": "d1 3B: the best-accuracy small decision model (DI 48.57, Italian explicitly listed, BoolQ 86.7) and a one-line swap, but the proposal itself estimates 1-3 s on CPU, and the iGPU path depends on opt-in Ollama Vulkan env vars reported broken on Intel Iris. Right model for the 16 GB + working iGPU rung, not for the 8 GB CPU user."
      },
      {
        "index": 3,
        "latency": 1,
        "accuracy": 3,
        "effort": 6,
        "total": 2.7,
        "note": "Instruct JSON fallback: 4-8 s per call per the only independent CPU numbers, exceeds the engine's 2500 ms timeout on every tick, num_predict = 8*bullets truncates the JSON, gemma3 Italian is near floor, confidence is an invented number. Not a candidate."
      },
      {
        "index": 4,
        "latency": 4,
        "accuracy": 2,
        "effort": 7,
        "total": 3.9,
        "note": "laya 421M: English only (the multilingual tag is an undocumented sibling with no decision accuracy), bf16-only non-MLX tag so CPU matmul falls to slow paths, 65.1% zero-shot on held-out task families with ECE 0.207, readme itself warns noul 'looks stuck on no'. strands-decider/kev are MLX-only and irrelevant to Windows first."
      },
      {
        "index": 5,
        "latency": 10,
        "accuracy": 2,
        "effort": 5,
        "total": 6.2,
        "note": "Static embeddings: genuinely sub-5 ms and the only proposal that is certain to hit the latency target, but bag-of-words cannot encode 'announced is not started', negation, or sibling-bullet disambiguation; thresholds are guesses with no Filow logs; hysteresis makes a false yes permanent. High total is latency-driven; as the sole judge it fails this council's criterion (false 'started' is worse than late). Valuable only as a stage-1 gate."
      },
      {
        "index": 6,
        "latency": 7,
        "accuracy": 3,
        "effort": 5,
        "total": 5.2,
        "note": "MiniLM-L12 / e5-small int8: plausible 60-300 ms per tick but unmeasured, XLM-R embedding table not quantized, competes with Whisper on the same cores, same bi-encoder blind spot on announcements and near-duplicate bullets; invented thresholds; no plan for fact_i gap detection. Better feature extractor than #5, same category of judge."
      },
      {
        "index": 7,
        "latency": 6,
        "accuracy": 4,
        "effort": 4,
        "total": 4.9,
        "note": "Embedding gate + NLI cross-encoder: the only HF-lens design that attacks the announcement/keyword rules with a model that reads both texts jointly, but the WASM default (MiniLMv2-L6) was trained on XNLI without Italian (avg 0.713), and the Italian-capable mDeBERTa is too slow on CPU and cannot run int8 on WebGPU. Right architecture, wrong default model; latency of the whole cascade is a sum of guesses."
      },
      {
        "index": 8,
        "latency": 3,
        "accuracy": 3,
        "effort": 3,
        "total": 3,
        "note": "EmbeddingGemma: self-disqualified for CPU, contends with Whisper fp32 on the same iGPU, Gemma terms need an installer page, MTEB score says nothing about false-yes rate. Optional tier with no proven gain."
      },
      {
        "index": 9,
        "latency": 8,
        "accuracy": 2,
        "effort": 2,
        "total": 4.7,
        "note": "Trained classifier head: no logger, no labels, no held-out decks exist; labels would come from the engine users say is unusable locally; position/time-elapsed features teach the model to advance on silence (exactly the forbidden behaviour). A research programme, not a proposal."
      },
      {
        "index": 10,
        "latency": 8,
        "accuracy": 9,
        "effort": 5,
        "total": 7.75,
        "note": "Nemotron 3.5 ASR Streaming 0.6B int8 via sherpa-onnx: the only proposal the devil's advocate could not refute. Model, tags, sizes, Italian first-tier WER 4.41% at 560 ms, native cache-aware streaming (no 4 s window, no 30 s padding), measured RTF 0.16 on one thread (Mac), a shipping Electron product using the same stack. Gaps are honest: no x86 laptop RTF, no RSS figure, 320 ms chunk does not exist, partial-hypothesis revisions need a debounce in the decision loop. Fixes the dominant source of the user's complaint (STT lag) with first-tier Italian accuracy."
      },
      {
        "index": 11,
        "latency": 5,
        "accuracy": 8,
        "effort": 4,
        "total": 5.85,
        "note": "Parakeet TDT 0.6B v3: best Italian WER on FLEURS (3.00%) but MLS 10.08% is the honest long-form number; not streaming, short-segment RTF 0.325 means 2-3 s end-of-phrase lag on a laptop, forced-cut dedupe is unimplemented and will feed split Italian words to the judge. Same addon cost as #10 with worse live behaviour; keep only as an 'accurate' option after #10 ships."
      },
      {
        "index": 12,
        "latency": 3,
        "accuracy": 2,
        "effort": 8,
        "total": 3.65,
        "note": "Whisper tiny/base fixes: concedes it cannot reach <=1 s on CPU; Italian WER is 31% (base) / 42% (tiny) per the Whisper paper, not 15-25%; the q8-on-WebGPU dtype plan is contradicted by its own sources; shorter hop multiplies the fixed 30 s encoder cost. Only the catalog-size fix survives."
      },
      {
        "index": 13,
        "latency": 7,
        "accuracy": 1,
        "effort": 6,
        "total": 4.7,
        "note": "Nemotron EN-only: identical compute to the multilingual export, so no gain on weak laptops; English-only alphabet mangles the Italian/English mixing common in Italian talks; gated on prefs:lang which is the UI language. Correctly self-labelled 'probably not worth shipping'."
      },
      {
        "index": 14,
        "latency": 1,
        "accuracy": 9,
        "effort": 1,
        "total": 3.8,
        "note": "Voxtral note: a rejection, not a proposal. Verdict is right (measured 3 tok/s CPU vs 12.5 needed, Metal-only int4), but the runtime description and encoder size need the DA's corrections. Scored as a non-option for low-spec."
      },
      {
        "index": 15,
        "latency": 4,
        "accuracy": 6,
        "effort": 5,
        "total": 4.9,
        "note": "Embedding gate + Clef for ambiguous: good shape, but the second stage cannot run on the target (Clef q8 is 11 GB, seconds on CPU, blows the 2500 ms timeout), the HIGH-band keyword-overlap rule never fires cross-lingually, and the 4 s STT commit remains the floor. Becomes strong only when the second stage is replaced (see combination)."
      },
      {
        "index": 16,
        "latency": 3,
        "accuracy": 7,
        "effort": 7,
        "total": 5.2,
        "note": "Prompt diet / keep_alive / adaptive loop: keeps the judge users already trust (accuracy preserved), but '12 s becomes 3-4 s' is a 10x miss and the rubric-in-state token saving is unproven given the API's own 'shared context counted again' note; sentence gating adds delay. The catalog fix, keep_alive -1, warm-up call, non-blocking in-flight guard and question-count cap are unconditionally worth merging."
      },
      {
        "index": 17,
        "latency": 2,
        "accuracy": 5,
        "effort": 8,
        "total": 4.25,
        "note": "Nimble 9B q4: admits it is not a path to 300 ms; on a 4-core laptop it times out every tick; 'fits 8 GB' is wishful next to Electron and Whisper; no Italian benchmark and 75.7% vs Clef unknown on this task. Keep only the clef-flash catalog correction."
      },
      {
        "index": 18,
        "latency": 2,
        "accuracy": 3,
        "effort": 7,
        "total": 3.35,
        "note": "Whisper short-hop/partials: the central mechanism does not exist in transformers.js 4.3.2 (feature extractor pads to 30 s regardless of chunk_length_s), so the 1.5 s hop runs the fixed encoder 2.7x more often on exactly the WASM machines in scope; 3 s overlapping windows are a hallucination regime that feeds false 'yes' to the judge."
      },
      {
        "index": 19,
        "latency": 4,
        "accuracy": 5,
        "effort": 6,
        "total": 4.75,
        "note": "mDeBERTa NLI judge: int8 ONNX exists (onnx-community/Xenova, ~320-340 MB) and Italian was in the 26 fine-tuning languages, so it is a real on-device candidate, but latency on WASM is unmeasured and likely 1-2 s per tick for 5 bullets, pairwise scoring discards the covered/upcoming context that suppresses sibling-bullet false positives, and NLI lexical-overlap bias means 'I will talk about pricing' entails 'the speaker is making this point'. Needs cross-bullet normalisation and a benchmark before it can be the ambiguous-band judge."
      }
    ],
    "pick": 10,
    "rationale": "Judging accuracy and robustness in a live Italian/English talk, where a false 'started' is worse than a late one, proposal #10 (Nemotron 3.5 ASR Streaming 0.6B int8 through sherpa-onnx) is the single best proposal: it is the only one whose claims survived the devil's advocate, its Italian quality is first-tier and published (FLEURS it 4.41% WER at 560 ms, auto-detect 4.47%), it is natively streaming so it removes the 4 s window + 30 s padded decode that the architecture lens correctly identifies as the real latency floor, and a shipping Electron product proves the packaging path. Its remaining gaps (no x86 laptop RTF, no RSS number, debounce for revised partials, drop the non-existent 320 ms chunk) are measurement and hygiene, not refuted claims. Every decision-side proposal was refuted on its central latency or accuracy claim: the Ollama decision models either cannot meet 300 ms on CPU (d1 3B, tev1, nimble, Clef) or are too weak/English-only to be trusted as a judge (d1-omni, laya, tev1); the embedding proposals are fast but structurally cannot honour 'announced is not started' or 'a shared keyword is not enough' and would make false positives permanent under the current hysteresis.\n\nWhat combines well: (1) STT: #10 as the primary streaming backend, with #12's catalog-size fix and Whisper kept only as the no-packaging fallback; #11 Parakeet as an optional 'accurate' preset later, sharing the same addon. (2) Decision on low-spec CPU: the cascade shape of #7/#15 with #5 (static multilingual embeddings) or #6 (MiniLM/e5 int8) as a strict stage-1 gate that only selects 1-2 candidate bullets per tick, and #19's mDeBERTa int8 NLI (or a verified Italian-trained equivalent) as the verifier with cross-bullet normalisation and no instant sureThreshold flip; Clef Flash stays the verifier only where a GPU is detected. (3) Rungs: #2 d1:3b on 16 GB machines with a working iGPU, clef-flash on dGPU, with #16/#17's catalog corrections (clef-flash downloadGb 11, ramGb 16 tight, no q4 tag) and #16's hygiene (keep_alive -1, warm-up call, in-flight guard so a slow call never blocks the tick, question-count cap, skip rather than error on timeout). (4) Before any of the decision-side choices ships, the gauntlet harness must exist: >=200 labelled Italian and >=200 English transcript windows with announced-only, shared-keyword and sibling-bullet hard negatives, reporting false-yes rate at the operating threshold per model on a 4-core/8 GB Windows laptop with the STT worker running concurrently."
  },
  {
    "scores": [
      {
        "index": 0,
        "latency": 5,
        "accuracy": 3,
        "effort": 9,
        "total": 5.1,
        "note": "Cheapest thing to try (CLEF_MODEL env swap, 0.85 GB), but the only public CPU datapoint (208 ms for 157 tokens, bidirectional encoder, no prefix cache) scales to ~1 s for Filow's real request, and Decision Index Language 12.9 is too weak to be the sole judge. Keep as a gauntlet candidate for the 8 GB rung, not a fix."
      },
      {
        "index": 1,
        "latency": 3,
        "accuracy": 3,
        "effort": 9,
        "total": 4.2,
        "note": "Same one-line swap, but per-question full-prompt scoring makes cost scale with bullet count and 63.5% is the lowest measured accuracy in the category; English-only training. Refuted claim (zero output tokens) was wrong and the fix list is a full engine change."
      },
      {
        "index": 2,
        "latency": 2,
        "accuracy": 6,
        "effort": 8,
        "total": 4.6,
        "note": "Only small decision model that names Italian, but 1-3 s on CPU and an iGPU Vulkan path that is opt-in and reported broken on Intel; 3.7 GB with a dead vision encoder. A plausible 16 GB+iGPU middle rung after measurement, not a low-spec answer."
      },
      {
        "index": 3,
        "latency": 1,
        "accuracy": 3,
        "effort": 6,
        "total": 2.7,
        "note": "Slowest path (autoregressive JSON decode, 4-8 s per call per the one independent CPU measurement), needs a new provider plus parser, and the sketch ships a num_predict truncation bug. Not worth the scope."
      },
      {
        "index": 4,
        "latency": 4,
        "accuracy": 2,
        "effort": 7,
        "total": 3.9,
        "note": "English-only, bf16-only tag (no q8 for CPU), Ollama 0.40 gate, 512-token budget forces a state/rubric rewrite; 65% zero-shot on held-out families. The macOS MLX rungs are irrelevant to Windows-first."
      },
      {
        "index": 5,
        "latency": 10,
        "accuracy": 2,
        "effort": 4,
        "total": 6,
        "note": "Latency is essentially free, but bag-of-words embeddings cannot honour the announcement/keyword/covered rules, the route-vs-renderer stack mismatch is real, and transformers.js 4.x loading is unverified. Good only as a pre-filter gate feeding something that reads both texts."
      },
      {
        "index": 6,
        "latency": 7,
        "accuracy": 4,
        "effort": 5,
        "total": 5.55,
        "note": "Reuses the existing whisper.worker loader pattern, 118 MB, Italian in training data; still a bi-encoder with invented thresholds, unmeasured on WASM, and silent on the fact_i gap detector. Best of the embedding tier as a stage-1 filter."
      },
      {
        "index": 7,
        "latency": 5,
        "accuracy": 5,
        "effort": 3,
        "total": 4.6,
        "note": "Right idea (joint reading of transcript+bullet), but the WASM default model never saw Italian, the Italian-capable mDeBERTa is the slow one, needs an optimum export, a second worker and a gate that does not exist yet. Too many moving parts for this week."
      },
      {
        "index": 8,
        "latency": 3,
        "accuracy": 4,
        "effort": 3,
        "total": 3.35,
        "note": "Self-disqualifies on CPU, contends with Whisper on the same iGPU (whisper.worker.ts already picks WebGPU fp32), and adds Gemma terms to the installer. Optional tier with no proven upside."
      },
      {
        "index": 9,
        "latency": 9,
        "accuracy": 2,
        "effort": 1,
        "total": 4.95,
        "note": "A research programme: tick logger, consent UI, Python training pipeline, three engine ids, and no labelled data today. Position/time features would make it drift. The logger alone is worth building; the rest is out of scope."
      },
      {
        "index": 10,
        "latency": 8,
        "accuracy": 9,
        "effort": 3,
        "total": 7.35,
        "note": "The only proposal the devil's advocate could not refute: model, int8 export, Italian first-tier WER (4.4%), sherpa-onnx-node 2.0.1 and a shipping Electron product (OpenWhispr) all verified; true streaming removes the 4 s window floor that dominates the user-visible lag. Costs a native addon or sidecar, asarUnpack, ~650 MB download and a RAM measurement; the sidecar variant matches how main.js already spawns servers."
      },
      {
        "index": 11,
        "latency": 5,
        "accuracy": 8,
        "effort": 3,
        "total": 5.65,
        "note": "Best Italian WER but not streaming: pause-gated text plus forced-cut dedupe that nobody has prototyped, short-segment RTF 0.325 on unknown hardware, same packaging cost as #10 without the streaming payoff. Only worth it as a second model sharing #10's addon."
      },
      {
        "index": 12,
        "latency": 3,
        "accuracy": 3,
        "effort": 8,
        "total": 4,
        "note": "Small, zero-packaging change, but its core lever (chunk_length_s avoiding 30 s padding) does not exist in transformers.js 4.3.2 and shorter hops multiply the fixed encoder cost on WASM; whisper-base Italian WER is ~31%. Keep only the catalog size fix and add whisper-tiny as an option."
      },
      {
        "index": 13,
        "latency": 7,
        "accuracy": 3,
        "effort": 4,
        "total": 5,
        "note": "Same 600M encoder as the multilingual model, so no latency or RAM win; English-only in an Italian-first product; a second 630 MB download. Drop; expose chunk size on #10 instead."
      },
      {
        "index": 14,
        "latency": 0,
        "accuracy": 8,
        "effort": 0,
        "total": 2.8,
        "note": "Not a proposal, a correctly reasoned rejection; the DA's corrections (voxtral.c measures ~3 tok/s CPU vs 12.5 needed) should be folded into the note. No action."
      },
      {
        "index": 15,
        "latency": 4,
        "accuracy": 5,
        "effort": 5,
        "total": 4.55,
        "note": "Keeps 9B Clef as stage 2 on hardware where it cannot load (8 GB) or finishes after the 2500 ms timeout (16 GB CPU), and the HIGH-band keyword rule never fires cross-lingually. The embedding gate idea survives only when paired with a stage 2 that fits."
      },
      {
        "index": 16,
        "latency": 3,
        "accuracy": 6,
        "effort": 9,
        "total": 5.25,
        "note": "Pure hygiene that should ship regardless: catalog fix (clef-flash 11 GB, no q4 tag), keep_alive -1, warm-up, adaptive tick, timeout surfaced as 'slow' not error. It admits 3-4 s per call, so it is not the latency fix; rubric-in-state token saving is unproven."
      },
      {
        "index": 17,
        "latency": 2,
        "accuracy": 4,
        "effort": 9,
        "total": 4.1,
        "note": "The catalog correction is right and cheap; recommending a 9B q4 on <14 GB laptops would ship timeouts on every tick and swap on 8 GB. Merge the fix, drop the nimble recommendation until measured."
      },
      {
        "index": 18,
        "latency": 3,
        "accuracy": 4,
        "effort": 7,
        "total": 4.15,
        "note": "Same false premise as #12 (padding is fixed in transformers.js) plus 2.7x more encoder calls on the machines it targets; partials would re-trigger Clef calls without a gate. Keep the per-device dtype map and catalog sizes only."
      },
      {
        "index": 19,
        "latency": 4,
        "accuracy": 6,
        "effort": 5,
        "total": 4.9,
        "note": "int8 ONNX exists (onnx-community/Xenova), Italian in fine-tuning, fits RAM; but DeBERTa on ORT-WASM without VNNI is likely 1-2 s for 5 pairs and pairwise scoring loses the cross-bullet context. Candidate for the ambiguous-band judge once a benchmark exists."
      }
    ],
    "pick": 10,
    "rationale": "Goldfish verdict: the user's complaint is 'slow locally', and every lens agrees the dominant, structural part of that lag is STT (4 s window + 30 s-padded Whisper decode), not the decision model. Proposal #10 is the only one whose claims survived the devil's advocate: real model, real int8 export with Italian first-tier WER, real npm addon, a shipping Electron app using the same stack. It costs packaging work (native addon or, lower risk, a sherpa-onnx sidecar over 127.0.0.1 the way main.js already spawns servers; asarUnpack; 650 MB download UI), which is why effort is 3, but it removes the 4 s floor outright instead of shaving an estimate. Nothing in the decision column meets 300 ms on CPU with evidence; the cheap decision-model swaps (#0, #1, #2) are all one-line tries and should go into the gauntlet harness, not the catalog, until measured.\n\nWhat to ship this week with no new runtime: the hygiene from #16/#17 (catalog truth: clef-flash 11 GB / no q4, ramGb 16 tight; keep_alive -1; warm-up call; adaptive tick; local timeout shown as 'slow' instead of an error), plus whisper catalog sizes from #12/#18 and a whisper-tiny entry. That is a day of work and stops local mode from erroring.\n\nCombination that fits the brief: STT = #10 (Nemotron 3.5 streaming, 560 ms chunk default, sidecar); decision for GPU machines = Clef Flash unchanged; decision for CPU/8-16 GB = a two-stage path where #6 (multilingual-e5-small / paraphrase-MiniLM int8, reusing the whisper.worker loader) gates bullets to 0-2 candidates and a measured second stage reads both texts: #19 (mDeBERTa int8) or #0 (d1-omni via Ollama) depending on gauntlet numbers; #5 is a cheaper stand-in for #6 if WASM time is a problem. Prerequisite for all of it: the gauntlet harness (a replay of 10-20 labelled IT/EN takes reporting per-tick ms and false-yes rate on a 4-core no-GPU laptop), which #9's logger idea provides the data for. Reject outright: #3, #4, #8, #13, #14 (note only), and the nimble recommendation half of #17."
  }
]
