// Session client. Protocol: ARCHITECTURE.md §5.4.
import { applyPatch, type Operation } from "fast-json-patch";
import type { Command, SessionState } from "@intelliprompter/core";

export type ClientStatus = "connecting" | "open" | "closed";
export type Role = "viewer" | "controller" | "engine";

export type ConnectOptions = {
  /** Session server origin, e.g. "http://192.168.1.10:4748" or "https://prompter.example.com" */
  serverUrl: string;
  /** Pair with a 6-digit code (views) ... */
  code?: string;
  /** ... or connect with an existing token (engine, or a view that already paired). */
  session?: { id: string; token: string; role: Role };
  /** Called with the full state after every change. */
  onState?: (state: SessionState) => void;
  onStatus?: (status: ClientStatus, detail?: string) => void;
  /** Reconnect with backoff (default true). */
  reconnect?: boolean;
  fetchImpl?: typeof fetch;
  WebSocketImpl?: typeof WebSocket;
};

export type SessionClient = {
  readonly id: string;
  readonly role: Role;
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
  /** Engine: the server asks for a full state (it could not apply a patch). */
  onResync(fn: () => void): void;
  close(): void;
};

export async function pair(serverUrl: string, code: string, fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl(`${serverUrl.replace(/\/$/, "")}/api/session/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (res.status === 404) throw new Error("unknown code");
  if (res.status === 429) throw new Error("too many attempts, wait a minute");
  if (!res.ok) throw new Error(`pair failed (${res.status})`);
  return (await res.json()) as { id: string; viewToken: string; role: "controller" };
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
  let commandHandler: ((cmd: Command, ack: (r: { ok: boolean; error?: string }) => void) => void) | null = null;
  let resyncHandler: (() => void) | null = null;
  let ws: WebSocket | null = null;
  let closedByUser = false;
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
      ws?.readyState === 1 && ws.send(JSON.stringify({ t: "state", version: state.version, state }));
    },
    publishPatch(version, ops) {
      ws?.readyState === 1 && ws.send(JSON.stringify({ t: "patch", version, ops }));
    },
    onCommand(fn) {
      commandHandler = fn;
    },
    onResync(fn) {
      resyncHandler = fn;
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
        sock.send(JSON.stringify({ t: "hello", role: session!.role === "engine" ? "engine" : "view", token: session!.token }));
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
            backoff = 500;
            setStatus("open");
            resolve();
            break;
          case "state":
            emit(msg.state as SessionState);
            break;
          case "patch": {
            const version = msg.version as number;
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
        if (closedByUser || fatal || opts.reconnect === false) {
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
