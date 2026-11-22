# N-06 decision and teaching pilot

Reference base `a21db5ad`, packaged candidate `36643d534660e5f88d2bff59a75951bc3039cf2f`. Presenter confirmation stays enabled. The independent labels and topic were hashed before implementation in freeze commit `fc59133a`. [Frozen sets and pilot limits](N06-FREEZE.md)

## Run 1 measurements

Neon authored 100 reports. Each language contributes 5 development reports and 15 held-out reports from three other speaker and album groups. All 75 held-out reports were retained per available route. For clear reports, MiniLM counts an abstention as both a miss and a clarification. The lexical scorer counts abstention only as a miss. Unit counts are small and speakers contribute repeated reports. The two-sided Wilson intervals below describe report-level binomial uncertainty.

| Language | Route | Correct / clear (95%) | False / negative (95%) | Clarify / clear (95%) |
|---|---|---:|---:|---:|
| EN | current lexical proposal | 0/9 (0 to 30%) | 0/6 (0 to 39%) | 0/9 (0 to 30%) |
| EN | current automatic write | 0/9 (0 to 30%) | 0/6 (0 to 39%) | 0/9 (0 to 30%) |
| EN | granted Gemma proposal | 5/9 (27 to 81%) | 0/6 (0 to 39%) | 0/9 (0 to 30%) |
| EN | MiniLM candidate | 4/9 (19 to 73%) | 0/6 (0 to 39%) | 5/9 (27 to 81%) |
| IT | current lexical proposal | 1/9 (2 to 44%) | 0/6 (0 to 39%) | 0/9 (0 to 30%) |
| IT | current automatic write | 0/9 (0 to 30%) | 0/6 (0 to 39%) | 0/9 (0 to 30%) |
| IT | granted Gemma proposal | 3/9 (12 to 65%) | 0/6 (0 to 39%) | 0/9 (0 to 30%) |
| IT | MiniLM candidate | 2/9 (6 to 55%) | 0/6 (0 to 39%) | 7/9 (45 to 94%) |
| JA | current lexical proposal | 0/9 (0 to 30%) | 0/6 (0 to 39%) | 0/9 (0 to 30%) |
| JA | current automatic write | 0/9 (0 to 30%) | 0/6 (0 to 39%) | 0/9 (0 to 30%) |
| JA | granted Gemma proposal | 9/9 (70 to 100%) | 0/6 (0 to 39%) | 0/9 (0 to 30%) |
| JA | MiniLM candidate | 4/9 (19 to 73%) | 0/6 (0 to 39%) | 5/9 (27 to 81%) |
| RO | current lexical proposal | 0/9 (0 to 30%) | 0/6 (0 to 39%) | 0/9 (0 to 30%) |
| RO | current automatic write | 0/9 (0 to 30%) | 0/6 (0 to 39%) | 0/9 (0 to 30%) |
| RO | granted Gemma proposal | 4/9 (19 to 73%) | 0/6 (0 to 39%) | 1/9 (2 to 44%) |
| RO | MiniLM candidate | 2/9 (6 to 55%) | 0/6 (0 to 39%) | 7/9 (45 to 94%) |
| RU | current lexical proposal | 0/9 (0 to 30%) | 0/6 (0 to 39%) | 0/9 (0 to 30%) |
| RU | current automatic write | 0/9 (0 to 30%) | 0/6 (0 to 39%) | 0/9 (0 to 30%) |
| RU | granted Gemma proposal | 7/9 (45 to 94%) | 1/6 (3 to 56%) | 1/9 (2 to 44%) |
| RU | MiniLM candidate | 4/9 (19 to 73%) | 0/6 (0 to 39%) | 5/9 (27 to 81%) |
| EN | Character trigram classifier | 3/9 (12 to 65%) | 1/6 (3 to 56%) | 1/9 (2 to 43%) |
| IT | Character trigram classifier | 3/9 (12 to 65%) | 1/6 (3 to 56%) | 0/9 (0 to 30%) |
| JA | Character trigram classifier | 5/9 (27 to 81%) | 1/6 (3 to 56%) | 0/9 (0 to 30%) |
| RO | Character trigram classifier | 3/9 (12 to 65%) | 1/6 (3 to 56%) | 1/9 (2 to 43%) |
| RU | Character trigram classifier | 4/9 (19 to 73%) | 0/6 (0 to 39%) | 1/9 (2 to 43%) |

The character trigram classifier calibrated on development speech distinguishes an explicit clarifying question from abstention. All unavailable or unqualified routes retain presenter control.

Current automatic writes count journal changes before confirmation. The lexical and granted Gemma rows count what a unique completion proposal would have selected automatically. The shipped baseline requires confirmation. Clarification in a proposal row counts an explicit choice between recipients. An unmatched utterance stays in the denominator. One English Gemma attempt reached its 45-second deadline and abstained.

