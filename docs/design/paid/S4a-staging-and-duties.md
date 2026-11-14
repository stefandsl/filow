# S4a Staging, duties and pilot

Proposal, main `d320837`, 2026-11-14. Source: PLAN.md v6 sections 4, 5b, 5c, 6, 8. S4a precedes any pilot with real people's screens. This note also holds the pilot design because the requested file set has no separate pilot file. No deployment, recruitment or paid provider call has occurred in this task.

## Decisions before real screens

| Choice | Branch A | Branch B | Recommended default |
|---|---|---|---|
| Hosting | One EU VPS, persistent SQLite/WAL, one Node process; lower setup complexity, operator owns patching and backup | Managed EU PostgreSQL now; additional service/credentials/cost, easier future multi-instance coordination | Single EU instance for pilot; PostgreSQL before a second serving instance, as v6 directs. Host and actual region still unselected. |
| Provider terms | Selected hosted P0 winner with zero-retention terms, DPA and confirmed transfer arrangements | EU-hosted open model; capacity, licence and operations costs shift to Filow | Use only the branch the owner can document and approve; do not recruit while neither is ready. |
| Trial | Small bounded trial and anti-abuse marker | No trial, named pilot entitlements distinct from subscriptions | Follow owner decision; staging pilot grants never imply a public trial or live purchase. |
| Billing | Stripe test account isolated from production | Merchant-of-record sandbox; replace processor-specific tests and webhook adapter | Stripe test scaffolding is reusable, but merchant choice remains open. |

Legal/duty register, not legal advice. The plan requires the following gates; every entry **needs a professional's confirmation**:

| Topic | What v6 already requires | Evidence to obtain |
|---|---|---|
| GDPR controller, processors and transparency | D33 controller identity and published privacy policy with subprocessor list before pilot | Named seller/controller, responsibilities, disclosures and contact checked against actual data flow |
| GDPR provider processing/transfers | Zero-retention terms, DPA and transfer mechanism, or an EU-hosted open model | Signed/accepted contractual version, hosting/support locations, actual retention and transfer assessment; EU hosting alone is not a conclusion |
| DPIA | Owner decision before pilot | Professional review of whether/what assessment is needed and recorded owner decision |
| Personal-data breach procedure | S4a calls for a 72-hour procedure | Who assesses, who advises, whom/when to notify, documentation and communications reviewed professionally; do not infer every incident is reportable |

Before charging, also carry S5's withdrawal, VAT OSS, Italian SDI, AI Act Article 50, licensing and age-policy questions forward. This note makes no finding of compliance.

## Staging controls

Verified `apps/cloud/config.mjs` `configuredCloud()` enforces HTTPS outside localhost, a >=32-character auth secret, an absolute DB path and complete Stripe credential triplets. It sets WAL/busy_timeout and creates SMTP transport. `apps/cloud/server.mjs` defaults to loopback:4780, has security response headers, 30-second request timeout and no readiness/drain handler. `apps/cloud/http.mjs` `clientAddress()` trusts only a named immediate proxy. `apps/cloud/README.md` describes a single persistent service and says real merchant/email acceptance is still required. Configuration is not evidence a server is deployed.

Proposed environment: distinct EU staging domain, TLS certificate/renewal monitoring, one private persistent volume, firewall exposing only HTTPS proxy, loopback Node binding, no public SQLite port/file. Separate auth secret, mail credentials, provider project/key and test billing account. Staging has no route to production customer data, production feed writes or live Stripe keys. Apply S2's streaming proxy settings, upload limit, no request-body logs and readiness/drain before testing real streams.

Email: dedicated sender domain/address; validate SPF, DKIM signing and DMARC alignment via a controlled received message, then record DNS values, delivery result and bounce process. Do not print OTPs. `createCloud()` currently has global database auth limits of 60/minute, OTP length 6, expiry 600 s and allowedAttempts 5. That is not the requested per-address/per-path abuse policy.

Proposed new persisted limits: OTP send 3/address/15 min and 10/address/day; IP 20 OTP sends/hour; code verification 5 failures/challenge plus 20/IP/15 min; device-code creation 10/IP/hour; token polls no faster than the issued interval, honor slow_down. Normalize addresses using the auth library's canonical identity, keyed-HMAC them in abuse buckets; use generic send responses so account existence is not revealed. Bound bucket cardinality/expiry. Keep `/v1/*` S2 limits separate. Trusted proxy spoof tests are mandatory. These thresholds are initial proposals to tune with synthetic abuse tests, not vendor defaults.

Device cap proposal: 3 active desktop sessions/account. On approving a fourth, explain the limit and offer explicit replacement or private support; do not silently sign another machine out. Existing `deviceAuthorization()` and seven-day session expiry do not establish this cap. Count active desktop sessions transactionally at grant, including parallel approvals, expiry and revocation; a full device management page remains deferred by v6. No hardware fingerprint required.

Provider: owner chooses 2-3 P0 candidates and research cap before comparisons; only synthetic/owner-made screens until duties are resolved. Separate staging daily ceiling within that approved budget; zero means disabled. Test the cap under concurrency and lost-usage replies as S2 specifies. Stripe tests use test clocks/fixtures and signed events; no live charge for testing.

