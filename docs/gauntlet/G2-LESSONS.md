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