The MiniLM classifier ranks task embeddings by cosine similarity. Each language selected a minimum similarity and margin using its development album. Every nonselection routes to confirmation. This probe missed the accuracy bar in every language. Liquid d1-2B was unavailable in the local evaluation stores for all five languages. No weights were downloaded for that arm.

Among available decision probes, only the Japanese granted Gemma proposal met all three count thresholds (9/9 correct, 0/6 false, 0/9 person clarifications). This was an isolated decision replay. The automatic journal path remains disabled. The passing proposal rate has a 95% Wilson interval of 70% to 100%.

### Stage tracking and question rotation

| Main | Attempts | 60 s misses | Desktop first p50/p95 ms | Desktop done p50/p95 ms | Mobile view done p50/p95 ms |
|---|---:|---:|---:|---:|---:|
| cold | 3 | 0 | 244/310 | 2312/2709 | 2023/2129 |
| warm | 6 | 3 | 415/821 | 2823/3243 | 2232/2312 |

The reference machine ran a real-time 16 kHz capture replay with a local deck and paired same-host mobile viewport. First means the expected row first became active or done. Complete means that row became done. Timing begins at the final PCM sample exceeding 320/32768 amplitude. All three warm alias attempts timed out. Cold and warm inputs differ. An earlier three-attempt instrumentation check used a shorter observation window and is recorded separately. Peak sampled process-tree working set was 2.35 GiB and dedicated graphics memory 60.8 MiB.

With six open questions, the synthetic replay supplied a second call and offered the fifth target then at its default four-question cap and on call one at a six-question cap. The original packaged engine never made that second call during silence. In separate real Clef replays, twelve calls per corpus per route completed without timeouts.

| Clef call latency | EN p50/p95 ms | IT p50/p95 ms |
|---|---:|---:|
| direct-nogate | 752/1294 | 776/1876 |
| gated | 776/978 | 784/976 |

### Candidate capture replay

Each condition has three fresh QA launches for each target position. The warm attempt follows a separate completed warm-up. The same launch-date recording and six-point deck were used in both conditions. The tracker recorded the recognizer endpoint, partial and final transcript, queue, inference and both displays. The clock is shared by two processes on the same host. Times below are milliseconds relative to the last audible PCM sample. A negative value precedes the end of speech. The endpoint is the recognizer signal. An independent acoustic VAD was unavailable.

| Position and condition | Complete / attempts | First correct desktop p50/p95 | Complete on both p50/p95 | 60 s timeouts |
|---|---:|---:|---:|---:|
| 3 / cold | 3/3 | 566/632 | 2568/2634 | 0 |
| 3 / warm | 3/3 | 247/925 | 2152/2250 | 0 |
| 5 / cold | 0/3 | 324/432 | unmeasured | 3 |
| 5 / warm | 0/3 | 56/822 | unmeasured | 3 |

| Stage for the third target | Cold p50/p95 ms | Warm p50/p95 ms |
|---|---:|---:|
| First partial | 14/23 | -589/-579 |
| Recognizer endpoint | 1698/1707 | 1704/1705 |
| First committed text | 1698/1707 | 1704/1705 |
| First queue entry | -1304/-1303 | -1310/-1306 |
| First queue exit | 1898/2006 | 1816/2174 |
| First inference start | 1898/2007 | 1816/2174 |
| First inference end | 1916/2025 | 1845/2205 |
| Desktop active or done | 566/632 | 247/925 |
| Desktop done | 2568/2634 | 2152/2250 |
| Paired display active or done | 33/37 | -1/10 |
| Paired display done | 1937/2044 | 1853/2211 |

Peak sampled process-tree working set 2.73 GiB and dedicated GPU memory 71.4 MiB on the reference tier. Missing tiers, physical Bluetooth, physical phone and the v17 capture-to-correct trace remain open. Owner freeze HOLD. No gain claim.

## Frozen lesson trial

| Arm | Attempts | Delivered and graded | Critical errors in delivered lessons | Delivered lessons with a critical error | Full rubric passes | Rejected drafts graded / critical errors |
|---|---:|---:|---:|---:|---:|---:|
| Main | 24 | 20 | 1 | 1 | 1 | 4 / 1 |
| First packaged candidate db26730b | 25 | 20 | 0 | 0 | 1 | 5 / 3 |
| Final packaged candidate 36643d53 | 25 | 20 | 1 | 1 | 2 | 5 / 1 |

