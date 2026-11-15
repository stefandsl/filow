# Experimental OK Filow wake word

Branch: `feat-wake-word`, based on `3479560`. Not a release recommendation.

## Round 3 measured result, 14 November 2026

**Do not ship, including as an experimental opt-in.** The changed portable
training reference reaches 500/500 decision agreement. Held-out clean/noisy
misses improve to 3/48, but background false accepts average 0.75/hour and
whole-app CPU is 9.40% of one core. Item 4 is not complete: both detectors now
share a utility process, but capture remains in Chromium, with 100 ms IPC.
There is no claim that capture and inference share one worker or meet 4%.

| Measurement | Round 0 | Round 1 | Round 2 | Round 3 |
| --- | ---: | ---: | ---: | ---: |
| Training decision agreement, 500 clips | Not measured | 87.8% | 89.2% | 100%, changed reference |
| Diagnostic misses, no hard negatives, 256 positives | Not isolated | 52/256 | 46/256 | 34/256 |
| Diagnostic near accepts, no hard negatives, 144 clips | Not isolated | 99/144 | 98/144 | 91/144 |
| Balanced chronological misses | 50/256, original corpus | 13/48, held-out clean/noisy | Not rerun | 3/48, held-out clean/noisy |
| Balanced chronological near accepts | 95/144 | 14/36 | Not rerun | 12/26; 9/26 with personal negatives |
| Background false accepts/hour | 0 observed, one head, 2 h | 0.40 mean, 1.25 worst, 5 x 4 h | Not rerun | 0.75 mean, 1.50 worst, 5 x 4 h |
| Whole-app real-time CPU, one-core equivalent | 15.71%, 15 s | 9.96%, 60 s | Not rerun | 8.89% before, 9.40% after, 60 s each |
| Own-take replay gate and optional negatives | Neither | Neither | Neither | Both, en/it/ru/ro/ja |

The chronological and diagnostic rows are different experiments, not a single
matched accuracy benchmark. Round 3 reserves two near phrases per held-out
speaker for optional-negative training, removing those ten clips from BOTH
sides of the 26-clip comparison. Round 0 includes pitch conditions; the 48-clip
held-out row excludes pitch shifts. Four hours of unique background are shared
by five independent heads, giving twenty head-hours, not twenty independent
audio hours. Each language's 48-minute background segment starts with reset
detectors. This is accelerated replay, not four hours of live microphone capture.

### First differing stages and changed reference

The original app at `d4aac39` and unmodified spike were instrumented on the
same first five WAVs with seed 12345. Stage (a) already fails: both produce
80 clips, but 55 sample counts/durations and all 80 sample checksums differ.
The app uses fixed speed/gain cycles and low uniform noise. The original spike
uses NumPy choices, duration-preserving pitch shifts, real speech lead-ins and
recorded noise. It also uses 30,000 unquantized negative windows, sklearn
LBFGS logistic regression and thresholds drawn from its evaluation background.

**The reference changed.** `wake-augmentation.js` and the independent Python
implementation in `stage-reference.py` replace the augmentation in the app and
the experimental reference. They use a 32-bit LCG, identical draw order, linear
speed resampling, gain, generated white noise at 20/15/10 dB and a two-tap
40/70 ms synthetic reverb. No noise audio or speech lead-ins are shipped.
One initial Python reverb comparison differed because of floating-point addition
grouping; matching the specified grouping fixes the checksum mismatch.

For stages (c) and (e), the new reference explicitly adopts the app's verified
quantized CC0 background partition and balanced, regularized SGD. The Python
implementation is independent, uses no fastmath and reproduces float32 weight
stores with double accumulation. This is NOT parity with the original sklearn
model or proof that quantization is harmless. Compared with the old reference's
24/256 misses and 76/144 near accepts, the new no-hard-negative reference has
34/256 misses and 91/144 near accepts. The higher agreement cannot be presented
as recovering the original spike's quality.

Stage evidence for the first enrolment, then repeated over all twenty profiles:

- (a) All 80 post-resampling sample hashes, counts, order and durations match
  exactly. Original and replacement per-clip manifests are in the JSON report.
- (b) Each full embedding sequence is compared. Maximum absolute component
  error across all 1,600 augmented clips is 7.45e-8.
- (c) Both decode the same checksum-verified `background.bin`: 141,313 frames,
  five Common Voice language segments, float32 conversion of signed bytes / 127.
  The first third of each segment supplies training windows; the remaining
  portion supplies calibration. Hard negatives are disabled for this parity test.
- (d) Both concatenate twelve 96-dimensional frames, with an 80 ms embedding
  hop, and label four windows at speech-end + 80/160/240/320 ms after a one-second
  lead. All 320 positive windows' frame indices agree per enrolment.
