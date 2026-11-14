# Phase 2b: local answer latency

Design before implementation, 2026-11-14, based on a03cf5e.

The baseline is partial: standard warm 31 valid samples, cold 14; first sentence
and first sound are absent because valid answers were marks only. The primary
judge here is release to first token, as requested, not an invented voice proxy.

## Chosen waits

1. Picture evaluation: 7,422 ms warm, 12,049 ms cold. Capture currently caps every
route at 1,024 pixels wide, JPEG quality 72 (1,024 x 576 on the 40 synthetic
1,920 x 1,080 screens). Evaluate 1,024, 768 and 512 on all 40 screens, recording
Ollama prompt token counts and evaluation duration, plus raw and rectangle-placed
points inside the intended element. Token counts must be measured: pixel area
alone does not establish the vision encoder's token count. Select the smallest
candidate within 2 percentage points of baseline accuracy. Apply any selected
cap only to local captures, including QA captures; preserve online 1,024/72.

The ground.ts name match places a unique exact name at its rectangle centre;
nearby guesses snap within 30/1000. This protects named controls, not unnamed
canvas targets, ambiguous labels or image understanding. Report raw and placed
accuracy separately; this fixture cannot prove arbitrary screen quality.

2. Reload after warm-up: 1,556 ms cold. warmLocalModel sends an empty generate
request with keep_alive 30m and no options; askOllama sends num_ctx 8192 with the
same keep_alive. Share the context/load settings between both paths, including
the pointer warm-up. Keep installed-model thread/GPU defaults unchanged. Keep
warm-up weight-only: no fabricated system prompt or image. Actual dated prompts
retain the existing static prefix and append only the local calendar date, per
DATE-IN-PROMPTS.md. Verify whether matching context eliminates measured reload;
projector initialization can remain and must not be reported as removed.

## Recognition investigation

The question recognizer starts on press, concurrently with microphone opening,
and stays loaded across takes. Cold release-to-sttStop is 1,217 ms versus 168 ms
warm; the fixed post-stop tail contributes about 243/247 ms. Inspect startup
loading and stop acknowledgement before choosing a third change. Do not conflate
worker initialization, offline decoding and the tail. An optional preload must
never open a microphone or replace a worker that an active session owns.

## User experience and hardware

Preserve opening until microphone capture is ready, keys-up closure, processing
while final words arrive, thinking while the local model reads the screen, and
speaking for output. No optimistic readiness or fabricated progress. On CPU-only
standard hardware warm-up may run ahead. On a discrete GPU with less than 12 GB,
retain warmEvictsDecision: warming helpers can evict the presentation model.
That machine may intentionally pay a cold load on its first question. Measure
fast only when the original CPU/GPU idle rules permit it.

## Regression and acceptance

Unit tests and a killed mutation for each implemented change. Run typecheck,
lint and the full suite, including Stop, Resume, grounding/marks, microphone
opening and keys-up races, phone questions and date tests. Run existing hidden
QA end-to-end checks where supported. No physical input, real microphone,
visible window, paid request, owner profile or owner Ollama mutation.

Package the committed branch under G:/FILOW/tmp/latency/build-phase2b. Use the
same latency tool/judge and standard profile, at least 30 warm and 12 cold valid
samples, retaining failures and partial samples. Foreign CPU <=15%; at most
40 minutes total idle waiting, never relax the threshold. Keep original baseline
artifacts intact. All processes have hard deadlines and owned-process cleanup.
Report median and p90 for heard, token, sentence, sound and mark. Pass requires
at least 20% lower warm AND cold token medians, p90 no worse, pointing loss <=2
points, Stop and Resume intact. Missing evidence is unverified, never a pass.
