import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionServer, type SessionServer } from "./server";
import { connect, type SessionClient } from "../../../packages/client/src/index";
import { Engine } from "@filow/core";
import { useSession } from "../../web/components/useSession";

// Actual relay, client and engine hook; only HTTP/WS transport and React lifecycle are faked.
// No listen(), TCP sockets, browser, network or model calls.
const runtime = vi.hoisted(() => ({ http: null as any, effects: [] as Array<() => void>, clients: [] as any[] }));
vi.mock("node:http", () => ({ createServer: (handler: unknown) => {
  const http = Object.assign(new EventEmitter(), { handler, close: (cb: () => void) => cb(), closeAllConnections() {} });
  runtime.http = http; return http;
} }));
vi.mock("ws", () => ({ WebSocket: { OPEN: 1 }, WebSocketServer: class {
  clients = new Set();
  handleUpgrade(_req: unknown, socket: any, _head: unknown, cb: (peer: unknown) => void) { cb(socket.peer); }
} }));
vi.mock("react", () => ({
  useCallback: (fn: unknown) => fn, useRef: (current: unknown) => ({ current }),
  useState: (value: unknown) => [value, () => {}],
  useEffect: (fn: () => (() => void)) => { runtime.effects.push(fn()); },
}));
vi.mock("@/lib/sessionUrl", () => ({ desktopBridge: () => null,
  sessionServerUrl: () => "http://relay.invalid", mirrorOrigin: () => "http://relay.invalid", mirrorServerUrl: () => "http://relay.invalid" }));

