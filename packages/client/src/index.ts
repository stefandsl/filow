// Session client. Protocol: ARCHITECTURE.md §5.4.
import { applyPatch, type Operation } from "fast-json-patch";
import type { Command, SessionState } from "@filow/core";

export type ClientStatus = "connecting" | "open" | "closed";
export type Role = "viewer" | "controller" | "engine" | "pending";

export type PairRequest = { token: string; device: string };
export type PairDecision = "viewer" | "controller" | "reject";

export type ConnectOptions = {
  /** Session server origin, e.g. "http://192.168.1.10:4748" or "https://prompter.example.com" */
  serverUrl: string;
  /** Pair with a 6-digit code (views) ... */
  code?: string;
  /** ... or connect with an existing token (engine, or a view that already paired). */
  session?: { id: string; token: string; role: Role };
  /** Shown to the presenter when they must accept this device (views). Defaults to the user agent. */
  deviceLabel?: string;
  /** Called with the full state after every change. */
  onState?: (state: SessionState) => void;
  onStatus?: (status: ClientStatus, detail?: string) => void;
  /** Views: the presenter accepted (viewer/controller) or changed the role. */
  onRole?: (role: Role) => void;
  /** Engine: a phone paired and waits for a decision. */
  onPairRequest?: (req: PairRequest) => void;
  /** Reconnect with backoff (default true). */
  reconnect?: boolean;
  fetchImpl?: typeof fetch;
  WebSocketImpl?: typeof WebSocket;
};

export type SessionClient = {
  readonly id: string;
  role: Role;
  readonly token: string;
  status: ClientStatus;
  state: SessionState | null;
  subscribe(fn: (state: SessionState) => void): () => void;
  /** Views: send a command. Resolves with the engine's ack. */
  send(cmd: Command): Promise<{ ok: boolean; error?: string }>;
  /** Engine: publish a full state. */
  publishState(state: SessionState): void;
  /** Engine: publish a patch. */
  publishPatch(version: number, ops: Operation[]): void;
  /** Engine: handle incoming commands. */
  onCommand(fn: (cmd: Command, ack: (result: { ok: boolean; error?: string }) => void) => void): void;
  /** Engine: send a full state after reconnect or when the server cannot apply a patch. */
  onResync(fn: () => void): void;
  /** Engine: accept (as viewer or controller) or reject a paired phone. */
  decidePair(token: string, decision: PairDecision): void;
  /** Engine: ask for a fresh single-use pairing code. */
  requestCode(): Promise<{ code: string; codeExpiresAt: number }>;
  close(): void;
};

