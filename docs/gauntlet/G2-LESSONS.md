# Local lesson gauntlet: builder evidence

The run is not a passing product change. No default or opt-in model preset is
enabled. The evaluation uses the existing local lesson generator, schemas and
renderer without changing them.

Task evidence lives under `G:/FILOW/tmp/g2-lessons`. `FROZEN.json` was written
before scored generation; its SHA-256 is
`3dea2fa0667ebbac190f0ebf77703b2e188048edf70359529877318cc2e82c9c`.
The baseline checkout is `92f28bf88d1a97f5c543428ff195adeb17366184`.
The source snapshots, exact model and runtime hashes, ten development topics,
lesson settings, scoring rules and three-rework cap are retained there.

The CPU role default is `lfm3-vl`, traced through `modelRoles/auto.ts`,
`buddy/providers.ts` and `packages/core/src/profile.ts`. Gemma E4B is a GPU
comparison, not a measured CPU control here. No owner's model server was used.

## What the tools do

- `tools/eval/g2-protocol.mjs` verifies frozen sources and model bytes, enforces
  one repair across pipeline calls, calculates nearest-rank percentiles and
  limits metadata written into blind records.
- `tools/eval/g2-generate.mjs` calls the unchanged `generateLocal` function using
  an isolated OpenAI-compatible loopback server on 5011. All inference is local.
  It refuses existing sample files. Full request/response evidence stays outside
  the blind output tree. Held-out topics are hash checked and never synthesized.
- `tools/eval/g2-render.mjs` bundles the unchanged app layout, scene preparation
  and PNG renderer, including the app's offline fonts. It runs a hidden, muted
  Electron window with its own profile, HTTP port 5012 and debug port 9611.
  It blocks external browser requests and exports each step in both themes.

These are evaluation tools, not a replacement inference adapter. The generator
expects an independently started, hash-verified runtime and a successful smoke
record. Model-process memory instrumentation and process supervision are in the
task's `run-model.py`; total app memory, contention eligibility and native Stop
acceptance are not verified. Do not interpret null measurements as zero.

## Preregistered protocol deviations

`DEVIATIONS.json` preserves the limitations instead of silently changing the
frozen rules. In particular, runtime smoke warmed the first development sample;
the declared cold sample was not achieved. Foreign-load sampling was not
implemented, so timing observations cannot establish target acceptance. The
actual machine is an i9-13900KF with 137,182,855,168 bytes of physical memory,
four inference threads and affinity 0x55, without an 8 GB memory cap.

The Qwen conversion card identifies bartowski and llama.cpp b6096, but the
converter repository has no LICENSE/NOTICE file. Upstream Apache-2.0 and the
converter card are retained; redistribution clearance remains unverified.
The Bonsai notice is retained from the pinned PrismML study evidence. The direct
NOTICE URL returned an error; `NOTICE-CORRECTION.json` records this explicitly.

## Acceptance boundary

Schema validity is not correctness, rendering is not readability, and a
successful runtime smoke is not model qualification. Held-out factual scores,
blind preference and the teacher answer key belong to the critic. Hardware and
Stop gates remain conjunctive. A rejected development arm does not get promoted
or repeatedly resampled until it looks better.

Final measured counts and acquisition failures are recorded in the task's
`REPORT.md` and `development-summary.json`. Synthetic renderer smoke images are
kept separately from development and held-out evidence.

## Result on 2026-11-14

Qwen Q4 and the LFM baseline could not be acquired within the bounded download
attempts. No partial model file was loaded. Bonsai 2's 517,312,992-byte file
matched its frozen SHA-256 and passed the isolated CPU runtime smoke.

Bonsai completed 7/10 valid, rendered development lessons; 7/10 attempts used
the permitted repair. Three failed when another repair would have been needed.
First meaningful step p50/p90/p95 was 18.438/29.123/29.123 seconds among the eight
attempts that produced one. Two attempts never produced a meaningful step, so
these conditional latency percentiles are not a ten-attempt acceptance pass.
Total time p50/p90/p95 across all ten was 29.748/37.065/41.586 seconds. Aggregate
decode throughput was 37.27 token/s; peak model working set was 1,194,536,960
bytes. Neither total app memory nor an 8 GB target was measured.

The model is dropped under the factual-error condition: the English spoon
lesson calls wood a poor insulator, the Italian rainbow lesson instead teaches
a construction of a circle, and the Romanian explanations are malformed and
incorrect. The Japanese moon lesson mixes English into its drawing and final
sentence; the fractions attempt yields no lesson. See the full per-language
notes and raw responses in the task folder. This is builder development review,
not a held-out or native-speaker score.

The 20 supplied held-out topics remain unscored. No held-out outputs were
produced: zero topics, zero arms. The random mapping is outside the held-out
tree in `arm-key.json`. No preset was added for a rejected/unmeasured candidate.
No rework round was used. No merge, push, tag or release was performed.

## Continuation acquisition and harness changes

