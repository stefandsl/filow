# Gauntlet: real-time local mode on low-spec hardware

Status: v2 brief, after an EGM review round (seven reviewers, 2026-11-02). Owner: Stefan Butnaru.
A single-pass run of v1 (research, devil's advocate, council, synthesis) is the input to lap 1.

## Mission

Find and validate a local stack (speech-to-text + per-point decision + architecture changes) that
makes Filow's offline mode usable on low-spec hardware, and leave behind a harness that proves it.

Definitions. A script is a list of short points grouped in sections. Every 500 ms the engine takes
the last 900 chars of transcript and the still-open points of the current section and asks the
decision model, per point, "has the speaker started this point?"; a per-point confidence ≥ 0.70 on
two consecutive calls (or ≥ 0.90 once) flips the point to started and the prompter advances. A wrong
"started" scrolls the speaker past text they have not said, so a false start is worse than a late
one. A candidate is one model or technique; a stack is one STT candidate + one decision candidate +
the architecture changes it needs. Measured = run by the harness on M1 or M2; everything else is
estimated, even when a vendor measured it elsewhere.

Targets (p50/p95 on M2 unless stated):

- T1 decision call: `tick()` to `apply()` for the reference request (900-char Italian transcript,
  6 open, 3 covered, 4 upcoming points, model warm, 5 warm-up calls discarded): p95 ≤ 300 ms, never
  above the engine's 2500 ms timeout.
- T2 STT lag: end of a spoken sentence to committed text in `engine.feed()`: p50 ≤ 1.0 s. Today it
  is ≥ 4 s because of `WINDOW_S = 4` in `packages/stt/src/whisper.ts`; windowing is in scope.
- T3 mic-to-tick: ground-truth point start to `status === "started"` on screen, including the
  500 ms tick and the confirm rule: p50 ≤ 2.0 s, p95 ≤ 3.5 s. `confirmCalls` and `WINDOW_S` are in
  scope for change and dominate T3.
- T4 accuracy on the test set: false-start rate ≤ 3 % of points, miss rate ≤ 10 %, Italian and
  English (language known per take; one code-switching talk).

All on device; cloud mode is out of scope. T1–T4 must pass on M2 for the 8 GB tier; the 16 GB tier
may use a larger model; M3 (discrete GPU) keeps Clef Flash.

Today (baseline; every figure is estimated until Round 0 runs): decisions go to Clef Flash
(`clef-flash`, ~6 GB, catalogue requires 16 GB RAM) via Ollama `POST /v1/systemone`, one yes/no
question per open point, a probability per answer (`packages/core/src/clef.ts`,
`apps/web/lib/decide/clef.ts`); the cloud path uses the JSON prompt in `packages/core/src/prompt.ts`
and `parseDecisions`, which any Ollama chat model could reuse through `/api/chat format: "json"`.
The vendor quotes ~40 ms/call on a dedicated GPU; no CPU/iGPU number exists in the repo. Speech is
Whisper base (default) or small via transformers.js (q8 WASM / fp32 WebGPU, 4 s windows, no
partials, no language hint), the same worker in the web app, Electron and the PowerPoint pane.
Below 16 GB without a discrete GPU the app currently offers no local decision model at all.

## Machines and environment

- M1: the owner's laptop, Intel Core Ultra 7 155H, 32 GB (test with a 16 GB cap where possible),
  Arc integrated GPU, Windows 11, Ollama ≥ 0.35.1, WebGPU on/off in Electron 33.
- M2: an 8 GB, 4-core Windows 11 machine with no discrete GPU (to be named; a VM with 8 GB is
  acceptable for memory, not for latency).
- M3 (ceiling): the owner's desktop with a dedicated GPU (RTX 3070, 8 GB VRAM); keeps Clef Flash.
- Agents have web access and a shell on M1; model pull budget 20 GB. Report whether the Electron
  page is cross-origin isolated and the WASM thread count actually used (no COOP/COEP headers were
  found, so WASM may be single-threaded: a 2–4× factor on CPU by itself).

## Constraints

- Memory: on M2, STT + decision models resident ≤ 8 GB minus Filow's idle RSS (measured in Round 0)
  minus 1.5 GB OS headroom; on M1 ≤ 6 GB. Report resident set with both models loaded, not
  download size.
- Packaging: no native modules unless prebuilt for win-x64, mac-x64, mac-arm64, linux-x64 with the
  CI change named (`apps/desktop/package.json` has `npmRebuild: false`). Models downloadable
  in-app with progress and cached offline. Say whether the PowerPoint pane keeps a working STT.
  ARCHITECTURE.md §6.10 (no per-platform binaries) stands unless the owner lifts it; native
  candidates (sherpa-onnx, onnxruntime-node) go in a separate "if we accept a sidecar" column.
- Licence: commercial use in a closed-source app without fee; attribution text if required (Gemma
  terms, LFM revenue threshold, CC-BY for Parakeet/Kyutai). A licence failure is a refutation ground.
- Concurrency: every latency figure is taken with the other half of the stack running on the same
  machine, plus a 20–30 min sustained run (CPU %, thermal throttling, UI frame rate).
- Contract: a decision candidate returns `DecideResponse` (`packages/core/src/api.ts`) with per-point
  confidence in 0..1 compatible with the 0.70/0.90 flip rule, or proposes new thresholds with corpus
  evidence; it must handle the traps (an announcement "ora parlerò di X" is not a start; a shared
  keyword is not enough; covered and upcoming points get no credit). An STT candidate implements
  `SttBackend` emitting `{committed, partial}`.
- Already done, do not re-propose: only waiting points are sent; unchanged windows are skipped
  (`lastSent`); decisions already run off the renderer thread. Open and cheap: `keep_alive` and
  `num_ctx` (verify `/v1/systemone` accepts `options`), window 900 → 400 chars (also hard-coded in
  `prompt.ts`), aborting the request on timeout (`withTimeout` does not abort the fetch, so slow CPU
  calls pile up), smaller or overlapping STT windows, `language: "it"` hint, fp16/q4 on WebGPU.

## Round 0: test set and harness (before any scout)

`docs/gauntlet/corpus/`: 4–6 talks (3 IT, 2 EN, 1 Italian speech with English points), 8–15 min
each, each with `script.md` (10–20 points in 3–5 sections), `audio.wav` (16 kHz mono),
`labels.json` `[{pointId, startedAtSec}]` and `transcript.json` `[{sec, committed}]` so decision
candidates replay without STT. Labelled traps: announcements, shared-keyword passages, a skipped
point, a point made out of order, a point spanning two windows.

Metrics per candidate: precision/recall of flips (correct within ±5 s of `startedAtSec`), false
starts per 10 min, median and p95 flip delay, STT WER per language. A false start counts 3× a miss.

One agent writes `docs/gauntlet/bench/decide-bench.ts` and `stt-bench.ts`, runs them on the current
stack (clef-flash via Ollama; whisper-base WASM and WebGPU) on M1 and M2, and commits
`baseline.json`. Every later number is a delta against this file; a candidate with no harness run
cannot be "measured". Baseline measurements to take: `/api/local/test` p50/p95 × 10 with
`/api/local/resources` `loaded[].where`; decision latency vs open points (1, 3, 6, 10) and window
length (300/600/900 chars); cold load and first-call latency; whether Ollama unloads between calls
on 8 GB; STT sentence-end to committed text, dropped windows (`pending.size >= 2`) over 5 min,
hallucinations on windows < 4 s, with/without `language: "it"`, fp32/fp16/q8/q4; timeouts and
Ollama queue depth over 5 min on CPU; T3 with `confirmCalls` 2 and 1; accuracy vs the OpenRouter
baseline (`google/gemini-2.5-flash-lite`); transcript updates per minute; resident RAM of the whole
stack; cross-origin isolation and WebGPU availability per OS; download size and first-run time at
20 Mbit/s; licence and attribution per model.

## Round 1: scouts (parallel, four lenses)

1. Ollama library: the smallest instruct models (≤ 4B) that answer "has the speaker started this
   point?" either (a) as a yes/no token probability per point (Clef-style, `/v1/systemone` or
   logprobs) or (b) as batch JSON through `/api/chat format: "json"` reusing `prompt.ts`. State
   which path and how the raw output maps to the 0.70/0.90 rule. Exact tags only.
