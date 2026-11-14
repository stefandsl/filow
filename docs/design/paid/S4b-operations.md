# S4b Operations

Proposal, 2026-11-14, main `d320837`; PLAN.md v6 sections 4, 5b, 5c, 6, 8. Depends on S2 ledger and S4a staging. Operations and restore acceptance are not performed by this document.

## Billing truth and reconciliation

Read `apps/cloud/service.mjs` `paidSubscription()`, `createCloud()`, `webhook()`, `handle()`. The pinned Better Auth/Stripe plugin versions are 1.7.21, Stripe SDK 23.1.0 in `apps/cloud/package.json` and lockfile. `filowStripeEvent` records id, subject and created timestamp. Duplicate or older subscription events are acknowledged without reapplying; equal-second events can still arrive in either order. `paidSubscription()` accepts future `active`/`trialing` only. Existing tests in `apps/cloud/service.test.ts` cover sign-in, server price selection, unsigned events, ordering and externally closed plugin billing routes. They do not prove live reconciliation.

Proposed entitlement state machine, retaining the plugin and `filowStripeEvent` as v6 requires:

| Situation | Decision and visible result |
|---|---|
| Active and periodEnd future | Paid, subject to remaining allowance and S2 switches |
| Trial | Only an owner-approved trial source; do not conflate the proposed no-card trial ledger with Stripe trialing |
| periodEnd is past on entitlement check | Re-read authoritative subscription from Stripe before deciding; serialize refresh per account, deadline 5 s; never trust a success redirect |
| past_due | Eligible no later than periodEnd + 7 days; show S3 payment-failed grace text with exact grace end. No unlimited extension when refresh fails |
| Grace elapsed | Refuse with payment_required; portal stays available |
| Cancel at period end | Eligible until periodEnd only, then stop; no grace after voluntary cancellation |
| Immediate cancel, charge.refunded, charge.dispute.created | Immediate persisted entitlement revocation and cancel active streams; no later stale active webhook can restore it |
| Provider/billing API unavailable | If a fresh authoritative period already proves entitlement, keep its bounded validity; if renewal/reconciliation is required, fail closed with billing_unavailable, never add a guessed period |

The plan says a refund removes entitlement immediately; apply it to any refund event under that target rule, including partial refunds, pending owner/professional review of commercial terms. Resolve charge -> invoice -> subscription/customer -> account using authenticated Stripe records, never client ids. Persist refund/dispute revocations as separate durable facts and refresh current subscription state on ambiguous/order-sensitive events. A verified invoice/payment event plus explicit policy may restore payment failure access; a generic active event cannot clear a dispute/refund block. Test a missed refund while the period is still future: schedule reconciliation of relevant invoice/charge/dispute state, not just subscriptions at period expiry.

Window semantics during grace: when periodEnd passes and Stripe confirms past_due, create the next account-anchored allowance window only once, with its normal allowance and entitlement limited to the grace deadline. This bounds free usage to one allowance during at most seven days; it is a proposed policy detail to approve with pricing. No second reset on recovered payment or re-subscription. If the owner instead wants grace to use only leftover old-period answers, revise S2/S3 window rules and disclose the smaller benefit before launch.

Webhooks: verify raw signature first, deduplicate ids, then reconcile and persist revocation/entitlement revision. A 200 means durable processing or durable deduplication, not merely receipt in memory. Transient failures return a retryable error. Do not hold a SQLite transaction while calling Stripe. Once remote reads finish, transactionally apply only if the stored revision still matches; otherwise re-read/retry boundedly. Existing plugin mutation and the Filow event marker are not one transaction; crash-between tests and reconciliation must cover that boundary rather than claim atomicity.

Schedule proposed reconciliation hourly for active/grace/canceling accounts and on portal return, webhook ambiguity and every expired-period admission. Record last success/attempt and controlled error, alert on lag. Lookup can repair dropped webhooks. Cancellation/refund revocations take effect on event processing or reconciliation; no network system can promise to detect a dropped event instantaneously. Declare the maximum reconciliation interval in operational targets.

Stripe API version: `configuredCloud()` currently calls `new Stripe(key)` without an explicit `apiVersion`. The installed locked SDK's `G:/FILOW/node_modules/stripe/esm/apiVersion.js` reports `2026-10-28.endive`; propose explicitly pinning that exact version only after staging confirms plugin compatibility. Record the webhook endpoint version as well. Do not assume SDK pin and webhook API version are identical.

Every outbound Stripe POST needs a stable operation-specific `Idempotency-Key`: checkout attempt, portal session, subscription update/cancel and deletion. Reuse for retries of the same business operation, never for a different body. Passing the inbound Filow request header does not prove the plugin forwards it to Stripe. Inspect/wrap the pinned plugin's Stripe client transport, validate every emitted POST and persist operation ids; no unverified global random key wrapper. The installed plugin source was searched for idempotency handling; this task did not prove every outbound POST is covered. Implement a transport-level recording judge before accepting this requirement.

Owner billing branches: Stripe reuses the plugin and requires the reconciliation above; a merchant of record needs an equivalent sandbox-verified adapter, event vocabulary, renewal/grace/cancellation and refund rules, with its fees/limits as inputs. Recommended engineering default is Stripe reuse, conditional on S5's professional review, not a claim that it is commercially cheaper. No processor is selected by this note.

