# N-06 decision and teaching pilot

**No route-language pair has qualified.** Day-by-day keeps presenter confirmation. Open-ended teaching remains HELD. The independent split and private payload digests are in [the public freeze](N06-FREEZE.md).

## Decision results

NM means unmeasured. Each language has 5 development and 15 held-out reports. The operator has not supplied inference or grading receipts for these cells. Correct automatic ticks count the route's unassisted selection of one correct row before confirmation. Missed clear reports stay in the denominator. A presenter choosing a recipient, a typed review and the journal write after confirmation cannot add a correct automatic tick.

| Route | Language | Correct / clear (95% CI) | False / negative (95% CI) | Clarify / clear (95% CI) | Qualification |
|---|---|---|---|---|---|
| Pinned lexical matcher | EN | NM | NM | NM | Unqualified |
| Pinned lexical matcher | IT | NM | NM | NM | Unqualified |
| Pinned lexical matcher | JA | NM | NM | NM | Unqualified |
| Pinned lexical matcher | RO | NM | NM | NM | Unqualified |
| Pinned lexical matcher | RU | NM | NM | NM | Unqualified |
| Granted Gemma 4 E2B | EN | NM | NM | NM | Unqualified |
| Granted Gemma 4 E2B | IT | NM | NM | NM | Unqualified |
| Granted Gemma 4 E2B | JA | NM | NM | NM | Unqualified |
| Granted Gemma 4 E2B | RO | NM | NM | NM | Unqualified |
| Granted Gemma 4 E2B | RU | NM | NM | NM | Unqualified |
| Liquid d1-2B | EN | NM | NM | NM | Unqualified |
| Liquid d1-2B | IT | NM | NM | NM | Unqualified |
| Liquid d1-2B | JA | NM | NM | NM | Unqualified |
| Liquid d1-2B | RO | NM | NM | NM | Unqualified |
| Liquid d1-2B | RU | NM | NM | NM | Unqualified |
| Character trigram classifier | EN | NM | NM | NM | Unqualified |
| Character trigram classifier | IT | NM | NM | NM | Unqualified |
| Character trigram classifier | JA | NM | NM | NM | Unqualified |
| Character trigram classifier | RO | NM | NM | NM | Unqualified |
| Character trigram classifier | RU | NM | NM | NM | Unqualified |

Wrong-target choices, correction recovery, abstentions and confirmed writes are unmeasured in every held-out cell. The offline classifier supports character features in all five scripts/locales. Development-only cosine thresholds were 0.25 for EN, IT, JA and RO, and 0.15 for RU. The top-two margin was 0.10 in each. These settings establish no accuracy claim. Gemma speech requires the existing named grant and installed weights. Without a usable assessment, the presenter can type or tick manually. Liquid and the classifier are experimental predictors.

### Private decision replay

Use an empty private output directory per arm. Run `node tools/autoloop/e2e/n06-eval.mjs freeze SPEC PAYLOAD OUT`, then `predict SPEC OUT` and `score SPEC PAYLOAD OUT`. The prediction command reads the sealed blind jobs and takes no grading payload. Keep the five development groups and fifteen held-out groups in the original payload. The program verifies its digest, split and group membership. It saves one prediction per held-out report before the scoring join. An interrupted prediction file stays incomplete. A second prediction run in that directory is refused.

The private JSON spec names `arm` (lexical, gemma, liquid or classifier), `runnerSha`, `machine` (including accelerator), `runtimeFile` and its SHA-256 `runtimeDigest`. Use the pinned clean `baseRoot` for the three model/matcher comparisons. Supply `origin`, exact installed `model` and tag `digest` for Ollama. The Gemma spec also names the existing source-specific daily `grant`. The lexical arm calls the base interpreter. Gemma calls the base granted speech matcher. Model calls use a private numeric loopback port. The classifier uses its own development calibration. No predictor sees the report label. Publish the three Wilson intervals, denominators and diagnostic counts separately for each language. An unavailable runtime or set of weights remains unqualified.

## Open-ended lessons

| Topic and arm | Delivered | Blind graded | Critical errors | Factual verdict |
|---|---:|---:|---:|---|
| Earlier topic, main | NM | 19 | 3 | HELD |
| Earlier topic, N-04 | NM | 20 | 3 | HELD |
| New frozen topic, pinned base | NM | NM | NM | Pending |
| New frozen topic, candidate | NM | NM | NM | HELD |

