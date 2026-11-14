import { createHmac } from 'node:crypto';

export const DEFAULT_LIMITS = { addressHour: 20, emailQuarter: 3, emailDay: 10, deviceHour: 10, devices: 3 };
export function abuseLimits(env = {}) {
  const names = { addressHour: 'FILOW_AUTH_ADDRESS_HOUR', emailQuarter: 'FILOW_AUTH_EMAIL_QUARTER', emailDay: 'FILOW_AUTH_EMAIL_DAY', deviceHour: 'FILOW_AUTH_DEVICE_HOUR', devices: 'FILOW_AUTH_DEVICES' };
  return Object.fromEntries(Object.entries(names).map(([key, name]) => {
    const value = env[name] === undefined ? DEFAULT_LIMITS[key] : Number(env[name]);
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${name}`);
    return [key, value];
  }));
}
export function createAbuse(database, secret, limits = DEFAULT_LIMITS, now = Date.now) {
  database.exec('CREATE TABLE IF NOT EXISTS filowAuthBucket (key TEXT PRIMARY KEY, expires INTEGER NOT NULL, count INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS filowDesktopSession (id TEXT PRIMARY KEY)');
  const hash = value => createHmac('sha256', secret).update(value).digest('hex');
  const consume = database.transaction(buckets => {
    const at = now();
    database.prepare('DELETE FROM filowAuthBucket WHERE expires <= ?').run(at);
    const rows = buckets.map(([key, max, ms]) => ({ key: hash(key), max, ms }));
    let retry = 0;
    for (const row of rows) {
      const found = database.prepare('SELECT count, expires FROM filowAuthBucket WHERE key = ?').get(row.key);
      if (found?.count >= row.max) retry = Math.max(retry, Math.ceil((found.expires - at) / 1000));
    }
    if (retry) return retry;
    // Bound unique keys, including an attack with many invented addresses.
    if (database.prepare('SELECT COUNT(*) AS n FROM filowAuthBucket').get().n + rows.length > 100000) return 60;
    for (const row of rows) database.prepare('INSERT INTO filowAuthBucket (key, expires, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET count = count + 1').run(row.key, at + row.ms);
    return 0;
  });
  return {
    request(path, address, email) {
      path = path.replace(/\/+$/, '');
      if (path === '/api/auth/device/code') return consume([[`device:${address}`, limits.deviceHour, 3600000]]);
      if (!['/api/auth/email-otp/send-verification-otp', '/api/auth/email-otp/request-password-reset', '/api/auth/forget-password/email-otp', '/api/auth/email-otp/request-email-change'].includes(path)) return 0;
      const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
      return consume([[`address:${address}`, limits.addressHour, 3600000],
        [`quarter:${path}:${normalized}`, limits.emailQuarter, 900000], [`day:${path}:${normalized}`, limits.emailDay, 86400000]]);
    },
    full(userId) {
      database.prepare('DELETE FROM filowDesktopSession WHERE id NOT IN (SELECT id FROM session WHERE expiresAt > ?)').run(now());
      return database.prepare('SELECT COUNT(*) AS n FROM session s JOIN filowDesktopSession d ON d.id = s.id WHERE s.userId = ? AND s.expiresAt > ?').get(userId, now()).n >= limits.devices;
    },
    remember(token) {
      const session = database.prepare('SELECT id FROM session WHERE token = ?').get(token);
      if (!session) throw new Error('desktop_session_missing');
      database.prepare('INSERT OR IGNORE INTO filowDesktopSession (id) VALUES (?)').run(session.id);
    },
  };
}
