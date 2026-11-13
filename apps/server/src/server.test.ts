import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openSocket, type Msg } from "../test/sockets";
import { createSessionServer, type SessionServer } from "./server";
import { mintEngineToken, verifyEngineToken } from "./auth";

let server: SessionServer;
let base: string;
let clock = 1_000_000;
/** The socket address the relay sees (a phone on the Wi-Fi unless a test says otherwise). */
let lanPeer = "192.168.1.20";

beforeEach(async () => {
  clock = 1_000_000;
  lanPeer = "192.168.1.20";
  server = createSessionServer({ now: () => clock, pairLimitPerMinute: 3, pingMs: 60_000, autoAcceptLan: true, remoteAddress: () => lanPeer });
  await new Promise<void>((r) => server.httpServer.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => server.close());

const post = (path: string, body: unknown = {}, headers: Record<string, string> = {}) =>
  fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });


const open = (id: string, hello: Msg) => openSocket(base.replace("http", "ws"), id, hello);

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
    const paired = await engine.nextMeta("paired");
    const view = open(id, { role: "view", token: pair.viewToken });
    await view.next();
    await view.next();
    // the engine knows the pairing by its id, never by the device's token: the token does nothing here
    engine.send({ t: "setRole", token: pair.viewToken, role: "viewer" });
    engine.send({ t: "setRole", id: paired.id, role: "viewer" });
    expect(await view.next()).toMatchObject({ t: "role", role: "viewer" });
    view.send({ t: "cmd", id: "x", cmd: { type: "nextSection" } });
    expect(await view.next()).toMatchObject({ t: "ack", id: "x", ok: false, error: "viewer role" });
    view.send({ t: "resync" });
    expect(await view.next()).toMatchObject({ t: "state", version: 5 });
    engine.ws.close();
    view.ws.close();
  });

  it("a controller accepted on the PC gets a short controller token, never an engine token; auto-accepted phones, viewers and strangers get none", async () => {
    const { id, code, engineToken } = await createSession();
    const engine = open(id, { role: "engine", token: engineToken });
    await engine.next();
    expect((await post(`/api/session/${id}/engine-token`)).status).toBe(401);
    const pair = (await (await post("/api/session/pair", { code })).json()) as { viewToken: string; role: string };
    expect(pair.role).toBe("controller"); // auto-accepted on the Wi-Fi
    const paired = await engine.nextMeta("paired");
    expect((await post(`/api/session/${id}/engine-token`, {}, { Authorization: `Bearer ${pair.viewToken}` })).status).toBe(403);
    // the presenter accepts it on the PC
    engine.send({ t: "setRole", id: paired.id, role: "controller" });
    await new Promise((r) => setTimeout(r, 30));
    const r = await post(`/api/session/${id}/engine-token`, {}, { Authorization: `Bearer ${pair.viewToken}` });
    expect(r.status).toBe(200);
    const { engineToken: minted } = (await r.json()) as { engineToken: string };
    expect(minted.startsWith("c.")).toBe(true);
    expect(verifyEngineToken(server.secret, minted, clock)).toBeNull();
    expect(verifyEngineToken(server.secret, minted.slice(2), clock)).toBeNull();
    // the engine itself still gets a real engine token
    const own = (await (await post(`/api/session/${id}/engine-token`, {}, { Authorization: `Bearer ${engineToken}` })).json()) as { engineToken: string };
    expect(verifyEngineToken(server.secret, own.engineToken, clock)?.sessionId).toBe(id);
    engine.send({ t: "setRole", id: paired.id, role: "viewer" });
    await new Promise((r) => setTimeout(r, 30));
    expect((await post(`/api/session/${id}/engine-token`, {}, { Authorization: `Bearer ${pair.viewToken}` })).status).toBe(401);
    engine.ws.close();
  });

  it("script upload is relayed as loadScript and needs a controller token", async () => {
    const { id, code, engineToken } = await createSession();
    const engine = open(id, { role: "engine", token: engineToken });
    await engine.next();
    expect((await post(`/api/session/${id}/script`, { text: "# A\n- b" })).status).toBe(401);
    const pair = (await (await post("/api/session/pair", { code })).json()) as { viewToken: string };
    const r = await post(`/api/session/${id}/script`, { text: "# A\n- b" }, { Authorization: `Bearer ${pair.viewToken}` });
    expect(r.status).toBe(200);
    expect(await engine.next()).toMatchObject({ t: "cmd", cmd: { type: "loadScript", text: "# A\n- b" }, from: { device: expect.any(String) } });
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
    // b's original code expired long ago (5 min TTL); the engine asks for a fresh one
    const fresh = (await (await post(`/api/session/${b.id}/code`, {}, { Authorization: `Bearer ${b.engineToken}` })).json()) as { code: string };
    expect((await post("/api/session/pair", { code: fresh.code })).status).toBe(200);
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

describe("pairing security", () => {
  let strict: SessionServer;
  let sbase: string;
  beforeEach(async () => {
    strict = createSessionServer({ now: () => clock, pairLimitPerMinute: 3, pairGlobalLimitPerMinute: 5, codeTtlMs: 300_000, pingMs: 60_000 });
    await new Promise<void>((r) => strict.httpServer.listen(0, "127.0.0.1", r));
    sbase = `http://127.0.0.1:${strict.address().port}`;
  });
  afterEach(() => strict.close());
  const spost = (path: string, body: unknown = {}, headers: Record<string, string> = {}) =>
    fetch(sbase + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const sopen = (id: string, hello: Msg) => openSocket(sbase.replace("http", "ws"), id, hello);
  const screate = async () => (await (await spost("/api/session")).json()) as { id: string; code: string; codeExpiresAt: number; engineToken: string };

  it("codes are eight characters without look-alikes, expire after the window and are single-use; the engine can issue a new one", async () => {
    const { id, code, codeExpiresAt, engineToken } = await screate();
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    expect(codeExpiresAt).toBe(clock + 300_000);
    clock += 300_001;
    strict.sweep();
    const expired = await spost("/api/session/pair", { code });
    expect(expired.status).toBe(404);
    const fresh = (await (await spost(`/api/session/${id}/code`, {}, { Authorization: `Bearer ${engineToken}` })).json()) as { code: string };
    expect(fresh.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    expect(fresh.code).not.toBe(code);
    // typed in lower case with a space, as people do: the same code
    expect((await spost("/api/session/pair", { code: `${fresh.code.slice(0, 4).toLowerCase()} ${fresh.code.slice(4)}` })).status).toBe(200);
    expect((await spost("/api/session/pair", { code: fresh.code })).status).toBe(404); // used
    expect((await spost(`/api/session/${id}/code`)).status).toBe(401);
  });

  it("a paired phone stays pending until the engine accepts; reject closes it", async () => {
    const { id, code, engineToken } = await screate();
    const engine = sopen(id, { role: "engine", token: engineToken });
    expect((await engine.next()).t).toBe("welcome");
    engine.send({ t: "state", version: 1, state: { version: 1 } });
    const pair = (await (await spost("/api/session/pair", { code })).json()) as { viewToken: string; role: string };
    expect(pair.role).toBe("pending");
    const view = sopen(id, { role: "view", token: pair.viewToken, device: "iPhone · Safari" });
    expect(await view.next()).toMatchObject({ t: "welcome", role: "pending" });
    const request = await engine.next();
    expect(request).toMatchObject({ t: "pairRequest", device: "iPhone · Safari" });
    // the engine is given the pairing's id, never the phone's credential
    expect(request.token).not.toBe(pair.viewToken);
    expect(JSON.stringify(request)).not.toContain(pair.viewToken);
    // no state yet, commands refused
    view.send({ t: "cmd", id: "c1", cmd: { type: "nextSection" } });
    expect(await view.next()).toMatchObject({ t: "ack", id: "c1", ok: false });
    engine.send({ t: "pairDecision", token: request.token, role: "controller" });
    expect(await view.next()).toMatchObject({ t: "role", role: "controller" });
    expect(await view.next()).toMatchObject({ t: "state", version: 1 });
    view.send({ t: "cmd", id: "c2", cmd: { type: "nextSection" } });
    expect(await engine.next()).toMatchObject({ t: "cmd", id: "c2" });

    const fresh = (await (await spost(`/api/session/${id}/code`, {}, { Authorization: `Bearer ${engineToken}` })).json()) as { code: string };
    const pair2 = (await (await spost("/api/session/pair", { code: fresh.code })).json()) as { viewToken: string };
    const view2 = sopen(id, { role: "view", token: pair2.viewToken });
    await view2.next();
    const request2 = await engine.next();
    expect(request2).toMatchObject({ t: "pairRequest" });
    engine.send({ t: "pairDecision", token: request2.token, role: "reject" });
    expect((await view2.closed).code).toBe(4003);
    engine.ws.close();
    view.ws.close();
  });

  it("spoofed x-forwarded-for does not reset the per-IP limiter unless the proxy is trusted; the global cap returns 429", async () => {
    for (let i = 0; i < 3; i++) await spost("/api/session/pair", { code: "000000" }, { "x-forwarded-for": `10.0.0.${i}` });
    expect((await spost("/api/session/pair", { code: "000000" }, { "x-forwarded-for": "10.0.0.99" })).status).toBe(429);
    // global cap: 5/min across everyone, even for a trusted proxy with many addresses
    const trusted = createSessionServer({ now: () => clock, pairLimitPerMinute: 100, pairGlobalLimitPerMinute: 5, trustProxy: true });
    await new Promise<void>((r) => trusted.httpServer.listen(0, "127.0.0.1", r));
    const tb = `http://127.0.0.1:${trusted.address().port}`;
    const tpost = (xff: string) =>
      fetch(tb + "/api/session/pair", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": xff }, body: JSON.stringify({ code: "000000" }) });
    for (let i = 0; i < 5; i++) expect((await tpost(`203.0.113.${i}`)).status).toBe(404);
    expect((await tpost("203.0.113.200")).status).toBe(429);
    await trusted.close();
  });

  it("auto-accepts only direct local peers, never requests that came through a proxy", async () => {
    const { code } = await createSession(); // the default server has autoAcceptLan: true
    const viaProxy = (await (await post("/api/session/pair", { code }, { "cf-connecting-ip": "203.0.113.5" })).json()) as { role: string };
    expect(viaProxy.role).toBe("pending");
  });
});
