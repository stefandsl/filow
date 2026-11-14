# Decision-independent hardening

Local branch `feat-hardening`, based on `78830a7`. Four scoped commits; no merge,
push, tag, provider selection, allowance, price, deployment or new Stripe behavior.

## Empty local answers

The historical failure is the last sample in
`G:/FILOW/tmp/latency/results-a5fcc5c-standard-measure-2026-11-14-run2.json`:
question index 3, slot 7, run 27, 16 generated tokens, first token received,
`end=error`, missing mark. The corresponding startup log at
2026-11-14T07:26:34.189Z says the model gave an empty answer. Neither file retains
the raw response, so its exact bytes cannot be recovered.

The isolated reproduction uses the tool's existing `ollama-std` store on 11435,
lfm3-vl, CPU, 8192 context, temperature 0.3, 512px synthetic images, the five
original questions, named-control hints and empty history. Each phase discards one
warm-up question and counts the next 60. It uses the real provider after the fix
and the identical API request before it. This is an API reliability experiment,
not a microphone or latency comparison; it does not repeat the CPU-affinity and
foreign-load latency judge. `tools/eval/hardening-measure.test.ts` is explicitly
opt-in and has per-call and whole-run deadlines and process-tree cleanup.

Reproduced cause: lfm3-vl sometimes emits a two-coordinate BOX, for example
`[BOX:241,588:Customer name field:screen1]`, with no prose. BOX requires four
coordinates. The parser correctly drops it, leaving no words or valid mark.
The stream completes normally. This matches the historical symptom and token
count, but is not proof of the lost historical bytes. Pointer-only replies are
much more frequent than completely empty parsed replies.

Human local answers now retry once with the same input, model and date prefix.
Completed marks remain streamed; an unfinished tag is delimited before retry.
After two words-free attempts, a five-language explanation becomes the answer.
Internal schema/drawing and explicitly tag-only pointing operations retain their
own validation. Stop never triggers a retry. Empty streams and a connection cut
before its first token have real HTTP fake-server tests. Stream readers are
cancelled/released on early completion.

Raw measurements and summary: `G:/FILOW/tmp/hardening/warm-samples.json` and
`warm-summary.json`. No real screen content or owner model store was used.

| Outcome | Before (60 warm questions) | After (60 warm questions) |
|---|---:|---:|
| First model response without words | 59/60 (98.3%) | 59/60 (98.3%) |
| First response with neither words nor valid marks | 4/60 (6.7%) | 4/60 (6.7%) |
| Final display without words | 59/60 (98.3%) | 0/60 |
| Final completely empty display | 4/60 (6.7%) | 0/60 |
| Retried once / plain fallback shown | 0 / 0 | 59 / 59 |

All four malformed baseline replies ended with `done_reason=stop`, 16 output
tokens and 1,713 prompt tokens, far below 8,192 context. No stream-cut or immediate
stop-token cause was observed. The model's wordless rate did not improve; the app
now explains the failure. Repeating these inputs recovered no spoken answer.
The historical prompt count was 1,720, so this is a matching failure-mode
reproduction with synthetic inputs, not an exact replay of the lost request.

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

## Validation and isolation

Dependencies installed with npm/Electron caches and temp files on G:. The first
sandbox registry attempt failed EACCES; the network-enabled retry completed. No
dependency versions changed. All fixtures are fake except the explicitly isolated
local model run. No real microphone, desktop input, owner Ollama request, installed
Filow operation, paid API or Stripe network call occurred.

`tools/eval/hardening-mutations.mjs` runs 12 removed-protection mutations with
assertion failures required, restoring each source in finally. Results and full
check logs are under `G:/FILOW/tmp/hardening`.

Final checks: `npx vitest run --maxWorkers=4`: 3,237 pass, 6 skip, 257 passing
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
