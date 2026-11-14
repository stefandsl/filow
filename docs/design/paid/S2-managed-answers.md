# S2 Managed answers, including L1

Design proposal, 2026-11-14. Baseline: main `d320837`; source: `G:/FILOW/tmp/openbot-research/PLAN.md` v6, sections 4, 5b, 5c, 6, 8. Nothing here enables billing. Numbers described as proposed are engineering limits to validate, not owner decisions or measured provider performance.

## Decisions and scope

| Owner choice | Branch A | Branch B | Recommended default and reason |
|---|---|---|---|
| What a subscription buys | Managed OK Filow question answers, including text and screen questions; one bounded generation per answer | Add whiteboard, script generation, speech or agents; each needs its own cost and consent design | A: one understandable benefit and a bounded bill. Agent jobs/actions remain excluded by v6 even if a broader bundle is chosen. |
| Trial | Proposed 3 answers, once per verified account, expiring 7 days after activation; no card, no automatic conversion | No trial; local onboarding or an explicit purchase before managed use | Small trial, only after P0 prices and anti-abuse costs are approved; it gives modest PCs a first screen answer. |
| Allowance unit | Answers per billing window, as v6 specifies | Money credit; needs a replacement ledger, rounding and price-change rules | Answers: clear to explain. Money is an owner-requested plan revision, not a second implementation hidden in this note. |
| Billing | Stripe plus Stripe Tax; reuse identity/plugin, operate seller duties | Merchant of record; replace checkout/webhook/portal adapter and validate its service eligibility, fees and duties | Stripe for implementation continuity, conditional on the owner's professional review of seller duties. No cost advantage is assumed. |
| Provider | One P0 winner with acceptable terms, measured quality, quotas and bounded token billing | EU-hosted open model if acceptable terms cannot be obtained; adds hosting, capacity and operational work | Choose only after P0; no provider or price has been selected. No silent second-provider fallback. |
| Spend | Approved nonzero research cap, then a separate approved daily production ceiling | Zero: fixtures and local work only | Zero until the owner gives actual amounts and 2-3 P0 candidates. |

Proposed launch scope excludes whiteboard lessons, agent CLIs/actions, take decisions, Screen Sense's continuous loop, translation, slide scripts, cloud voice and cloud transcription. Local voice and local marks can present an answer without another paid generation. A follow-up or generation resumed after Stop is a new answer, requiring a new id and visible count notice. Resuming already buffered speech is free. A display-only tour demonstration is free. No automatic pointing-repair, model retry or fallback may create an invisible extra generation. If broader features are chosen, revise caps and economics before including them.

One answer means the first nonempty answer-content delta from one admitted generation, including a visual tag. Headers, keepalives, reasoning-only deltas and provider errors do not count. A refusal containing actual answer content counts. After that boundary, Stop, disconnect, truncation or provider failure does not refund it. Show this before purchase and before a new generation on Resume. This preserves v6's first-token rule without charging for an SSE heartbeat.

## Verified implementation seams

`apps/cloud/service.mjs`: `createCloud()` uses `bearer()`, `deviceAuthorization()`, `emailOTP()` and conditionally the Stripe plugin. `handle()` exposes only `/v1/me`, `/v1/checkout`, `/v1/portal`; no assist route or allowance exists. `paidSubscription()` accepts only future-ended `active`/`trialing` Pro subscriptions. Inline `database.exec()` creates `filowStripeEvent`; `webhook()` verifies signatures, deduplicates events and skips older subscription events. `apps/cloud/migrate.mjs` runs Better Auth migrations; proposed Filow tables follow the existing inline DDL style, without modifying plugin-owned columns.

