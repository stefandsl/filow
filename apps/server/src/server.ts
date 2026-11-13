// Session relay. Protocol and lifetimes: ARCHITECTURE.md §5.4.
//
// Pairing security (the public link only encrypts; the code is the access control):
// - codes are 8 characters from a 31-letter alphabet (about 40 bits), come from crypto.randomInt,
//   live `codeTtlMs` (5 min) and are single-use; the engine asks for a fresh one (POST
//   /api/session/:id/code or ws {t:"newCode"}). After 10 wrong codes every live code is burned and
//   replaced, and each engine is sent its new one ({t:"codeRotated"});
// - pairing attempts are limited per address and in total, in two separate buckets: the local network
//   and everything else (the tunnel), so one cannot lock the other out;
// - the engine is told about every pairing ({t:"paired"} and the {t:"devices"} list), can revoke any
//   of them ({t:"revoke"}) and gives each controller, separately, the right to ask OK Filow
//   ({t:"allowAsk"}): off by default, never automatic;
// - a paired phone starts as "pending": the engine is told {t:"pairRequest"} and answers
//   {t:"pairDecision"} with viewer / controller / reject; until then it gets no state. Peers on the
//   local network can be auto-accepted as controllers (autoAcceptLan, desktop LAN mode); loopback and
//   anything that came through a proxy or tunnel never are. The app's own floating windows prove
//   themselves with the per-launch app key instead (appPairKey);
// - a device's token expires `viewTokenTtlMs` after it was last connected (refreshed on every
//   connection and while connected), and with its pairing when revoked;
// - client IPs come from the socket unless trustProxy is on (cf-connecting-ip, then x-forwarded-for).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { WebSocketServer, WebSocket } from "ws";
import { applyPatch, type Operation } from "fast-json-patch";
import { mintControllerToken, mintEngineToken, randomToken, verifyEngineToken } from "./auth";
import { cleanDeviceName, PHONE_ASK, phoneAskText } from "./phone-ask";

export type Role = "viewer" | "controller" | "pending";
/** How a device reached the relay: this computer's own windows, the local network, or anything else (the tunnel). */
export type Peer = "app" | "lan" | "remote";

type Pairing = {
  /** Shown to the engine; never a credential. */
  id: string;
  /** The device's credential. */
  token: string;
  role: Role;
  device: string;
  peer: Peer;
  /** The presenter decided on the PC (pairDecision, setRole); false for an auto-accepted phone. */
  approved: boolean;
  /** May ask OK Filow: given on the PC only, off by default. */
  canAsk: boolean;
  pairedAt: number;
  expiresAt: number;
};
type View = { ws: WebSocket; pairing: Pairing; alive: boolean };
type Session = {
  id: string;
  code: string | null;
  codeExpiresAt: number;
  createdAt: number;
  engineClosedAt: number | null;
  engine: WebSocket | null;
  engineAlive: boolean;
  pairings: Map<string, Pairing>;
  byToken: Map<string, Pairing>;
  views: Set<View>;
  lastState: unknown | null;
  version: number;
};

export type ServerOptions = {
  port?: number;
  host?: string;
  /** Required for session creation when set. Also the HMAC secret for engine tokens. */
  accessPassword?: string;
  /** Secret for engine tokens when no password is set (LAN / localhost mode). */
  secret?: string;
  now?: () => number;
  engineGraceMs?: number; // 2 h
  absoluteTtlMs?: number; // 12 h
  /** How long a pairing code stays valid after it was issued (5 min). */
  codeTtlMs?: number;
  /** How long a device's token lives after it was last connected (30 min). */
  viewTokenTtlMs?: number;
  pairLimitPerMinute?: number; // 10 per address
  pairGlobalLimitPerMinute?: number; // 60 per bucket (local network, everything else)
  /** Wrong codes before every live code is burned and replaced (10). */
  wrongCodesBeforeRotation?: number;
  pingMs?: number; // 15 s
  /** Allowed CORS origins for the HTTP endpoints ("*" by default: the token is the credential). */
  corsOrigin?: string;
  /** Honour cf-connecting-ip / x-forwarded-for (only behind our own proxy or tunnel). Default: TRUST_PROXY=1. */
  trustProxy?: boolean;
  /** Auto-accept phones on the local network that talk to us directly (never loopback, never proxied). Default: AUTO_ACCEPT_LAN=1. */
  autoAcceptLan?: boolean;
  /** The per-launch key the desktop app gives its own floating windows (FILOW_APP_PAIR_KEY); only from loopback, never proxied. */
  appPairKey?: string;
  /** Test seam: the socket's peer address. */
  remoteAddress?: (req: IncomingMessage) => string | undefined;
};