2. Hugging Face, not an LLM: multilingual sentence embeddings, NLI cross-encoders, tiny fine-tuned
   classifiers (we can fine-tune on the Round 0 corpus) that run in milliseconds in transformers.js.
3. Real-time speech-to-text inside Electron: Moonshine, distil-whisper, quantized Whisper (int8/q4,
   WebGPU vs WASM, smaller/overlapping windows, partials); in the sidecar column: Parakeet TDT,
   Zipformer via sherpa-onnx, Kyutai, Voxtral, SenseVoice.
4. Architecture: ask the model less (see "Open and cheap" above), quantified per change.

Every candidate carries: exact tag or repo id verified today, parameter count, download size,
resident RAM, Italian support, licence, latency with a source URL, "measured" or "estimated".

## Round 2: refutation (devil's advocate)

One refuter per candidate: does the model exist with that tag, is the latency measured or wishful,
does it hold Italian, does it fit the memory budget next to Electron and the other half of the
stack, does the contract above hold, what breaks in a live talk (false "started", drift, long
points), licence. Refuted without a fix: out. Survivors get a one-line fix list.

## Round 2b: assembly

From the survivors the coordinator forms at most 6 stacks per hardware tier (one STT × one decision
× zero or more lens-4 changes) and runs each through the Round 0 harness on M1 and M2 with both
halves active. Output per stack: T1–T4 p50/p95, resident RAM with both models loaded, sustained
CPU %, dropped windows, timeouts, licence, packaging class. A stack that cannot be run here is
marked "estimated" on every latency figure.

