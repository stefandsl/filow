# Experimental OK Filow wake word

Branch: `feat-wake-word`, based on `3479560`. Not a release recommendation.

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