Development checks cover a directed change of phase and a dimensional conversion through validation and board layout. Other factual claims still require independent grading. The teaching bar requires zero critical errors in at least 20 blind-graded deliveries on the new topic. Audit replays have a separate count.

The operator verifies the lesson payload digest, retains the grading key and passes only the question to the generator. In one private ledger directory run `node tools/autoloop/e2e/n06-lessons.mjs freeze SETTINGS LEDGER`. The settings name both `armShas`, `gradedTrials`, exact Google Flash `model`, `locale`, `maxSteps` and SHA-256 `questionHash` of the UTF-8 question. For each arm and trial run `generate SPEC QUESTION LEDGER RECEIPT` with those settings, the clean arm checkout `root`, `sha` and one-based `trial`. QUESTION is a JSON string.

Start the worker without credentials. Connect its JSON-lines input and output to the operator's direct Google transport. For each `quote` the broker prices the worst-case prompt, output and thinking tokens and returns the same ID and a positive integer `maxMicroEur`. Only `send-once` permits one request to the specified endpoint. Return the ID, endpoint, model and response text. Both arms charge the same EUR 1 ledger before every request, including repairs. Unknown cost or remaining balance holds further sends. Keep interrupted reservations. On `render`, load the supplied arm's renderer script in a private, offline browser document and return `{"svg":[…]}` from its `renderN06(scene)` for every frame. Grade the rendered frames and spoken steps blind. Run `grade RECEIPTS GRADES` on the private JSON arrays. Each grade binds its trial ID and render hash to its critical error count.

## Time to correct visible output

| Observation | Temperature | Attempts / timed / misses / 60 s timeouts | First correct p50 / p95 | Complete correct p50 / p95 | Peak private RAM / dedicated VRAM |
|---|---|---|---|---|---|
| Reference tier, paced PCM, paired display | Cold and warm, separately | NM | NM | NM | NM |
| Reference tier, physical Bluetooth, physical phone | Cold and warm, separately | NM | NM | NM | NM |
| Other hardware tiers | Cold and warm, separately | NM | NM | NM | NM |

The operator freezes usable limits with the owner on the measured baseline. Four-question rotation and Clef direct versus gated have no measured comparison yet. The v17 comparison stays open pending its original trace. Photo recall belongs to X-05.

Run `node tools/autoloop/e2e/n06-windows.mjs capture SPEC RECEIPT` per attempt with a run-owned Windows QA executable. The private spec names `root`, `exe`, `sha`, `asarSha512`, `exeSha512`, `tier`, `temperature`, `target`, `ports` (web, relay, debugging, Ollama), `https`, `phoneOrigin`, and the `phoneDebug` port forwarded from the paired browser. Select `phoneType` (physical or surrogate) and `source` (pcm or bluetooth). Supply the installed tracking model directory tree in `speechModels` and the run-owned Ollama models in `ollamaModels` when needed. Use distinct free application ports and reserve 4747, 4748 and 11434 for the operator's other applications.

Prepare the same deck and provider settings on each fresh profile. For a warm attempt warm the selected weights before starting the measured microphone. Pair the phone, leave the target visible on both displays and start local capture. Place the target beyond the first four open rows. For PCM, supply `wav`, `wavSha256` and annotated `lastWordSample` for a mono 16 kHz PCM16 clip. For physical Bluetooth, specify the actual microphone label in `device` and record an independent time-aligned copy. Run `annotate RECEIPT ANNOTATION NEW_RECEIPT` with the attempt ID, WAV, SHA-256, last-word sample, host-aligned recording start (epoch ms) and alignment error (ms). Keep physical and surrogate runs separate. Use both themes.

Run `score RECEIPTS` on a private JSON array. It reports nearest-rank p50 and p95 from timed attempts, and retains missed attempts and timeouts by build, tier, temperature, input, phone type, route and gate mode. Each trace records the two clock offsets and round-trip times, recognizer backend, queue batches and inference boundaries. The first matching visible row can be active or done. Completion requires the target done on both displays. Missing events, a final-only trace or missing phone paint leave the timing incomplete. A missing memory counter stays unmeasured.
