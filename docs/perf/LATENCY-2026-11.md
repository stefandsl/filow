# Phase 2b latency, 2026-11-14

Measured product commit: a5fcc5c (a5fcc5c51be6fd948460bf5b0def5cd2124d2112), branch feat-phase2b. QA directory: G:/FILOW/tmp/latency/build-phase2b/win-unpacked. No merge, push or tag.

Requested standard-profile judge: **PASS**. Gates: warmCount=true, coldCount=true, warmMedian=true, coldMedian=true, warmP90=true, coldP90=true, pointing=true, stopResume=true, measurementJudge=true.

## Release-to-output results

Milliseconds, median / nearest-rank p90. Percent change compares medians; negative is faster. N/A is missing evidence, never zero.

| Stage | Baseline warm | After warm | Change | Baseline cold | After cold | Change |
|---|---:|---:|---:|---:|---:|---:|
| Heard | 407 / 470 | 224 / 296 (n=45) | -45.0% | 1459 / 1830 | 1237 / 1562 (n=31) | -15.2% |
| First token | 8797 / 8953 | 6561 / 6722 (n=45) | -25.4% | 15689 / 16369 | 10172 / 10508 (n=31) | -35.2% |
| First sentence | N/A / N/A | 6677 / 6705 (n=2) | N/A | N/A / N/A | 11033 / 11033 (n=1) | N/A |
| First sound | N/A / N/A | 8314 / 8442 (n=2) | N/A | N/A / N/A | 12567 / 12567 (n=1) | N/A |
| First mark | 8797 / 8954 | 6576 / 6722 (n=45) | -25.2% | 15690 / 16369 | 10173 / 10519 (n=31) | -35.2% |

The baseline is REPORT-a03cf5e.md: 31 valid warm and 14 valid cold voice samples, with incomplete/unbalanced question coverage and no first-sentence or first-sound distributions. This is a comparison to that supplied historical baseline, not an interleaved old/new experiment. Sentence/sound after values, if present, describe only answers that produced speech; they cannot establish a before/after voice gain.

## Counts and exclusions

- warm-voice: 45 valid of 65 counted attempts. Exclusions: {"heard check":10,"interference":10,"end error":1,"missing mark":1,"mode error":1}. Valid by question: {"1":2,"2":9,"3":11,"4":15,"5":8}.
- cold-voice: 31 valid of 42 counted attempts. Exclusions: {"heard check":7,"interference":6,"missing mark":1,"tts level":1}. Valid by question: {"1":5,"2":6,"3":7,"4":5,"5":8}.

Discarded launch-first questions are retained separately. The original transcription, CPU, model-processor split, mark, TTS-level, retry-limit and isolation checks remain in force. Completed counted samples are saved immediately, including on interruption.

## Measured costs

| Cost, median / p90 ms | After warm | After cold |
|---|---:|---:|
| Ollama load | 27 / 58 (n=45) | 20 / 133 (n=31) |
| Picture prompt evaluation | 5392 / 5630 (n=45) | 8078 / 8237 (n=31) |
| Release to recognizer stop | 169 / 230 (n=45) | 1187 / 1506 (n=31) |
| Recognizer stop to heard | 57 / 66 (n=45) | 58 / 64 (n=31) |

Cold valid samples with the warm-up response before release: 31/31. Warm-up remains weight-only, uses the same 8192 context as questions and inherits the same model thread/GPU options. Date handling is unchanged: append the calendar line after the static instruction prefix.

## Image choice and pointing

Three widths, 40 valid synthetic screens each; 137 total attempts, 120 valid. These questions carry the normal named-control coordinate hint. Raw means before UI Automation placement and named-point fallback, not vision-only accuracy. Scores require a parsed POINT inside the intended rectangle; other visual tag types are not credited.

| Width | Prompt tokens | Increment from image | Prompt evaluation median / p90 ms | Raw inside target | Placed inside target |
|---|---:|---:|---:|---:|---:|
| 1024 | 2152 | 578 | 7221 / 7400 | 27.5% | 85% |
| 768 | 1912 | 338 | 4916 / 4970 | 42.5% | 90% |
| 512 | 1720 | 146 | 3189 / 3250 | 100% | 100% |

Choose 512: smallest tested and no quality loss. UI Automation placement/fallback adds 57.5 points at 1024 and 47.5 at 768; it adds zero at 512 on these fixtures. Image token contribution is measured against the identical imageless first-screen prompt (1574 tokens), not inferred from pixel area. Online captures stay 1024/JPEG 72. Display bounds, normalized rectangles and phone capture bypass stay unchanged.

## Validation

- Typecheck and lint pass. Full suite: 3,171 passed, 5 skipped.
- Four mutations caught and restored: remove warm-up context, restore 200 ms transcript tail, restore local width 1024, shrink online width to 512.
- Existing hidden microphone E2E: 11/11 pass on interim d68abf1. Covers opening, missing microphone, cold recognizer, keys-up closure and rapid re-press. Final image routing is covered by the native-image/IPC tests.
- Final-package deterministic Stop/Resume: PASS, thinking Stop to silent 2 ms, speaking 1 ms, resume to scheduled speech 1183 ms; no output after Stop.
- Original 1000 ms injected-delay judge: {"pass":true,"checks":{"fetch":{"interval":[959,1040.5],"pass":true},"before":{"interval":[-5.5,1.5],"pass":true},"voice":{"interval":[946.5,1034],"pass":true,"span":"t0->mark"}},"n":{"plain":20,"delayed":20}}.

