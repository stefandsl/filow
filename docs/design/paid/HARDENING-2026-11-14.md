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