- (e) Snapshots after 1, 10 and 120,000 updates include weight SHA-256 and sampled
  cross-entropy loss. Hashes differ due to tiny native embedding differences;
  maximum final component error across all heads is 4.17e-7, below the 2e-5 gate.
  For the first head, app/reference losses are 0.69314718056/0.69314718056,
  0.74966093777/0.74966094009 and 0.00001445649552/0.00001445649549.

The 500 evaluation clips use common cached reference embeddings and keyword
decisions to isolate training. Independently trained weights and calibration
thresholds agree on every Balanced decision. This diagnostic does not replace
the separate chronological live-path and background tests. Compact generated
audio, embedding and optimizer fixtures remain in `portable-reference.json`;
no person's recorded audio is committed.

### Hard negatives, held-out voices and personal negatives

The sampling curve uses five calibration voice-language profiles, separate from
the five held-out identities. It excludes pitch shifts and uses per-clip scores:

| Fraction of negative updates using hard negatives | Misses | Near accepts |
| --- | ---: | ---: |
| 0 | 7/48 | 24/36 |
| 0.10 | 6/48 | 16/36 |
| **0.20, retained default** | **6/48** | **10/36** |
| 0.50 | 7/48 | 8/36 |

Twenty percent is the lowest near-accept count at the minimum observed misses.
The small calibration set does not establish an optimal population threshold.
The held-out results below did not select the rate or thresholds.

| Held-out voice | Language | Clean/noisy misses | Near accepts, no personal negatives | Balanced background accepts / 4 h |
| --- | --- | ---: | ---: | ---: |
| kokoro_v14 | en | 2/24 | 6/18 | 6 |
| supertonic_v6 | it | 0/6 | 1/2 | 0 |
| supertonic_v7 | ru | 0/6 | 2/2 | 6 |
| supertonic_v8 | ro | 0/6 | 1/2 | 1 |
| supertonic_v9 | ja | 1/6 | 2/2 | 2 |

Two optional accepted non-wake recordings are stored as `negative-1.wav` and
`negative-2.wav`, folded into the numerical hard-negative pool, and removed by
Skip/remove or Delete. Changing them invalidates the head and requires retraining.
Their effect was measured using two reserved synthetic near phrases per speaker,
not the ordinary-sentence examples displayed by the UI. On the remaining clips,
misses stay at 3/48 and near accepts fall from 12/26 to 9/26. This does not establish
the effect of the owner's ordinary sentences. No new background-rate improvement
is claimed for personal negatives: the four-hour results use the default heads.

After training, actual detector replay uses one second of leading silence,
the stored take and one second of trailing silence, resetting both detectors
and combiners between clips. Settings shows recognised N of 5 and negative
accepts for the selected sensitivity. Enabling requires at least 4/5 recognised
and zero accepted supplied negatives. Legacy profiles without replay evidence
must be retrained. This is explicitly a training-set check, not held-out recall.
All five languages include the gate, optional-negative instructions and retention
notice. Hidden fake-audio UI views were captured in both themes.

### CPU result and exact remaining obstacle

An isolated co-load probe successfully loaded and inferred with both native
runtimes. The previous blanket claim that they cannot share a process does not
hold for this installed Windows combination. Both now run serially in one
utility process, with one native inference thread per detector. The main process
no longer fans each frame out to two workers. Reset, scores and keyword timing
cross one detector RPC; the indicator is still published on state changes only.

| Process | Before, % one core | After, % one core |
| --- | ---: | ---: |
| Main, previously including KWS worker | 2.778 | 1.142 |
| Detector utility, embedding before / both after | 1.817 | 3.535 |
| Chromium audio service | 2.013 | 2.202 |
| Renderer 1 | 1.159 | 1.228 |
| Renderer 2 | 0.282 | 0.319 |
| Renderer 3 | 0.146 | 0.168 |
| Renderer 4 | 0.148 | 0.166 |
| GPU | 0.531 | 0.595 |
| Network service | 0.025 | 0.055 |
| **Total** | **8.890** | **9.404** |

Both runs use 60 seconds of real-time Chromium fake microphone input, all windows
hidden, isolated G: profiles and the i9-13900KF. These are development-app samples,
not a statistically significant speed comparison. The consolidation does not
meet the CPU target and does not demonstrate a reduction. Capture still depends
on renderer `getUserMedia`/AudioWorklet and `openSelectedMic`; the utility process
has no browser media-device API. Replacing that capture path, preserving device
selection, echo cancellation, pause/indicator authorization and failure handling,
and eliminating its per-100-ms IPC remain undone. The combined inference process
alone already consumes 3.535%; moving processes cannot by itself establish <4%.