export type SessionServer = {
  httpServer: Server;
  secret: string;
  address(): { port: number; host: string };
  close(): Promise<void>;
  /** test hook */
  sweep(): void;
};

/** A pairing code: 8 characters, no 0/O, 1/I/L. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 8;
/** What a person typed, as a code: upper case, without spaces or dashes. */
export const normalizeCode = (raw: unknown): string => String(raw ?? "").slice(0, 64).toUpperCase().replace(/[\s-]/g, "");
/** The largest WebSocket message accepted (commands are small; a state comes from the engine only). */
export const VIEW_MAX_PAYLOAD = 16 * 1024;
export const ENGINE_MAX_PAYLOAD = 8 * 1024 * 1024;

/** RFC 1918, link-local, loopback (v4 and v4-mapped v6, ::1). */
export function isPrivateIp(ip: string | undefined): boolean {
  if (!ip) return false;
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (v4 === "::1") return true;
  if (isIP(v4) !== 4) return false;
  return /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(v4);
}
/** 127.0.0.0/8 and ::1 (v4-mapped too): this computer, which proxies and tunnels also come from. */
export function isLoopbackIp(ip: string | undefined): boolean {
  if (!ip) return false;
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  return v4 === "::1" || (isIP(v4) === 4 && v4.startsWith("127."));
}
const proxied = (req: IncomingMessage) =>
  Boolean(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.headers["forwarded"] || req.headers["x-real-ip"]);