`apps/cloud/package.json` and `package-lock.json` pin Better Auth and `@better-auth/stripe` to **1.7.21**, Stripe SDK to **23.1.0**, SQLite binding to **12.4.1**. Read the installed matching Better Auth package at `G:/FILOW/apps/cloud/node_modules/better-auth/dist/plugins/bearer/index.mjs` and its package version: `bearer()` accepts an opaque unsigned token when `requireSignature` is unset, signs it internally, verifies HMAC and supplies a session cookie. A dotted signed token is verified; a response cookie can be exposed as `set-auth-token`. This is not a JWT verification API. Keep the device flow's opaque token and `auth.api.getSession({headers})`; do not turn on `requireSignature: true` without migrating device tokens and proving that flow. A valid signature alone never proves a live session or entitlement. New-endpoint integration with these hooks needs an actual device-token test; not verified by this document.

`apps/desktop/account.js`: `createAccount()` keeps the token in its closure and an OS-encrypted `account-session.bin`; `request()` has a 15-second JSON timeout. `signalledFetch()` reads the entire body as text, so neither helper is a streaming transport. `main.js` constructs the account after `startOkFilow()` and restricts account actions to the main window's `/account`; `account:configured` additionally permits `/tour` and `/settings/local`.

`apps/web/lib/buddy/providers.ts` uses `buddySystemPrompt()` from `prompt.ts` plus `withLocalDate()` from `apps/desktop/prompt-date.js`; local and online paths use that source. Proposal: extract/package that pure prompt and its dependencies for cloud and local builds, with byte-comparison fixtures, instead of copying the prompt or importing Next server internals. Dates in the hosted service must use a validated client time zone with the server clock, not accidentally describe the VPS's date as the PC's date. No client system message, arbitrary prompt override, tools or model selection.

## HTTP contract

Proposed `POST /v1/assist`, HTTPS, `Authorization: Bearer <device session>`, `x-filow-version: <stable semver>`, `Content-Type: application/json`, `Accept: text/event-stream`, `x-filow-consent: assist:<recipientId>`. Every desktop `/v1/*` call carries its real build version; sign-in/bootstrap remains possible for an obsolete client so it can discover update instructions.

```json
{
  "requestId": "uuid-v7",
  "providerId": "server-published-id",
  "language": "en",
  "timeZone": "Europe/Rome",
  "question": "Where is the Save button?",
  "sees": true,
  "images": [{"screen": 1, "width": 1024, "height": 576,
              "mime": "image/jpeg", "base64": "..."}],
  "history": [{"role": "user", "text": "..."},
              {"role": "assistant", "text": "..."}]
}
```

Strict schema: reject unknown control fields, `system`, `model`, image-fetch URLs, tools, user/account ids and client quotas. URLs quoted as ordinary question text are not fetched. Language is one of en/it/ru/ro/ja. Proposed limits: body 8 MiB including base64; at most 4 images, at most 1 MiB decoded each, longest edge 1024 pixels, at most 1,048,576 pixels each; JPEG/PNG/WebP only after decoding and dimension validation. `sees:false` requires empty images. No UI Automation element list or phone conversation history travels. Text question at most 4,000 characters; history at most 6 messages, user/assistant only, 12,000 characters total. Reject rather than silently alter the current question. Tokenizer admission: total input, including the server prompt and provider image tokens, at most **8,192**; output including any billable reasoning at most **1,500**. If the provider cannot bound reasoning/image billing, it does not qualify under this contract. P0 must verify image accounting; character limits are not token accounting. Invalid bodies get no reservation.

Before headers are sent, errors are JSON:

```json
{"error":{"code":"allowance_exhausted","requestId":"uuid",
          "retryable":false,"windowEnd":"2026-12-01T00:00:00Z"}}
```