## Round 3: scoring (three judges)

Gates first. A stack is eligible only if it meets T1, T2 and T4 on its target tier, fits the memory
budget, has an acceptable licence, and has at least T1 measured on M1 or M2. Ineligible stacks get
a "what would fix it" note (fix, expected effect on T1–T4, the measurement that would confirm it)
and go to the next lap.

Three judges each score every eligible stack on all three lenses, 0–10; the lens score is the
median of the three.

- Accuracy (weight 0.50), from the test set: 10 = precision ≥ 0.95 and recall ≥ 0.85; 7 = precision
  ≥ 0.90, recall ≥ 0.80; 5 = precision ≥ 0.85, recall ≥ 0.70; 0 = precision < 0.75.
- Latency margin (weight 0.30), T3 on the target tier: 10 = measured, ≥ 30 % under target; 7 =
  measured, meets target; 5 = estimated only; 3 = measured, misses by < 50 %; 0 = misses by ≥ 50 %
  or unknown. Estimated figures score at 0.7× the anchor.
- Shipping simplicity (weight 0.20): 10 = dependency already in the repo, no native binary, < 200
  lines changed, PowerPoint pane keeps STT; 7 = new npm dependency, no native code; 5 = native
  binary with prebuilds for all four targets and a named CI change; 0 = per-platform build step or
  no offline install path.

Total = 0.50 × accuracy + 0.30 × latency + 0.20 × simplicity. Pass: total ≥ 7.0 and no lens below 5.
Output: per stack a scoresheet (lens scores, total, pass/fail, evidence links, measured/estimated
per figure) and, for every failing stack, the "what would fix it" note the next lap consumes.

## Stop conditions and laps

Stop when at least one stack passes per tier, or after three laps. A lap produces "nothing new"
when no candidate or stack composition is absent from the previous Round 3 table; two such laps in
a row also stop the run.

## Deliverable (`docs/gauntlet/REPORT.md`, written by the synthesizer)

1. The stack to adopt per tier, with evidence and T1–T4 figures, measured vs estimated.
2. The fallback ladder: 8 GB no GPU; 16 GB integrated graphics; dedicated GPU (Clef Flash).
3. Ordered implementation steps, each shippable alone: `apps/web/lib/decide/*`,
   `packages/core` (engine, prompts, `api.ts` `DecisionProviderId`), `packages/stt`,
   `apps/web/lib/localModels.ts`, `apps/desktop/localai.js` CATALOG, `installer.nsh` model page,
   `PROVIDERS` in `api/decide/route.ts`, `PROVIDER_LABELS` in `prefs.ts`, `StartModeDialog`, i18n.
4. The rejected list: what was refuted or failed the gates, and why, so it is not retried.
5. The measurements still needed before a final choice.
6. If no stack passed: the best failing stack per tier with its fix note and the cost to get there.
