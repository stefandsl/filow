// Session relay. Protocol and lifetimes: ARCHITECTURE.md §5.4.
//
// Pairing security (the public link only encrypts; the code is the access control):
// - codes are 8 characters from a 31-letter alphabet (about 40 bits), come from crypto.randomInt,
//   live `codeTtlMs` (5 min) and are single-use; the engine asks for a fresh one (POST
//   /api/session/:id/code or ws {t:"newCode"}). Wrong codes burn nothing: at the two buckets' 120
//   tries a minute a live code is guessed about once in 10 000 years, while burning codes on wrong
//   tries let anyone who can reach the relay stop the presenter from pairing;
// - pairing attempts are limited per address and in total, in two separate buckets: the local network
//   and everything else (the tunnel), so one cannot lock the other out. A pair request from a web page
//   is taken only from the app's own pages (pairOriginAllowed), so a page of another site open in the
//   presenter's browser cannot spend the local bucket;
// - the engine is told about every pairing ({t:"paired"} and the {t:"devices"} list), can revoke any
//   of them ({t:"revoke"}) and gives each controller, separately, the right to ask OK Filow
//   ({t:"allowAsk"}): off by default, never automatic;
// - a paired phone starts as "pending": the engine is told {t:"pairRequest"} and answers
//   {t:"pairDecision"} with viewer / controller / reject; until then it gets no state. Peers on the
//   local network (the subnet of this computer's LAN address, lanCidr) can be auto-accepted as
//   controllers (autoAcceptLan, desktop LAN mode); loopback and anything that came through a proxy or
//   tunnel never are. Auto-accepted is not approved: such a phone may only move between sections and
//   mark points (REMOTE_BEFORE_APPROVAL) until the presenter accepts it on the PC. The app's own
//   floating windows prove themselves with the per-launch app key instead (appPairKey);
// - a device's name is fixed when it pairs (never the app's own labels) and every command it sends is
//   rate limited;
// - a device's token expires `viewTokenTtlMs` after it was last connected (refreshed on every
//   connection and while connected), and with its pairing when revoked;
// - client IPs come from the socket; cf-connecting-ip / x-forwarded-for only when trustProxy is on AND
//   the socket is this computer (the tunnel and the HTTPS proxy), never from a peer on the network;
// - the engine's socket (large messages) is opened only with a valid engine token in its URL, and a
//   device's socket says hello within 5 s, with at most UNAUTHENTICATED_PER_ADDRESS waiting per address;
// - an engine's ack goes back only to the device that sent the command.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import { WebSocketServer, WebSocket } from "ws";
import { applyPatch, type Operation } from "fast-json-patch";
import { CONTROLLER_TOKEN_TTL_MS, mintControllerToken, mintEngineToken, randomToken, verifyEngineToken } from "./auth";
import { cleanDeviceName, isAppLabel, PHONE_ASK, phoneAskText, REMOTE } from "./phone-ask";

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
  /** The device gave its own name (at pairing or in its first hello): it is fixed from then on. */
  named: boolean;
  peer: Peer;
  /** The presenter decided on the PC (pairDecision, setRole); false for an auto-accepted phone. */
  approved: boolean;
  /** May ask OK Filow: given on the PC only, off by default. */
  canAsk: boolean;
  pairedAt: number;
  expiresAt: number;
};
type View = { ws: WebSocket; pairing: Pairing; alive: boolean; ip: string };
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
  /** Commands relayed to the engine and not acknowledged yet: the relay's id -> the device and its own id. */
  acks: Map<string, { view: View; id: string }>;
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
  /** Commands one device may send in `commandWindowMs` (40 in 10 s: a clicker held down, never a flood). */
  commandLimit?: number;
  commandWindowMs?: number;
  pingMs?: number; // 15 s
  /** Allowed CORS origins for the HTTP endpoints ("*" by default: the token is the credential). */
  corsOrigin?: string;
  /** Honour cf-connecting-ip / x-forwarded-for (only behind our own proxy or tunnel). Default: TRUST_PROXY=1. */
  trustProxy?: boolean;
  /** Auto-accept phones on the local network that talk to us directly (never loopback, never proxied). Default: AUTO_ACCEPT_LAN=1. */
  autoAcceptLan?: boolean;
  /** The per-launch key the desktop app gives its own floating windows (FILOW_APP_PAIR_KEY); only from loopback, never proxied. */
  appPairKey?: string;
  /**
   * This computer's address on the local network with its prefix ("192.168.1.10/24"), or null when there
   * is none: only peers in that subnet count as the local network (never a VM, WSL or Docker network).
   * Default: FILOW_LAN_IP (set by the desktop app) and its interface's netmask.
   */
  lanCidr?: () => string | null;
  /**
   * Whether a pair request sent by a web page with this Origin is taken. Default: this computer's own
   * pages (loopback, its own addresses, the current public link FILOW_PUBLIC_WEB), browser extensions,
   * and corsOrigin when it names one. A request without an Origin (not from a web page) is always taken.
   */
  pairOriginAllowed?: (origin: string) => boolean;
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
const v4Number = (ip: string): number | null => {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIP(v4) !== 4) return null;
  return v4.split(".").reduce((n, part) => n * 256 + Number(part), 0);
};
/** Whether an IPv4 address lies in a CIDR ("192.168.1.10/24"); false for anything else. */
export function inCidr(ip: string | undefined, cidr: string | null | undefined): boolean {
  if (!ip || !cidr) return false;
  const [base, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  const a = v4Number(ip);
  const b = v4Number(base ?? "");
  if (a === null || b === null || !Number.isInteger(bits) || bits < 8 || bits > 32) return false;
  const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
  return ((a & mask) >>> 0) === ((b & mask) >>> 0);
}
/** The desktop app's LAN address (FILOW_LAN_IP) with its interface's prefix, or null. */
export function lanCidrFromEnv(): string | null {
  const ip = process.env.FILOW_LAN_IP;
  if (!ip) return null;
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) if (i.family === "IPv4" && i.address === ip && i.cidr) return i.cidr;
  }
  return null;
}
/** This computer's own addresses (every interface): a page served from one of them is the app's own. */
const ownAddresses = (): Set<string> => {
  const out = new Set<string>();
  for (const list of Object.values(networkInterfaces())) for (const i of list ?? []) out.add(i.address);
  return out;
};
/**
 * The default for pairOriginAllowed: a page of this app (loopback, one of this computer's addresses,
 * the public link it runs now), a browser extension (the Filow extension pairs from its side panel), or
 * the one origin the operator configured.
 */
