# Filo accounts and subscriptions

This is a separate hosted service. The desktop runs without it. Never put the database, SMTP password, Better Auth secret or Stripe keys in a desktop release.

## Local setup

1. From the repository root run `npm ci`, then `npm run build -w apps/cloud`.
2. Copy `.env.example` to `apps/cloud/.env`. Set a randomly generated `BETTER_AUTH_SECRET` (at least 32 characters), `MAIL_FROM`, and a working `SMTP_URL`. For local development use an SMTP inbox such as Mailpit. Codes are not printed to logs.
3. Set `FILOW_CLOUD_DB` to an absolute persistent path on G: or E: on this workstation. The database must never be committed. On a server, use a private persistent volume.
4. Run `npm run migrate -w apps/cloud`, then `npm start -w apps/cloud`.
5. Set `FILOW_ACCOUNT_ORIGIN=http://127.0.0.1:4780` in the development desktop environment and restart it. Packaged builds require an HTTPS origin. Open Settings > Account & plan.

The browser asks for an email code, then the code shown in the desktop app, then explicit device approval. Desktop tokens are encrypted by the OS and never exposed to the page. Codes expire; polling obeys the server interval. Signing out clears the local session even if remote revocation fails; an offline failure is shown so it can be investigated. Unused server sessions expire after seven days.

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

This implements identity, billing and account/plan display. It does **not** sell or enforce metered cloud AI usage yet. Any future hosted inference endpoint must verify the session, entitlement and usage quota on the server; never trust a desktop `plan` value. Existing local features stay available without login.

The desktop and browser screens use Filo's shared five-language dictionary. The intro video is an original, silent, captioned 18-second guide; its transcript is localized. Rebuild it with `node scripts/make-intro.mjs` from the repository root (requires ffmpeg). No competitor media is included.

Reference APIs: [Better Auth device flow](https://better-auth.com/docs/plugins/device-authorization), [email codes](https://better-auth.com/docs/plugins/email-otp), [Stripe plugin](https://better-auth.com/docs/plugins/stripe).
