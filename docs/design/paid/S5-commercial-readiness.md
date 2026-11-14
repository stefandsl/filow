# S5 Commercial readiness

Proposal, 2026-11-14, main `d320837`; PLAN.md v6 sections 4, 5b, 5c, 6, 8. This is an engineering and decision checklist, not legal or tax advice. No legal/tax conclusion, compliance finding or final commercial term is made here.

## Owner choices and professional review

| Decision | Option A and consequence | Option B and consequence | Recommended default |
|---|---|---|---|
| Merchant | Stripe plus Stripe Tax: reuse 1.7.21 plugin; Filow arranges seller processes and professional review; fees and operational work are inputs | Merchant of record: integrate its checkout, events, refunds, export/deletion and portal; confirm exactly what it handles and its fees/eligibility | Compare written total cost and duties first; retain Stripe implementation as the provisional technical path, not an owner choice |
| Trial | Proposed 3 answers/7 days/no card; extra provider/email spend and anti-repeat marker | No trial; simpler retention/abuse policy, harder first screen answer on modest PCs | Small trial if P0 cost and abuse safeguards are approved |
| Subscription | Managed answers only, bounded allowance | Broader bundle needs per-feature cost, consent, entitlement and licence work | Managed answers only for clear terms and bounded cost |
| Age | Adults-only launch policy, subject to professional confirmation; simpler initial flow | Permit younger people under professionally designed eligibility/consent/support process; more product work | Adults-only provisional proposal; no age threshold is asserted as legally sufficient |
| Price | Cost-backed monthly price from P0 and pilot feedback | EUR 19.99 hypothesis from v6; may not cover chosen allowance/fees/support | Do not publish a price until S2's worst-case economics pass; no price chosen here |

Every row below **needs a professional's confirmation**. These are v6's decisions/gates, not this note's interpretation of the law:

| Topic | What the plan already decided or left open | Confirmation required before the relevant gate |
|---|---|---|
| GDPR duties | Controller, published privacy/subprocessors, DPA, zero-retention and transfers before pilot; DPIA decision open | Actual roles, lawful bases, disclosures, rights handling, security, transfer arrangements, retention and breach procedure |
| EU 14-day withdrawal | S5 requires terms and withdrawal consent in checkout | Applicable rights, exact consent/acknowledgement wording, evidence, refund process and interaction with immediate service delivery; no pre-ticked or assumed consent proposed |
| VAT OSS | Section 8 treats seller entity and VAT OSS as merchant-choice inputs | Which obligations/processes apply to this seller and customers, records and selected processor support |
| Italian SDI e-invoicing | Section 8 explicitly asks to consider it if established in Italy | Actual applicability, invoice generation/transmission, corrections and retention; do not assume Stripe Tax or a merchant of record settles it |
| AI Act Article 50 | Section 8 requires transparency, including synthetic voice, before charging | Applicable disclosures and implementation for AI answers/voice, presentation and timing; no applicability conclusion here |
| Licences and sale | 5b #10 remains open; Filow is GPL-3.0-or-later and v6 proposes selling service/updates/support. D5/D37 model commercial use requires review | GPL distribution/source obligations and exact bundled voice, speech, local and hosted model licence permissions |
| Minors/age policy | Owner must choose before charging | Appropriate eligibility, notice and handling; no self-selected numeric age presented as law |

Seller identity, country of establishment, account domain, EU host, email sender and billing account are owner inputs. Do not fill them with plausible placeholders in checkout. D3 network listener/token, D6 signing, D31 public-link default and D32 app id/GUID remain explicit pre-charge gates; this commercial note does not resolve them. No automatic live switch when the checklist is drafted.

## Checkout, terms and mail

Verified `apps/cloud/service.mjs` `handle()` constructs fixed-plan upgrade/portal calls with the service return URL and ignores client price/account ids. `/api/auth/subscription/*` is externally closed except success. `apps/desktop/account.js` `billingUrl()` allows only exact Stripe checkout/portal HTTPS hosts. A merchant-of-record choice must replace this allowlist with reviewed exact destinations, not accept arbitrary returned URLs. `apps/cloud/config.mjs` sends one English email with subject "Your Filo sign-in code"; multilingual UI does not translate this email.