| HTTP | Typed code | Meaning/action |
|---|---|---|
| 400 / 413 / 415 | `invalid_request` / `payload_too_large` / `unsupported_media` | Correct input; no upstream call. |
| 401 | `sign_in_required` | Expired, revoked or absent session. |
| 402 | `subscription_required`, `trial_expired`, `allowance_exhausted`, `payment_required` | No entitlement, expired trial, zero remaining (include windowEnd), or grace ended. |
| 403 | `consent_required`, `account_blocked`, `origin_forbidden` | No send; blocked accounts get a private appeal action. |
| 409 | `provider_changed`, `request_in_progress`, `request_closed` | Refresh recipients and ask consent; or do not replay this id. Closed includes released, counted and failed ids. |
| 426 | `update_required` | Include `minVersion`; never raise it above a version available to everyone. Missing/unparseable version is 400 `invalid_version`. |
| 429 | `rate_limited`, `concurrency_limited`, `provider_quota` | Retry-After; no queued generation or answer charge. |
| 503 | `paid_route_off`, `daily_cap_reached`, `service_unavailable`, `provider_unavailable`, `billing_not_open`, `billing_unavailable` | Include retryAt when known. `billing_not_open` is checkout's L1 response. |
| 504 | `provider_timeout` | Deadline before first answer delta; release answer reservation. |

Success: `200 text/event-stream; charset=utf-8`, `Cache-Control: no-store, no-transform`, `X-Accel-Buffering: no`. Events are JSON: `meta {requestId,providerId,windowEnd}`, `delta {text,counted:true}`, `done {requestId,counted:true,answersLeft,usage:{inputTokens,outputTokens}}`. The first delta is emitted only after a durable count commit. Subsequent deltas retain counted=true. After headers, `error {code,retryable,counted,requestId}` replaces a new HTTP status, then closes; never append a provider's raw error. EOF without `done` means interrupted, never success. No SSE event replay or payload persistence. Refresh `/v1/me` after an ambiguous disconnect; a counted answer is not recoverable by reusing its id.

## Server body and streaming lifecycle

Verified `apps/cloud/server.mjs` anonymous `createServer` callback currently buffers up to **1 MiB** on every non-asset request and buffers responses with `response.arrayBuffer()`. `server.requestTimeout` is 30 seconds; there is no explicit upstream cancellation, drain or streaming proxy configuration in that file.

Proposed: branch for assist before the common body read. Authenticate and apply IP/account rate limits before reading expensive input. Read bounded JSON with an 8 MiB counter even for chunked uploads, 10-second upload deadline and header deadline. Keep webhook raw bytes and its existing signature verification path unchanged. Validate schema, recipient, version, entitlement and all limits before upstream. Only then reserve allowance and spend. No HTTP headers are flushed until upstream yields first answer content, preserving pre-token typed status errors. Heartbeats can start after streaming begins.

Stream the service's Response body to Node's response with backpressure, not `arrayBuffer()`. The provider adapter normalizes deltas; it does not blindly forward vendor SSE, keys, reasoning or errors. Proposed upstream limits: connect/headers 10 s, first content 20 s, idle 15 s, total 60 s. Deadlines include no unbounded wait queue. Listen to aborted request and premature response close, cancel the reader and provider AbortController; a normal request-body completion is not cancellation. Enforce bounded buffers and a slow-client deadline. Post-token cuts keep the charge and show the interrupted-state text in S3.

Disable reverse-proxy buffering, response compression that accumulates chunks, body/access-log capture and automatic POST retries. Proxy timeouts must exceed the 60 s application deadline plus close margin. Verify over the real HTTPS proxy that the first delta arrives before completion. On shutdown: readiness false, reject new admissions, allow existing streams up to their deadline plus 5 s, abort the rest, settle reservations, close DB last. Only one serving process; no overlapping rolling restart against SQLite. At cold start release all answer inflight rows before readiness, but never free potentially spent provider budget merely because the process crashed.

## Allowance SQL and transaction boundaries

Proposed inline DDL in `createCloud()`, beside `filowStripeEvent`, uses camel-case Filow table names, TEXT ids and INTEGER epoch milliseconds. Explicitly enable foreign keys. `user_id` comes from the session. Billing-window identity is account-level and immutable, not subscription-id-based: persist its anchor before checkout, map a replacement subscription in the same window to it, and never reset counters on a webhook. Provider subscription periods may disagree after a re-subscribe; keep the existing allowance window until its end and show that date. Owner-approved allowance changes are versioned for a future window, not reset by checkout.