The Stop/Resume driver initially ran before panel hydration; it now uses the existing readiness wait. Its second attempt timed the deliberate two-second telemetry horizon; the corrected check uses the existing stopAt-to-silent marks. Both unsuccessful driver results are retained. Product code was not changed to pass those checks.

The first fresh-checkout tests had three QA hardware failures before building the generated desktop vendor module; the full suite then passed. npm ci succeeded on its one retry. The native-runtime packaging prerequisite succeeded after selecting Windows tar instead of the PATH tar that misread G: as a host.

## Scope, isolation and remaining evidence

- Standard is the baseline CPU-only approximation: four P-core threads, affinity 0x55, simulated 16 GB / 8 logical CPUs, lfm3-vl in the harness store on 11435. Physical RAM is not capped.
- Foreign CPU stays at most 15%; the shared idle ledger caps total waiting at 40 minutes. Invalid and partial samples remain available. No threshold or requested workload was tuned to improve results.
- Hidden QA windows, global input disabled, prerecorded microphone, muted speech, G: profiles and files; only harness Ollama stores. The optional budget mode avoids even the old tool's read-only owner-Ollama query.
- Online measurements are skipped: no paid API calls. Online capture dimensions have regression tests, not live-provider measurements.
- Actual desktop capture, dense text, unnamed canvas targets, native UI Automation accuracy, real microphone/speaker latency, physical hotkeys and live phone/network questions remain unverified. Phone, Stop, Resume and marks unit suites passed.
- The pill retains opening, listening, thinking and speaking states. There is no separate instrumented model-load/image-evaluation progress stage.
- A small discrete GPU may intentionally defer warm-up to avoid evicting the presentation model. That protection is unchanged. CPU results do not predict GPU cold-start behavior.

## Artifacts

- Baseline: G:/FILOW/tmp/latency/REPORT-a03cf5e.md
- Image attempts/control counts: G:/FILOW/tmp/latency/work/phase2b-images/
- Stop/Resume: G:/FILOW/tmp/latency/work/phase2b-stop-resume.json
- Microphone E2E: G:/FILOW/tmp/latency/phase2b-mic/mic-open-result.json
- Commands, checks, mutations and packaging logs: G:/FILOW/tmp/latency/work/phase2b-*.log
- Raw measured samples: G:/FILOW/tmp/latency/results-a5fcc5c-standard-measure-2026-11-14-run1.json
- Raw measured samples: G:/FILOW/tmp/latency/results-a5fcc5c-standard-measure-2026-11-14-run2.json
- Raw measured samples: G:/FILOW/tmp/latency/results-a5fcc5c-standard-measure-2026-11-14-stop.json

## Final run notes

The initial fixed standard schedule produced 26 valid warm / 31 valid cold samples.
Because warm was below the requested 30, a second complete original warm schedule
was started, with the same offsets and retry limits. It added 19 valid samples.
The fourth question then produced an empty model answer (16 output tokens); the
panel showed its error state and the harness stopped because it did not return to
idle. This unresolved reliability observation is excluded from latency statistics
by the original validity rule, retained in raw data, and is not a passing result.
No further warm repeat was attempted. Pooled results include all 45 valid warm
samples, not a selected subset. An early archive snapshot is preserved separately
under work/phase2b-run1-before-retries.json and is not counted twice.

The existing real-model Stop schedule ended at its original 25% retry limit:
8 valid thinking-stop checks of 19 attempts, all with no regression flags; stop
logging 0-63 ms and idle 1-66 ms. One thinking-stop sample failed interference.
Ten speaking-stop attempts had no speech to interrupt (one also ended in error).
Thus real-model speaking interruption has no valid measurement. The deterministic
final-package speech test separately verifies speaking Stop and Resume, including
no output after Stop; it does not measure model latency.

The initial repeat was stopped before samples when the first run was still doing
its built-in retries. A sandbox-stalled launch was stopped and retried once with
Windows process-inspection access. These launches produced no counted samples.

Commands used the same latency.mjs judge and measure paths, with --conditions
warm,cold, then warm, then stop, and a single shared --idle-budget-file. The image
trial used the added images command. All runs used the packaged product a5fcc5c.
Fast profile: attempted with the unchanged GPU-at-most-10% idle rule. The launch's
discarded first question completed (load 1983 ms), but GPU usage was 26% at the
counted-sample gate. Zero counted/valid fast samples; no baseline fast distribution
exists either. The shared idle budget stopped the run at 2,395,003 ms (39.92 minutes),
below 40 minutes. Its launch and wait evidence remain in work/phase2b-fast.log.
No CPU/GPU threshold was relaxed and no other workload was stopped.

Final diagnostic-only changes pass lint and all 16 latency-lib tests. The original
report command also completed and agrees on 45 valid warm / 31 valid cold samples.
Cleanup verified no listeners on task ports 11435, 11436, 4811, 4812, 9361,
4871, 4872, 4873, 9371, and no process from the task's QA package or microphone
profile remained. No owner Ollama request, installed-app operation, paid API,
merge, push or tag was performed.