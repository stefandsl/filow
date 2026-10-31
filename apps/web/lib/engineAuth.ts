// Gate for the spend endpoints (/api/decide, /api/stt/*, later /api/vision, /api/import).
// When ACCESS_PASSWORD is set, callers must present an engine token minted by the
// session server (HMAC with the same password). Without a password (localhost /
// LAN desktop use) the endpoints stay open, matching ARCHITECTURE.md §10.
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

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

/** Returns a 401 response when the request is not allowed, otherwise null. */
export function requireEngine(req: Request): NextResponse | null {
  const password = process.env.ACCESS_PASSWORD;
  if (!password) return null;
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (token && verifyEngineToken(password, token)) return null;
  return NextResponse.json({ error: "engine token required (ACCESS_PASSWORD is set)" }, { status: 401 });
}
