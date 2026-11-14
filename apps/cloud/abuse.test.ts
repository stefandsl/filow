import { afterEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { getMigrations } from 'better-auth/db/migration';
import { createCloud } from './service.mjs';
import { abuseLimits, createAbuse, DEFAULT_LIMITS } from './abuse.mjs';
const databases: InstanceType<typeof Database>[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
const database = () => { const db = new Database(':memory:'); databases.push(db); return db; };
it.each([
  ['addressHour', 3600000, (i: number) => ['same-ip', `person${i}@example.test`]],
  ['emailQuarter', 900000, (i: number) => [`ip${i}`, ' Person@Example.test ']],
  ['emailDay', 86400000, (i: number) => [`ip${i}`, 'person@example.test']],
  ['deviceHour', 3600000, () => ['same-ip', '']],
] as const)('enforces %s and expires it', (key, window, identity) => {
  let now = 1000;
  const db = database();
  const limits = { ...DEFAULT_LIMITS, addressHour: 100, emailQuarter: 100, emailDay: 100, deviceHour: 100, [key]: 2 };
  const guard = createAbuse(db, 'secret', limits, () => now);
  const path = key === 'deviceHour' ? '/api/auth/device/code' : '/api/auth/email-otp/send-verification-otp';
  for (let i = 0; i < 2; i++) expect(guard.request(path, ...identity(i))).toBe(0);
  expect(guard.request(path, ...identity(2))).toBe(window / 1000);
  now += window;
  expect(guard.request(path, ...identity(3))).toBe(0);
  expect(JSON.stringify(db.prepare('SELECT * FROM filowAuthBucket').all())).not.toMatch(/person|same-ip|example/i);
});
it('rejects invalid configuration', () => {
  expect(abuseLimits()).toEqual(DEFAULT_LIMITS);
  expect(() => abuseLimits({ FILOW_AUTH_DEVICES: '0' })).toThrow();
});
it('normalizes trailing slashes and limits every code-send path', () => {
  const guard = createAbuse(database(), 'secret', { ...DEFAULT_LIMITS, addressHour: 1 });
  expect(guard.request('/api/auth/email-otp/send-verification-otp/', 'same', 'one@example.test')).toBe(0);
  expect(guard.request('/api/auth/email-otp/request-password-reset', 'same', 'two@example.test')).toBeGreaterThan(0);
});
async function setup(overrides = {}) {
  const db = database(); const logs: unknown[] = []; let otp = '';
  const origin = 'http://localhost:4994';
  const cloud = createCloud({ database: db, origin, secret: 'hardening-secret-32-characters-long-12345', limits: { ...DEFAULT_LIMITS, devices: 1 },
    sendOTP: async (m: { otp: string }) => { otp = m.otp; }, logger: (...values: unknown[]) => logs.push(values), ...overrides });
  await (await getMigrations(cloud.auth.options)).runMigrations();
  const call = (route: string, body: unknown, token = '') => cloud.handle(new Request(origin + route, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'x-filow-client-ip': '127.0.0.1', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }));
  const email = 'CANARY-private-email@example.test';
  await call('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' });
  const signed = await (await call('/api/auth/sign-in/email-otp', { email, otp })).json();
  return { db, logs, call, email, otp, token: signed.token,
    claim: (code: string) => cloud.handle(new Request(origin + '/api/auth/device?user_code=' + code, { headers: { Authorization: `Bearer ${signed.token}` } })) };
}
it('returns typed 429 with retry time through the handler', async () => {
  const { call, email } = await setup();
  for (let i = 0; i < 2; i++) expect((await call('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' })).status).toBe(200);
  const r = await call('/api/auth/email-otp/send-verification-otp', { email: email.toUpperCase(), type: 'sign-in' });
  expect(r.status).toBe(429); expect(Number(r.headers.get('Retry-After'))).toBeGreaterThan(0);
  expect(await r.json()).toMatchObject({ error: 'sign_in_rate_limited' });
});
it('caps parallel desktop grants, preserving ordinary browser sign-in and freeing revoked devices', async () => {
  const { call, token, db, claim } = await setup();
  const codes = [];
  for (let i = 0; i < 2; i++) {
    const code = await (await call('/api/auth/device/code', { client_id: 'filow-desktop' })).json(); codes.push(code);
    expect((await claim(code.user_code)).status).toBe(200);
    expect((await call('/api/auth/device/approve', { userCode: code.user_code }, token)).status).toBe(200);
  }
  const redeem = (code: { device_code: string }) => call('/api/auth/device/token', { client_id: 'filow-desktop', device_code: code.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
  const replies = await Promise.all(codes.map(redeem));
  expect(replies.map(r => r.status)).toEqual([200, 409]);
  expect(await replies[1].json()).toEqual({ error: 'device_limit_reached', limit: 1 });
  db.prepare('DELETE FROM session WHERE id IN (SELECT id FROM filowDesktopSession)').run();
  expect((await redeem(codes[1])).status).toBe(200);
});
it('logs only fixed events for success, denial, malformed input and a payload-bearing SMTP failure', async () => {
  const { logs, call, email, token, otp } = await setup();
  await call('/api/auth/sign-in/email-otp', { email, otp: 'CANARY-code', body: 'CANARY-request-body' }, 'CANARY-token');
  await call('/api/auth/email-otp/send-verification-otp', null);
  await call('/v1/me', { body: 'CANARY-response-body' }, token);
  const failure = await setup({ sendOTP: async () => { throw new Error('CANARY-provider-response secret@example.test CANARY-code CANARY-token'); } });
  const output = JSON.stringify([...logs, ...failure.logs]);
  for (const value of ['CANARY', email, token, otp, 'secret@example.test']) if (value) expect(output).not.toContain(value);
  expect(failure.logs.length).toBeGreaterThan(0);
  for (const line of [...logs, ...failure.logs]) expect(line).toEqual(['account_handler_error']);
});
