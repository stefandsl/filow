# Filow wake evaluation, 21 November 2026

Balanced detected all 15 original OK Filow clips after round 1 detected 10. It also detected all 15 original bare calls. On the frozen set it detected 29/30 OK calls and 24/30 bare calls. Two of the five new profiles needed more enrolment takes before the app would enable Balanced.

| Evaluation | Spoken form or measure | Strict | Balanced | Sensitive |
|---|---|---:|---:|---:|
| Round 2 | Filow | 9/15 | 15/15 | 13/15 |
| Round 2 | OK Filow | 11/15 | 15/15 | 15/15 |
| Round 2 | Hey Filow | 4/5 | 4/5 | 4/5 |
| Round 2 | near-word accepts | 0/20 | 3/20 | 2/20 |
| Round 2 | false wakes/h | 0.00 (0/4 h) | 0.50 (2/4 h) | 1.50 (6/4 h) |
| Held-out | Filow | 8/30 | 24/30 | 28/30 |
| Held-out | OK Filow | 24/30 | 29/30 | 30/30 |
| Held-out | Hey Filow | 24/30 | 27/30 | 29/30 |
| Held-out | near-word accepts | 3/60 | 11/60 | 14/60 |
| Held-out | false wakes/h | 0.00 (0/6 h) | 0.00 (0/6 h) | 0.67 (4/6 h) |

The table gives raw detector counts for all five profiles. Each false-wake rate uses continuous normal speech, with all wake forms active in one detector. Near-word accepts have a separate denominator. Six hours with zero observed false wakes gives a one-sided 95% Poisson upper bound of 0.50 wakes/h, assuming a constant event rate. The voices and microphones in a classroom can differ from this corpus.

## Enrolment and held-out results

The packaged app enables a profile only when the selected mode recognizes at least four of its five enrolment takes and rejects its personal negatives. The following table gives held-out Balanced results and replay eligibility for all three modes. Each profile used five separate bare takes and zero personal negatives.

| Language | Eligible Strict/Balanced/Sensitive | Filow | OK Filow | Hey Filow | Near accepts | Speech minutes |
|---|---|---:|---:|---:|---:|---:|
| en | no/yes/yes | 6/6 | 6/6 | 5/6 | 3/12 | 90 |
| it | no/no/yes | 4/6 | 6/6 | 6/6 | 3/12 | 90 |
| ro | yes/yes/yes | 5/6 | 6/6 | 6/6 | 2/12 | 35 |
| ru | no/yes/yes | 5/6 | 6/6 | 5/6 | 2/12 | 80 |
| ja | no/no/yes | 4/6 | 5/6 | 5/6 | 1/12 | 65 |

Among the three profiles that could enable Balanced, detector counts were 16/18 bare, 18/18 OK and 16/18 Hey, with 7/36 near words accepted and zero false wakes in 205 minutes. Only the Romanian profile could enable Strict. All five could enable Sensitive. Strict reduced held-out near accepts from 11 to 3 and bare detections from 24 to 8.

### Corpus separation

The development set kept the original five synthetic language profiles, 15 calls per main form, five Hey calls, 20 near words and four hours of speech. The first 18 minutes per language had been used for tuning and these voices had already been scored. English follow, fellow, pillow and video also occurred in the old training bank.

The frozen protocol at `3811f0e` reserved Supertonic speakers 5, 6 and 7, six evaluation rates per form, and six different near words per language rendered twice. The original development voices were 0 through 4, and the phrase banks used speakers 8 and 9. New English near words included hello, philosophy, willow, below, yellow and hero. Other languages included profilo, pernă, подушка and 疲労. For each language, the exporter excluded every utterance ID in the earlier Common Voice 22 corpus before selecting speech. This yielded 3,928 distinct clips and 360 minutes. The selection protocol was committed before tuning. Rendering finished during development, and the WAV manifest was sealed before final detector selection. Held-out scores were read after selection. [Frozen corpus receipt](wake-filow-freeze.json)

### Historical comparison on the original corpus

| Original corpus | Spoken form or measure | Strict | Balanced | Sensitive |
|---|---|---:|---:|---:|
| Legacy OK profile | Filow | 0/15 | 13/15 | 15/15 |
| Legacy OK profile | OK Filow | 11/15 | 15/15 | 15/15 |
| Legacy OK profile | Hey Filow | 4/5 | 4/5 | 3/5 |
| Legacy OK profile | near-word accepts | 0/20 | 7/20 | 7/20 |
| Legacy OK profile | false wakes/h | 0.00 (0/4 h) | 0.75 (3/4 h) | 0.75 (3/4 h) |
| Round 1 | Filow | 14/15 | 15/15 | 15/15 |
| Round 1 | OK Filow | 10/15 | 10/15 | 9/15 |
| Round 1 | Hey Filow | 4/5 | 4/5 | 4/5 |
| Round 1 | near-word accepts | 5/20 | 5/20 | 4/20 |
| Round 1 | false wakes/h | 0.75 (3/4 h) | 0.75 (3/4 h) | 1.25 (5/4 h) |