export function defaultPairOriginAllowed(origin: string, configured: string): boolean {
  if (configured !== "*" && origin === configured) return true;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.protocol === "chrome-extension:" || u.protocol === "moz-extension:" || u.protocol === "safari-web-extension:") return true;
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || isLoopbackIp(host)) return true;
  if (ownAddresses().has(host)) return true;
  const pub = process.env.FILOW_PUBLIC_WEB;
  if (pub) {
    try {
      if (new URL(pub).origin === u.origin) return true;
    } catch {
      /* not a URL */
    }
  }
  return false;
}
/**
 * What a controller the presenter has not accepted on the PC (auto-accepted on the Wi-Fi) may do: move
 * between sections and points, and mark points. Everything else (start or stop the take and with it the
 * microphone, Look now, a new script, a reset) waits for the presenter's accept.
 */
export const REMOTE_BEFORE_APPROVAL: ReadonlySet<string> = new Set(["nextSection", "prevSection", "goToSection", "anchor", "markStarted", "markMissed", "reopen"]);
/** Sockets that have not said hello yet, per address: more are refused at the upgrade. */
export const UNAUTHENTICATED_PER_ADDRESS = 8;
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
  const commandLimit = opts.commandLimit ?? 40;
  const commandWindowMs = opts.commandWindowMs ?? 10_000;
  const pingMs = opts.pingMs ?? 15000;
  const secret = opts.accessPassword || opts.secret || randomToken();
  const cors = opts.corsOrigin ?? "*";
  const trustProxy = () => opts.trustProxy ?? process.env.TRUST_PROXY === "1";
  const autoAcceptLan = opts.autoAcceptLan ?? process.env.AUTO_ACCEPT_LAN === "1";
  const appPairKey = opts.appPairKey ?? process.env.FILOW_APP_PAIR_KEY ?? "";
  const peerAddress = (req: IncomingMessage) => (opts.remoteAddress ? opts.remoteAddress(req) : req.socket.remoteAddress);
  const lanCidr = opts.lanCidr ?? lanCidrFromEnv;
  const pairOriginAllowed = opts.pairOriginAllowed ?? ((origin: string) => defaultPairOriginAllowed(origin, cors));

  const sessions = new Map<string, Session>();
  const byCode = new Map<string, Session>();
  const pairAttempts = new Map<string, { count: number; windowStart: number }>();
  const globalAttempts = new Map<string, { count: number; windowStart: number }>();
  const commandAttempts = new Map<string, { count: number; windowStart: number }>();
  /** Sockets per address that have not said hello yet. */
  const unauthenticated = new Map<string, number>();

  // ---- helpers ---------------------------------------------------------------
  const json = (res: ServerResponse, status: number, body: unknown, origin = cors) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origin,
      ...(origin !== "*" ? { Vary: "Origin" } : {}),
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
    commandAttempts.delete(p.id);
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
    for (const map of [pairAttempts, globalAttempts, commandAttempts]) for (const [k, a] of map) if (t - a.windowStart > 60000) map.delete(k);
  };
  /**
   * Client address: the socket's. The forwarding headers only when we sit behind our own proxy or
   * tunnel (trustProxy) and the socket is this computer, where both of them run: a peer on the network
   * that sends cf-connecting-ip or x-forwarded-for itself is known by its socket.
   */
  const ipOf = (req: IncomingMessage): string => {
    if (trustProxy() && isLoopbackIp(peerAddress(req))) {
      const cf = req.headers["cf-connecting-ip"];
      if (typeof cf === "string" && cf.trim()) return cf.trim();
      const xff = req.headers["x-forwarded-for"];
      if (typeof xff === "string" && xff.trim()) return xff.split(",")[0].trim();
    }
    return peerAddress(req) || "?";
  };
  /**
   * A phone on the local network, talking to us directly: in the subnet of this computer's LAN address
   * (not a VM, WSL or Docker network that is private too), not this computer, not through a proxy or tunnel.
   */
  const isLanPeer = (req: IncomingMessage): boolean => {
    const ip = peerAddress(req);
    return isPrivateIp(ip) && !isLoopbackIp(ip) && !proxied(req) && inCidr(ip, lanCidr());
  };
  /** One of this computer's own windows, direct (not through the HTTPS proxy or the tunnel). */
  const isDirectLoopback = (req: IncomingMessage): boolean => isLoopbackIp(peerAddress(req)) && !proxied(req);
  const bump = (map: Map<string, { count: number; windowStart: number }>, key: string, limit: number, windowMs = 60000) => {
    const a = map.get(key) ?? { count: 0, windowStart: now() };
    if (now() - a.windowStart > windowMs) {
      a.count = 0;
      a.windowStart = now();
    }
    a.count++;
    map.set(key, a);
    return a.count <= limit;
  };
  /** A device's own name, cleaned; "" when it gave none or took one of the app's own labels. */
  const deviceName = (raw: unknown): string => {
    const n = cleanDeviceName(raw);
    return n && !isAppLabel(n) ? n : "";
  };
  const pairingOf = (s: Session, token: string): Pairing | undefined => {
    const p = token ? s.byToken.get(token) : undefined;
    return live(s, p) ? p : undefined;
  };

  // ---- HTTP -----------------------------------------------------------------------
  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method === "OPTIONS" && url.pathname !== "/api/session/pair") return json(res, 204, {});

    if (req.method === "POST" && url.pathname === "/api/session") {
      if (opts.accessPassword && !sameSecret(String(req.headers["x-access-password"] ?? ""), opts.accessPassword)) {
        return json(res, 401, { error: "bad access password" });
      }
      const id = randomUUID();
      const s: Session = {
        id, code: null, codeExpiresAt: 0, createdAt: now(), engineClosedAt: now(), engine: null, engineAlive: false,
        pairings: new Map(), byToken: new Map(), views: new Set(), lastState: null, version: 0, acks: new Map(),
      };
      sessions.set(id, s);
      const { code, codeExpiresAt } = issueCode(s);
      return json(res, 200, { id, code, codeExpiresAt, codeTtlMs, engineToken: mintEngineToken(secret, id, absoluteTtlMs, now()) });
    }

    if (url.pathname === "/api/session/pair") {
      // A web page may pair only from the app's own origins: a page of another site in the presenter's
      // browser reaches 127.0.0.1 too, and would spend the local bucket (a browser always sends Origin on a POST).
      const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
      if (origin && !pairOriginAllowed(origin)) return json(res, 403, { error: "not from this app" }, "null");
      const allow = origin || cors;
      if (req.method === "OPTIONS") return json(res, 204, {}, allow);
      if (req.method !== "POST") return json(res, 404, { error: "not found" }, allow);
      // Two buckets, each with its own total: the local network and everything else (the tunnel).
      const bucket = isLanPeer(req) || isDirectLoopback(req) ? "lan" : "remote";
      if (!bump(globalAttempts, bucket, pairGlobalLimit)) return json(res, 429, { error: "too many attempts" }, allow);
      if (!bump(pairAttempts, `${bucket}:${ipOf(req)}`, pairLimit)) return json(res, 429, { error: "too many attempts" }, allow);
      const body = await readBody(req);
      const code = normalizeCode(body.code);
      const s = code.length === CODE_LENGTH ? byCode.get(code) : undefined;
      if (!s || !s.code) return json(res, 404, { error: "unknown code" }, allow);
      if (now() > s.codeExpiresAt) {
        consumeCode(s);
        return json(res, 404, { error: "code expired" }, allow);
      }
      consumeCode(s); // single use
      const app = Boolean(appPairKey) && typeof body.appKey === "string" && sameSecret(body.appKey, appPairKey) && isDirectLoopback(req);
      const lan = !app && isLanPeer(req);
      const role: Role = app || (autoAcceptLan && lan) ? "controller" : "pending";
      // The name is the device's own, fixed from now on; never one of the app's own labels.
      const said = app ? "" : deviceName(body.device);
      const p: Pairing = {
        id: randomToken(), token: randomToken(), role, device: app ? "Filow window" : said || `device at ${ipOf(req)}`, named: app || Boolean(said),
        peer: app ? "app" : lan ? "lan" : "remote", approved: app, canAsk: false, pairedAt: now(), expiresAt: now() + viewTtlMs,
      };
      s.pairings.set(p.id, p);
      s.byToken.set(p.token, p);
      toEngine(s, { t: "paired", id: p.id, device: p.device, role: p.role, peer: p.peer });
      sendDevices(s);
      return json(res, 200, { id: s.id, viewToken: p.token, role, expiresAt: p.expiresAt }, allow);
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
        // Short-lived: the web app checks it without asking us, so a revoked device keeps it at most this long.
        return json(res, 200, { engineToken: mintControllerToken(secret, s.id, CONTROLLER_TOKEN_TTL_MS, now()), expiresInMs: CONTROLLER_TOKEN_TTL_MS });
      }
      if (req.method === "POST" && m[2] === "/code") {
        if (!isEngine) return json(res, 401, { error: "engine token required" });
        return json(res, 200, issueCode(s));
      }
      if (req.method === "POST" && m[2] === "/script") {
        // A new script only from the engine or a controller the presenter accepted on the PC, never as a flood.
        if (!isEngine && pairing?.role !== "controller") return json(res, 401, { error: "controller token required" });
        if (!isEngine && !pairing!.approved) return json(res, 403, { error: REMOTE.approveFirst });
        if (!isEngine && !bump(commandAttempts, pairing!.id, commandLimit, commandWindowMs)) return json(res, 429, { error: REMOTE.tooMany });
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
    const query = new URLSearchParams((m[2] ?? "").slice(1));
    const engineOnly = query.get("role") === "engine";
    // The large-message socket only for the engine, proven before a byte of a message is read.
    if (engineOnly && !verifyEngine(query.get("token") ?? "", s.id)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    // A socket that has not said hello yet costs memory and a timer: only a few per address at once.
    const ip = ipOf(req);
    const waiting = unauthenticated.get(ip) ?? 0;
    if (!engineOnly && waiting >= UNAUTHENTICATED_PER_ADDRESS) {
      socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
      socket.destroy();
      return;
    }
    (engineOnly ? engineWss : wss).handleUpgrade(req, socket, head, (ws) => attach(ws, s, req, engineOnly, ip));
  });
  /** One fewer socket waiting for its hello at this address. */
  const helloDone = (ip: string) => {
    const n = (unauthenticated.get(ip) ?? 1) - 1;
    if (n > 0) unauthenticated.set(ip, n);
    else unauthenticated.delete(ip);
  };

  const sendPairRequests = (s: Session) => {
    for (const v of s.views) if (v.pairing.role === "pending") toEngine(s, { t: "pairRequest", token: v.pairing.id, id: v.pairing.id, device: v.pairing.device });
  };

  /** Deliver the current state to a view that just became viewer/controller. */
  const admit = (s: Session, v: View) => {
    v.ws.send(JSON.stringify({ t: "role", role: v.pairing.role, canAsk: v.pairing.canAsk, approved: v.pairing.approved }));
    if (s.lastState) v.ws.send(JSON.stringify({ t: "state", version: s.version, state: s.lastState }));
    else v.ws.send(JSON.stringify({ t: "engineOffline" }));
  };

  function attach(ws: WebSocket, s: Session, req: IncomingMessage, engineOnly: boolean, ip: string) {
    let me: View | null = null;
    let isEngine = false;
    // Counted until its hello is taken or it closes (the engine's socket was proven at the upgrade).
    let waitingHello = !engineOnly;
    if (waitingHello) unauthenticated.set(ip, (unauthenticated.get(ip) ?? 0) + 1);
    const heard = () => {
      if (waitingHello) helloDone(ip);
      waitingHello = false;
    };
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
          heard();
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
        heard();
        // Refreshed on every connection; a pairing nobody connects to runs out.
        pairing.expiresAt = now() + viewTtlMs;
        // A device that paired without a name may give one in its first hello, before the presenter
        // decided anything; from then on the name is fixed (the presenter's yes was for that name).
        const said = deviceName(msg.device);
        if (said && !pairing.named && !pairing.approved && !pairing.canAsk) {
          pairing.device = said;
          pairing.named = true;
        }
        me = { ws, pairing, alive: true, ip };
        s.views.add(me);
        ws.send(JSON.stringify({ t: "welcome", role: pairing.role, version: s.version, canAsk: pairing.canAsk, approved: pairing.approved, expiresAt: pairing.expiresAt }));
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
          // Only to the device that sent the command, under its own id.
          const to = typeof msg.id === "string" ? s.acks.get(msg.id) : undefined;
          if (!to) return;
          s.acks.delete(msg.id as string);
          if (s.views.has(to.view) && to.view.ws.readyState === WebSocket.OPEN) {
            to.view.ws.send(JSON.stringify({ t: "ack", id: to.id, ok: msg.ok === true, ...(typeof msg.error === "string" ? { error: msg.error.slice(0, 200) } : {}) }));
          }
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
            else v.ws.send(JSON.stringify({ t: "role", role, canAsk: p.canAsk, approved: p.approved }));
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
          if (!bump(commandAttempts, me.pairing.id, commandLimit, commandWindowMs)) return ack(id, REMOTE.tooMany);
          // Auto-accepted on the Wi-Fi, not accepted on the PC: moving and marking only. (Asking has its own
          // right, given on the PC for this device, checked below.)
          if (!me.pairing.approved && !REMOTE_BEFORE_APPROVAL.has(cmd.type) && cmd.type !== "askOkFilow") return ack(id, REMOTE.approveFirst);
          const from = { id: me.pairing.id, device: me.pairing.device, peer: me.pairing.peer };
          let relay: unknown = cmd;
          if (cmd.type === "askOkFilow") {
            // A question for OK Filow: only from a device the presenter allowed to ask, only text, checked here before it moves.
            if (!me.pairing.canAsk) return ack(id, PHONE_ASK.notAllowed);
            const text = phoneAskText(cmd);
            if (text === null) return ack(id, PHONE_ASK.bad);
            relay = { type: "askOkFilow", text };
          }
          if (!s.engine || s.engine.readyState !== WebSocket.OPEN) return ack(id, "engine offline");
          // Rebuilt, never passed through: the engine reads `from` from here only. The engine sees the
          // relay's own id, so its ack can go back to this device only (never to another with the same id).
          const relayId = randomToken();
          if (s.acks.size >= 1000) s.acks.delete(s.acks.keys().next().value!);
          s.acks.set(relayId, { view: me, id });
          s.engine.send(JSON.stringify({ t: "cmd", id: relayId, cmd: relay, from }));
        } else if (msg.t === "resync") {
          if (s.lastState) ws.send(JSON.stringify({ t: "state", version: s.version, state: s.lastState }));
        }
      }
    });

    ws.on("close", () => {
      clearTimeout(helloTimer);
      heard();
      if (isEngine && s.engine === ws) {
        s.engine = null;
        s.engineClosedAt = now();
        broadcast(s, JSON.stringify({ t: "engineOffline" }));
      }
      if (me) {
        s.views.delete(me);
        for (const [k, a] of s.acks) if (a.view === me) s.acks.delete(k);
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
