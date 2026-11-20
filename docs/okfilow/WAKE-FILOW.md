# Filow wake evaluation, 20 November 2026

Five Supertonic 3 voices each supplied five enrolment takes and three held-out takes at different speaking rates in English, Italian, Romanian, Russian and Japanese. The baseline enrolled OK Filow and used the keyword list, personal head and combiner from a7962fc. The candidate enrolled Filow. Both ran the streaming detectors in 100 ms blocks with the production replay gate and cooldown.

Normal speech comprised the same 48-minute Common Voice segment per language in both runs, four hours per version. Each language also supplied four confusables and one Hey call. English confusables were follow, fellow, pillow and video. Synthetic calibration used other voices reading the same confusables. The first 18 minutes of each speech segment and the synthetic clips were used during tuning. These measurements cover this corpus. New speakers, classroom acoustics and physical microphones still need field validation.

| Sensitivity | Target detections before /15 | Filow after /15 | False wakes/hour before | False wakes/hour after | Near accepts before /20 | Near accepts after /20 |
|---|---:|---:|---:|---:|---:|---:|
| Strict | 11 | 14 | 0.00 (0/4 h) | 0.75 (3/4 h) | 0 | 5 |
| Balanced | 15 | 15 | 0.75 (3/4 h) | 0.75 (3/4 h) | 7 | 5 |
| Sensitive | 15 | 15 | 0.75 (3/4 h) | 1.25 (5/4 h) | 7 | 4 |

Counts above show raw detector performance including profiles that the enrolment replay would block. The baseline Japanese profile failed Strict replay. Replay eligibility is recorded below in Strict, Balanced, Sensitive order.

| Language | Baseline eligible | Candidate eligible | Old OK /3 | Old Filow /3 | New Filow /3 | New OK /3 | New Hey /1 | New near /4 | Normal false wakes before / after |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
| en | yes/yes/yes | yes/yes/yes | 3 | 3 | 3 | 3 | 1 | 1 | 2 / 1 |
| it | yes/yes/yes | yes/yes/yes | 3 | 3 | 3 | 1 | 1 | 2 | 1 / 2 |
| ro | yes/yes/yes | yes/yes/yes | 3 | 3 | 3 | 3 | 1 | 1 | 0 / 0 |
| ru | yes/yes/yes | yes/yes/yes | 3 | 3 | 3 | 2 | 1 | 0 | 0 / 0 |
| ja | no/yes/yes | yes/yes/yes | 3 | 1 | 3 | 1 | 0 | 1 | 0 / 0 |

The language breakdown uses Balanced sensitivity. The legacy training bank included translated Hey Filow calls among its negatives. The new bank excludes those calls, adds multilingual synthetic prefixes to half of the positive examples and uses dedicated near-word embeddings. Bare spellings use boost 2.35 and threshold 0.12. Prefixed spellings retain 2.5 and 0.05. All modes require a score from the speaker's trained head. The option to accept Filow alone defaults on for new profiles and can be switched off without retraining. With it off, all three modes also require the spotter to recognize an explicit OK or Hey prefix. In this mode, boost 1 and threshold 0.4 rejected 15/15 bare clips in a separate spotter-only check, detecting 10/15 OK and 4/5 Hey calls.

## Reproduction

Run from the repository root with installed workspace dependencies, local Supertonic 3 int8 weights, the verified desktop wake models, and the five background WAVs exported by `tools/wake/prepare-qa.py --held-out`. Supply the output paths on the project volume.

```text
python tools/wake/phrase-clips.py SUPERTONIC_MODEL CLIPS
node tools/wake/phrase-eval.cjs WAKE_MODELS CLIPS BACKGROUND_DIR RESULTS 48
```

Each results row records the actual speech duration, eligibility and counts per sensitivity. Synthesis is stochastic. Preserve the generated WAVs for paired reruns. To regenerate the shipped training inputs, pass `--training-bank` to the clip generator with a separate destination and run `node tools/wake/phrase-bank.cjs WAKE_MODELS TRAINING_CLIPS apps/desktop/wake-data`.

## Desktop and upgrade

Existing verified profiles use their original keywords and head. Settings explains how to switch in each language. The five new recordings use a separate directory. The earlier profile stays usable while those takes are collected. The assistant retains its product name **OK Filow** in Settings, the panel and product documentation.

The isolated Windows QA package used ports 34971 through 34975 and a G: profile. Settings displayed the new Italian recording prompt in light and dark themes. Five local takes trained the packaged verifier. An earlier candidate opened a question when a held-out Filow clip played through Chromium's file-backed microphone with count-only mode off. Transcription then requested an additional speech model. On detector revision bdccc8c, the prefix-required setting rejected the repeated bare clip. With bare calls enabled, the packaged detector stopped on microphone timing overruns in repeated runs, including a run with background throttling disabled. The final packaged positive wake remains unverified. Branch CI passed. Three unrelated local factory tests timed out during the full suite and the entire 66-test factory file passed on retry.