```sql
CREATE TABLE IF NOT EXISTS filowAllowanceWindow (
  user_id TEXT NOT NULL REFERENCES user(id), window_id TEXT NOT NULL,
  starts_ms INTEGER NOT NULL, ends_ms INTEGER NOT NULL,
  allowance INTEGER NOT NULL CHECK(allowance >= 0),
  counted INTEGER NOT NULL DEFAULT 0 CHECK(counted >= 0),
  inflight INTEGER NOT NULL DEFAULT 0 CHECK(inflight >= 0),
  PRIMARY KEY(user_id, window_id), CHECK(ends_ms > starts_ms),
  CHECK(counted + inflight <= allowance)
);
CREATE TABLE IF NOT EXISTS filowAssistRequest (
  user_id TEXT NOT NULL, request_id TEXT NOT NULL, window_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('inflight','counted','released')),
  created_ms INTEGER NOT NULL, closed_ms INTEGER, outcome TEXT,
  PRIMARY KEY(user_id, request_id),
  FOREIGN KEY(user_id, window_id)
    REFERENCES filowAllowanceWindow(user_id, window_id)
);
CREATE INDEX IF NOT EXISTS filowAssistByWindow
  ON filowAssistRequest(user_id, window_id, state);
```

Admission below is a transaction protocol: application checks every affected-row count. Roll back on any failed assertion; never continue after returning an error. Before entering, resolve entitlement and the active window. Inside, recheck expiry and the stored block/entitlement revision to prevent cancellation racing admission; the same transaction also reserves daily worst-case spend. No network I/O under the SQLite write lock.

```sql
BEGIN IMMEDIATE;
SELECT state FROM filowAssistRequest
 WHERE user_id=:user AND request_id=:request;
-- Any row: ROLLBACK, 409 request_in_progress or request_closed.
UPDATE filowAllowanceWindow SET inflight=inflight+1
 WHERE user_id=:user AND window_id=:window
   AND starts_ms<=:now AND ends_ms>:now
   AND counted+inflight<allowance;
-- changes() must be 1. Otherwise ROLLBACK, 402 with windowEnd.
INSERT INTO filowAssistRequest
 (user_id,request_id,window_id,state,created_ms)
 VALUES(:user,:request,:window,'inflight',:now);
-- Reserve provider daily worst-case cost and a stream slot; failure rolls back all.
COMMIT;
```

First nonempty answer delta: hold the delta in memory until this transaction commits. Idempotent settlement uses the request row as its guard. If changes() is zero, do not execute the counter update or emit a first delta.

```sql
BEGIN IMMEDIATE;
UPDATE filowAssistRequest SET state='counted',closed_ms=:now,outcome='started'
 WHERE user_id=:user AND request_id=:request AND state='inflight';
-- If changes()=1, use this row's stored window_id, even across a renewal:
UPDATE filowAllowanceWindow SET inflight=inflight-1,counted=counted+1
 WHERE user_id=:user AND window_id=:window;
COMMIT;
```

Pre-token failure/disconnect: same guarded transaction, set request state to `released`, outcome to a controlled code, and decrement only inflight. Retain the row, so retrying a closed id gets 409. Startup, exclusively before serving:

```sql
BEGIN IMMEDIATE;
UPDATE filowAssistRequest SET state='released',closed_ms=:now,outcome='restart'
 WHERE state='inflight';
UPDATE filowAllowanceWindow SET inflight=0;
COMMIT;
```

The tiny crash interval after durable counting but before delivery can charge an answer the PC never saw. This follows v6's server first-token/no-refund rule; disclose it as interrupted delivery, and test it. Exactly-once human receipt would need a different policy, not an undocumented refund. Proposed ids are UUIDv7: new admissions require the encoded creation time within the previous 10 minutes or at most 60 seconds ahead of the server clock. Check an existing id first so a retained closed id still gets 409; an unknown stale id gets 400 `invalid_request`. Keep closed request tombstones through window end plus 30 days, subject to S5 retention confirmation. The timestamp is a replay-lifetime limit, not proof of entitlement; modifying it changes the id and creates another fully metered request. No retry can obtain a fresh timestamp under the same id. Test clock skew and tombstone cleanup. Do not implement finite tombstone retention with unrestricted UUIDv4 replay.

