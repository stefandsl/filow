import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createSessionServer, type SessionServer } from "./server";
import { mintEngineToken, verifyEngineToken } from "./auth";

let server: SessionServer;
let base: string;
let clock = 1_000_000;

beforeEach(async () => {
  clock = 1_000_000;
  server = createSessionServer({ now: () => clock, pairLimitPerMinute: 3, pingMs: 60_000 });
  await new Promise<void>((r) => server.httpServer.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => server.close());

const post = (path: string, body: unknown = {}, headers: Record<string, string> = {}) =>
  fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

type Msg = Record<string, unknown>;
function open(id: string, hello: Msg) {
  const ws = new WebSocket(`${base.replace("http", "ws")}/ws/session/${id}`);
  const inbox: Msg[] = [];
  const waiters: Array<(m: Msg) => void> = [];
  ws.on("message", (d) => {
    const m = JSON.parse(String(d));
    const w = waiters.shift();
    if (w) w(m);
    else inbox.push(m);
  });
  const next = () => new Promise<Msg>((r) => (inbox.length ? r(inbox.shift()!) : waiters.push(r)));
  const closed = new Promise<{ code: number; reason: string }>((r) => ws.on("close", (code, reason) => r({ code, reason: String(reason) })));
  ws.on("open", () => ws.send(JSON.stringify({ t: "hello", ...hello })));
  return { ws, next, closed, send: (m: Msg) => ws.send(JSON.stringify(m)) };
}

async function createSession() {
  const r = await post("/api/session");
  return (await r.json()) as { id: string; code: string; engineToken: string };
}

describe("tokens", () => {
  it("round-trips and rejects expiry and tampering", () => {
    const t = mintEngineToken("s", "abc", 1000, 0);
    expect(verifyEngineToken("s", t, 500)).toEqual({ sessionId: "abc" });
    expect(verifyEngineToken("s", t, 1001)).toBeNull();
    expect(verifyEngineToken("other", t, 500)).toBeNull();
    expect(verifyEngineToken("s", t.slice(0, -1) + "x", 500)).toBeNull();
  });
});

describe("pairing", () => {
  it("bad code is 404, rate limit is 429", async () => {
    expect((await post("/api/session/pair", { code: "000000" })).status).toBe(404);
    await post("/api/session/pair", { code: "000000" });
    await post("/api/session/pair", { code: "000000" });
    expect((await post("/api/session/pair", { code: "000000" })).status).toBe(429);
  });

  it("requires the access password when configured", async () => {
    const s2 = createSessionServer({ accessPassword: "pw" });
    await new Promise<void>((r) => s2.httpServer.listen(0, "127.0.0.1", r));
    const b2 = `http://127.0.0.1:${s2.address().port}`;
    expect((await fetch(b2 + "/api/session", { method: "POST" })).status).toBe(401);
    expect((await fetch(b2 + "/api/session", { method: "POST", headers: { "X-Access-Password": "pw" } })).status).toBe(200);
    await s2.close();
  });
});

describe("relay", () => {
  it("replays state to new views, forwards patches and commands, rejects a second engine", async () => {
    const { id, code, engineToken } = await createSession();
    const engine = open(id, { role: "engine", token: engineToken });
    expect((await engine.next()).t).toBe("welcome");
    engine.send({ t: "state", version: 1, state: { version: 1, sectionIdx: 0 } });

    const pair = (await (await post("/api/session/pair", { code })).json()) as { viewToken: string };
    const view = open(id, { role: "view", token: pair.viewToken });
    expect((await view.next()).t).toBe("welcome");
    expect(await view.next()).toMatchObject({ t: "state", version: 1 });

    engine.send({ t: "patch", version: 2, ops: [{ op: "replace", path: "/sectionIdx", value: 1 }] });
    expect(await view.next()).toMatchObject({ t: "patch", version: 2 });

    view.send({ t: "cmd", id: "c1", cmd: { type: "nextSection" } });
    const cmd = await engine.next();
    expect(cmd).toMatchObject({ t: "cmd", id: "c1" });
    engine.send({ t: "ack", id: "c1", ok: true });
    expect(await view.next()).toMatchObject({ t: "ack", id: "c1", ok: true });

    const second = open(id, { role: "engine", token: engineToken });
    expect((await second.closed).code).toBe(4001);

    const bad = open(id, { role: "view", token: "nope" });
    expect((await bad.closed).code).toBe(4002);

    engine.ws.close();
    expect(await view.next()).toMatchObject({ t: "engineOffline" });
    view.ws.close();
  });

  it("viewer role cannot send commands; resync returns full state", async () => {
    const { id, code, engineToken } = await createSession();
    const engine = open(id, { role: "engine", token: engineToken });
    await engine.next();
    engine.send({ t: "state", version: 5, state: { version: 5 } });
    const pair = (await (await post("/api/session/pair", { code })).json()) as { viewToken: string };
    const view = open(id, { role: "view", token: pair.viewToken });
    await view.next();
    await view.next();
    engine.send({ t: "setRole", token: pair.viewToken, role: "viewer" });
    await new Promise((r) => setTimeout(r, 30));
    view.send({ t: "cmd", id: "x", cmd: { type: "nextSection" } });
    expect(await view.next()).toMatchObject({ t: "ack", id: "x", ok: false, error: "viewer role" });
    view.send({ t: "resync" });
    expect(await view.next()).toMatchObject({ t: "state", version: 5 });
    engine.ws.close();
    view.ws.close();
  });

  it("script upload is relayed as loadScript and needs a controller token", async () => {
    const { id, code, engineToken } = await createSession();
    const engine = open(id, { role: "engine", token: engineToken });
    await engine.next();
    expect((await post(`/api/session/${id}/script`, { text: "# A\n- b" })).status).toBe(401);
    const pair = (await (await post("/api/session/pair", { code })).json()) as { viewToken: string };
    const r = await post(`/api/session/${id}/script`, { text: "# A\n- b" }, { Authorization: `Bearer ${pair.viewToken}` });
    expect(r.status).toBe(200);
    expect(await engine.next()).toMatchObject({ t: "cmd", cmd: { type: "loadScript", text: "# A\n- b" } });
    engine.ws.close();
  });
});

describe("lifetimes", () => {
  it("expires 2 h after the engine leaves and 12 h absolutely", async () => {
    const a = await createSession();
    const b = await createSession();
    const engine = open(b.id, { role: "engine", token: b.engineToken });
    await engine.next();
    clock += 3 * 60 * 60 * 1000; // 3 h: a (never had an engine) expires, b (engine connected) stays
    server.sweep();
    expect((await post("/api/session/pair", { code: a.code })).status).toBe(404);
    expect((await post("/api/session/pair", { code: b.code })).status).toBe(200);
    clock += 10 * 60 * 60 * 1000; // 13 h total
    server.sweep();
    expect((await engine.closed).code).toBe(4003);
  });
});

describe("late joiners", () => {
  it("get a snapshot that includes earlier patches", async () => {
    const { id, code, engineToken } = await createSession();
    const engine = open(id, { role: "engine", token: engineToken });
    await engine.next();
    engine.send({ t: "state", version: 0, state: { version: 0, sectionIdx: 0, script: { sections: [] } } });
    engine.send({ t: "patch", version: 1, ops: [{ op: "replace", path: "/script/sections", value: [{ id: "s0" }] }] });
    await new Promise((r) => setTimeout(r, 30));
    const pair = (await (await post("/api/session/pair", { code })).json()) as { viewToken: string };
    const view = open(id, { role: "view", token: pair.viewToken });
    await view.next();
    const snap = (await view.next()) as { t: string; version: number; state: { version: number; script: { sections: unknown[] } } };
    expect(snap.t).toBe("state");
    expect(snap.version).toBe(1);
    expect(snap.state.version).toBe(1);
    expect(snap.state.script.sections).toHaveLength(1);
    engine.ws.close();
    view.ws.close();
  });
});