type Message = Record<string, any>;
class FakeSocket {
  static OPEN = 1;
  readyState = 1;
  onopen?: () => void;
  onmessage?: (ev: { data: string }) => void;
  onclose?: (ev: { code: number; reason: string }) => void;
  sent: Message[] = [];
  peer = Object.assign(new EventEmitter(), {
    readyState: 1,
    send: (data: string) => queueMicrotask(() => this.onmessage?.({ data })),
    close: (code = 1000, reason = "") => this.close(code, reason),
    terminate: () => this.close(1006),
  });
  constructor(url: string) {
    runtime.clients.push(this);
    queueMicrotask(() => {
      runtime.http.emit("upgrade", { url: new URL(url).pathname, headers: {}, socket: { remoteAddress: "192.168.1.20" } }, { peer: this.peer }, null);
      this.onopen?.();
    });
  }
  send(data: string) { this.sent.push(JSON.parse(data)); this.peer.emit("message", data); }
  close(code = 1000, reason = "") {
    if (this.readyState === 3) return;
    this.readyState = this.peer.readyState = 3;
    this.peer.emit("close"); this.onclose?.({ code, reason });
  }
}
async function fakeFetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  const req = Object.assign(new EventEmitter(), { url: new URL(String(url)).pathname,
    method: init?.method ?? "GET", headers: {}, socket: { remoteAddress: "192.168.1.20" } });
  return new Promise(resolve => {
    let status = 200;
    const res = { writeHead: (s: number) => { status = s; }, end: (body: string) => resolve(new Response(body, { status })) };
    runtime.http.handler(req, res);
    req.emit("data", init?.body ?? ""); req.emit("end");
  });
}
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
let server: SessionServer;
beforeEach(() => {
  vi.useFakeTimers(); runtime.clients = []; runtime.effects = [];
  server = createSessionServer({ autoAcceptLan: true });
  vi.stubGlobal("fetch", fakeFetch); vi.stubGlobal("WebSocket", FakeSocket);
});
afterEach(async () => {
  for (const off of runtime.effects) off?.();
  await server.close(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});
async function fixture() {
  const session = await (await fakeFetch("http://relay.invalid/api/session", { method: "POST" })).json();
  const engine = await connect({ serverUrl: "http://relay.invalid", session: { id: session.id, token: session.engineToken, role: "engine" } });
  const state = new Engine({ decide: async () => ({ decisions: [], latencyMs: 0, cost: 0, model: "fake" }) }).getState();
  engine.publishState(state);
  const phone = await connect({ serverUrl: "http://relay.invalid", code: session.code });
  await settle();
  return { engine, phone, state, engineSocket: runtime.clients[0] as FakeSocket, phoneSocket: runtime.clients[1] as FakeSocket };
}
const patch = (engine: SessionClient, version: number, sectionIdx: number) => engine.publishPatch(version, [{ op: "replace", path: "/sectionIdx", value: sectionIdx }]);

describe("Step 4 relay/client seams", () => {
  it("phone rejects unexpected patches before resync and accepts a lower-version full reset", async () => {
    const f = await fixture();
    f.phoneSocket.onmessage!({ data: JSON.stringify({ t: "patch", version: 4, ops: [{ op: "replace", path: "/sectionIdx", value: 4 }] }) });
    expect(f.phone.state?.sectionIdx).toBe(0);
    expect(f.phoneSocket.sent.at(-1)).toEqual({ t: "resync" });
    await settle();
    f.engine.publishState({ ...f.state, version: 10 }); await settle();
    f.engine.publishState({ ...f.state, version: 0 }); await settle();
    expect(f.phone.state?.version).toBe(0);
  });
  // Contract: ARCHITECTURE.md §5.4 version = previous + 1; Q1 older patches must not overwrite newer state.
  it("stale relay patch must not roll the phone back through resync", async () => {
    const f = await fixture(); patch(f.engine, 1, 1); patch(f.engine, 2, 2); await settle();
    expect(f.phone.state?.sectionIdx).toBe(2);
    patch(f.engine, 1, 1); await settle();
    expect(f.phone.state?.sectionIdx, "stale patch must preserve section 2").toBe(2);
    const sent = f.phoneSocket.sent.length;
    f.phoneSocket.onmessage!({ data: JSON.stringify({ t: "patch", version: 1, ops: [{ op: "replace", path: "/sectionIdx", value: 1 }] }) });
    expect(f.phone.state?.sectionIdx).toBe(2);
    expect(f.phoneSocket.sent).toHaveLength(sent); // older patches are dropped, not resynced
    f.phoneSocket.send(JSON.stringify({ t: "resync" })); await settle();
    expect(f.phone.state).toMatchObject({ version: 2, sectionIdx: 2 });
  });
  // Contract: ARCHITECTURE.md §5.4 version = previous + 1; duplicate application is not a new revision.
  it("duplicate non-idempotent patch must not be applied twice by relay", async () => {
    const f = await fixture();
    const ops = [{ op: "add" as const, path: "/unmentioned/-", value: "one fact" }];
    f.engine.publishPatch(1, ops); await settle();
    expect(f.phone.state?.unmentioned).toEqual(["one fact"]);
    f.engine.publishPatch(1, ops); await settle();
    expect(f.phone.state?.unmentioned, "one version must append the fact once").toEqual(["one fact"]);
    const sent = f.phoneSocket.sent.length;
    f.phoneSocket.onmessage!({ data: JSON.stringify({ t: "patch", version: 1, ops }) });
    expect(f.phone.state?.unmentioned).toEqual(["one fact"]);
    expect(f.phoneSocket.sent).toHaveLength(sent); // duplicates need no resync
    f.phoneSocket.send(JSON.stringify({ t: "resync" })); await settle();
    expect(f.phone.state?.unmentioned).toEqual(["one fact"]);
  });
  it("a phone-only reconnect replays missed patches folded into a full snapshot", async () => {
    const f = await fixture(); f.phoneSocket.close(1006);
    patch(f.engine, 1, 1); patch(f.engine, 2, 2);
    await vi.advanceTimersByTimeAsync(500); await settle();
    expect(f.phone.state).toMatchObject({ version: 2, sectionIdx: 2 });
  });
  // Contract: ARCHITECTURE.md §5.4/§10: engine reconnect sends fresh full state; Q2 missed patches converge.
  it("engine reconnect must resend state changed while disconnected", async () => {
    const engine = new Engine({ decide: async () => ({ decisions: [], latencyMs: 0, cost: 0, model: "fake" }) });
    useSession(engine); await settle();
    const socket = runtime.clients[0] as FakeSocket;
    expect(socket.sent.some(m => m.t === "state")).toBe(true);
    socket.close(1006);
    engine.feed({ committed: "missed during disconnect" });
    await vi.advanceTimersByTimeAsync(500); await settle();
    const reconnected = runtime.clients[1] as FakeSocket;
    expect(reconnected.sent.find(m => m.t === "state")?.state.transcriptTail,
      "reconnect must publish the current transcript without waiting for another change").toBe("missed during disconnect");
  });
  // Contract: ARCHITECTURE.md §5.4 contiguous versions and Q2 convergence after missed engine patches.
  it("relay must request full state when engine skips a patch version", async () => {
    const f = await fixture(); const resync = vi.fn(); f.engine.onResync(resync);
    patch(f.engine, 2, 2); await settle();
    expect(resync, "relay must request the missing base instead of blessing an incomplete snapshot").toHaveBeenCalledOnce();
    expect(f.phone.state).toMatchObject({ version: 0, sectionIdx: 0 });
    f.phoneSocket.send(JSON.stringify({ t: "resync" })); await settle();
    expect(f.phone.state).toMatchObject({ version: 0, sectionIdx: 0 });
    f.engine.publishState({ ...f.state, version: 2, sectionIdx: 2, transcriptTail: "missing base restored" });
    await settle(); patch(f.engine, 3, 3); await settle();
    expect(f.phone.state).toMatchObject({ version: 3, sectionIdx: 3, transcriptTail: "missing base restored" });
  });
  it("characterizes a fresh relay: the prior process's pairing code no longer exists", async () => {
    const created = await (await fakeFetch("http://relay.invalid/api/session", { method: "POST" })).json();
    await server.close();
    server = createSessionServer({ autoAcceptLan: true });
    const res = await fakeFetch("http://relay.invalid/api/session/pair", { method: "POST", body: JSON.stringify({ code: created.code }) });
    expect(res.status).toBe(404);
  });
});