Trial branch: separate account window `trial:<activation>` with limit 3 and 7-day end, one activation marker; purchasing closes trial admission and selects a paid window without converting unused trial credits. Trial marketing is not Stripe's existing `trialing` status. No-trial branch: no trial window or marker. Repeated sign-up abuse still needs S4a limits; no device fingerprinting is proposed.

## Configuration, spend and capacity

Existing: `FILOW_CLOUD_ORIGIN`, `FILOW_CLOUD_DB`, `BETTER_AUTH_SECRET`, `SMTP_URL`, `MAIL_FROM`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `FILOW_TRUSTED_PROXY`, `HOST`, `PORT` in `configuredCloud()`/server. Never ship their secrets to desktop.

Proposed: `FILOW_ASSIST_ENABLED=0`, `FILOW_MIN_VERSION`, `FILOW_ASSIST_PROVIDER_ID`, `FILOW_ASSIST_MODEL`, `FILOW_ASSIST_PROVIDER_KEY`, `FILOW_ASSIST_DAILY_CAP_MICROEUR=0`, `FILOW_ASSIST_ALLOWANCE`, `FILOW_TRIAL_ENABLED=0`, `FILOW_TRIAL_ANSWERS=3`, `FILOW_TRIAL_DAYS=7`, `FILOW_ASSIST_MAX_STREAMS=4`, `FILOW_ASSIST_USER_STREAMS=1`, `FILOW_ASSIST_RPM`, `FILOW_ASSIST_TPM`, `FILOW_ASSIST_PSEUDONYM_SECRET`. Missing prices, provider quota or nonzero approved ceiling leaves assist disabled. Allowance quantity and price remain unset until the owner decides. Price config is versioned and denominated explicitly; conversion to micro-euro rounds up. Per-account block is a persisted operator-controlled record, not a renderer preference.

Proposed `/v1/*` limits: persisted per-account 60 requests/minute and per-IP 120/minute, plus assist 10 starts/minute per account and one live stream/account; checkout 5/minute. Use `clientAddress()` from `apps/cloud/http.mjs`, which trusts only the configured immediate proxy. Webhook handling has its own raw-body path, not a device-session limiter. Provider concurrency/RPM/TPM are additional hard constraints using P0's actual quota. Start at at most 4 global streams, reduce to provider limits. Reserve maximum input+output tokens in the provider rolling quota, not just request count; return 429 immediately instead of queueing screens. A two-instance service requires PostgreSQL/shared admission first.

Let P0 fill `P_in` and `P_out` (price per million billable tokens in provider currency), `P_image` if separately billed, `P_request` if any, `FX` (conservative EUR conversion), and `C_gateway` (bounded allocated hosting/egress cost per answer). With token-priced images inside the 8,192 input cap:

`C_answer_max = FX * (8192 * P_in / 1e6 + 1500 * P_out / 1e6 + P_request) + C_gateway`.

If images have separate charges, add `4 * P_image_max(1024,1024)` and cap the remaining text input separately; never double-count the same image tokens. Treat cache discounts as zero for worst-case pricing. No automatic retries: at most one upstream attempt. A failed attempt may cost provider money even when no answer is counted.

For allowance `A`, the subscription needs `net_receipts(price) >= A*C_answer_max + failed_attempt_budget + trial_allocation + support_and_fixed_cost_allocation + desired_margin`. `net_receipts` and fees are inputs from the selected billing arrangement/professional review, not a tax calculation here. EUR 19.99 is an unapproved hypothesis. Trial maximum direct answer cost is `3*C_answer_max`, plus bounded failed attempts. Production cap must cover failed attempts too.