### Verification and reproduction

Measured evidence: `wake-round3-results.json`. Local arrays, full logs and ten
UI captures: `G:/FILOW/tmp/wake-word/round3`. Full suite: 3,245 passed, six skipped;
typecheck and lint pass. Focused native fixture tests also pass with the downloaded
models. All 53 deliberately broken rules are caught and restored. Tests cover
independent augmentation hashes, embedding vectors, optimizer states, labels,
negative training/storage/removal, replay/reset, enable rejection, combined RPC
and the existing privacy/authorization rules. Temporary QA route is not shipped.

With TEMP/TMP and NUMBA_CACHE_DIR on G:, PYTHONDONTWRITEBYTECODE=1, and BLAS/OMP
threads set to one: run `original-stage.cjs` and `original-stage.py`, then
`round3-parity.cjs`, `round3-curve.cjs`, `round3-heldout.cjs` and
`background-heads.cjs` on the five held-out fixtures. The latter accepts
FILOW_WAKE_MODEL_DIR to reuse the verified models without copying them.
`round3-report.cjs` creates the committed numerical report. The reference scripts
do not overwrite the historical spike; their portable Python replacement lives
alongside the other diagnostic tools. `portable-fixture.py` regenerates the small
independent test fixture. `ui-qa.cjs` retains the 60-second CPU measurement;
FILOW_QA_WAKE_ENROLMENT_UI=1 instead runs the separate short visual check.

No merge, push, tag, real microphone, installed profile, paid service or visible
desktop interaction was used. All new files/caches are on G:. AGENTS.md is excluded.
Original real-room, live STT handoff, platform, low-tier hardware and model-card
limitations remain. A single owner count-only trial would settle the real-voice
accuracy question: five enrollment takes, then 100 unseen calls across quiet,
distance/noise and immediate-question conditions during at least 24 hours of
ordinary work. Report misses by condition and false accepts/hour. It cannot
waive the independently failed CPU target or substitute for fixing item 4.

## Round 2 partial checkpoint, 14 November 2026

**The requested round is incomplete. Training parity fails; do not ship.**
Main `78830a7` was merged in `041b650`, keeping both handoff sections and both
implementations. The merged baseline passed 3,232 tests with six skips,
typecheck and lint. AGENTS.md was not included in the merge commit.

This checkpoint fixes one additional framing mismatch, not the augmentation
gap identified in round 1. The app now finds the phrase end from complete
20 ms frames relative to peak energy, at the spike's -30 dB cutoff. It preserves
the whole recording, including its tail, during augmentation, and places labels
relative to the speech end. Previously an absolute sample cutoff trimmed the
recording and also determined label timing. Gain therefore moved the labels.
`positiveWindows` exposes the actual app training matrix to the diagnostic
exporter, replacing source-text interception.

The original spike was rerun with seed 12345 and identical five-take inputs for
all twenty voice-language profiles. Its output is byte-identical to round 1:
SHA-256 `fe814a333b021387fb5161465251f251006fbcfc85c1c7d610c737d6efd2abf9`.
Both comparisons use the same 500 cached Python embeddings and native keyword
detections. App hard negatives are disabled for this diagnostic comparison.
Each trainer retains its own background and threshold rule, so this measures
the remaining end-to-end training/calibration discrepancy, not just weights.

| Diagnostic, identical clips | Round 1 | Round 2 framing checkpoint |
| --- | ---: | ---: |
| App/reference Balanced decisions agreeing | 439/500 (87.8%) | 446/500 (89.2%) |
| App positive misses | 52/256 (20.31%) | 46/256 (17.97%) |
| App near-miss accepts | 99/144 (68.75%) | 98/144 (68.06%) |
| Python, only app positive matrix substituted: misses | 44/256 | 45/256 |
| Python, only app positive matrix substituted: near accepts | 94/144 | 94/144 |

The original Python reference remains 24/256 misses and 76/144 near accepts.
The isolated positive-matrix ablation does not improve, despite the better
full-app diagnostic result. Do not infer that this change resolves the known
augmentation problem. All 54 disagreement IDs, languages, decisions and scores
are in `wake-round2-training-parity.json`; ablation counts and 44 caught
mutations are in `wake-round2-framing.json`.

The gate `node tools/wake/training-parity.cjs <comparison.json> <report.json>`
requires 500 distinct clips and exits 1 below 98% agreement. It currently
**fails**. Its boundary regression checks 490 versus 489 agreements, and its
weakened-boundary mutation is caught. These unit tests passing do not mean
the actual training-parity acceptance gate passes. An initial gate mutation
survived because tools/wake was absent from Vitest discovery; discovery was
fixed and the mutation then failed as intended.