The legacy baseline enrolled OK Filow at `a7962fc`. Round 1 enrolled bare Filow at `a8561c4`. Round 2 used the same development WAVs and a new personal head. The previous prefix selector visited only odd indices, all Hey clips. Training now cycles through both prefixes and includes end-aligned features from natural synthetic prefixed calls. The bare lexicon excludes the phonemes for hero. Strict requires keyword agreement and a score above the strong personal threshold.

Turning off **Allow Filow alone** keeps listening active and requires the prefix spotter at boost 1 and threshold 0.4. At Balanced, the production combiner rejected 15/15 bare calls on the development set and detected 10/15 OK and 3/5 Hey calls in this mode. With bare calls allowed it detected 15/15 OK and 4/5 Hey. The evaluation saves actual seconds, counts, enrolment eligibility and denominators. [Per-language results](wake-filow-results.json)

## Packaged desktop and upgrades

A QA-marked Windows package built from `6f9e671` trained a new English profile on five takes. The harness delivered one 1,600-sample block every 100 ms through the panel's capture callback. The native detectors and IPC ran in the package, with an isolated profile, offline mode and global input disabled. Settings displayed the checked default in light and dark themes.

| Balanced setting | Input | Observed result |
|---|---|---|
| Allow bare, default | follow | 0 wakes, listening continued |
| Allow bare | Filow, then OK Filow | 1 wake each |
| Require prefix | Filow twice, then OK Filow | 0, 0, 1 wakes |
| Allow bare again, ordinary question mode | Filow | 1 wake and 1 question event |

All seven cases finished without capture errors. The ordinary question event arrived about 2.27 seconds after the start of the padded clip. The receipt includes the package archive digest and per-clip measurements. [Packaged and evaluation evidence](wake-filow-results.json)

The factory integration suite now runs in its own Vitest scheduling group. Previously, real Git and Node children competed with the general file workers, and one test performed five separate checkout recoveries within a single timeout. The scoped rule and builder-packet tests took 2.46 and 3.98 seconds on the local full gate. Independent checkout recovery cases took 1.64 to 2.33 seconds. The packaged source passed branch checks. [Windows CI](https://github.com/stefandsl/filow/actions/runs/44849714701)

The keyword spotter alone processed one warm-up minute followed by the same 600 measured 100 ms speech blocks in a fresh process for each list. The 95th-percentile times were 5.02 ms for the 15 legacy spellings, 5.25 ms for the 41 round-1 spellings and 5.41 ms for the 39 current spellings. The renderer sends one inference request at a time and buffers at most two additional 100 ms blocks. Sustained overload still closes capture. Stopping drops pending audio.

A verified legacy profile keeps its head and keywords while the new five takes are collected. Failed migration preserves the previous profile byte for byte and leaves it usable with the prefix-only preference. Successful replacement deletes the old takes and optional negatives. If the app exits after saving the profile, it retries deletion on startup. The assistant retains the product name **OK Filow**.

## Reproduction

Use local Supertonic 3 int8 weights, the verified wake models, the local Common Voice 22 dev archives and workspace dependencies. Keep the frozen WAVs with their manifest. Fresh TTS rendering is stochastic. The evaluator rejects changed files or a mismatched manifest digest.

```text
python tools/wake/freeze-corpus.py TTS_MODEL CV_ARCHIVES OLD_CLIP_IDS NEW_FROZEN_DIR
node tools/wake/phrase-eval.cjs WAKE_MODELS NEW_FROZEN_DIR frozen RESULTS 0 en 0 bare MANIFEST_SHA256
node tools/wake/phrase-eval.cjs WAKE_MODELS DEVELOPMENT_CLIPS BACKGROUND_DIR RESULTS 48 en 0 bare
node tools/wake/phrase-eval.cjs WAKE_MODELS DEVELOPMENT_CLIPS BACKGROUND_DIR PREFIX_RESULTS 0 en 0 prefix
```

Repeat each command for it, ro, ru and ja in separate results directories. The original development clips come from `tools/wake/phrase-clips.py` and the four-hour background from `tools/wake/prepare-qa.py --held-out`. To regenerate prefixed training features, use `phrase-clips.py TTS_MODEL CALLS --training-calls` followed by `export-prefixed.cjs WAKE_MODELS CALLS DEST` with Node. The shipped bank used previously rendered alternate OK clips from the original Supertonic corpus as the exporter's optional final argument.

For packaged replay, install playwright-core for the harness, generate a QA-marked unpacked Windows package and run the command below. The last argument must name a fresh profile. The harness allocates separate loopback ports, uses the real Settings checkbox and writes per-clip counts, question events, elapsed times and the rendered checkbox state in each theme.

```text
node tools/wake/packaged-replay.cjs PACKAGED_EXE WAKE_MODELS DEVELOPMENT_CLIPS/en NEW_PROFILE
node tools/wake/spotter-cost.cjs WAKE_MODELS NORMAL_WAV KEYWORD_LIST
```