Proposed before opening checkout: show approved seller, recurring price/currency/frequency, what is included/excluded, allowance/reset rules, trial/no-trial terms, first-token charging and interruption rule, cancellation/support/refund access, terms/privacy links and professionally approved withdrawal/delivery consent. Store versioned consent text identifiers, timestamp and checkout operation id separately from the request payload, with the retention period professionally approved. Checkout-success redirect is informational, not entitlement. Verify the chosen plugin/provider can collect and retrieve required consent evidence; that capability is **not verified** here. L1 keeps live checkout closed until the owner confirms readiness.

Five-language email plan: validate locale en/it/ru/ro/ja from device approval/browser flow, persist the preference with account consent/settings and use English only as an explicit fallback. Auth sendVerificationOTP currently passes `{email,otp,type}`; extend the locale plumbing without taking arbitrary HTML from clients. Localize subject, code explanation, expiry and unsolicited-code warning; test text and HTML variants, link origin, expiry, escaping, bounce delivery and no OTP logs. Native/cloud UI should not switch languages halfway through sign-in. SMTP provider and recipient locations go on the subprocessor list.

Private support: create an owner-monitored address/form with restricted access and stated response expectations, no required screenshots, no public issue redirect for billing/account/block appeals. Existing `apps/desktop/about.js` `SUPPORT`/`issueUrl` use public GitHub issues, described in `docs/okfilow/OUTBOUND.md` row 16; that is not a private billing support channel. Account support may ask for request id and time, not token, OTP or full card data.

## Manual export procedure

Proposed operator process, before self-service tooling: receive private request, verify account control through a fresh sign-in or agreed recovery process, record request id and verification without copying OTPs, resolve the immutable account id, and snapshot only that account's relevant records. Include profile/preferences, sessions/device grants as metadata, subscriptions and entitlement, allowance/request metadata, consent records, retained billing references and trial eligibility marker explanation. Never export raw active tokens, secrets, password/session hashes, other users or screenshots (none should be stored). Export the user's billing records through the chosen processor's supported flow as appropriate, with professional guidance on scope.

Prepare human-readable summary plus structured JSON/CSV in encrypted temporary storage; operator reviews account scoping and redaction. Deliver via authenticated expiring download or a professionally approved secure channel, verify receipt, remove task-created export after the disclosed short expiry (proposed 7 days), record completion metadata. Request response deadlines and retained proof **need a professional's confirmation**; no deadline is invented here. Drill two accounts with deliberately similar emails to prove there is no cross-account export.

## Deletion, failure handling and retention set

v6 fixed order: **cancel at Stripe first and fail closed, then delete locally in one transaction**. Current `createCloud()` exposes no Filow deletion endpoint/process or retention ledger; do not interpret basic account identity as completed deletion support.

Proposed sequence: freshly verify account control, mark deletion pending and block new managed admission, abort streams, list all active billing subscriptions, cancel immediately with persisted idempotent operation ids, and verify remote state. Remote timeout/failure leaves local data intact and the request pending; do not announce success. Retry the same operations and ids. Only after verified cancellation perform a SQLite transaction deleting account-linked auth/session/device verification data, subscriptions, usage/windows/request rows, consent, preferences and block records outside the approved retention set. Add the minimum deletion/revocation journal record needed to prevent a backup restore resurrecting access; retain only through backup expiry, with professional approval. Handle a crash between remote cancellation and local deletion by resuming the pending operation, never recreating a subscription.

Inventory actual tables via pinned Better Auth migration/schema and `sqlite_master`/foreign keys in the implementation judge, including verification/rate-limit records that may hold email-derived data and any webhook subjects/customer references. `filowStripeEvent` currently has a subscription subject, not a user foreign key; explicitly resolve/redact retained linkability or delete rows where permitted rather than rely on cascade. Unknown tables block a successful deletion report. Auth/session revocation and no post-delete paid answer must be verified.

