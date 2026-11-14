# Filo accounts and subscriptions

This is a separate hosted service. The desktop runs without it. Never put the database, SMTP password, Better Auth secret or Stripe keys in a desktop release.

## Local setup

1. From the repository root run `npm ci`, then `npm run build -w apps/cloud`.
2. Copy `.env.example` to `apps/cloud/.env`. Set a randomly generated `BETTER_AUTH_SECRET` (at least 32 characters), `MAIL_FROM`, and a working `SMTP_URL`. For local development use an SMTP inbox such as Mailpit. Codes are not printed to logs.
3. Set `FILOW_CLOUD_DB` to an absolute persistent path on G: or E: on this workstation. The database must never be committed. On a server, use a private persistent volume.
4. Run `npm run migrate -w apps/cloud`, then `npm start -w apps/cloud`.
5. Set `FILOW_ACCOUNT_ORIGIN=http://127.0.0.1:4780` in the development desktop environment and restart it. Packaged builds require an HTTPS origin. Open Settings > Account & plan.

The browser asks for an email code, then the code shown in the desktop app, then explicit device approval. Desktop tokens are encrypted by the OS and never exposed to the page. Codes expire; polling obeys the server interval. Signing out clears the local session even if remote revocation fails; an offline failure is shown so it can be investigated. Unused server sessions expire after seven days.

## Checkout availability

Checkout is closed by default, including with test credentials. Unless `FILOW_LIVE_BILLING=1`, `POST /v1/checkout` returns HTTP 503 with `{"error":"billing_not_open"}` before any Stripe call. `/v1/me` includes `checkout: "billing_not_open"`; the desktop explains this in five languages. Existing subscribers can still open the portal. Webhooks, plan selection and prices are unchanged.

Setting the switch requires the owner's live-billing decision. These safety changes do not authorize enabling it. Unit tests inject the flag and use fake Stripe methods; there is no staging bypass.

## Stripe test mode

Create a **recurring monthly price** in Stripe test mode. Pricing is a business decision; no price or currency is hard-coded in the app. Set `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` and `STRIPE_WEBHOOK_SECRET` together, then migrate again (the plugin adds billing tables) and restart.

Forward test webhooks to `/api/auth/stripe/webhook`, with at least:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Enable the Stripe customer portal for payment methods, invoices and cancellation. The desktop's Subscribe button creates checkout for the signed-in user and the configured `pro` price. The service ignores client-supplied prices and account IDs. The return page does not unlock anything: Refresh account reads the stored subscription. Only `active`/`trialing` Pro subscriptions with a future period end are treated as paid. `past_due`, `unpaid`, expired and canceled subscriptions are not paid.

Stripe retries events and does not promise their order. Every signed event is recorded in the `filowStripeEvent` table; an event that was already applied, or that is older than the newest event applied to the same subscription, is answered with 200 and not applied. Two different events created in the same second are applied in arrival order. This is not a reconciliation against Stripe's current state: add that before live billing.

Before production, exercise checkout, canceled checkout, repeated callbacks, a failed renewal, cancel-at-period-end and portal cancellation against your own Stripe **test** account. Automated tests use Stripe SDK mocks and signed webhook fixtures; they do not prove a merchant account or webhook endpoint is configured correctly.

## Deployment

Use a single Node.js 22 LTS service behind HTTPS for the first beta. SQLite is intentional for a single-instance beta; use a durable volume and backups. Do not put this process on an ephemeral filesystem or scale it to multiple replicas sharing a database file. `better-sqlite3` is pinned to 12.4.1: 13.1.1 crashed in this workstation's Node 22.13.0 runtime during validation.

Set `FILOW_CLOUD_ORIGIN` to the public account origin. Bind `HOST=0.0.0.0` only behind the deployment's firewall/reverse proxy. Configure real email delivery, domain authentication and a monitored SMTP sender. Back up the database before migrations. Preserve request bodies at the Stripe webhook endpoint. Use an edge rate limit as well as the persisted authentication rate limit; make sure the proxy supplies the correct client IP headers.

Set the desktop's public `FILOW_ACCOUNT_ORIGIN` to that HTTPS origin. It is not a secret. The distributed desktop does not need any Stripe or email credentials. Native builds only open the configured account site and exact Stripe checkout/portal domains.

The HTTP server overwrites its internal client-IP header from the actual socket address. If a reverse proxy is in front, set `FILOW_TRUSTED_PROXY` to its exact immediate peer IP. Only that peer's last `X-Forwarded-For` entry is accepted for rate limiting; forwarding headers from other peers are ignored.

Live Stripe keys are rejected unless `FILOW_LIVE_BILLING=1`. Turn this on only after the test account flow, published price/benefits, support/refund process and privacy disclosures are ready. Deploying the service or setting this flag is not part of this local implementation.

## Scope

### Sign-in abuse controls

These positive integer settings apply to the single serving process and its persistent SQLite database. Defaults preserve ordinary sign-in use; no billing or provider setting is enabled.

| Setting | Default | Meaning |
|---|---:|---|
| `FILOW_AUTH_ADDRESS_HOUR` | 20 | Code-send requests per client address per hour |
| `FILOW_AUTH_EMAIL_QUARTER` | 3 | Code-send requests per normalized email and path per 15 minutes |
| `FILOW_AUTH_EMAIL_DAY` | 10 | Code-send requests per normalized email and path per day |
| `FILOW_AUTH_DEVICE_HOUR` | 10 | Device-code requests per client address per hour |
| `FILOW_AUTH_DEVICES` | 3 | Active desktop sessions per account |

Code-send limits run before the auth handler. They return HTTP 429 with
`{error:"sign_in_rate_limited",retryAfter:<seconds>}` and a `Retry-After` header.
Buckets use keyed HMAC identifiers, expire after their window, and have a 100,000-key
ceiling. No clear email or address is kept in these buckets. The existing database
auth limiter and five-attempt OTP verification rule remain in place.

Desktop token grants are serialized and recorded in `filowDesktopSession`. A full
account receives HTTP 409 `{error:"device_limit_reached",limit:3}`; no other device
is signed out. Expired and revoked sessions stop counting. Browser sign-in sessions
do not consume desktop slots. Previously issued, unclassified sessions are preserved;
this is not a retroactive inventory of devices issued by an older service.
Do not run multiple serving processes against this database: the grant mutex is
process-local. Multi-instance admission requires a transactional shared grant flow.

Auth SDK diagnostics and caught handler failures emit only the fixed
`account_handler_error` event through the injectable logger. No request, response,
exception message, email, token or code is passed to it. Tests exercise the handlers
with a capturing logger, fake mail failures and canaries. This does not audit a deployed
reverse proxy, SMTP infrastructure, system logs or crash dumps.

This implements identity, billing and account/plan display. It does **not** sell or enforce metered cloud AI usage yet. Any future hosted inference endpoint must verify the session, entitlement and usage quota on the server; never trust a desktop `plan` value. Existing local features stay available without login.

The desktop and browser screens use Filo's shared five-language dictionary. The intro video is an original, silent, captioned 18-second guide; its transcript is localized. Rebuild it with `node scripts/make-intro.mjs` from the repository root (requires ffmpeg). No competitor media is included.

Reference APIs: [Better Auth device flow](https://better-auth.com/docs/plugins/device-authorization), [email codes](https://better-auth.com/docs/plugins/email-otp), [Stripe plugin](https://better-auth.com/docs/plugins/stripe).