No-payload-log judge: seed unique canaries in question, history, screenshots, email/OTP, token and provider error body. Exercise success, denial, timeout, malformed upload, crash, proxy 413/5xx, debug/error middleware, SMTP failure and backup. Search proxy/service/system logs and error captures for canaries, base64 and authorization values; inspect DB tables and backup contents. Allowed assist records: request id, pseudonymous account reference, window, outcome, token counts, numeric latency and app version for error rates; no prompt, answer, image, selection or raw provider error. Auth/billing records remain separately disclosed. Disable SDK verbose logging, core dumps with payloads and proxy body tracing. A read of this repository cannot verify the deployment logging chain; this is a staging gate.

Key rotation drill: inventory auth/session signing, provider, Stripe webhook/API, SMTP, pseudonym, backup recipient and storage keys with owner and expiry. Rotate provider/SMTP/storage independently, test the new key with synthetic data, revoke old, verify no secrets in logs or builds. Stripe webhook rotation needs bounded overlap and signed-event tests. Better Auth secret rotation compatibility in pinned 1.7.21 is **not verified**; until proven, announce that rotation signs sessions out and revoke them rather than assume dual-secret support. Preserve separate trial-marker/pseudonym key policy through rotation so an account does not accidentally receive another trial. Backup public encryption keys can coexist; private keys stay off the VPS.

## Incident procedure

Prepare named primary and backup contacts before recruitment. On a suspected personal-data breach: record discovery time in UTC and facts without payload; isolate affected traffic using S2 switches, preserve minimal access-controlled evidence, revoke compromised keys and stop further disclosure. Notify the owner and designated privacy professional immediately. Track a 72-hour decision/notification clock as v6 requests, with professional assessment of applicable duties, recipients and content. Document uncertainties, containment, notifications/advice, recovery and lessons. Run a tabletop leaked-provider-key and exposed-backup incident before pilot. No invented determination of legal notification duties belongs in a runbook.

## Pilot build, recruitment and predeclared judge

Owner recruits **5-10 testers**, after S4a acceptance and privacy/terms gates. CI builds a named commit with `-c.extraMetadata.accountOrigin=<staging>` and `-c.extraMetadata.updates=false`. Record full sourceSha, dependency lock hash, installer SHA-256/SHA-512, platform, build run and config. No public-feed publication. Testers are told it is unsigned until D6, what security prompts they may see, and that the owner sends each new pilot installer. Returning to public means installing the public installer over the pilot; test this transition in a disposable VM and preserve ordinary user data. Do not claim updater downgrade protection performs this manual transition.

Critical gap: `main.js` `loadUpdater()` and `checkForUpdates()` currently guard packaging/feed existence but do not consult package `updates=false`. The metadata alone is not protection. Implement and test both automatic and manual update suppression, including startup, notification and downloaded-update installation paths. `.github/workflows/desktop.yml` presently has no pilot-origin/updates inputs. Add a separate private-artifact pilot build path before distributing; public release `verifyInstaller()` must continue rejecting staging origin.

Consent script proposal: "This is a test build. You choose whether a question and screen picture leave your PC. We do not collect usage telemetry. May we ask you to keep a short diary and discuss it with us? You can skip questions or stop." IT: "Questa è una versione di prova. Scegli tu se inviare una domanda e un'immagine dello schermo fuori dal PC. Non raccogliamo telemetria d'uso. Possiamo chiederti di tenere un breve diario e parlarne con noi? Puoi saltare le domande o interrompere la prova." Professionally review participant information before use. Optional diary consent is separate from content-send consent and participation.

Diary/interview: hardware and installed version; task described without private content; time to first useful answer; whether it was correct/useful; whether recipients and remaining answers were understood; what happened on Stop/error; whether local setup was understandable; willingness to pay and expected monthly usage. No screen recordings or screenshots requested by default. Interviewer records answers only with permission in restricted storage under an agreed deletion date. Server health/usage counts are disclosed; no background client telemetry.

Proposed pass thresholds, freeze before recruiting: at least 80% independently reach and recognize a useful first answer in their assigned branch; all can identify the named recipient and how to stop; all can find answers left; zero unexpected sends, cap overruns or updater replacements; all observed charge outcomes agree with the ledger; no data-loss/security critical defects. Report denominators and failures, not just successful runs. For trial users target first useful answer <=3 minutes excluding user idle, with <=20 s first content per answer; for local users report download time separately and apply F1 tier targets. A participant with an unsupported PC is an outcome, not silently excluded. Price feedback is a hypothesis, not validated demand or the owner's final price.

## Differences from the plan

HTTPS configuration, auth limits and test-mode key checks exist, but deployed EU staging, DNS authentication, per-address limits, device cap, rotation and breach drills are **not verified**. Pilot updater isolation is absent even if metadata were supplied. DPA/privacy/controller/DPIA decisions are open. This design completes the pilot questions without asserting that the pilot itself is ready or run.
