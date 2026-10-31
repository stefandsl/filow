// Engine tokens are HMAC-signed so the Next.js API can verify them without
// talking to the session server. Views get random opaque tokens held in memory.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function randomToken(): string {
  return randomBytes(16).toString("base64url");
}

/** engineToken = base64url(sessionId).expiresMs.hmac(secret, sessionId.expiresMs) */
export function mintEngineToken(secret: string, sessionId: string, ttlMs: number, now = Date.now()): string {
  const exp = String(now + ttlMs);
  const sid = Buffer.from(sessionId).toString("base64url");
  const mac = createHmac("sha256", secret).update(`${sessionId}.${exp}`).digest("base64url");
  return `${sid}.${exp}.${mac}`;
}

export function verifyEngineToken(secret: string, token: string, now = Date.now()): { sessionId: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [sid, exp, mac] = parts;
  if (!/^\d+$/.test(exp) || Number(exp) < now) return null;
  const sessionId = Buffer.from(sid, "base64url").toString();
  const expected = createHmac("sha256", secret).update(`${sessionId}.${exp}`).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { sessionId };
}