| Retention category | Proposal and reason | Open decision/confirmation |
|---|---|---|
| Pseudonymised invoices and Stripe records | Keep only the professionally approved minimum fields and schedule in a restricted billing archive; pseudonymisation does not mean anonymity | Exact required identifiers, period, access and deletion rules need a professional's confirmation |
| Trial-used marker, if trial exists | Salted/keyed email marker and trial-used date only, separate from profile; prevent deletion/re-signup from repeating trial | Duration, key custody/rotation and justification need professional confirmation; no-trial branch stores none |
| Encrypted backups | Bounded expiry; proposed S4b maximum 28 days, access only for recovery; replay pending deletions before restored service opens | Approve period and restoration safeguards; no indefinite retained snapshots |
| Temporary deletion journal | Minimal opaque subject reference and deletion time to clean restored snapshots, expires when affected backups expire | Professional confirmation of necessity/period; no indefinite new exception to v6's retention set |
| Ordinary assist/auth operational logs | Short proposed 14-day controlled logs, no payload; pseudonymise/delete account-linked records at deletion unless explicitly approved | Retention schedule and relation to trial/billing evidence need professional confirmation |
| Active-account allowance and replay records | S2 proposes window counters and closed request tombstones through window end plus 30 days, then deletion; not the same as diagnostic logs | Confirm this bounded schedule professionally; account deletion removes them immediately, outside any separately approved billing retention set |

Trial marker design: random per-record salt alone cannot find repeat email without checking every salt; use an access-controlled keyed normalized-email lookup plus salt/version metadata, designed and reviewed as personal data. No claim that hashing removes GDPR duties. Reject new trial while retaining that minimal approved marker; account signup/local use must remain possible under the chosen policy.

Stripe customer deletion branches: (A) delete remote customer after verified subscription cancellation and professional confirmation that retained invoice/transaction records remain handled correctly; less residual profile data, more failure/recovery work; (B) retain only professionally justified billing identity/records with documented period/access, remove optional metadata and payment-method links where appropriate. Recommended default: minimize the remote customer profile, but make no blanket deletion promise until the professional and processor behavior are confirmed. If remote customer deletion is required, treat its failure as pending before reporting complete. Merchant-of-record branch uses its documented erasure/export API or assisted process and cannot claim Stripe behavior applies.

## Privacy inventory and acceptance

Publish actual names, purpose, data categories, region/transfer information and retention for: EU host, provider (and router/actual host if any), email sender, billing processor/merchant, backup storage, private support and monitoring where they receive personal data. List existing optional routes accurately: `docs/okfilow/OUTBOUND.md` records OpenRouter, speech/voice services, public GitHub reports and Cloudflare public link. Do not present the new assist notice as a complete privacy inventory. `HANDOFF.md` says domain/SMTP, deployment, production keys and paid quota enforcement remain pending; those historical notes need reconciliation against actual deployment evidence, not assumed completion.

Judge: seed two accounts with every auth, billing, trial, consent and usage relation; complete export; delete one; force remote cancel timeout and verify fail-closed retention/retry; retry after remote success/local crash; verify no row outside the approved retention set, no live session, no hidden billing subscription, no leaked related event id or email bucket. Restore a retained backup and prove deleted access stays deleted. Test both trial/no-trial, Stripe/MoR selected branch, remote-customer policy, five emails, consent evidence and private support. A professional signs off the legal/duty questions separately from the engineering tests.

## Differences from the plan

Identity/Stripe checkout exists, but no reviewed commercial terms, deletion/export process, private account support or five-language email flow is established by this code. Withdrawal consent collection and all legal/tax applicability remain **not verified**. v6's Stripe-first deletion must be adapted if the owner chooses a merchant of record. Proposed retention durations and the bounded deletion journal are decisions for confirmation, not silently expanded retention rights.
