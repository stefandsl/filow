// Session relay. Protocol and lifetimes: ARCHITECTURE.md §5.4.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { applyPatch, type Operation } from "fast-json-patch";
import { mintEngineToken, randomToken, verifyEngineToken } from "./auth";

export type Role = "viewer" | "controller";

type View = { ws: WebSocket; token: string; role: Role; alive: boolean };
type Session = {
  id: string;
  code: string;
  createdAt: number;
  engineClosedAt: number | null;
  engine: WebSocket | null;
  engineAlive: boolean;
  viewTokens: Map<string, Role>;
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
  pairLimitPerMinute?: number; // 10
  pingMs?: number; // 15 s
  /** Allowed CORS origins for the HTTP endpoints ("*" by default: the token is the credential). */
  corsOrigin?: string;
};

export type SessionServer = {
  httpServer: Server;
  secret: string;
  address(): { port: number; host: string };
  close(): Promise<void>;
  /** test hook */
  sweep(): void;
};

export function createSessionServer(opts: ServerOptions = {}): SessionServer {
  const now = opts.now ?? (() => Date.now());
  const engineGraceMs = opts.engineGraceMs ?? 2 * 60 * 60 * 1000;
  const absoluteTtlMs = opts.absoluteTtlMs ?? 12 * 60 * 60 * 1000;
  const pairLimit = opts.pairLimitPerMinute ?? 10;
  const pingMs = opts.pingMs ?? 15000;
  const secret = opts.accessPassword || opts.secret || randomToken();
  const cors = opts.corsOrigin ?? "*";

  const sessions = new Map<string, Session>();
  const byCode = new Map<string, Session>();
  const pairAttempts = new Map<string, { count: number; windowStart: number }>();

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
  const newCode = () => {
    for (let i = 0; i < 20; i++) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      if (!byCode.has(code)) return code;
    }
    throw new Error("could not allocate a code");
  };
  const destroy = (s: Session, reason: string) => {
    sessions.delete(s.id);
    byCode.delete(s.code);
    for (const v of s.views) v.ws.close(4003, reason);
    s.engine?.close(4003, reason);
  };
  const sweep = () => {
    const t = now();
    for (const s of [...sessions.values()]) {
      if (t - s.createdAt > absoluteTtlMs) destroy(s, "session expired");
      else if (s.engineClosedAt !== null && t - s.engineClosedAt > engineGraceMs) destroy(s, "engine gone");
    }
    for (const [ip, a] of pairAttempts) if (t - a.windowStart > 60000) pairAttempts.delete(ip);
  };
  const ipOf = (req: IncomingMessage) =>
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0].trim() || req.socket.remoteAddress || "?";

  // ---- HTTP -----------------------------------------------------------------------
  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method === "OPTIONS") return json(res, 204, {});

    if (req.method === "POST" && url.pathname === "/api/session") {
      if (opts.accessPassword && req.headers["x-access-password"] !== opts.accessPassword) {
        return json(res, 401, { error: "bad access password" });
      }
      const id = randomUUID();
      const code = newCode();
      const s: Session = {
        id, code, createdAt: now(), engineClosedAt: now(), engine: null, engineAlive: false,
        viewTokens: new Map(), views: new Set(), lastState: null, version: 0,
      };
      sessions.set(id, s);
      byCode.set(code, s);
      return json(res, 200, { id, code, engineToken: mintEngineToken(secret, id, absoluteTtlMs, now()) });
    }

    if (req.method === "POST" && url.pathname === "/api/session/pair") {
      const ip = ipOf(req);
      const a = pairAttempts.get(ip) ?? { count: 0, windowStart: now() };
      if (now() - a.windowStart > 60000) {
        a.count = 0;
        a.windowStart = now();
      }
      a.count++;
      pairAttempts.set(ip, a);
      if (a.count > pairLimit) return json(res, 429, { error: "too many attempts" });
      const { code } = await readBody(req);
      const s = byCode.get(String(code ?? ""));
      if (!s) return json(res, 404, { error: "unknown code" });
      const viewToken = randomToken();
      s.viewTokens.set(viewToken, "controller");
      return json(res, 200, { id: s.id, viewToken, role: "controller" });
    }

    const m = url.pathname.match(/^\/api\/session\/([^/]+)(\/script)?$/);
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
      if (req.method === "POST" && m[2]) {
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
    wss.handleUpgrade(req, socket, head, (ws) => attach(ws, s));
  });

  function attach(ws: WebSocket, s: Session) {
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
          ws.send(JSON.stringify({ t: "welcome", role: "engine", version: s.version }));
          return;
        }
        const role = s.viewTokens.get(token);
        if (!role) return ws.close(4002, "bad token");
        me = { ws, token, role, alive: true };
        s.views.add(me);
        ws.send(JSON.stringify({ t: "welcome", role, version: s.version }));
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
          for (const v of s.views) v.ws.send(raw.toString()); // sender filters by id
        } else if (msg.t === "setRole") {
          const role = msg.role === "viewer" ? "viewer" : "controller";
          for (const v of s.views) if (v.token === msg.token) v.role = role;
          if (typeof msg.token === "string" && s.viewTokens.has(msg.token)) s.viewTokens.set(msg.token, role);
        }
        return;
      }

      if (me) {
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
      if (me) s.views.delete(me);
    });
  }

  function broadcast(s: Session, data: string) {
    for (const v of s.views) if (v.ws.readyState === WebSocket.OPEN) v.ws.send(data);
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
