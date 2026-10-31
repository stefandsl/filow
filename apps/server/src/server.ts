// Session relay. Protocol and lifetimes: ARCHITECTURE.md §5.4.
//
// Pairing security (the public link only encrypts; the code is the access control):
// - codes come from crypto.randomInt, live `codeTtlMs` (5 min) and are single-use;
//   the engine asks for a fresh one (POST /api/session/:id/code or ws {t:"newCode"});
// - a paired phone starts as "pending": the engine is told {t:"pairRequest"} and answers
//   {t:"pairDecision"} with viewer / controller / reject; until then it gets no state.
//   Peers on the local network can be auto-accepted (autoAcceptLan, desktop LAN mode);
// - client IPs come from the socket unless trustProxy is on (cf-connecting-ip, then
//   x-forwarded-for); pairing is limited per IP and globally.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomInt, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { WebSocketServer, WebSocket } from "ws";
import { applyPatch, type Operation } from "fast-json-patch";
import { mintEngineToken, randomToken, verifyEngineToken } from "./auth";

export type Role = "viewer" | "controller" | "pending";

type View = { ws: WebSocket; token: string; role: Role; alive: boolean };
type Session = {
  id: string;
  code: string | null;
  codeExpiresAt: number;
  createdAt: number;
  engineClosedAt: number | null;
  engine: WebSocket | null;
  engineAlive: boolean;
  viewTokens: Map<string, Role>;
  views: Set<View>;
  /** pair requests waiting for the engine's decision (token -> device label) */
  pendingPairs: Map<string, string>;
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
  pairLimitPerMinute?: number; // 10 per IP
  pairGlobalLimitPerMinute?: number; // 60 across all IPs
  pingMs?: number; // 15 s
  /** Allowed CORS origins for the HTTP endpoints ("*" by default: the token is the credential). */
  corsOrigin?: string;
  /** Honour cf-connecting-ip / x-forwarded-for (only behind our own proxy or tunnel). Default: TRUST_PROXY=1. */
  trustProxy?: boolean;
  /** Auto-accept phones whose socket peer is a private address and that did not come through a proxy. Default: AUTO_ACCEPT_LAN=1. */
  autoAcceptLan?: boolean;
};

export type SessionServer = {
  httpServer: Server;
  secret: string;
  address(): { port: number; host: string };
  close(): Promise<void>;
  /** test hook */
  sweep(): void;
};

/** RFC 1918, link-local, loopback (v4 and v4-mapped v6, ::1). */
export function isPrivateIp(ip: string | undefined): boolean {
  if (!ip) return false;
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (v4 === "::1") return true;
  if (isIP(v4) !== 4) return false;
  return /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(v4);
}