Final verification: 3,237 Vitest tests pass, five skip, typecheck and lint pass.
The downloaded-model feature regression ran rather than skipping. All 44
mutation cases were caught and restored (43 framing/existing rules plus the
new acceptance boundary). No UI behavior was changed or inspected this round.

The original spike trainer uses gain, duration-preserving pitch shifts,
one-second real-speech or silent lead-ins, fan/keyboard/traffic mixtures and
four end offsets, with sixteen variants per take. Speed and reverberation are
evaluation conditions, not augmentations in its `lr_train` function. The app
still uses speed/gain/white noise, its original SGD optimiser and quantized
background. No noise assets or replacement signals were shipped in this
checkpoint. Matching pitch/noise/lead-ins, RNG, all 30,000 background windows
and sklearn's balanced logistic objective remains outstanding.

No new held-out, four-hour background, hard-negative trade-off, personal-negative
or real-time CPU measurement was performed. The round 1 values below remain
historical evidence, not round 2 results:

| Held-out or CPU acceptance | Round 1 | Round 2 |
| --- | ---: | --- |
| Five-voice clean plus noisy misses | 13/48 (27.08%) | Not measured |
| Five-voice near accepts | 14/36 (38.89%) | Not measured |
| Balanced background, 4 h per head | 0.40/h mean, 1.25/h worst | Not measured |
| Main including KWS, one-core CPU | 2.97% | Not measured |
| Embedding utility CPU | 1.95% | Not measured |
| Chromium audio service CPU | 2.31% | Not measured |
| Renderers CPU | 1.90% | Not measured |
| GPU CPU | 0.81% | Not measured |
| Network service CPU | 0.03% | Not measured |
| Whole app CPU, 60 s | 9.96% | Not measured |

Optional personal negatives, detector/capture process consolidation, state-only
indicator updates and the required post-training "recognised N of 5" enable
gate are **not implemented**. There is no new experimental opt-in recommendation.
Before such a verdict, finish training parity and the five-head synthetic gates.
Owner acceptance then needs fresh held-out recordings after the five enrolment
takes: 100 calls across three days (40 close/quiet, 20 distant, 20 noisy,
20 after speech or with an immediate question), plus at least 24 hours of
count-only ordinary work. Measure miss rates, background events, ten repetitions
of each named near-miss, p90 wake latency and 60-second per-process CPU, comparing
the same head with and without the two personal negatives. The design's real-room
limits are at most 5% close/quiet misses, 15% in other groups, one Balanced false
wake per eight hours and p90 latency at most 0.7 seconds. The round 2 synthetic
limits remain 10% misses, 0.2 false accepts/hour and under 4% total one-core CPU.
Replay of the five training takes is a self-check, not held-out evidence.

All work used existing synthetic WAVs. No real microphone, visible UI, installed
profile, push, tag or merge into main was used. The unimplemented work above,
real rooms, real STT handoff, low-tier hardware, other platforms and licence-card
confirmation remain unverified.

## Rework round 1, 14 November 2026

**Incomplete acceptance: would not ship, including as an experimental opt-in.**
This round fixes a measured streaming feature defect, adds numerical hard
negatives and measures the remaining gap. It does not achieve training parity,
the requested miss rate, or the whole-app CPU target. Historical evidence below
is retained; this section supersedes its conclusions about the cause of the gap.

### Identical-input diagnosis

`parity-reference.py` runs the unmodified spike `feats.embed` on the exact 500
16 kHz PCM WAVs exported for the app: 100 enrolment takes, 256 positives and 144
near-misses. Python soundfile and the app decode the same PCM16 values using
32768; no resampling occurs in this comparison. Both use the same pinned models,
32 mel bands, 76-frame embedding windows, eight-frame stride, 96 unit-normalized
features and twelve-vector head. Both native runtimes use one inference thread.

The first measured divergence is **mel normalization in streaming**, not ONNX
embedding inference. The mel graph ends with `ReduceMax`, subtracts 80 dB and
clips the whole input to that floor. Full-clip silence therefore depends on a
later loud sound. Calling it separately on each 1,760-sample block and merely
concatenating its outputs gives a different floor every 80 ms.

| Numerical check, same WAVs | Before | After |
| --- | ---: | ---: |
| Offline embedding max absolute error vs Python | 1.19e-7 | 1.19e-7 |
| Final retained streaming context, worst cosine | 0.810150 | 0.9999999999966 |
| Final retained streaming context, max absolute error | 0.203027 | 7.90e-7 |
| Shared Python head, JS vs Python score max error | 2.03e-6 | 2.03e-6 |
| Python vs Node spotter detection times, 500 clips | 500 match | 500 match |

