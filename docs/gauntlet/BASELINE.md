# Gauntlet baseline (Round 0)

How to run: `GAUNTLET=1 GAUNTLET_PROVIDERS=openrouter,clef-local npx vitest run apps/web/lib/gauntlet`
(keys from the shell or from the desktop profile's `.env`). Results land in `docs/gauntlet/results/`.
The harness is `packages/core/src/gauntlet.ts` (unit-tested with an oracle provider); corpora live in
`docs/gauntlet/corpus/<name>/` as `script.md` + `transcript.json` (timed committed segments) +
`labels.json` (when each point really started). Section changes follow the labels, as the presenter
or the slideshow follower would.

## 2026-11-02 · demo-it (SYNTHETIC seed talk, 85 s, 9 points, traps: announcement, shared words, out-of-order point)

Machine: Intel Core Ultra 7 155H, 32 GB, Windows 11. Engine defaults (window 900, confirm 2, sure 0.9, timeout 2500 ms, max 4 questions).

| provider | calls | p50 | p95 | timeouts | correct | false starts | misses | precision | recall | delay p50 |
|---|---|---|---|---|---|---|---|---|---|---|
| openrouter · google/gemini-2.5-flash-lite | 15 | 1477 ms | 2746 ms | 0 | 7 | 0 | 2 | 1.00 | 0.78 | 7 s |
| clef-local · clef-flash | not run here: this PC has Ollama 0.13, Clef needs 0.35.1+ | | | | | | | | | |

Per point: s0b0 correct (0 s), s0b1 late (6 s), s0b2 miss (announced at 21 s, started at 46 s after the
presenter had moved to section 2: by design it ends in the "missed" list), s1b0 miss, s1b1 late (7 s),
s1b2 late (7 s), s2b0 correct (0 s), s2b1 late (7 s), s2b2 late (7 s).

What this already says, before any model change:
- No false starts: the model respects the announcement trap. Good.
- The median delay (7 s) is one transcript segment: the two-call confirm rule costs a whole segment on
  every point, and s1b0 is missed because the matching text left the 900-char window before the
  second confirming call. On a real talk with 4 s Whisper windows this is the 9–12 s mouth-to-tick the
  EGM review predicted. `confirmCalls`, `sureThreshold` and the window are the first levers (T3).
- Per-call latency of the cloud model (1.5 s p50, 2.7 s p95) is itself close to the 2.5 s timeout.

Next measurements: Clef on a machine with Ollama ≥ 0.35 (the owner's desktop, RTX 3070), the same
corpus with `confirmCalls: 1` and `sureThreshold: 0.85`, and a real recorded talk instead of the seed.

## 2026-11-02 · confirm-rule variants (T3), same corpus, OpenRouter gemini-2.5-flash-lite

One run each; the cloud model is not deterministic and the corpus is tiny, so differences under
about 2 points of recall are noise. `GAUNTLET_VARIANT` names the result file.

| variant | calls | p50 | p95 | correct | false | miss | recall | delay p50 |
|---|---|---|---|---|---|---|---|---|
| defaults before (confirm 2, sure 0.90, window 900, no re-ask) | 15 | 1.5 s | 2.7 s | 7 | 0 | 2 | 0.78 | 7 s |
| confirm 1 | 15 | 1.7 s | 4.2 s | 5 | 0 | 4 | 0.56 | 0 s |
| sure 0.85 | 14 | 1.4 s | 1.8 s | 7 | 0 | 2 | 0.78 | 0 s |
| window 400 | 15 | 1.9 s | 3.4 s | 5 | 0 | 4 | 0.56 | 7 s |
| **new defaults: sure 0.85 + re-ask once while a point awaits its 2nd confirmation** | 20 | 2.0 s | 4.9 s | 7 | 0 | 2 | 0.78 | **2 s** |

Confidence trails of the last run (label → flip, every answer as `sec:confidence`):
`s1b1 39 → 41: 33s:0.35 39s:0.75 41s:0.75` (the re-ask at 41 s supplied the second confirmation, 2 s
instead of a whole segment); `s2b1 71 → 73: 73s:0.70 73s:0.85`; `s1b0 miss: 27s:0.13 33s:0.11 …
60s:0.80` (the model does not take "presentare con lo script davanti e sembrare che stesse leggendo"
as the point "Le presentazioni con lo script fanno sembrare che stai leggendo" until it is too late: a
paraphrase miss, the kind the embedding gate of Step 3 should catch); `s0b2 miss` by design (announced
at 21 s, actually started at 46 s after the presenter left the section: it goes to the missed list).

Decision: `sureThreshold` 0.90 → 0.85 and the re-ask rule become engine defaults (0.8.18). `confirmCalls`
stays 2 and the window stays 900 (both variants lost points). Expected on real talks with 4 s Whisper
windows: median flip delay drops from one or two windows to about one pacing gap (1–2 s on a slow
model, 0.5 s on a fast one) for confident points. To be re-checked on a real recorded corpus and on
Clef (whose `noul` probabilities are calibrated differently from the cloud model's confidence).

## 2026-11-02 · streaming STT measured (Step 2)

Nemotron 3.5 ASR streaming 0.6B, int8 export `sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11`
(475 MB archive, 680 MB on disk), sherpa-onnx-node 2.0.1 (onnxruntime 1.28.2), CPU, this laptop
(Core Ultra 7 155H). Synthetic Italian speech (Windows "Elsa" voice, 13.6 s):

| threads | per-chunk p50 | p95 | RTF | load |
|---|---|---|---|---|
| 4 | 105 ms | 116 ms | 0.19 | 1.8 s |
| 2 | 131 ms | 145 ms | 0.23 | |

Transcript: "Buongiorno a tutti siamo una piccola realtà di bassano del grappa e da dieci anni seguiamo
le piccole e medie imprese del Veneto. Il Gob classico scorre alla sua velocità, non alla tua"
("gobbo" → "Gob" on the synthetic voice). Partial words appear with every 560 ms chunk. The worker
path (apps/desktop/stt.js, 100 ms chunks like the microphone) fed 13.6 s of audio in 3.8 s wall time
with 138 result events. English with the synthetic "Zira" voice was poor ("A speaking campaign Dead
Listens…"): to be re-measured with real speech. T2 (sentence end → committed text) is now bounded by
the endpoint rule (1.2 s of trailing silence) plus one chunk: about 1.3–1.8 s, against ≥ 4 s before.
Tokens include <en-US>, <it-IT>, <ro-RO>, <ru-RU>: all four target languages.

## 2026-11-02 · cloud decision models and provider routing (owner reported "slow model: 1956 ms per call")

Same corpus, one run each, OpenRouter. The current model is already the fastest and the most accurate
of the four; provider routing by throughput trims the tail.

| model / routing | p50 | p95 | correct | miss | recall |
|---|---|---|---|---|---|
| google/gemini-2.5-flash-lite (current) | 1.4 s | 3.5 s | 7 | 2 | 0.78 |
| google/gemini-2.0-flash-001 | 1.9 s | 3.6 s | 6 | 3 | 0.67 |
| openai/gpt-4.1-nano | 2.1 s | 3.4 s | 6 | 3 | 0.67 |
| openai/gpt-4o-mini | 2.4 s | 3.1 s | 6 | 3 | 0.67 |
| flash-lite + provider sort "latency" | 1.6 s | 5.3 s | 7 | 2 | 0.78 |
| **flash-lite + provider sort "throughput" (new default)** | **1.3 s** | **1.9 s** | 7 | 2 | 0.78 |

Still open for the cloud path: the request is about 600 tokens of system prompt + the window and a
JSON answer of up to 500 tokens; a shorter answer format (ids and confidences only) is the next lever
(Step 3 territory). The 2 s figure the owner saw is this model's normal cloud latency, reported by
the new "slow model" chip (the engine paces itself to it; nothing is lost).

## Step 3: embedding gate in front of the model (2026-11-02)

`packages/core/src/gate.ts`, pattern adapted from Jarvis' embedding intent classifier (vectors prepared
ahead, cached under a content hash, cosine at query time; CC BY-NC-SA, no code copied). Model
`Xenova/paraphrase-multilingual-MiniLM-L12-v2` (q8, 384 dims) through transformers.js: Node for the
gauntlet, a Web Worker in the app. On this PC (Core Ultra 7 155H, CPU): load 1.1–4.5 s, 5–7 ms per
transcript tail, 21 ms for three points. Cross-lingual check: an Italian window scores 0.79 on its English
point, an English window 0.84 on its Italian point, an unrelated sentence 0.16 at most. Gate: `low` 0.3,
at most 4 candidates, tail 320 chars; no candidate → no model call, answered locally.

Same corpus (demo-it), same cloud model (google/gemini-2.5-flash-lite), two runs each, same hour:

| variant | calls | p50 | p95 | correct | false | miss | recall | model calls skipped |
|---|---|---|---|---|---|---|---|---|
| direct, run 1 | 15 | 2277 ms | 3555 ms | 5 | 0 | 4 | 0.556 | – |
| direct, run 2 | 17 | 1278 ms | 1688 ms | 7 | 0 | 2 | 0.778 | – |
| gate, run 1 | 16 | 1275 ms | 6479 ms | 7 | 0 | 2 | 0.778 | 3 / 17 |
| gate, run 2 | 17 | 1419 ms | 6773 ms | 8 | 0 | 1 | 0.889 | 3 / 17 |

Reading: precision 1 in every run; recall is equal or better with the gate (the model gets 1–2 focused
questions instead of 4, and the three windows with no plausible point cost nothing); the p50 difference
between the two direct runs (1 s) is larger than any gate effect, so no latency claim is made from these
runs. The p95 outliers in the gate runs are single slow provider answers, not the embedder. Files:
`docs/gauntlet/results/openrouter-demo-it{,-direct2,-gate,-run2-gate}.json`. Run it with
`GAUNTLET=1 GAUNTLET_GATE=1 GAUNTLET_PROVIDERS=openrouter npx vitest run apps/web/lib/gauntlet`
(`GAUNTLET_GATE_LOW` overrides the threshold). The gate is a Settings option ("Pre-filter before the
model"), off by default until it is measured with Clef on the RTX 3070 PC, where the model call is the
expensive part and the skipped calls should show in the delay.

Also in this step: the engine now drops decision replies from a previous epoch (script reload, section
change, reset, manual mark, start/stop) and aborts the in-flight call on those commands
(`packages/core/src/engine.ts`, six regression tests). Before, bullet ids being positional (`s0b1`), a
reply to an old script could mark a point of the newly loaded one.

## Metric change (2026-11-03, bug hunt #35)

`correct` and `recall` now count only flips within the tolerance of the label; flips after that are
reported as `late` (new field) and no longer inflate recall. `delaySec` still includes late flips, since
a late flip is the delay this harness measures. Numbers in the tables above were computed with late
flips counted as correct and are not directly comparable with new runs.

## P1 baseline (2026-11-08): trap corpora, local Clef, engine before P1

Two new SYNTHETIC trap corpora (docs/PRODUCTION-PLAN.md, P1 step 1), written by hand in the existing
format. `transcript.json` segments may now carry only `partial` (a streaming STT hypothesis that the
next committed segment replaces), which the replay feeds as a partial; committed segments clear it.

- `traps-it` (12 points, 5 labelled): contradiction ("aumentati del trenta per cento" against "calati
  del 30%", corrected 6 s later), negation ("non abbiamo tagliato"), wrong number (21% against 12%),
  wrong unit (two days against 2 hours), announcement only, partial STT revision ("Apriremo una sede a
  Milano" partial, "Non apriremo" committed), out-of-order points, a true point with a spelled-out
  number, a negated point said with a negation.
- `traps-en` (11 points, 4 labelled): contradiction ("rose thirty percent" against "fell 30%"),
  negation ("did not cut"), wrong number (fourteen against 4%), wrong unit (four days against 4
  hours), announcement only, two partial revisions ("will raise" to "will not raise", "fifty" to
  "fifteen"), out-of-order points, true points with spelled-out numbers and an unrelated "nothing".

Machine: Intel Core Ultra 7 155H, 32 GB, RTX 3070 8 GB, Ollama 0.40.13, `clef-flash` (Q8, 9.1B; 15 GB
resident, 64% CPU / 36% GPU). Engine defaults (window 900, confirm 2, sure 0.85, re-ask on, timeout
2500 ms, max 4 questions). Clef answers the same request with the same probability, and the replay
clock is the transcript's, so a run is reproducible; one run per variant.

The runner now warms Clef before replaying: a cold load takes about 16 s, and calls aborted at the
2.5 s timeout never let it finish (a first probe without warm-up timed out on all 59 calls). The same
cause broke the app's warm-up: `warmClefLocal` posted to `/api/generate`, which Ollama refuses for
Clef ("does not support generate"); it now loads the model with a one-question `/v1/systemone` call
and `keep_alive: -1`.

Run: `GAUNTLET=1 GAUNTLET_PROVIDERS=clef-local GAUNTLET_VARIANT=baseline [GAUNTLET_GATE=1] npx vitest run apps/web/lib/gauntlet`

| corpus | variant | calls | p50 | p95 | correct | late | false | miss | precision | recall |
|---|---|---|---|---|---|---|---|---|---|---|
| demo-it | direct | 15 | 909 ms | 936 ms | 7 | 1 | 0 | 1 | 0.875 | 0.778 |
| journey-en | direct | 10 | 881 ms | 917 ms | 1 | 1 | 0 | 2 | 0.5 | 0.25 |
| journey-it | direct | 9 | 862 ms | 960 ms | 2 | 1 | 0 | 1 | 0.667 | 0.5 |
| traps-en | direct | 17 | 860 ms | 988 ms | 4 | 0 | **1** | 0 | 0.8 | 1 |
| traps-it | direct | 16 | 887 ms | 2441 ms | 5 | 0 | 0 | 0 | 1 | 1 |
| **all 5** | **direct** | 67 | | | **19 / 26** | 3 | **1** | 4 | | **0.731** |
| demo-it | gate | 14 (2 skipped) | 756 ms | 983 ms | 7 | 1 | 0 | 1 | 0.875 | 0.778 |
| journey-en | gate | 10 (1 skipped) | 748 ms | 822 ms | 1 | 1 | 0 | 2 | 0.5 | 0.25 |
| journey-it | gate | 9 (0 skipped) | 698 ms | 781 ms | 2 | 1 | 0 | 1 | 0.667 | 0.5 |
| traps-en | gate | 17 (2 skipped) | 827 ms | 1015 ms | 2 | 2 | 0 | 0 | 0.5 | 0.5 |
| traps-it | gate | 17 (1 skipped) | 874 ms | 959 ms | 4 | 1 | 0 | 0 | 0.8 | 0.8 |
| **all 5** | **gate** | 67 (6 skipped) | | | **16 / 26** | 6 | 0 | 4 | | **0.615** |

What this says:
- Local Clef already respects the semantic traps: contradiction, negation, wrong number, wrong unit
  and the announcement stay open (confidence 0.01 to 0.3).
- The one false completion is the partial revision: at 68 s the partial "We ship the mobile app to
  fifty pilot" is in the window and Clef answers 0.88 for "Ship the mobile app to 50 pilot customers";
  the committed text 4 s later says "fifteen". Partial text can flip a point today (step 4).
- p95 stays under the 2.5 s timeout once Clef is warm (one 2.4 s outlier).
- With the gate, three true points of the trap corpora flip a whole segment late (s1b0, s1b3 in
  traps-en, s2b2 in traps-it): the gate's candidate order changes which points are asked in the
  call where the evidence appears.

## P1 results (2026-11-09): guard, lexical stage, committed-only flips, evidence

Same machine, model and corpora as the P1 baseline above; one run per variant (reproducible, see
above). Totals over the five corpora (26 labelled true points; 12 trap points in `traps-*` that must
stay open). "Model calls" excludes the calls the gate answered locally. Result files:
`docs/gauntlet/results/clef-local-<corpus>-<variant>.json`.

| variant | false completions | recall (correct / 26) | late | model calls | gate skipped | p95 (worst corpus) |
|---|---|---|---|---|---|---|
| baseline, direct (before P1) | **1** | 19 (0.731) | 3 | 67 | - | 2441 ms |
| baseline, gate (before P1) | 0 | 16 (0.615) | 6 | 61 | 6 | 1015 ms |
| + guard (step 2), direct | 1 | 19 | 3 | 67 | - | 887 ms |
| + guard, gate with the lexical stage off | 0 | 16 | 6 | 61 | 6 | 1010 ms |
| + lexical stage (step 3), gate low 0.3 / lexical 0.5 | 0 | 18 (0.692) | 4 | 65 | 4 | 1035 ms |
| + lexical stage, gate low 0.4 | 0 | 18 | 4 | 60 | 7 | 1033 ms |
| + lexical stage, gate low 0.5 | 0 | 18 | 4 | 58 | 8 | 989 ms |
| **+ committed-only flips (step 4) + evidence (step 5), direct = P1 default** | **0** | **19 (0.731)** | 3 | **62** | - | **874 ms** |
| P1, gate narrowed (low 0.3 / lexical 0.5) | 0 | 17 (0.654) | 5 | 60 | 4 | 909 ms |
| **P1, gate skip-only (now the gate's mode for local Clef)** | **0** | **19 (0.731)** | 3 | **58** | 4 | 1033 ms |
| P1, gate skip-only, low 0.4 | 0 | 19 | 3 | 55 | 7 | 1399 ms |

Exit criteria, P1 default (direct, the app's default since the gate is off by default):
- 0 false completions on both trap corpora and on the three older corpora (baseline: 1).
- Recall 19 / 26, equal to the baseline; per corpus identical (demo-it 7/9, journey-en 1/4,
  journey-it 2/4, traps-en 4/4, traps-it 5/5).
- Local decision latency p95 at most 874 ms per corpus, under the 2500 ms timeout; no timeouts.
- 5 fewer model calls (67 to 62): partial text no longer triggers calls.

What each step did, measured:
- Step 2, guard. Local Clef already rejects the semantic traps on its own, so with real Clef the guard
  never fired in the direct runs and rejected one confirming answer per gate run on traps-en. Its
  value is as a floor under any model: `packages/core/src/gauntlet.test.ts` replays both trap corpora
  with a deliberately gullible model (sure about every surface match, numbers and negation included).
  Without the guard it completes at least 3 trap points per corpus; with the guard and committed-only
  flips it completes none and still finds every true point. The first guard run blocked one true
  point (demo-it, "senza niente davanti si saltano i punti importanti" read as a denial); fixed
  ("senza"/"without" + negation word is not a denial) and re-run, the table shows the fixed run.
- Step 3, lexical stage. With the narrowed gate it brings back 2 true points the embedding gate lost
  (traps-en recall 0.5 to 1.0), at the cost of 2 fewer skipped calls. A stricter embedding threshold
  (0.4 or 0.5) with the lexical stage as the safety net skips more calls at the same recall.
- Step 4, committed-only flips. Removes the one false completion of the baseline (the partial
  "fifty" later committed as "fifteen") and the calls partial text used to trigger.
- Gate mode. Asking Clef about fewer points changes its answers: with the narrowed gate two true
  points flip a segment late (traps-en s2b2 0.67 then 0.94; traps-it s2b2 0.62 then 0.72), with
  every open point asked they flip on time. The gate now only skips calls when the provider is local
  Clef (`gateThresholdsFor`), which keeps the full recall and saves 4 of 62 calls; other providers
  keep the narrowed gate measured in Step 3 (not re-measured here: no paid calls).

Still open, not P1 regressions (identical before and after): journey-en and journey-it recall (Clef
answers 0.65 to 0.75 on "Bristol pilot", "Launch date Monday" and the backup point, under the 0.85
sure threshold and not confirmed twice before the label tolerance), and demo-it s0b2 (by design, see
the first section) and s1b0 (paraphrase, one segment late). These are threshold and paraphrase
questions for the decision model, not trap failures.