Both previously incomplete files were acquired with resumable byte-range
downloads and verified against the unchanged frozen SHA-256 pins. Qwen is
2,497,280,448 bytes; the CPU baseline is 1,099,627,808 bytes. Completed chunks
from the first run were reused. Bonsai was not run again.

The originally pinned Prism runtime rejects the baseline with `unknown model
architecture: 'lfm3'`. The continuation therefore copies the existing installed
Ollama CPU runner and licences into the task directory, hashes every copied
file before baseline scoring, and runs it directly against the pinned GGUF.
`BASELINE-RUNTIME-CONTINUATION.json` records this explicit protocol deviation:
version 0.9.0-dev build 1, commit 6c01da627. Qwen retains the original frozen
runtime. Neither the owner's Ollama service nor its model store is used.

Model verification now hashes bounded chunks: Node's whole-file read cannot
load the 2.5 GB Qwen file. A regression test checks a multi-chunk input with a
short final chunk; a deliberate mutation that hashes the unused buffer tail is
caught. The one-repair mutation is also caught and restored. Generation records
wall-clock boundaries for sample alignment, and the render CLI can select a
development arm without touching the existing Bonsai artifacts. Application
prompts, schemas and rendering functions remain byte-for-byte frozen.

The task's `continue-run.py` supervises the process and saves per-lesson metrics.
Its initial Windows memory structure omitted a field, leaving baseline memory
and host-load samples unavailable. Raw zero is an instrumentation failure, not
zero memory. Baseline samples were not replaced. This was fixed before Qwen
scoring, with a memory-probe check before generation. Both arms remain warm
after runtime smoke; no cold distribution or 8 GB hardware acceptance is claimed.

## Continuation development result and decision

Development split, 10 topics, two per language, warm after smoke:

| Arm | Valid rendered | Repair used | First step p50 / p90 | Tokens/s | Model peak |
| --- | --- | --- | --- | --- | --- |
| Baseline | 2/10 | 9/10 | 29.9 s / 35.3 s | 22.2 | not measured |
| Qwen3-4B-Instruct-2507 | 9/10 | 7/10 | 95.8 s / 159.3 s | 5.9 | 5.35 GB |

All Qwen latency samples ran under more than 20 percent foreign CPU load, so
none is latency-eligible; the numbers are exploratory only. Even so, both
percentiles are an order of magnitude above the 8 s / 15 s CPU bar.

Qwen is dropped under the item's drop condition "grammar-valid output still
teaches wrong facts". Two schema-valid, rendered lessons teach wrong facts:
the Japanese fractions lesson states that one half has numerator 2 and
denominator 1, and the English spoon lesson draws heat flowing from the metal
spoon to the hand. The 5.35 GB model-only working set also leaves no credible
8 GB CPU route once the app is added. The baseline is worse on validity
(2/10), but the drop conditions are absolute, not relative.

Because Qwen was dropped on the development split, no held-out outputs were
generated (zero topics, zero arms) and no role preset was added. The baseline
stays the default. No rework round was used.

## Round 3 (last): Qwen3.5-2B

Pinned before scoring: `unsloth/Qwen3.5-2B-GGUF` at revision
`f6d5376be1edb4d416d56da11e5397a961aca8ae`, file `Qwen3.5-2B-Q4_K_M.gguf`,
1,280,835,840 bytes, SHA-256
`aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223`.
Upstream `Qwen/Qwen3.5-2B` is Apache-2.0; its LICENSE and the converter card
(licence apache-2.0, linking the upstream LICENSE) are kept under `notices/qwen35`.
Text GGUF only, no mmproj. The frozen runtime, arguments, ten development topics,
prompt, schema, non-thinking mode and one-repair rule are unchanged. FROZEN.json
after the round 3 entry has SHA-256
`b969665293514f4793773861330da253e7c3cb46e5f510b3e6611b8f598c4518`.

| Arm | Valid rendered | Repair used | First step p50 / p90 | Tokens/s | Model peak |
| --- | --- | --- | --- | --- | --- |
| Qwen3.5-2B Q4_K_M | 10/10 | 8/10 | 52.7 s / 63.0 s | 19.4 | 2.53 GB |

All ten samples ran under more than 20 percent foreign CPU load, so no latency
sample is eligible; the numbers are exploratory, and still far above 8 s / 15 s.

Builder fact check (`round3-review.json`): 6 factual errors in 4 of 10 lessons.
The Romanian shadow lesson says shadows are long by day and short at night and
labels a node "Umbria"; the Romanian salt lesson says an ion is a molecule and a
molecule is water. English says the spoon becomes colder; Italian says droplets
"filter" light. Three more lessons do not answer the question (lever, day and
night, one half equals two quarters). Japanese moon and Russian switch are
correct; Japanese output has no English mixed in this time.

Decision: dropped under "grammar-valid output still teaches wrong facts". Memory
alone would allow the low-spec route. No held-out outputs were generated and no
preset was added. This was the third and last round: the baseline stays the
default.