The stream now retains the head's mel context, applies the prefix-wide 80 dB
floor and recomputes cached embeddings when that floor rises. Memory remains
bounded. Reset clears the normalization state. Three small numerical reference
vectors generated by the unmodified Python pipeline are committed in
`wake-data/reference.json`; the native parity test uses deterministic generated
PCM, not stored audio, and tests the actual ONNX sessions.

**Scope of parity:** the 500-file streaming check compares the final retained
context at the same frame indices. It does not assert that early causal outputs
can use future audio. The spike's whole-file normalization is noncausal. Exact
whole-file scores at every live timestamp cannot be promised from these tests.
The maximum persists until capture reset; long-running changes in input gain
still need investigation. Streaming/training equivalence is not fully closed.

The spotter check runs the same fifteen keywords in one search, maxActivePaths
16, 100 ms input blocks, boost 2.5 and keyword threshold 0.05, plus an identical
two-second tail. The API exposes detections, not a numeric confidence score, so
the evidence records detection times. The spike headline instead unions fifteen
independent searches. That union is not the app's search configuration.

The Python trainer was rerun on the identical five WAVs for each of the twenty
voice-language profiles, with seed 12345. This controlled comparison uses the
spike's per-clip maximum score and real fifteen-keyword detections:

| Head, same 256 positives / 144 near-misses | Misses | Near-miss accepts |
| --- | ---: | ---: |
| Original Python trainer | 24 (9.38%) | 76 (52.78%) |
| Python trainer, only positive augmentation replaced by the app's | 44 (17.19%) | 94 (65.28%) |
| Original app trainer | 52 (20.31%) | 99 (68.75%) |
| App trainer plus hard negatives | 60 (23.44%) | 63 (43.75%) |

These are diagnostic numbers, not held-out accuracy claims. The Python reference
reproduces its historical threshold selection on its evaluation background.
That is not an independent calibration split. Native chronological replay below
also applies the agreement window, cooldown and continuous detector state, so
its counts differ slightly from per-clip maximum scoring.

With shared weights, head score arithmetic agrees to 2.03e-6. The remaining
learned-head discrepancy is in training/calibration, and has **not been fixed**:
the spike uses pitch shifts, real lead-in speech, fan/keyboard/traffic noise,
30,000 unquantized background windows including noisy mixes and sklearn's
balanced logistic regression (C=1, max_iter=300). The app uses speed/gain/white
noise augmentation, quantized Common Voice features, a smaller training
partition and 50 epochs of 2,400 SGD updates. A controlled ablation changes only
the positive training matrix, keeping Python's optimizer, negative samples and
threshold rule fixed: misses rise from 24 to 44 and near-miss accepts from 76
to 94. This establishes augmentation as a major cause. The remaining difference
between that ablation and the full app has not been separated into optimizer,
negative-data and calibration contributions. Do not describe the feature fix
alone as closing the published 12.5% vs 19.5% gap.

### Hard negatives and calibration

`hard-negatives.bin` contains 298 float32 feature windows, 1,373,184 bytes, from
synthetic near-misses. No audio is shipped. Its JSON records source clip IDs,
phrases, speaker/language identities and SHA-256. Training checks both its size
and checksum, and uses hard negatives for one fifth of negative updates. They
include the problematic fellow/follow-like phrases. Applying them requires
retraining; existing profiles are not silently retrained.

The calibration corpus has twenty voice-language profiles, but only eight
distinct speaker IDs. The hard-negative corpus uses separate speaker IDs. The
final held-out corpus uses five further distinct IDs: kokoro_v14/en,
supertonic_v6/it, supertonic_v7/ru, supertonic_v8/ro and supertonic_v9/ja. Each
gets five enrolment WAVs and is tested on separate takes. An earlier diagnostic
split reused a Supertonic speaker across languages; it is excluded from the
final held-out results.

Thresholds remain per-head order statistics from 2.09056 hours of calibration
background, disjoint from the training third of the shipped first-fifth
partition. The frozen budgets are loose=5/hour, sensitive=0.5/hour and
sure=0.1/hour. Strict requires spotter plus loose head; Balanced accepts sure
head or spotter plus loose head; Sensitive uses its head threshold alone. No
threshold was adjusted after examining the final held-out results. These are
retained calibration rules, not a newly optimized set that meets the requested
operating point. Actual per-head thresholds and all three modes' background
counts are in the evidence JSON.

Two personal negative recordings were not added to enrolment. The current flow
retains exactly five positive recordings; a transient-negative flow and its
retraining behavior remain unimplemented. Acoustically identical readings of
"OK Filow" and "OK fellow" cannot be distinguished by this audio-only system.

### Before and after