All three arms received the same frozen learner question through their packaged lesson endpoint. An isolated adapter forwarded the product messages to Google Gemini 3.1 Flash Lite. Gemini 4 Neon High graded narration and diagram data against the independent key. Delivered lessons and rejected audit drafts were replayed separately. Full-rubric passes include completeness. Repairs between packaged candidates addressed existing regression tests. The final candidate missed the zero-error requirement. The live feature stays HELD. The owner-designated free key incurred EUR 0. Every generation call has a private usageMetadata entry.

## Reproducing the measurements

Use an empty private output directory per arm. Run `node tools/autoloop/e2e/n06-eval.mjs freeze SPEC PAYLOAD OUT`, then `predict SPEC OUT` and `score SPEC PAYLOAD OUT`. The prediction command reads the sealed blind jobs and takes no grading payload. Keep the five development groups and fifteen held-out groups in the original payload. The program verifies its digest, split and group membership. It saves one prediction per held-out report before the scoring join. An interrupted prediction file stays incomplete. A second prediction run in that directory is refused.

The private JSON spec names `arm` (lexical, gemma, liquid or classifier), `runnerSha`, `machine` (including accelerator), `runtimeFile` and its SHA-256 `runtimeDigest`. Use the pinned clean `baseRoot` for the three model/matcher comparisons. Supply `origin`, exact installed `model` and tag `digest` for Ollama. The Gemma spec also names the existing source-specific daily `grant`. The lexical arm calls the base interpreter. Gemma calls the base granted speech matcher. Model calls use a private numeric loopback port. The classifier uses its own development calibration. No predictor sees the report label. Publish the three Wilson intervals, denominators and diagnostic counts separately for each language. An unavailable runtime or set of weights remains unqualified.

The operator verifies the lesson payload digest, retains the grading key and passes only the question to the generator. In one private ledger directory run `node tools/autoloop/e2e/n06-lessons.mjs freeze SETTINGS LEDGER`. The settings name both `armShas`, `gradedTrials`, exact Google Flash `model`, `locale`, `maxSteps` and SHA-256 `questionHash` of the UTF-8 question. For each arm and trial run `generate SPEC QUESTION LEDGER RECEIPT` with those settings, the clean arm checkout `root`, `sha` and one-based `trial`. QUESTION is a JSON string.

Start the worker without credentials. Connect its JSON-lines input and output to the operator's direct Google transport. For each `quote` the broker prices the worst-case prompt, output and thinking tokens and returns the same ID and a positive integer `maxMicroEur`. Only `send-once` permits one request to the specified endpoint. Return the ID, endpoint, model and response text. Both arms charge the same EUR 1 ledger before every request, including repairs. Unknown cost or remaining balance holds further sends. Keep interrupted reservations. On `render`, load the supplied arm's renderer script in a private, offline browser document and return `{"svg":[…]}` from its `renderN06(scene)` for every frame. Grade the rendered frames and spoken steps blind. Run `grade RECEIPTS GRADES` on the private JSON arrays. Each grade binds its trial ID and render hash to its critical error count.

Run `node tools/autoloop/e2e/n06-windows.mjs capture SPEC RECEIPT` per attempt with a run-owned Windows QA executable. The private spec names `root`, `exe`, `sha`, `asarSha512`, `exeSha512`, `tier`, `temperature`, `target`, `ports` (web, relay, debugging, Ollama), `https`, `phoneOrigin`, and the `phoneDebug` port forwarded from the paired browser. Select `phoneType` (physical or surrogate) and `source` (pcm or bluetooth). Supply the installed tracking model directory tree in `speechModels` and the run-owned Ollama models in `ollamaModels` when needed. Use distinct free application ports and reserve 4747, 4748 and 11434 for the operator's other applications.

Prepare the same deck and provider settings on each fresh profile. For a warm attempt warm the selected weights before starting the measured microphone. Pair the phone, leave the target visible on both displays and start local capture. Place the target beyond the first four open rows. For PCM, supply `wav`, `wavSha256` and annotated `lastWordSample` for a mono 16 kHz PCM16 clip. For physical Bluetooth, specify the actual microphone label in `device` and record an independent time-aligned copy. Run `annotate RECEIPT ANNOTATION NEW_RECEIPT` with the attempt ID, WAV, SHA-256, last-word sample, host-aligned recording start (epoch ms) and alignment error (ms). Keep physical and surrogate runs separate. Use both themes.

Run `score RECEIPTS` on a private JSON array. It reports nearest-rank p50 and p95 from timed attempts, and retains missed attempts and timeouts by build, tier, temperature, input, phone type, route and gate mode. Each trace records the two clock offsets and round-trip times, recognizer backend, queue batches and inference boundaries. The first matching visible row can be active or done. Completion requires the target done on both displays. Missing events, a final-only trace or missing phone paint leave the timing incomplete. A missing memory counter stays unmeasured.