const sameSecret = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function createSessionServer(opts: ServerOptions = {}): SessionServer {
  const now = opts.now ?? (() => Date.now());
  const engineGraceMs = opts.engineGraceMs ?? 2 * 60 * 60 * 1000;
  const absoluteTtlMs = opts.absoluteTtlMs ?? 12 * 60 * 60 * 1000;
  const codeTtlMs = opts.codeTtlMs ?? 5 * 60 * 1000;
  const viewTtlMs = opts.viewTokenTtlMs ?? 30 * 60 * 1000;
  const pairLimit = opts.pairLimitPerMinute ?? 10;
  const pairGlobalLimit = opts.pairGlobalLimitPerMinute ?? 60;
  const rotateAfter = opts.wrongCodesBeforeRotation ?? 10;
  const pingMs = opts.pingMs ?? 15000;
  const secret = opts.accessPassword || opts.secret || randomToken();
  const cors = opts.corsOrigin ?? "*";
  const trustProxy = () => opts.trustProxy ?? process.env.TRUST_PROXY === "1";
  const autoAcceptLan = opts.autoAcceptLan ?? process.env.AUTO_ACCEPT_LAN === "1";
  const appPairKey = opts.appPairKey ?? process.env.FILOW_APP_PAIR_KEY ?? "";
  const peerAddress = (req: IncomingMessage) => (opts.remoteAddress ? opts.remoteAddress(req) : req.socket.remoteAddress);

  const sessions = new Map<string, Session>();
  const byCode = new Map<string, Session>();
  const pairAttempts = new Map<string, { count: number; windowStart: number }>();
  const globalAttempts = new Map<string, { count: number; windowStart: number }>();
  let wrongCodes = 0;

  // ---- helpers ---------------------------------------------------------------
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": cors,
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Access-Password",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    });
    res.end(JSON.stringify(body));
  };
  const readBody = (req: IncomingMessage) =>
    new Promise<Record<string, unknown>>((resolve) => {
      let data = "";
      req.on("data", (c) => {
        data += c;
        if (data.length > 1024 * 1024) req.destroy();
      });
      req.on("end", () => {
        try {
          const v = data ? JSON.parse(data) : {};
          resolve(v && typeof v === "object" ? v : {});
        } catch {
          resolve({});
        }
      });
    });
  const allocCode = () => {
    for (let i = 0; i < 20; i++) {
      let code = "";
      for (let j = 0; j < CODE_LENGTH; j++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!byCode.has(code)) return code;
    }
    throw new Error("could not allocate a code");
  };
  /** Issue a fresh single-use code for a session, replacing any unused one. */
  const issueCode = (s: Session) => {
    if (s.code) byCode.delete(s.code);
    s.code = allocCode();
    s.codeExpiresAt = now() + codeTtlMs;
    byCode.set(s.code, s);
    return { code: s.code, codeExpiresAt: s.codeExpiresAt };
  };
  const consumeCode = (s: Session) => {
    if (s.code) byCode.delete(s.code);
    s.code = null;
  };
  const toEngine = (s: Session, msg: unknown) => {
    if (s.engine && s.engine.readyState === WebSocket.OPEN) s.engine.send(JSON.stringify(msg));
  };
  /** Too many wrong codes: every live code is burned and replaced; each engine shows its new one. */
  const rotateCodes = () => {
    wrongCodes = 0;
    for (const s of sessions.values()) {
      if (!s.code) continue;
      toEngine(s, { t: "codeRotated", ...issueCode(s) });
    }
  };
  const connected = (s: Session, p: Pairing) => [...s.views].some((v) => v.pairing === p);
  /** The engine's view of every pairing: what the devices list in the main window shows. */
  const sendDevices = (s: Session) =>
    toEngine(s, {
      t: "devices",
      devices: [...s.pairings.values()].map((p) => ({
        id: p.id, device: p.device, role: p.role, peer: p.peer, approved: p.approved, canAsk: p.canAsk,
        connected: connected(s, p), pairedAt: p.pairedAt, expiresAt: p.expiresAt,
      })),
    });
  const live = (s: Session, p: Pairing | undefined): p is Pairing => Boolean(p && s.pairings.get(p.id) === p && p.expiresAt > now());
  const dropPairing = (s: Session, p: Pairing, code: number, reason: string) => {
    s.pairings.delete(p.id);
    s.byToken.delete(p.token);
    for (const v of [...s.views]) if (v.pairing === p) v.ws.close(code, reason);
  };
  const destroy = (s: Session, reason: string) => {
    sessions.delete(s.id);
    consumeCode(s);
    for (const v of s.views) v.ws.close(4003, reason);
    s.engine?.close(4003, reason);
  };
  const sweep = () => {
    const t = now();
    for (const s of [...sessions.values()]) {
      if (t - s.createdAt > absoluteTtlMs) destroy(s, "session expired");
      else if (s.engineClosedAt !== null && t - s.engineClosedAt > engineGraceMs) destroy(s, "engine gone");
      else {
        if (s.code && t > s.codeExpiresAt) consumeCode(s);
        let changed = false;
        for (const p of [...s.pairings.values()]) {
          if (connected(s, p)) p.expiresAt = Math.max(p.expiresAt, t + viewTtlMs);
          else if (p.expiresAt <= t) {
            dropPairing(s, p, 4004, "pairing expired");
            changed = true;
          }
        }
        if (changed) sendDevices(s);
      }
    }
    for (const map of [pairAttempts, globalAttempts]) for (const [k, a] of map) if (t - a.windowStart > 60000) map.delete(k);
  };
  /** Client address: the socket, unless we sit behind our own proxy / tunnel. */
  const ipOf = (req: IncomingMessage): string => {
    if (trustProxy()) {
      const cf = req.headers["cf-connecting-ip"];
      if (typeof cf === "string" && cf.trim()) return cf.trim();
      const xff = req.headers["x-forwarded-for"];
      if (typeof xff === "string" && xff.trim()) return xff.split(",")[0].trim();
    }
    return peerAddress(req) || "?";
  };
  /** A phone on the local network, talking to us directly: private, not this computer, not through a proxy or tunnel. */
  const isLanPeer = (req: IncomingMessage): boolean => {
    const ip = peerAddress(req);
    return isPrivateIp(ip) && !isLoopbackIp(ip) && !proxied(req);
  };
  /** One of this computer's own windows, direct (not through the HTTPS proxy or the tunnel). */
  const isDirectLoopback = (req: IncomingMessage): boolean => isLoopbackIp(peerAddress(req)) && !proxied(req);
  const bump = (map: Map<string, { count: number; windowStart: number }>, key: string, limit: number) => {
    const a = map.get(key) ?? { count: 0, windowStart: now() };
    if (now() - a.windowStart > 60000) {
      a.count = 0;
      a.windowStart = now();
    }
    a.count++;
    map.set(key, a);
    return a.count <= limit;
  };
  const pairingOf = (s: Session, token: string): Pairing | undefined => {
    const p = token ? s.byToken.get(token) : undefined;
    return live(s, p) ? p : undefined;
  };

  // ---- HTTP -----------------------------------------------------------------------
  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method === "OPTIONS") return json(res, 204, {});

    if (req.method === "POST" && url.pathname === "/api/session") {
      if (opts.accessPassword && !sameSecret(String(req.headers["x-access-password"] ?? ""), opts.accessPassword)) {
        return json(res, 401, { error: "bad access password" });
      }
      const id = randomUUID();
      const s: Session = {
        id, code: null, codeExpiresAt: 0, createdAt: now(), engineClosedAt: now(), engine: null, engineAlive: false,
        pairings: new Map(), byToken: new Map(), views: new Set(), lastState: null, version: 0,
      };
      sessions.set(id, s);
      const { code, codeExpiresAt } = issueCode(s);
      return json(res, 200, { id, code, codeExpiresAt, codeTtlMs, engineToken: mintEngineToken(secret, id, absoluteTtlMs, now()) });
    }

    if (req.method === "POST" && url.pathname === "/api/session/pair") {
      // Two buckets, each with its own total: the local network and everything else (the tunnel).
      const bucket = isLanPeer(req) || isDirectLoopback(req) ? "lan" : "remote";
      if (!bump(globalAttempts, bucket, pairGlobalLimit)) return json(res, 429, { error: "too many attempts" });
      if (!bump(pairAttempts, `${bucket}:${ipOf(req)}`, pairLimit)) return json(res, 429, { error: "too many attempts" });
      const body = await readBody(req);
      const code = normalizeCode(body.code);
      const s = code.length === CODE_LENGTH ? byCode.get(code) : undefined;
      if (!s || !s.code) {
        if (++wrongCodes >= rotateAfter) rotateCodes();
        return json(res, 404, { error: "unknown code" });
      }
      if (now() > s.codeExpiresAt) {
        consumeCode(s);
        return json(res, 404, { error: "code expired" });
      }
      consumeCode(s); // single use
      const app = Boolean(appPairKey) && typeof body.appKey === "string" && sameSecret(body.appKey, appPairKey) && isDirectLoopback(req);
      const lan = !app && isLanPeer(req);
      const role: Role = app || (autoAcceptLan && lan) ? "controller" : "pending";
      const p: Pairing = {
        id: randomToken(), token: randomToken(), role, device: app ? "Filow window" : cleanDeviceName(body.device) || `device at ${ipOf(req)}`,
        peer: app ? "app" : lan ? "lan" : "remote", approved: app, canAsk: false, pairedAt: now(), expiresAt: now() + viewTtlMs,
      };
      s.pairings.set(p.id, p);
      s.byToken.set(p.token, p);
      toEngine(s, { t: "paired", id: p.id, device: p.device, role: p.role, peer: p.peer });
      sendDevices(s);
      return json(res, 200, { id: s.id, viewToken: p.token, role, expiresAt: p.expiresAt });
    }

    const m = url.pathname.match(/^\/api\/session\/([^/]+)(\/script|\/code|\/engine-token)?$/);
    if (m) {
      const s = sessions.get(m[1]);
      if (!s) return json(res, 404, { error: "unknown session" });
      const auth = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      const isEngine = auth === "" ? false : verifyEngine(auth, s.id);
      const pairing = pairingOf(s, auth);
      if (req.method === "DELETE" && !m[2]) {
        if (!isEngine) return json(res, 401, { error: "engine token required" });
        destroy(s, "ended");
        return json(res, 200, { ok: true });
      }
      // A controller the presenter accepted on the PC (PowerPoint pane in View mode, browser extension)
      // may run the one-shot endpoints that name controllers (script generation, vision) through a
      // short-lived controller token: never an engine token, never /api/buddy/*, never a consent.
      // An auto-accepted phone gets none.
      if (req.method === "POST" && m[2] === "/engine-token") {
        if (isEngine) return json(res, 200, { engineToken: mintEngineToken(secret, s.id, 15 * 60 * 1000, now()), expiresInMs: 15 * 60 * 1000 });
        if (!pairing || pairing.role !== "controller") return json(res, 401, { error: "controller token required" });
        if (!pairing.approved) return json(res, 403, { error: "accept this device on the computer first" });
        return json(res, 200, { engineToken: mintControllerToken(secret, s.id, 15 * 60 * 1000, now()), expiresInMs: 15 * 60 * 1000 });
      }
      if (req.method === "POST" && m[2] === "/code") {
        if (!isEngine) return json(res, 401, { error: "engine token required" });
        return json(res, 200, issueCode(s));
      }
      if (req.method === "POST" && m[2] === "/script") {
        if (!isEngine && pairing?.role !== "controller") return json(res, 401, { error: "controller token required" });
        const { text } = await readBody(req);
        if (typeof text !== "string") return json(res, 400, { error: "text required" });
        if (!s.engine) return json(res, 409, { error: "engine not connected" });
        s.engine.send(JSON.stringify({ t: "cmd", id: `srv-${randomToken()}`, cmd: { type: "loadScript", text }, ...(pairing ? { from: { id: pairing.id, device: pairing.device } } : {}) }));
        return json(res, 200, { ok: true });
      }
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true, sessions: sessions.size });
    }
    json(res, 404, { error: "not found" });
  });

  function verifyEngine(token: string, sessionId: string): boolean {
    const v = verifyEngineToken(secret, token, now());
    return v !== null && v.sessionId === sessionId;
  }

  // ---- WebSocket ------------------------------------------------------------------------
  // A device's messages are small commands (16 KiB at most, refused by the socket before they are read);
  // the engine's full state can be large, so the engine connects with ?role=engine to a socket with a
  // larger limit, where nothing but an engine's hello is accepted.
  const wss = new WebSocketServer({ noServer: true, maxPayload: VIEW_MAX_PAYLOAD });
  const engineWss = new WebSocketServer({ noServer: true, maxPayload: ENGINE_MAX_PAYLOAD });
  httpServer.on("upgrade", (req, socket, head) => {
    const m = (req.url ?? "").match(/^\/ws\/session\/([^/?]+)(\?.*)?$/);
    const s = m && sessions.get(m[1]);
    if (!s) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    const engineOnly = new URLSearchParams((m[2] ?? "").slice(1)).get("role") === "engine";
    (engineOnly ? engineWss : wss).handleUpgrade(req, socket, head, (ws) => attach(ws, s, req, engineOnly));
  });

  const sendPairRequests = (s: Session) => {
    for (const v of s.views) if (v.pairing.role === "pending") toEngine(s, { t: "pairRequest", token: v.pairing.id, id: v.pairing.id, device: v.pairing.device });
  };

  /** Deliver the current state to a view that just became viewer/controller. */
  const admit = (s: Session, v: View) => {
    v.ws.send(JSON.stringify({ t: "role", role: v.pairing.role, canAsk: v.pairing.canAsk }));
    if (s.lastState) v.ws.send(JSON.stringify({ t: "state", version: s.version, state: s.lastState }));
    else v.ws.send(JSON.stringify({ t: "engineOffline" }));
  };

  function attach(ws: WebSocket, s: Session, req: IncomingMessage, engineOnly: boolean) {
    let me: View | null = null;
    let isEngine = false;
    const helloTimer = setTimeout(() => ws.close(4002, "hello timeout"), 5000);
    const ack = (id: string, error: string) => ws.send(JSON.stringify({ t: "ack", id, ok: false, error }));
    // A message over the limit closes the socket (1009); the error that comes with it is not the server's.
    ws.on("error", () => ws.terminate());

    ws.on("message", (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;
      if (msg.t === "pong") {
        if (me) me.alive = true;
        if (isEngine) s.engineAlive = true;
        return;
      }
      if (msg.t === "ping") return ws.send(JSON.stringify({ t: "pong" }));

      if (!me && !isEngine) {
        if (msg.t !== "hello") return ws.close(4002, "hello first");
        clearTimeout(helloTimer);
        const token = String(msg.token ?? "");
        if (msg.role === "engine") {
          if (!verifyEngine(token, s.id)) return ws.close(4002, "bad token");
          if (s.engine && s.engine.readyState === WebSocket.OPEN) return ws.close(4001, "engine already connected");
          isEngine = true;
          s.engine = ws;
          s.engineAlive = true;
          s.engineClosedAt = null;
          ws.send(JSON.stringify({ t: "welcome", role: "engine", version: s.version, code: s.code, codeExpiresAt: s.codeExpiresAt }));
          sendDevices(s);
          sendPairRequests(s);
          return;
        }
        if (engineOnly) return ws.close(4002, "engine socket");
        const pairing = pairingOf(s, token);
        if (!pairing) return ws.close(4002, "bad token");
        // Refreshed on every connection; a pairing nobody connects to runs out.
        pairing.expiresAt = now() + viewTtlMs;
        const said = cleanDeviceName(msg.device);
        if (said && pairing.peer !== "app") pairing.device = said;
        me = { ws, pairing, alive: true };
        s.views.add(me);
        ws.send(JSON.stringify({ t: "welcome", role: pairing.role, version: s.version, canAsk: pairing.canAsk, expiresAt: pairing.expiresAt }));
        sendDevices(s);
        if (pairing.role === "pending") return sendPairRequests(s);
        if (s.lastState) ws.send(JSON.stringify({ t: "state", version: s.version, state: s.lastState }));
        else ws.send(JSON.stringify({ t: "engineOffline" }));
        return;
      }

      if (isEngine) {
        if (msg.t === "state") {
          s.lastState = msg.state;
          s.version = Number(msg.version ?? 0);
          broadcast(s, raw.toString());
        } else if (msg.t === "patch") {
          const version = Number(msg.version);
          if (s.lastState && version <= s.version) return;
          // Fold the patch into the stored state so late joiners get a current snapshot.
          try {
            if (!s.lastState || version !== s.version + 1) throw new Error("missing patch base");
            s.lastState = applyPatch(s.lastState, msg.ops as Operation[], false, false).newDocument;
            (s.lastState as { version: number }).version = version;
            s.version = version;
            broadcast(s, raw.toString());
          } catch {
            ws.send(JSON.stringify({ t: "resync" })); // ask the engine for a full state
          }
        } else if (msg.t === "ack") {
          for (const v of s.views) if (v.pairing.role !== "pending") v.ws.send(raw.toString()); // sender filters by id
        } else if (msg.t === "newCode") {
          ws.send(JSON.stringify({ t: "code", ...issueCode(s) }));
        } else if (msg.t === "setRole" || msg.t === "pairDecision" || msg.t === "revoke" || msg.t === "allowAsk") {
          const id = typeof msg.id === "string" ? msg.id : typeof msg.token === "string" ? msg.token : "";
          const p = id ? s.pairings.get(id) : undefined;
          if (!p) return;
          if (msg.t === "revoke" || msg.role === "reject") {
            dropPairing(s, p, 4003, msg.t === "revoke" ? "revoked by the presenter" : "rejected by the presenter");
            return sendDevices(s);
          }
          if (msg.t === "allowAsk") {
            // Only a controller can ask; the yes is the presenter's, on the PC, for this device only.
            p.canAsk = p.role === "controller" && msg.allow === true;
            for (const v of s.views) if (v.pairing === p) v.ws.send(JSON.stringify({ t: "permissions", canAsk: p.canAsk }));
            return sendDevices(s);
          }
          const role: Role = msg.role === "viewer" ? "viewer" : "controller";
          const wasPending = p.role === "pending";
          p.role = role;
          p.approved = true;
          if (role !== "controller") p.canAsk = false;
          for (const v of s.views) {
            if (v.pairing !== p) continue;
            if (wasPending) admit(s, v);
            else v.ws.send(JSON.stringify({ t: "role", role, canAsk: p.canAsk }));
          }
          sendDevices(s);
        }
        return;
      }

      if (me) {
        const id = String(msg.id ?? "").slice(0, 64);
        if (!live(s, me.pairing)) return ws.close(4004, "pairing expired");
        if (me.pairing.role === "pending") {
          if (msg.t === "cmd") ack(id, "waiting for the presenter");
          return;
        }
        if (msg.t === "cmd") {
          const cmd = msg.cmd as { type?: unknown } | null;
          if (!cmd || typeof cmd !== "object" || typeof cmd.type !== "string") return ack(id, "bad command");
          if (me.pairing.role !== "controller") return ack(id, "viewer role");
          const from = { id: me.pairing.id, device: me.pairing.device };
          let relay: unknown = cmd;
          if (cmd.type === "askOkFilow") {
            // A question for OK Filow: only from a device the presenter allowed to ask, only text, checked here before it moves.
            if (!me.pairing.canAsk) return ack(id, PHONE_ASK.notAllowed);
            const text = phoneAskText(cmd);
            if (text === null) return ack(id, PHONE_ASK.bad);
            relay = { type: "askOkFilow", text };
          }
          if (!s.engine || s.engine.readyState !== WebSocket.OPEN) return ack(id, "engine offline");
          // Rebuilt, never passed through: the engine reads `from` from here only.
          s.engine.send(JSON.stringify({ t: "cmd", id, cmd: relay, from }));
        } else if (msg.t === "resync") {
          if (s.lastState) ws.send(JSON.stringify({ t: "state", version: s.version, state: s.lastState }));
        }
      }
    });

    ws.on("close", () => {
      clearTimeout(helloTimer);
      if (isEngine && s.engine === ws) {
        s.engine = null;
        s.engineClosedAt = now();
        broadcast(s, JSON.stringify({ t: "engineOffline" }));
      }
      if (me) {
        s.views.delete(me);
        // From now on its token runs out unless it connects again.
        if (live(s, me.pairing)) me.pairing.expiresAt = now() + viewTtlMs;
        sendDevices(s);
      }
    });
  }

  function broadcast(s: Session, data: string) {
    for (const v of s.views) if (v.pairing.role !== "pending" && v.ws.readyState === WebSocket.OPEN) v.ws.send(data);
  }

  const pinger = setInterval(() => {
    for (const s of sessions.values()) {
      for (const v of [...s.views]) {
        if (!v.alive) {
          v.ws.terminate();
          s.views.delete(v);
          continue;
        }
        v.alive = false;
        v.ws.send(JSON.stringify({ t: "ping" }));
      }
      if (s.engine) {
        if (!s.engineAlive) s.engine.terminate();
        else {
          s.engineAlive = false;
          s.engine.send(JSON.stringify({ t: "ping" }));
        }
      }
    }
    sweep();
  }, pingMs);

  return {
    httpServer,
    secret,
    address() {
      const a = httpServer.address();
      return typeof a === "object" && a ? { port: a.port, host: a.address } : { port: 0, host: "" };
    },
    close() {
      clearInterval(pinger);
      for (const s of [...sessions.values()]) destroy(s, "server closing");
      for (const c of [...wss.clients, ...engineWss.clients]) c.terminate();
      httpServer.closeAllConnections();
      return new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
    sweep,
  };
}