| Balanced, chronological native replay | Baseline | Feature fix only | Hard-negative rework |
| --- | ---: | ---: | ---: |
| Calibration positives missed | 50/256 (19.53%) | 50/256 (19.53%) | 62/256 (24.22%) |
| Calibration near-misses accepted | 95/144 (65.97%) | 97/144 (67.36%) | 62/144 (43.06%) |
| Calibration clean plus noisy misses, excluding pitch shifts | not recomputed | 28/192 (14.58%) | 28/192 (14.58%) |
| Final held-out misses, including pitch shifts | not measured | not measured | 20/64 (31.25%) |
| Final held-out clean plus noisy misses | not measured | not measured | 13/48 (27.08%) |
| Final held-out near-misses accepted | not measured | not measured | 14/36 (38.89%) |
| Background | 0 events / 2 h, one head | 0 events / 2 h, one head | 0.40/hour mean, 1.25/hour worst; 4 h on each of five heads |
| Whole development app CPU, one-core equivalent | 15.71%, 15 s | 10.64%, 60 s | 9.96%, 60 s |

The calibration near-miss improvement is paid for with more misses overall.
The 15-second historical CPU run is not a controlled baseline for the 60-second
runs. The two new runs each have five seconds of warm-up, then 60 seconds of
real-time Chromium fake-microphone capture with a looped positive WAV in
count-only mode; capture stays open instead of starting an assistant question.
The audio scheduling hint changes
from default to `playback` only for wake capture; PCM remains 16 kHz and 100 ms.
This single pair is an observation, not a statistically established saving.

Final held-out per-language misses:

| Language / distinct speaker | All conditions | Clean plus noisy, excluding pitch shifts |
| --- | ---: | ---: |
| English / kokoro_v14 | 10/32 (31.25%) | 7/24 (29.17%) |
| Italian / supertonic_v6 | 3/8 (37.50%) | 2/6 (33.33%) |
| Russian / supertonic_v7 | 0/8 (0%) | 0/6 (0%) |
| Romanian / supertonic_v8 | 3/8 (37.50%) | 1/6 (16.67%) |
| Japanese / supertonic_v9 | 4/8 (50%) | 3/6 (50%) |

The sample sizes are small, especially outside English. They are enough to
disprove the requested 10% miss target here, not to establish real-user accuracy.

The final background run uses four hours of Common Voice speech outside the
training/calibration partition, 48 minutes per language, in chronological 100 ms
chunks. It is accelerated replay, not four hours of wall-clock microphone use.

| Enrolled speaker | Loose / sensitive / sure thresholds | Strict events / 4 h | Balanced events / 4 h | Sensitive events / 4 h |
| --- | --- | ---: | ---: | ---: |
| kokoro_v14 | -0.498022 / 0.929743 / 2.078382 | 2 | 2 | 7 |
| supertonic_v6 | -1.221778 / 0.952413 / 1.215965 | 0 | 0 | 0 |
| supertonic_v7 | -0.925165 / 0.108705 / 1.216434 | 1 | 1 | 7 |
| supertonic_v8 | -0.376355 / 1.172132 / 1.751488 | 2 | 5 | 3 |
| supertonic_v9 | -0.476065 / 1.252982 / 1.659725 | 0 | 0 | 1 |

Balanced has eight events in twenty head-hours: mean 0.40/hour and worst
1.25/hour. Both exceed 0.2/hour. Even the zero-event heads do not establish a
rate below 0.2/hour: four hours without an event has an approximate one-sided
95% Poisson upper bound of 0.75/hour. Background was not re-used to retune these
profiles after scoring. Strict averages 0.25/hour; Sensitive averages 0.90/hour.

Whole-app CPU after the scheduling change: main process including KWS 2.97%,
embedding utility 1.95%, Chromium audio service 2.31%, renderers 1.90%, GPU 0.81%,
network service 0.03%. The aggregate is 9.96% of one core on this i9-13900KF.
There is still one native inference thread per detector. Process accounting
does not isolate IPC from KWS in the main process or the conversion callback
from rendering in a tab. The 4% total target is not met. Additional scheduling
latency, packaged-app cost and a low-tier machine remain unverified.

### Reproduction and remaining work

Machine-local WAVs, profiles, original logs and raw arrays stay under
`G:/FILOW/tmp/wake-word`. The committed `wake-round1-results.json` records every
clip's embedding errors, head scores and keyword detection times, plus aggregate
replays, CPU process breakdowns and mutation results. All comparisons are local;
there were no paid calls, real microphones or visible windows.