export function createSessionServer(opts: ServerOptions = {}): SessionServer {
  const now = opts.now ?? (() => Date.now());
  const engineGraceMs = opts.engineGraceMs ?? 2 * 60 * 60 * 1000;
  const absoluteTtlMs = opts.absoluteTtlMs ?? 12 * 60 * 60 * 1000;
  const codeTtlMs = opts.codeTtlMs ?? 5 * 60 * 1000;
  const pairLimit = opts.pairLimitPerMinute ?? 10;
  const pairGlobalLimit = opts.pairGlobalLimitPerMinute ?? 60;
  const pingMs = opts.pingMs ?? 15000;
  const secret = opts.accessPassword || opts.secret || randomToken();
  const cors = opts.corsOrigin ?? "*";
  const trustProxy = () => opts.trustProxy ?? process.env.TRUST_PROXY === "1";
  const autoAcceptLan = opts.autoAcceptLan ?? process.env.AUTO_ACCEPT_LAN === "1";

  const sessions = new Map<string, Session>();
  const byCode = new Map<string, Session>();
  const pairAttempts = new Map<string, { count: number; windowStart: number }>();
  const globalAttempts = { count: 0, windowStart: 0 };

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
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          resolve({});
        }
      });
    });
  const allocCode = () => {
    for (let i = 0; i < 20; i++) {
      const code = String(randomInt(100000, 1000000));
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
      else if (s.code && t > s.codeExpiresAt) consumeCode(s);
    }
    for (const [ip, a] of pairAttempts) if (t - a.windowStart > 60000) pairAttempts.delete(ip);
  };
  /** Client address: the socket, unless we sit behind our own proxy / tunnel. */
  const ipOf = (req: IncomingMessage): string => {
    if (trustProxy()) {
      const cf = req.headers["cf-connecting-ip"];
      if (typeof cf === "string" && cf.trim()) return cf.trim();
      const xff = req.headers["x-forwarded-for"];
      if (typeof xff === "string" && xff.trim()) return xff.split(",")[0].trim();
    }
    return req.socket.remoteAddress || "?";
  };
  /** A phone on the local network, talking to us directly (not through a tunnel or proxy). */
  const isLocalPeer = (req: IncomingMessage): boolean =>
    isPrivateIp(req.socket.remoteAddress) && !req.headers["cf-connecting-ip"] && !req.headers["x-forwarded-for"];
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

  // ---- HTTP -----------------------------------------------------------------------
  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method === "OPTIONS") return json(res, 204, {});

    if (req.method === "POST" && url.pathname === "/api/session") {
      if (opts.accessPassword && req.headers["x-access-password"] !== opts.accessPassword) {
        return json(res, 401, { error: "bad access password" });
      }
      const id = randomUUID();
      const s: Session = {
        id, code: null, codeExpiresAt: 0, createdAt: now(), engineClosedAt: now(), engine: null, engineAlive: false,
        viewTokens: new Map(), views: new Set(), pendingPairs: new Map(), lastState: null, version: 0,
      };
      sessions.set(id, s);
      const { code, codeExpiresAt } = issueCode(s);
      return json(res, 200, { id, code, codeExpiresAt, codeTtlMs, engineToken: mintEngineToken(secret, id, absoluteTtlMs, now()) });
    }

    if (req.method === "POST" && url.pathname === "/api/session/pair") {
      // Global cap first: header games or many addresses must not add up to a brute force.
      if (now() - globalAttempts.windowStart > 60000) {
        globalAttempts.count = 0;
        globalAttempts.windowStart = now();
      }
      if (++globalAttempts.count > pairGlobalLimit) return json(res, 429, { error: "too many attempts" });
      if (!bump(pairAttempts, ipOf(req), pairLimit)) return json(res, 429, { error: "too many attempts" });
      const { code } = await readBody(req);
      const s = byCode.get(String(code ?? ""));
      if (!s || !s.code) return json(res, 404, { error: "unknown code" });
      if (now() > s.codeExpiresAt) {
        consumeCode(s);
        return json(res, 404, { error: "code expired" });
      }
      consumeCode(s); // single use
      const viewToken = randomToken();
      const role: Role = autoAcceptLan && isLocalPeer(req) ? "controller" : "pending";
      s.viewTokens.set(viewToken, role);
      return json(res, 200, { id: s.id, viewToken, role });
    }

    const m = url.pathname.match(/^\/api\/session\/([^/]+)(\/script|\/code|\/engine-token)?$/);
    if (m) {
      const s = sessions.get(m[1]);
      if (!s) return json(res, 404, { error: "unknown session" });
      const auth = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      const isEngine = auth === "" ? false : verifyEngine(auth, s.id);
      const role = s.viewTokens.get(auth);
      if (req.method === "DELETE" && !m[2]) {
        if (!isEngine) return json(res, 401, { error: "engine token required" });
        destroy(s, "ended");
        return json(res, 200, { ok: true });
      }
      // An accepted controller (PowerPoint pane in View mode, browser extension) may run the
      // one-shot spend endpoints (script generation, vision) through a short-lived engine token.
      if (req.method === "POST" && m[2] === "/engine-token") {
        if (!isEngine && role !== "controller") return json(res, 401, { error: "controller token required" });
        return json(res, 200, { engineToken: mintEngineToken(secret, s.id, 15 * 60 * 1000, now()), expiresInMs: 15 * 60 * 1000 });
      }
      if (req.method === "POST" && m[2] === "/code") {
        if (!isEngine) return json(res, 401, { error: "engine token required" });
        return json(res, 200, issueCode(s));
      }
      if (req.method === "POST" && m[2] === "/script") {
        if (!isEngine && role !== "controller") return json(res, 401, { error: "controller token required" });
        const { text } = await readBody(req);
        if (typeof text !== "string") return json(res, 400, { error: "text required" });
        if (!s.engine) return json(res, 409, { error: "engine not connected" });
        s.engine.send(JSON.stringify({ t: "cmd", id: `srv-${randomToken()}`, cmd: { type: "loadScript", text } }));
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
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on("upgrade", (req, socket, head) => {
    const m = (req.url ?? "").match(/^\/ws\/session\/([^/?]+)/);
    const s = m && sessions.get(m[1]);
    if (!s) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => attach(ws, s, req));
  });

  const sendPairRequests = (s: Session) => {
    if (!s.engine || s.engine.readyState !== WebSocket.OPEN) return;
    for (const [token, device] of s.pendingPairs) s.engine.send(JSON.stringify({ t: "pairRequest", token, device }));
  };

  /** Deliver the current state to a view that just became viewer/controller. */
  const admit = (s: Session, v: View) => {
    v.ws.send(JSON.stringify({ t: "role", role: v.role }));
    if (s.lastState) v.ws.send(JSON.stringify({ t: "state", version: s.version, state: s.lastState }));
    else v.ws.send(JSON.stringify({ t: "engineOffline" }));
  };

  function attach(ws: WebSocket, s: Session, req: IncomingMessage) {
    let me: View | null = null;
    let isEngine = false;
    const helloTimer = setTimeout(() => ws.close(4002, "hello timeout"), 5000);

    ws.on("message", (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
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
          sendPairRequests(s);
          return;
        }
        const role = s.viewTokens.get(token);
        if (!role) return ws.close(4002, "bad token");
        me = { ws, token, role, alive: true };
        s.views.add(me);
        ws.send(JSON.stringify({ t: "welcome", role, version: s.version }));
        if (role === "pending") {
          const device = String(msg.device ?? "").slice(0, 80) || `phone at ${ipOf(req)}`;
          s.pendingPairs.set(token, device);
          sendPairRequests(s);
          return;
        }
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
          // Fold the patch into the stored state so late joiners get a current snapshot.
          try {
            if (!s.lastState) throw new Error("no base state");
            s.lastState = applyPatch(s.lastState, msg.ops as Operation[], false, false).newDocument;
            (s.lastState as { version: number }).version = Number(msg.version);
            s.version = Number(msg.version ?? s.version + 1);
            broadcast(s, raw.toString());
          } catch {
            ws.send(JSON.stringify({ t: "resync" })); // ask the engine for a full state
          }
        } else if (msg.t === "ack") {
          for (const v of s.views) if (v.role !== "pending") v.ws.send(raw.toString()); // sender filters by id
        } else if (msg.t === "newCode") {
          ws.send(JSON.stringify({ t: "code", ...issueCode(s) }));
        } else if (msg.t === "setRole" || msg.t === "pairDecision") {
          const token = typeof msg.token === "string" ? msg.token : "";
          if (!token) return;
          if (msg.role === "reject") {
            s.viewTokens.delete(token);
            s.pendingPairs.delete(token);
            for (const v of [...s.views]) if (v.token === token) v.ws.close(4003, "rejected by the presenter");
            return;
          }
          const role: Role = msg.role === "viewer" ? "viewer" : "controller";
          if (!s.viewTokens.has(token)) return;
          s.viewTokens.set(token, role);
          const wasPending = s.pendingPairs.delete(token);
          for (const v of s.views) {
            if (v.token !== token) continue;
            const admitNow = v.role === "pending";
            v.role = role;
            if (admitNow || wasPending) admit(s, v);
            else v.ws.send(JSON.stringify({ t: "role", role }));
          }
        }
        return;
      }

      if (me) {
        if (me.role === "pending") {
          if (msg.t === "cmd") ws.send(JSON.stringify({ t: "ack", id: msg.id, ok: false, error: "waiting for the presenter" }));
          return;
        }
        if (msg.t === "cmd") {
          if (me.role !== "controller") return ws.send(JSON.stringify({ t: "ack", id: msg.id, ok: false, error: "viewer role" }));
          if (!s.engine || s.engine.readyState !== WebSocket.OPEN)
            return ws.send(JSON.stringify({ t: "ack", id: msg.id, ok: false, error: "engine offline" }));
          s.engine.send(raw.toString());
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
        if (me.role === "pending") s.pendingPairs.delete(me.token);
      }
    });
  }

  function broadcast(s: Session, data: string) {
    for (const v of s.views) if (v.role !== "pending" && v.ws.readyState === WebSocket.OPEN) v.ws.send(data);
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
      for (const c of wss.clients) c.terminate();
      httpServer.closeAllConnections();
      return new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
    sweep,
  };
}
