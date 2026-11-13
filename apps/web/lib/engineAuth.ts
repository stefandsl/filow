// Gate for the spend endpoints (/api/decide, /api/stt/*, /api/vision, /api/import, /api/buddy/*).
// When ACCESS_PASSWORD is set, callers must present an engine token minted by the
// session server (HMAC with the same password). Without a password (localhost /
// LAN desktop use) the endpoints stay open, matching ARCHITECTURE.md §10.
//
// A controller the presenter accepted on the PC (the PowerPoint pane in View mode, the browser
// extension) gets a controller token instead ("c." + the same parts, signed over "ctl:",
// apps/server/src/auth.ts). It never passes as an engine token: only routes that name controllers
// take it (requireEngine(req, { controllers: true })), and a consent header that comes with it is
// never a consent (isControllerRequest, lib/buddy/outbound.ts consentDenied).
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

function verifySigned(secret: string, sid: string, exp: string, mac: string, prefix: string, now: number): { sessionId: string } | null {
  if (!/^\d+$/.test(exp) || Number(exp) < now) return null;
  const sessionId = Buffer.from(sid, "base64url").toString();
  const expected = createHmac("sha256", secret).update(`${prefix}${sessionId}.${exp}`).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { sessionId };
}

export function verifyEngineToken(secret: string, token: string, now = Date.now()): { sessionId: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  return verifySigned(secret, parts[0], parts[1], parts[2], "", now);
}

export function verifyControllerToken(secret: string, token: string, now = Date.now()): { sessionId: string } | null {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "c") return null;
  return verifySigned(secret, parts[1], parts[2], parts[3], "ctl:", now);
}

const bearer = (req: Request) => (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

/** The request carries a controller token (shaped like one: checked or not, it is never the engine). */
export function isControllerRequest(req: Request): boolean {
  return bearer(req).startsWith("c.");
}

/**
 * Returns a 401 response when the request is not allowed, otherwise null. `controllers`: this route
 * also takes a controller token (script generation, vision); every other route takes engine tokens only.
 */
export function requireEngine(req: Request, opts: { controllers?: boolean } = {}): NextResponse | null {
  const password = process.env.ACCESS_PASSWORD;
  if (!password) return null;
  const token = bearer(req);
  if (token && verifyEngineToken(password, token)) return null;
  if (token && opts.controllers && verifyControllerToken(password, token)) return null;
  return NextResponse.json({ error: "engine token required (ACCESS_PASSWORD is set)" }, { status: 401 });
}
