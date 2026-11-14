import { betterAuth } from 'better-auth';
import { bearer, deviceAuthorization, emailOTP } from 'better-auth/plugins';
import { stripe as stripePlugin } from '@better-auth/stripe';
import { createAbuse, DEFAULT_LIMITS } from './abuse.mjs';

export const CLIENT_ID = 'filow-desktop';
export function paidSubscription(subscriptions, now = Date.now()) {
  return subscriptions.find(s => s.plan === 'pro' && ['active','trialing'].includes(s.status)
    && s.periodEnd && new Date(s.periodEnd).getTime() > now) ?? null;
}
export function createCloud({ database, origin, secret, sendOTP, stripe, webhookSecret, priceId, liveBilling = false, limits = DEFAULT_LIMITS, logger = () => {}, now = Date.now }) {
  const abuse = createAbuse(database, secret, limits, now);
  // SDK errors can contain SMTP responses, request bodies and credentials. Only fixed events leave here.
  const safeLog = () => logger('account_handler_error');
  const billing = Boolean(stripe && webhookSecret && priceId);
  const auth = betterAuth({
    appName: 'Filo', baseURL: origin, secret, database, trustedOrigins: [origin],
    logger: { level: 'error', log: safeLog },
    advanced: { ipAddress: { ipAddressHeaders: ['x-filow-client-ip'] } },
    session: { expiresIn: 60 * 60 * 24 * 7 },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 60 },
    plugins: [
      bearer(),
      emailOTP({ otpLength: 6, expiresIn: 600, allowedAttempts: 5, storeOTP: 'hashed',
        sendVerificationOTP: ({ email, otp, type }) => sendOTP({ email, otp, type }) }),
      deviceAuthorization({ verificationUri: '/device', validateClient: id => id === CLIENT_ID }),
      ...(billing ? [stripePlugin({ stripeClient: stripe, stripeWebhookSecret: webhookSecret,
        createCustomerOnSignUp: false,
        subscription: { enabled: true, plans: [{ name: 'pro', priceId }] },
      })] : []),
    ],
  });
  const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
  // Stripe retries events and does not promise their order. The billing plugin applies whatever it is
  // handed, so an older "active" delivered after "past_due" would give the access back. Every signed
  // event is therefore recorded, and one that was already applied, or that is older than the newest
  // event applied to the same subscription, is answered (so Stripe stops retrying) and not applied.
  if (billing) database.exec('CREATE TABLE IF NOT EXISTS filowStripeEvent (id TEXT PRIMARY KEY, subject TEXT, created INTEGER NOT NULL)');
  async function webhook(request) {
    const payload = await request.text();
    let event;
    try { event = await stripe.webhooks.constructEventAsync(payload, request.headers.get('stripe-signature') ?? '', webhookSecret); }
    catch { return json({ error: 'invalid_signature' }, 400); }
    const subject = event.data?.object?.object === 'subscription' ? String(event.data.object.id) : null;
    const created = Number.isFinite(event.created) ? event.created : 0;
    if (database.prepare('SELECT 1 FROM filowStripeEvent WHERE id = ?').get(event.id)) return json({ received: true, applied: false });
    const newest = subject ? database.prepare('SELECT MAX(created) AS at FROM filowStripeEvent WHERE subject = ?').get(subject)?.at : null;
    const record = () => database.prepare('INSERT OR IGNORE INTO filowStripeEvent (id, subject, created) VALUES (?, ?, ?)').run(event.id, subject, created);
    if (newest != null && created < newest) { record(); return json({ received: true, applied: false }); }
    const headers = new Headers(request.headers);
    headers.delete('Content-Length');
    const response = await auth.handler(new Request(request.url, { method: 'POST', headers, body: payload }));
    // Recorded only once it was applied: a failure is retried by Stripe and must get through then.
    if (response.ok) record();
    return response;
  }
  async function handleInner(request) {
    const url = new URL(request.url);
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    if (billing && url.pathname === '/api/auth/stripe/webhook' && request.method === 'POST') return webhook(request);
    // The billing plugin's own routes are not reachable from outside: checkout, portal and the plan go through
    // /v1/* below. Only the return from Stripe's checkout stays open (the plugin has no cancel callback).
    if (url.pathname.startsWith('/api/auth/subscription/') && !(url.pathname === '/api/auth/subscription/success' && request.method === 'GET')) return json({ error: 'not_found' },404);
    if (url.pathname.startsWith('/api/auth/')) {
      if (request.method === 'POST') {
        let body;
        try { body = await request.clone().json(); } catch { return json({ error: 'invalid_request' }, 400); }
        const retryAfter = abuse.request(url.pathname, request.headers.get('x-filow-client-ip') || 'unknown', body?.email ?? body?.newEmail);
        if (retryAfter) return Response.json({ error: 'sign_in_rate_limited', retryAfter }, { status: 429, headers: { 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' } });
        if (url.pathname === '/api/auth/device/token') {
          const code = database.prepare('SELECT userId, status FROM deviceCode WHERE deviceCode = ?').get(typeof body?.device_code === 'string' ? body.device_code : '');
          if (code?.status === 'approved' && code.userId && abuse.full(code.userId)) return json({ error: 'device_limit_reached', limit: limits.devices }, 409);
          const response = await auth.handler(request);
          if (response.ok) { const data = await response.clone().json(); if (data.access_token) abuse.remember(data.access_token); }
          return response;
        }
      }
      return auth.handler(request);
    }
    if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true });
    if (!['/v1/me','/v1/checkout','/v1/portal'].includes(url.pathname)) return json({ error: 'not_found' },404);
    if (request.method !== (url.pathname === '/v1/me' ? 'GET' : 'POST')) return json({ error: 'method_not_allowed' },405);
    // A browser must come from this service. Desktop requests carry a bearer token and no cookies.
    if (request.headers.get('origin') && request.headers.get('origin') !== origin) return json({ error: 'forbidden' },403);
    if (url.pathname === '/v1/checkout' && !liveBilling) return json({ error: 'billing_not_open' },503);
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return json({ error: 'sign_in_required' },401);
    if (url.pathname === '/v1/me') {
      let subscriptions = [];
      if (billing) {
        const result = await auth.handler(new Request(`${origin}/api/auth/subscription/list`, { headers: request.headers }));
        if (!result.ok) return json({ error: 'billing_unavailable' },503);
        subscriptions = await result.json();
      }
      const paid = paidSubscription(Array.isArray(subscriptions) ? subscriptions : []);
      return json({ user: { email: session.user.email, name: session.user.name },
        plan: paid ? 'pro' : 'local', paidUntil: paid?.periodEnd ?? null, billing, checkout: liveBilling ? (billing ? 'open' : 'unconfigured') : 'billing_not_open' });
    }
    if (!billing) return json({ error: 'billing_not_configured' },503);
    // Only the configured plan, current user's reference, and our return page. Never client prices.
    const checkout = url.pathname === '/v1/checkout';
    const billingHeaders = new Headers(request.headers);
    billingHeaders.set('Content-Type', 'application/json');
    billingHeaders.set('Origin', origin);
    billingHeaders.delete('Content-Length');
    const result = await auth.handler(new Request(`${origin}/api/auth/subscription/${checkout ? 'upgrade' : 'billing-portal'}`, {
      method: 'POST', headers: billingHeaders,
      body: JSON.stringify({ ...(checkout ? { plan: 'pro', successUrl: `${origin}/done`, cancelUrl: `${origin}/done` } : {}),
        returnUrl: `${origin}/done`, disableRedirect: true }),
    }));
    return result;
  }
  // One serving process (README). Serialize grants across accounts to close the parallel redemption race.
  let grants = Promise.resolve();
  async function handle(request) {
    const run = async () => { try { return await handleInner(request); } catch { safeLog(); return json({ error: 'service_unavailable' }, 503); } };
    if (new URL(request.url).pathname.replace(/\/+$/, '') !== '/api/auth/device/token') return run();
    const result = grants.then(run, run);
    grants = result.then(() => undefined, () => undefined);
    return result;
  }
  return { auth, handle, billing };
}
