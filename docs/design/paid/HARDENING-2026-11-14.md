# Decision-independent hardening

Local branch `feat-hardening`, based on `78830a7`. Initial four scoped commits plus the pointer-only rework; no merge,
push, tag, provider selection, allowance, price, deployment or new Stripe behavior.

## Empty local answers: pointer-only rework

This section supersedes item 1 of b30b453. That implementation retried every
wordless answer and then displayed a failure even when the model had supplied a
valid pointer. The old 60-question run retried 59 times and displayed 59 failures.

The retry condition now requires both no words and no valid point or mark. A
complete BOX with exactly two finite, in-grid coordinates is normalized to a
POINT with those same coordinates, then goes through the existing UI Automation
placement. No missing coordinates are guessed. Four-coordinate boxes retain their
meaning; wrong arities, unknown screens, incomplete tags and out-of-grid values
are rejected. A bare :screenN suffix without a label identifies the screen rather
than becoming the label. Tests cover every split of the measured malformed tag.

A valid mark without prose supplies its label to a short app template in the UI
language. With no label, the app uses the short localized equivalent of "Right
here." EN, IT, RU, RO and JA are covered. Labels are preserved, not translated or
invented. The UI language travels separately from the model's spoken-language
setting. The stream carries APP_WORDS language metadata, stripped before display
and speech; the speech queue uses that language. The optional answer log records
wordsSource=app, and startup.log gets a fixed source=app reason=pointer-only event
without the label, coordinates or answer. Follow-up history strips the metadata.
Model-written prose stays unchanged. Stop, structured calls and explicit internal
tag-only calls retain their existing behavior.

### Saved-response audit

Counted actual model calls, including the old retries, in
G:/FILOW/tmp/hardening/warm-samples.json:

| Shape | Original 60 calls | Old post-fix 119 calls | Treatment |
|---|---:|---:|---|
| POINT with two coordinates | 56 | 110 | Existing point |
| BOX with two coordinates | 4 | 7 | Salvaged as a point |
| BOX with four coordinates | 0 | 2 | Existing box |
| Unclosed or unknown tags | 0 | 0 | No such sample observed |

The four originally empty baseline answers were all two-coordinate BOX tags,
including [BOX:241,588:Customer name field:screen1]. All ended normally with
16 generated tokens and 1,713 prompt tokens, below the 8,192 context. Thus these
samples contain recoverable pointers, not a stream-cut or context-exhaustion
failure. Other rejected shapes in the tests are defensive fixtures, not invented
observations from the saved corpus.

The historical Phase 2b failure at question index 3, slot 7, run 27 in
G:/FILOW/tmp/latency/results-a5fcc5c-standard-measure-2026-11-14-run2.json has no
saved response bytes. This reproduces its symptom, not its exact lost response.

### Prompt experiment and fresh outcomes