Add a persisted daily spend ledger and per-request cost reservations in the same admission transaction. Admit only when `spent + reserved + worst_case <= approved_daily_cap`. Reconcile final usage; if usage is missing, retain/charge worst case, including after restart. Release a cost reservation only when no upstream request was made or authoritative usage justifies it. Use UTC day keys; a crossing-midnight stream settles to its admission day. Operator kill switch cancels active calls and blocks new ones; account block likewise revokes that account's streams. Neither refunds counted answers. Provider-side budgets are a second guard, not the sole cap.

Extra-hop latency is **not verified**: P0 has not measured it. Record desktop send, server admission, upstream start/first delta, desktop first delta and completion with payload-free timings. Compare synthetic requests directly versus the EU gateway; proposed added-hop p95 budget 500 ms, managed first-content target 5 s p95, 20 s first-content hard timeout. These are acceptance proposals, not current promises.

## Desktop route and consent

Proposed explicit `managed` choice in `askRoute()`; keep `cloud` (own OpenRouter key), `freellm`, and `local` distinct. Extend `askRouteRecipient()` and `BuddyRecipients` in `outbound.ts` with `assist`, populated from authenticated `/v1/me`; unknown/stale recipients fail closed. `keepLocalPatch('assist')` returns `{provider:'local'}`. Add `assist` to both `OUTBOUND_KINDS` and `apps/desktop/okfilow-outbound.js` `KINDS`, translations and `docs/okfilow/OUTBOUND.md` inventory. Its recipient id binds Filow origin and the actual downstream provider chain using a short versioned hash/slug compatible with the desktop consent-key character/length restriction, not a raw HTTPS URL. Human-readable names remain separate. A router must name actual recipients and pin its host, not label a model maker as the only recipient.

Change panel `ask()` in `apps/web/app/okfilow/panel/page.tsx` to obtain explicit assist consent and use a main-process streaming bridge. Update `createOkFilow()`/`nextCfg()` in `apps/desktop/okfilow.js` to accept the new setting and expose only trusted panel sender access. Proposed IPC: `assist:status`, `assist:start`, `assist:cancel` (panel to main), `assist:event` (main to the initiating panel only); bounded chunks with acknowledgements/backpressure, opaque local stream handle, cancellation on destroyed sender. Add preload and `apps/web/lib/sessionUrl.ts` bridge types. Existing account IPC remains restricted to `/account`; do not widen it to give the panel token access.

Add `assist()` inside `createAccount()` so its private token supplies Authorization, version comes from `app.getVersion()`, origin comes from `buildAccountOrigin()`, and a dedicated fetch streams rather than using `signalledFetch()`. `main.js` registers the new channels with sender/path checks equivalent to `okfilowSender()`, bounds input, checks Offline and current persisted consent again immediately before fetch. `createOutboundController().allow()`/`sending()` provide the notice lifecycle; main owns the live signal through EOF/cancel. Refuse if the signal cannot be displayed. Cloud validates the request's provider id and consent key against its own current configuration before any byte reaches the provider. Pseudonym: HMAC of account id using a separate secret, supplied through the provider's supported safety-user field; support for that field is a P0 fact to verify.

Proposed notice: EN "Your question, conversation and shared screen pictures go to Filow's server and {provider}. Send them?" IT "La domanda, la conversazione e le immagini dello schermo condivise vengono inviate al server di Filow e a {provider}. Vuoi inviarle?" Words-only notice explicitly omits pictures and says none are sent. A words-only yes never covers later screen sharing. Buttons: Send / Invia; Keep it on this PC / Mantieni su questo PC. Provider change clears this permission for the new recipient, with no automatic resend.

Paid mode never falls back from local failure; Offline prevents all assist network traffic in both panel and main. Agent intent is rejected before this route, even if model text asks for an action. Validate and render existing visual tags as data; they do not execute tools. Disable automatic narrow pointing retries on managed mode. Phone requests are excluded from the first managed release until their one-question permission is explicitly extended to assist; existing phone consent is not reused silently.

## L1 and billing-off semantics