Run the scripts in `tools/wake` with TEMP/TMP on G:, Python bytecode disabled,
NUMBA_CACHE_DIR on G: and BLAS thread counts set to one. The sequence is
`parity-reference.py`, `parity.cjs` (also `--baseline`), `spotter-reference.py`,
`spotter-parity.cjs`, `train-reference.py`, `compare-heads.cjs`,
`export-app-augmentation.cjs`, `augmentation-ablation.py`, then the native
replays. `prepare-qa.py --held-out` asserts five distinct speaker IDs.
`background-heads.cjs` evaluates all five heads on one shared feature/spotter
pass over four hours of unique audio, with identical timing and separate
combiners. This is twenty head-hours, not twenty hours of independent audio.
The fake microphone CPU test remains a separate real-time test.

Set FILOW_WAKE_MODEL_DIR to the verified model directory for the native numerical
Vitest gate. Without downloaded models that one test is explicitly skipped;
the pure normalization, stride/reset, hard-negative and capture tests still run.
All 40 mutations were caught. Full Vitest: 3,170 passed, six skipped, across
252 passing files and two skipped files. Typecheck and lint pass.

Remaining acceptance work: training/augmentation/calibration parity, a genuinely
passing held-out operating point, lower whole-app CPU, long-running normalization
under changing gain, personal negatives, detection latency with the larger buffer,
and the original real-voice/room, STT handoff, platform and licence-card checks.
None of the requested numerical acceptance targets should be marked complete.

## Implementation and defaults

`apps/desktop/wake-policy.js` names the defaults in `DEFAULTS` and the fifteen
phone spellings in `SPELLINGS`. The settings sensitivity defaults to Balanced.

1. Phrase: OK Filow, including FEE-lo, FY-lo and fellow-like variants. The five
   personal recordings determine the head in practice.
2. No longer phrase.
3. No follow-up question window after an answer (`followUpMs: 0`).
4. No interruption while Filow speaks (`interruptSpeech: false`, 600 ms holdoff).
5. Disabled during every take and slide show.
6. Closing the eye or pressing Pause also stops wake capture.
7. No bundled detector models. Explicit setup consent downloads 35,300,235 bytes
   from official sherpa-onnx and openWakeWord GitHub releases. SHA-256 pins cover
   the archive and every extracted/individual model. There are no startup or
   listening downloads. Licence facts and the training-data caveat live in
   `scripts/third-party-notices.mjs`, the notices generator input.
8. Five accepted WAVs remain in the app profile under `wake/samples`, alongside
   the personal `wake/profile.json`. Delete removes both. Downloaded shared models
   remain available. Ordinary listening audio exists only in bounded RAM buffers.

The feature starts off on each app launch, even with a trained profile. Setup,
five takes with level meter/playback and accept/re-record, background training,
try mode, sensitivity, retraining and deletion live in Settings. The experimental
label and listening/off controls are translated in en, it, ru, ro and ja.

Both detectors consume identical 16 kHz mono, 100 ms blocks. Sherpa uses the zh-en
phone-token model, maxActivePaths 16 and one native inference thread. The embedding
runtime is isolated in an Electron utility process, sequential execution with one
intra-op and one inter-op thread setting. This avoids loading incompatible native
ONNX runtimes together. Neither detector uses a two-thread inference pool.

Strict requires keyword and loose head agreement within 1.2 seconds; Balanced
accepts a sure head or keyword plus loose head; Sensitive accepts the head alone
at its sensitive threshold. All modes debounce for two seconds. Training uses
deterministic regularized logistic SGD with gain, speed and noise augmentation.
Thresholds use a separate calibration partition of bundled CC0 background
embeddings. These are derived features, not model weights or retained mic audio.
See `wake-data/background.json` for provenance and checksum.

## Microphone invariant

The microphone must never be open without a visible indication. Wake capture
requires an acknowledged persistent pill with a one-click Off control. Losing the
indicator, pausing, closing the eye, taking/slideshow, another audio mode, lock or
suspend revokes capture. Capture generations discard late open/inference results.
The saved device is honored through `startMic -> openSelectedMic`. A failed or
stalled open fails closed and exposes the reason. The four-second watchdog has
separate explicit wake and question authorizations; idle is not blanket permission.

A wake triggers the existing hands-free question path and its `opening` state.
Only that question receives a bounded authorization. KWS timing, or a 200 ms
head-only trailing-context estimate, carries buffered post-phrase audio into STT.
There is no automatic follow-up question. Wake processing never requests an
outbound kind. A subsequent normal question retains the existing provider/privacy
rules. No cloud service was used in QA.

## Evidence from 14 November 2026

All UI instances were hidden, used fake WAV audio, isolated G: profiles and ports
4971/9571, with `FILOW_QA_NO_GLOBAL_INPUT=1` and `FILOW_QA_HEADLESS=1`. No real
microphone, global input hook, synthetic desktop input, installed app or paid API
was used. Screenshots of Settings in both themes were inspected.