Record Stripe dashboard retry settings before pilot acceptance: account/mode, API/webhook versions, retry schedule, Smart Retries on/off, terminal subscription state, customer notification settings, portal cancellation mode, dated screenshot or written export and owner. Values currently **not verified**. They cannot override the server's seven-day grace or immediate revocation rule.

## Backup, restore and health

Proposal: nightly SQLite online backup with `VACUUM INTO` to a new file on encrypted staging/production storage, not a live DB/WAL file copy. Existing `configuredCloud()` enables WAL; backup automation is not present in the cloud files read. Use SQLite's supported online snapshot, reject an existing output path, check `PRAGMA integrity_check` on the copy and capture schema/version, sourceSha, UTC snapshot time and row/count summaries without payload.

Encrypt the snapshot with `age` to the owner's and recovery custodian's public keys before off-host upload. Only public recipient keys on the service; private keys offline in separate custody. No plaintext backup uploaded. Proposed initial retention: seven daily encrypted snapshots and four weekly snapshots, bounded to 28 days, pending S5 professional review; a new key retains decryptability of retained snapshots. On this workstation temporary backup/test files belong on G:, never C:.

After upload, verify remote size and cryptographic digest, then write an immutable completion marker containing snapshot id/time, ciphertext hash, schema/version and verified upload time. Never mark completion merely because the backup process exited. Remove task-created plaintext safely after verification. External monitoring alerts if the newest **verified snapshot time** is older than **36 hours**, if encryption/upload fails, or if free disk approaches exhaustion. A recent marker on an old snapshot does not satisfy freshness.

Restore monthly and before a risky schema migration: isolated staging with production mail/provider/billing egress disabled; download ciphertext, verify digest, decrypt with controlled recovery access, integrity-check, run compatible migrations, start one instance, reconcile billing before enabling answers, and run synthetic sign-in/allowance checks. A restored old DB can resurrect deleted accounts or obsolete entitlement: replay the bounded deletion/revocation journal from a separately protected current source before any user access. Keep an account deletion request active until all retained backups age out. Record restoration time, recovered snapshot age and test results. Proposed RPO <=24 h, RTO <=4 h are targets, **not verified**; never test restores using real screenshots.

External HTTPS uptime check every minute from outside the host: `/health` today returns `{ok:true}` and proves only handler reachability. Add readiness with DB access, schema and admission availability without a paid call; monitor uptime/TLS/expiry, disk, backup freshness, billing reconciliation lag, error rate by app version, stream count and daily cap utilization. Two consecutive failures page primary and backup contacts. A separate synthetic staged sign-in/answer check can run under its own approved budget and test identities; do not put user tokens into a third-party monitor. No default client telemetry.

## Runbook

| Trigger | Operator steps | Recovery evidence |
|---|---|---|
| Provider outage or quota | Disable assist if necessary, cancel bounded streams, publish S3 state, check provider status/quota without payload; never switch recipients silently | Synthetic answer succeeds within cap, consent/provider identity unchanged |
| Spend/cost anomaly | Set assist off, preserve usage counters and conservative reservations, inspect aggregate tokens/cost; rotate leaked provider key if indicated | Cap/concurrency judge passes; owner approves resuming within budget |
| Payment mismatch | Inspect event ids/revisions, retrieve authoritative billing state, repair through reconciler; no manual counter reset | Account entitlement and window agree after duplicate/out-of-order/drop tests |
| Key leak | Contain, rotate/revoke, invalidate affected sessions, follow S4a incident procedure | Old credentials fail, new scoped credentials pass; assess notifications with professional |
| DB corruption/full disk | Stop admission, preserve evidence, restore last verified encrypted backup in isolation, replay deletion/revocation records | Integrity, reconciliation and smoke pass before readiness |
| Bad desktop release | Pause new paid admissions if unsafe; follow `docs/RELEASE-CHECKLIST.md` recall process and R2 verification | Replacement from named commit tested; no updater downgrade assumption |
| Account block/appeal | Private support verifies identity; record reason category and review decision without screen content | Owner-authorized unblock and audited revision; provider suspension resolved separately |

Primary/backup person, contact addresses, host dashboard, secret store, backup location and appeal contact remain owner-supplied, **not verified**. Do not operate an unattended paid service until these are filled and a tabletop drill succeeds.

## Judge and differences from the plan

Acceptance sequence on clean VM/staging: install -> real first answer -> sign-in -> test checkout -> paid answer -> failed renewal with Stripe test clock and exact S3 text -> grace expiry -> refusal -> card update in portal -> verified recovery -> cancel at period end -> refusal after periodEnd. Separately: immediate cancel, refund, dispute, duplicates, same-second ordering, missed webhook and stale cache; dropped event repaired by reconciliation. Assert allowance does not reset, all POSTs have correct idempotency keys, provider calls stop on entitlement revocation, no charge from a checkout redirect, and no payload in logs. Restore encrypted snapshot and prove backup-age alert fires at 36 h. Seed each named failure and verify the judge rejects it before operational acceptance.

v6's target grace/reconciliation/refund behavior is absent from current `paidSubscription()` and `webhook()`. The API version is implicitly supplied by the pinned SDK, not explicitly configured. Backup, external monitoring, dashboard retry settings, transport idempotency and restore drills are not verified. R2 code is merged, but its real publication/manual CI smoke path remains unverified in HANDOFF and the R2 evidence report. A source commit is not proof a release was exercised.