The isolated server reports Ollama 0.40.16. Its lfm3-vl model is LFM3 1.7B
Q4_K_M with num_gpu=0 and num_thread=4. The inspected Modelfile has no extra
SYSTEM instruction and uses RENDERER lfm3 / PARSER lfm3. The versioned
[renderer source](https://raw.githubusercontent.com/ollama/ollama/v0.40.16/model/renderers/lfm3.go)
retains the supplied system message, places image content before unmarked user
text and, with think=false, starts the assistant with an empty think block.
There is no renderer instruction to answer with only a pointer. The raw content
records establish that words are absent at generation, before Filow parses tags.
Model inspection is saved in rework-model-prompt.json and rework-modelfile.txt.

The local system prompt already asks for spoken sentences near its beginning,
then gives extensive pointing/mark/visual instructions and examples. The date
line follows that static prefix. The user message ends with the named-control
coordinate hint and the screen note asking for a tag. This gives competing
emphasis to speech and tags; the experiment tests instruction placement rather
than assuming a proven model-internal cause.

The opt-in tools/eval/hardening-rework-measure.test.ts uses only the tool's store
G:/FILOW/tmp/latency/ollama-std on 11435, lfm3-vl, CPU, 8192 context, temperature
0.3, 1500 output-token cap, 512px/JPEG-72 synthetic screens, empty history and the
same five questions and named-control hints. Each prompt variant has a discarded
warm-up, 60 warm questions, then the 40 pointing screens. First-token time is
measured from the HTTP request to the first nonempty content token, not release
of a microphone key. Output token counts come from Ollama's final done record. Medians average the
two middle observations for even-sized cohorts.
Strict pointing requires a parsed POINT inside the target rectangle before UIA
placement; the same repaired parser scores all variants. No named-point fallback
is credited. A separate placed score uses the existing UIA placement.

The first variants keep the original base system prompt: sentence-last appends an explicit
sentence-before-tag instruction after the date; examples-date-first moves the
date before the base and appends that instruction plus two explicit examples;
user-last keeps the system unchanged and adds the ordering instruction with one
example at the end of the user message. After its pointing gate failed,
user-last-exact keeps that order but explicitly requires a POINT tag with the
exact screen-hint coordinates. The final compact-exact trial replaces the long
system prompt with rules for this known-target task, one example and the date
last, while keeping the exact-coordinate user suffix. It removes the unrelated
generic-answer, drawing and 3D instructions. Exact wording is in
tools/eval/hardening-prompt-variants.ts and the saved rework-prompts.json. These
are isolated experimental requests; no online provider calls are made.

Predeclared adoption gates: wordless below 20%, strict pointing loss no greater
than 2 percentage points, median first-token time increase no greater than 10%.
A candidate must satisfy the gates on both cohorts. Sequential CPU API samples
are not a release-to-speech latency claim: CPU affinity, foreign-load filtering,
physical RAM cap and native microphone/overlay acceptance are not reproduced.
Some development checks overlapped the early experiment; timing is observational.

| Outcome (60 questions) | Before | Final |
|---|---:|---:|
| Truly empty first answer | 4 | 0 |
| Pointer-only first answer | 55 | 0 |
| Pointer-only with app-built words | 0 | 0 |
| Model-written words | 1 | 60 |
| Retries | 59 | 0 |
| Failure messages | 59 | 0 |

The four old empties are recoverable BOX points under the repaired parser. A separate
core-fix-only 60-question run yielded 60 pointer-only answers with app-built words,
zero retries and zero failures (rework-initial-samples.json). The final run below
uses the adopted prompt through the actual provider.

| Prompt | Cohort | Wordless | Valid mark | Strict point | Output tokens median / total | First token median (s) |
|---|---|---:|---:|---:|---:|---:|
| baseline | warm (60) | 100.0% | 100.0% | 95.0% | 16 / 980 | 4.951 |
| baseline | pointing (40) | 100.0% | 100.0% | 97.5% | 16 / 648 | 5.228 |
| sentence-last | warm (60) | 90.0% | 100.0% | 91.7% | 16 / 1003 | 5.299 |
| sentence-last | pointing (40) | 97.5% | 100.0% | 90.0% | 16 / 655 | 5.326 |
| examples-date-first | warm (60) | 100.0% | 100.0% | 100.0% | 16 / 967 | 5.356 |
| examples-date-first | pointing (40) | 97.5% | 100.0% | 100.0% | 16 / 648 | 6.469 |
| user-last | warm (60) | 0.0% | 100.0% | 95.0% | 23 / 1374 | 5.475 |
| user-last | pointing (40) | 0.0% | 100.0% | 90.0% | 23 / 923 | 7.039 |
| user-last-exact | warm (60) | 0.0% | 100.0% | 98.3% | 23 / 1430 | 6.063 |
| user-last-exact | pointing (40) | 0.0% | 100.0% | 97.5% | 23 / 942 | 6.119 |
| compact-exact | warm (60) | 0.0% | 100.0% | 98.3% | 22 / 1385 | 2.641 |
| compact-exact | pointing (40) | 0.0% | 100.0% | 100.0% | 22 / 922 | 2.693 |

Adopted compact-exact only: 0% wordless in both cohorts, strict pointing 98.3% /
100% versus 95% / 97.5%, and median first-token time 2.641 / 2.693 s versus
4.951 / 5.228 s. Median input tokens fell from 1,713 to 446. All three gates pass
in both cohorts. The other four variants fail at least one gate.

Production scope is deliberately limited to lfm3-vl (or :latest), English, one
screen indexed 1, and a simple location question with a server-resolved named UIA
target. HTTP callers cannot assert that target. General questions, explanations,
other languages/models, multiple screens, structured and internal pointing calls
keep their existing prompt. Online system/user prompts are unchanged, with mocked
request assertions; no paid online measurement or call was made.

Final validation: 3,291 tests passed, 7 skipped; typecheck and lint passed; all
26 protection-removal mutations failed as intended and sources were restored.
One initial full test run hit the existing download test
(localai-download.test.ts) idle-timeout versus connection-reset timing race; an
unchanged full rerun passed. Hidden string/layout QA passed 10 language/theme
cases, 30 string checks, with no overflow. This is not native panel/audio QA.
The 600 variant and 60 final answer records all contain done records, no API
errors and no nonempty hidden thinking. Aggregate evidence and raw-file hashes
are tracked in HARDENING-POINTER-SUMMARY-2026-11-14.json.

Unverified: physical microphone release-to-speech, live overlay/native audio,
GPU/8 GB hardware acceptance, non-English model prompt quality, general-question
quality under a compact prompt, and production online equivalence beyond mocked
requests. No prompt change was extended to those unmeasured cases.


Raw outputs and summary: G:/FILOW/tmp/hardening/rework-samples.json and
rework-summary.json. The summary is reproducible with
node tools/eval/hardening-rework-summary.mjs. Original warm-samples.json remains
unchanged. Final app outcomes are measured through askOllama, not a replacement
implementation of the retry policy.

## Account service

Persistent HMAC buckets cover client-address and normalized-email/path code-send
limits, including alternate email-code send routes, plus device-code requests.
Typed 429 replies include seconds and Retry-After. The README documents every
positive integer setting and default. Existing global/OTP verification limits stay.

Desktop grants are serialized in the documented single-process service; active
desktop session IDs persist separately, and expired/revoked sessions free slots.
The fourth default device receives typed `device_limit_reached` without evicting
another session. Existing browser sessions remain usable. Legacy unclassified
desktop sessions cannot be identified retroactively. Multi-process operation is
not supported by this process-local grant mutex.

The auth logger receives only a fixed event, never SDK error arguments. Capturing
logger tests exercise real handlers, fake SMTP, success, malformed input, denial,
and payload-bearing exceptions. Deployment proxy/system/mail/crash logs are not
covered and remain an S4a operational gate.

## Runtime checks

API minimum: Ollama 0.9.0. The versioned
[API types](https://raw.githubusercontent.com/ollama/ollama/v0.9.0/api/types.go)
contain chat messages/images, streaming, JSON-schema format, options, keep_alive,
and the think field. The [0.9.0 release](https://github.com/ollama/ollama/releases/tag/v0.9.0)
introduces thinking control. Tags/show/pull/delete/version are older endpoints;
the API floor does not assert that every modern model format loads in that binary.
Existing catalogue model-specific floors (0.35.1 for Clef) remain enforced before
answers. Capabilities remain advisory when absent, as in the existing resolver.

Setup checks the responding version; every local answer checks it again before
chat. Old, malformed and unreachable versions fail before generation with a
five-language repair message. Existing runtimes are not overwritten. Fake servers
cover old/new/unknown/unreachable and five-language refusal; setup tests cover
old and new existing installations. An actual 0.9.0 binary with modern models,
all supported OSes and native translation review remain unverified.

## Ownership and removal

`local-ownership.json` in the app profile records model pull intent, whether the
model pre-existed, completion and digest, server URL and the configured store hint.
Runtime installation intent/completion is recorded only after existing-runtime
and existing-executable checks return no installation. Atomic replacement and an
exclusive lock protect record updates; missing, partial or corrupt provenance
never authorizes deletion. No historical ownership is guessed.

Settings offers model Delete only for matching completed ownership; the route
independently rechecks current inventory/digest and serializes its own pull/delete
operations. A changed digest, changed configured store, other server, pre-existing
model or unknown record is preserved. Ollama's API performs model deletion, so
shared blobs are managed by Ollama, not filesystem recursion.

Remaining implementation boundary: the existing NSIS uninstaller has no model or
runtime cleanup flow. It still preserves both. Runtime provenance is recorded,
but this change does not add automated native runtime removal or an NSIS cleanup
offer. Ollama's HTTP API does not expose an authoritative executable/store identity
or whether other apps use it; endpoint plus digest cannot prove an identical model
was not replaced in a different store. Native cleanup must preserve unknown/shared
installations and needs a separate executable/store identity and OS-uninstaller
integration. This portion of item 4 is incomplete, not an uninstall acceptance pass.

## Initial four-item validation and isolation (before this rework)

Dependencies installed with npm/Electron caches and temp files on G:. The first
sandbox registry attempt failed EACCES; the network-enabled retry completed. No
dependency versions changed. All fixtures are fake except the explicitly isolated
local model run. No real microphone, desktop input, owner Ollama request, installed
Filow operation, paid API or Stripe network call occurred.

`tools/eval/hardening-mutations.mjs` runs 12 removed-protection mutations with
assertion failures required, restoring each source in finally. Results and full
check logs are under `G:/FILOW/tmp/hardening`.

Initial checks: `npx vitest run --maxWorkers=4`: 3,237 pass, 6 skip, 257 passing
files and 3 skipped files. The explicit real-model measurement separately passes
one test with 120 counted questions. `npm run typecheck` and `npm run lint` exit 0.
All 12 mutations are caught: 3 empty-answer, 5 account limits, 1 runtime version,
3 ownership. Initial failures exposed stale test fakes that lacked `/api/version`
or expected catalogue-only deletion; those fixtures were updated, with separate
real HTTP tests retaining coverage of version failure and ownership enforcement.

Hidden Electron renderer QA checks all 30 messages across five languages and both
themes, exact text, no horizontal overflow, and hidden windows. Ten screenshots
use the actual shared theme tokens. RU dark and JA light screenshots were visually
inspected. HTTP 4991/debug 9591, own G: profile, denied permissions, no global input,
network blocked outside the fixture, hard deadlines, clean exit. This is string
and layout QA, not the live Settings/panel flow or a packaged clean-VM journey.
Native uninstall, real deployed auth, physical microphone, translation review,
and full F1 acceptance remain unverified. Tool-modified AGENTS.md is excluded.