| Balanced evaluation | This branch | Design spike |
| --- | ---: | ---: |
| Positive clips | 256, 20 synthetic voices, five languages | 2,032, 89 voices |
| Misses | 50 / 256 (19.53%) | 12.5% |
| Near-miss accepts | 95 / 144 (65.97%) | 51.6% |
| Background | 7,200 s, 0 accepts, 0 observed FA/hour | approximately 0.15 FA/hour |
| Native replay CPU, one-core equivalent | 5.23% | approximately 5.2% total |
| Renderer replay CPU, one-core equivalent | 3.87% | not measured |
| Full development app, 15 s real-time fake mic | 15.71% | not measured |

Host: Intel Core i9-13900KF. Final validation: 251 test files passed, two skipped;
3,164 tests passed, six skipped. All 33 deliberate mutations were caught. The six
hidden UI checks passed. Typecheck and lint passed. Skips include the physical
global-input hook test, intentionally disabled by the QA isolation flag.

`e2e-results.json` records the hidden renderer replay through the production
capture conversion, IPC, controller and both native detectors. The corpus has
clean, pitch-shifted, fan, keyboard, traffic and far-field positives; enrollment
and positive test takes are separate. Background consists of 24 minutes each of
en/it/ru/ro/ja Common Voice speech outside the first-fifth training/calibration
partition, with an additional gap. Background was tested with the first synthetic
voice's head only, not all twenty profiles. Zero events in two hours is not a
production false-accept-rate guarantee (the approximate 95% Poisson upper bound
is 1.5/hour).

Replay is accelerated, not two hours of wall-clock microphone operation. CPU is
process CPU time divided by audio duration; renderer/native runs differ in
transport and scheduling, so their CPU figures are estimates, not a controlled
benchmark. `ui-results.json` additionally records a 15-second real-time Chromium
fake-microphone run and its measured CPU, indicator, take, slide show, eye, Pause
and one-click Off checks. Renderer background replay had zero outbound attempts.
Unit tests intercept fetch/http/https/net during listening and check unchanged
disk contents. Model verification/download tests exercise explicit consent,
size and hash failures. `mutations.json` records deliberately broken rules caught
by tests, including stale inference after pause.

The real-time number includes all Electron renderers and development UI overhead,
not just the listening detector process. This needs a packaged-app measurement
before making a battery/CPU claim. The spike is not an identical benchmark: this run uses a smaller voice sample,
quantized background features, deterministic SGD instead of its training stack,
different augmentation and a disjoint calibration partition. The spike's combined
figures also approximated the fifteen-spelling path. These changes can explain a
gap but do not establish its cause. No thresholds were tuned against this QA set.
The higher miss and near-miss rates remain a regression requiring further work.

## Reproduction

Keep TEMP, TMP, npm/Electron caches and all evidence under `G:\FILOW\tmp\wake-word`
or `G:\caches`. Use a hard process-tree deadline and hidden child windows. The QA
scripts reject missing isolation flags and profiles outside the task root.

1. Use `tools/wake/prepare-qa.py` with the trusted local spike to export fixtures.
   `tools/wake/export-background.cjs` reproduces the bundled feature partition.
2. With explicit consent, download/verify official files using `wake-models.js`
   into the isolated native QA profile. `tools/wake/native-qa.cjs` runs Electron
   without windows against those fixtures.
3. Copy `tools/wake/replay-page.tsx.fixture` temporarily to
   `apps/web/app/okfilow/wake-qa/page.tsx`. Start Next on 127.0.0.1:4971 with telemetry
   disabled. Run Electron `tools/wake/ui-qa.cjs` with an isolated `ui-profile` and
   `FILOW_QA_WAKE_REPLAY=1`. The script has a 20-minute deadline and blocks all
   browser requests except local static pages/devtools. Without that flag it runs
   the short UI checks. Remove the temporary route after QA; it is not shipped.
4. Run `node tools/wake/mutations.cjs <G:-evidence-path>` then `npx vitest run`,
   `npm run typecheck`, `npm run lint`, with both QA isolation flags set. The
   native global-input test is intentionally skipped under those flags.

## Not verified / would not ship

The owner's real voice in a real room is untested. No physical microphone was
opened. Long wall-clock capture, suspend/device-loss on real hardware, lower-tier
CPU, macOS/Linux, installer/update migration and spoken-question STT handoff have
not been exercised end to end. The buffered phrase boundary is an estimate for
head-only wakes and needs real speech validation. The background rate applies to
one trained head. The original Google embedding model card remains unverified;
the Apache-2.0 statement is attributed to openWakeWord, with no claim about an
unstated training corpus. These limitations and the high near-miss rate block a
shipping recommendation. Keep this branch experimental, off by default and unmerged.
