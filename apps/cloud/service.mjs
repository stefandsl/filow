import { betterAuth } from 'better-auth';
import { bearer, deviceAuthorization, emailOTP } from 'better-auth/plugins';
import { stripe as stripePlugin } from '@better-auth/stripe';

export const CLIENT_ID = 'filow-desktop';
export function paidSubscription(subscriptions, now = Date.now()) {
  return subscriptions.find(s => s.plan === 'pro' && ['active','trialing'].includes(s.status)
    && s.periodEnd && new Date(s.periodEnd).getTime() > now) ?? null;
}
export function createCloud({ database, origin, secret, sendOTP, stripe, webhookSecret, priceId }) {
  const billing = Boolean(stripe && webhookSecret && priceId);
  const auth = betterAuth({
    appName: 'Filo', baseURL: origin, secret, database, trustedOrigins: [origin],
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
  async function handle(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/auth/')) return auth.handler(request);
    if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true });
    if (!['/v1/me','/v1/checkout','/v1/portal'].includes(url.pathname)) return json({ error: 'not_found' },404);
    if (request.method !== (url.pathname === '/v1/me' ? 'GET' : 'POST')) return json({ error: 'method_not_allowed' },405);
    // A browser must come from this service. Desktop requests carry a bearer token and no cookies.
    if (request.headers.get('origin') && request.headers.get('origin') !== origin) return json({ error: 'forbidden' },403);
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
        plan: paid ? 'pro' : 'local', paidUntil: paid?.periodEnd ?? null, billing });
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
  return { auth, handle, billing };
}