export async function pair(serverUrl: string, code: string, fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl(`${serverUrl.replace(/\/$/, "")}/api/session/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (res.status === 404) {
    const { error } = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(error === "code expired" ? "code expired, ask for a new one" : "unknown code");
  }
  if (res.status === 429) throw new Error("too many attempts, wait a minute");
  if (!res.ok) throw new Error(`pair failed (${res.status})`);
  return (await res.json()) as { id: string; viewToken: string; role: "controller" | "viewer" | "pending" };
}

function defaultDeviceLabel(): string {
  if (typeof navigator === "undefined") return "device";
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "Mac" : "device";
  const browser = /CriOS|Chrome/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : /Firefox/.test(ua) ? "Firefox" : "";
  return `${os}${browser ? " · " + browser : ""}`;
}

export async function connect(opts: ConnectOptions): Promise<SessionClient> {
  const WS = opts.WebSocketImpl ?? WebSocket;
  const f = opts.fetchImpl ?? fetch;
  const base = opts.serverUrl.replace(/\/$/, "");

  let session = opts.session;
  if (!session) {
    if (!opts.code) throw new Error("code or session required");
    const p = await pair(base, opts.code, f);
    session = { id: p.id, token: p.viewToken, role: p.role };
  }
  const wsUrl = base.replace(/^http/, "ws") + `/ws/session/${session.id}`;

  const subs = new Set<(s: SessionState) => void>();
  const pending = new Map<string, (r: { ok: boolean; error?: string }) => void>();
  const codeWaiters: Array<(c: { code: string; codeExpiresAt: number }) => void> = [];
  let commandHandler: ((cmd: Command, ack: (r: { ok: boolean; error?: string }) => void) => void) | null = null;
  let resyncHandler: (() => void) | null = null;
  let ws: WebSocket | null = null;
  let closedByUser = false;
  let everWelcomed = false;
  let backoff = 500;
  let seq = 0;

  const client: SessionClient = {
    id: session.id,
    role: session.role,
    token: session.token,
    status: "connecting",
    state: null,
    subscribe(fn) {
      subs.add(fn);
      if (client.state) fn(client.state);
      return () => subs.delete(fn);
    },
    send(cmd) {
      return new Promise((resolve) => {
        if (!ws || ws.readyState !== 1) return resolve({ ok: false, error: "not connected" });
        const id = String(++seq);
        pending.set(id, resolve);
        ws.send(JSON.stringify({ t: "cmd", id, cmd }));
        setTimeout(() => {
          if (pending.delete(id)) resolve({ ok: false, error: "no ack" });
        }, 5000);
      });
    },
    publishState(state) {
      if (ws?.readyState === 1) ws.send(JSON.stringify({ t: "state", version: state.version, state }));
    },
    publishPatch(version, ops) {
      if (ws?.readyState === 1) ws.send(JSON.stringify({ t: "patch", version, ops }));
    },
    onCommand(fn) {
      commandHandler = fn;
    },
    onResync(fn) {
      resyncHandler = fn;
    },
    decidePair(token, decision) {
      if (ws?.readyState === 1) ws.send(JSON.stringify({ t: "pairDecision", token, role: decision }));
    },
    requestCode() {
      return new Promise((resolve, reject) => {
        if (!ws || ws.readyState !== 1) return reject(new Error("not connected"));
        codeWaiters.push(resolve);
        ws.send(JSON.stringify({ t: "newCode" }));
        setTimeout(() => {
          const i = codeWaiters.indexOf(resolve);
          if (i >= 0) {
            codeWaiters.splice(i, 1);
            reject(new Error("no code from server"));
          }
        }, 5000);
      });
    },
    close() {
      closedByUser = true;
      ws?.close(1000, "client closed");
      setStatus("closed");
    },
  };

  const setStatus = (s: ClientStatus, detail?: string) => {
    client.status = s;
    opts.onStatus?.(s, detail);
  };
  const emit = (s: SessionState) => {
    client.state = s;
    opts.onState?.(s);
    for (const fn of subs) fn(s);
  };

  const open = () =>
    new Promise<void>((resolve, reject) => {
      setStatus("connecting");
      const sock = new WS(wsUrl);
      ws = sock;
      let welcomed = false;
      sock.onopen = () => {
        const isEngine = session!.role === "engine";
        sock.send(
          JSON.stringify({ t: "hello", role: isEngine ? "engine" : "view", token: session!.token, device: isEngine ? undefined : opts.deviceLabel ?? defaultDeviceLabel() }),
        );
      };
      sock.onmessage = (ev) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        switch (msg.t) {
          case "welcome":
            welcomed = true;
            everWelcomed = true;
            backoff = 500;
            if (msg.role === "pending") {
              client.role = "pending";
              setStatus("open", "pending");
            } else setStatus("open");
            if (client.role === "engine") resyncHandler?.();
            resolve();
            break;
          case "role": {
            const role = msg.role as Role;
            client.role = role;
            session = { ...session!, role };
            opts.onRole?.(role);
            setStatus("open");
            break;
          }
          case "state":
            emit(msg.state as SessionState);
            break;
          case "patch": {
            const version = msg.version as number;
            if (client.state && version <= client.state.version) break;
            if (!client.state || version !== client.state.version + 1) {
              sock.send(JSON.stringify({ t: "resync" }));
              break;
            }
            const next = applyPatch(structuredClone(client.state), msg.ops as Operation[], false, false).newDocument;
            next.version = version;
            emit(next);
            break;
          }
          case "cmd": {
            const id = String(msg.id);
            commandHandler?.(msg.cmd as Command, (r) => sock.send(JSON.stringify({ t: "ack", id, ...r })));
            break;
          }
          case "resync":
            // Server lost sync with our patches (engine side): republish the full state.
            resyncHandler?.();
            break;
          case "pairRequest":
            opts.onPairRequest?.({ token: String(msg.token), device: String(msg.device ?? "") });
            break;
          case "code": {
            const fn = codeWaiters.shift();
            fn?.({ code: String(msg.code), codeExpiresAt: Number(msg.codeExpiresAt) });
            break;
          }
          case "ack": {
            const fn = pending.get(String(msg.id));
            if (fn) {
              pending.delete(String(msg.id));
              fn({ ok: Boolean(msg.ok), error: msg.error as string | undefined });
            }
            break;
          }
          case "ping":
            sock.send(JSON.stringify({ t: "pong" }));
            break;
          case "error":
            setStatus("closed", String(msg.message));
            if (!welcomed) reject(new Error(String(msg.message)));
            break;
        }
      };
      sock.onerror = () => {
        if (!welcomed) reject(new Error("websocket error"));
      };
      sock.onclose = (ev) => {
        const fatal = ev.code >= 4000 && ev.code < 5000; // protocol refusals: do not retry
        if (!welcomed) reject(new Error(ev.reason || `closed (${ev.code})`));
        if (closedByUser || fatal || opts.reconnect === false || !everWelcomed) {
          setStatus("closed", ev.reason || undefined);
          return;
        }
        setStatus("connecting", "reconnecting");
        setTimeout(() => void open().catch(() => undefined), backoff);
        backoff = Math.min(backoff * 2, 8000);
      };
    });

  await open();
  return client;
}