`FILOW_LIVE_BILLING` now passes an explicit live flag from `configuredCloud()` into `createCloud()` on `feat-safe-prep` (2026-11-14). While off (default), `/v1/checkout` returns 503 `billing_not_open` before any Stripe call; `/v1/me` exposes the checkout state, and the account page explains it in five languages. Existing users' portal/cancellation remains available. Two removed-guard/default mutations are caught; no Stripe network acceptance was run. Billing-off is not assist-off: explicit trial/pilot entitlement can work under its own enabled switch and cap, with no live checkout. Without billing configuration there is no paid entitlement; do not grant Pro to everyone. Pilot test checkout uses an isolated staging-only test adapter/flag and test keys, never an override accepted on production.

`tools/release/release-verify.mjs` now has an opt-in `--require-account-origin <comma-separated-exact-HTTPS-origins>` policy on `feat-safe-prep`. With it, a missing or non-allowlisted installer origin fails. Without it, `allowedOrigins=[]` still permits missing origin and rejects any configured origin. `tools/release/release.ps1` has no `-AccountOrigin` parameter. L1 still needs the owner's exact production-origin allowlist, build metadata wiring and release invocation with the explicit policy once live. Staging origins remain forbidden in public installers. Switch flip plus production-origin release is the section 8 owner gate; no deployment or switch change is authorized by these notes.

Provider acceptable-use terms, zero-retention terms and appeal contacts are **not verified** until selected. Before pilot: record dated terms, suspended-content behavior, support contact, data duties and a user appeal path. On suspension disable managed use, inform affected users without logging their content, and pursue the provider's appeal. No silent substitute provider. An EU-hosted alternative requires a new owner choice, P0 result and consent.

## Judge to implement before product changes

1. Real device flow on pinned 1.7.21: raw token, signed token, expired/revoked/forged token; session required on every assist entry, including direct HTTP and IPC.
2. No paid/trial entitlement: every route refuses before upstream. Billing-off checkout 503; test mode cannot enable live keys or grant production usage.
3. Last answer succeeds, next is 402 with exact windowEnd. At allowance minus one, N parallel requests across sessions commit at most one. Re-subscribe in the same window cannot reset counts.
4. Duplicate inflight/closed ids return 409. Fail before first token releases answer; fail/Stop after first token keeps it. Crash before/after commit, startup cleanup and midnight/renewal boundary preserve invariants and spend bounds.
5. Old version 426, invalid version 400. Provider change and missing consent send zero upstream bytes. Withdrawn screen consent never sends a captured image.
6. Body above 8 MiB, chunked overflow, forged dimensions, token overflow, system/model/tool fields, slow body, slow reader, proxy buffering and malformed vendor stream fail boundedly without payload logs.
7. Disconnect aborts provider; drain rejects admissions and terminates on time. EOF without done is an error; counted status remains correct.
8. Per-account/global concurrency, rolling TPM/RPM, daily cap including failed calls and lost usage, operator off and account block all refuse/cancel with typed state.
9. Scan packaged desktop and IPC for provider keys/session leakage. Test forged senders, renderer payload limits and recipient mismatch. Main's signal spans all streaming bytes.
10. Local failure, Offline, agent jobs, voice, whiteboard and excluded phone paths never call `/v1/assist`. Buffered Resume costs nothing; generation Resume has a new id and notice.
11. Measure P0 quality and proxy latency with synthetic screens; remove each gate in mutation tests and prove its judge fails. This note supplies no passing execution result.

## Differences from the plan

The v6 "Fixed now" bullets are target constraints, not features already present. Assist, allowance, limits and typed paid states do not exist. Body handling is 1 MiB/full buffering, not the proposed 8 MiB stream path. L1's flag now guards both keys and checkout on feat-safe-prep; release origin enforcement has an explicit opt-in requirement, while production metadata and wrapper wiring remain pending. The existing answer pipeline can make additional pointing calls, so it cannot be reused unchanged as one paid generation. Better Auth uses raw opaque device tokens by default; requiring signed tokens would break an untested assumption. The owner has not confirmed answers as the unit despite v6 also calling it chosen. Money-credit or merchant-of-record choices require explicit plan revisions. No P0 report or provider prices were found in `docs/perf`.
