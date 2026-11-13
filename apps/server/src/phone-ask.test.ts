import { afterEach, describe, expect, it } from "vitest";
import { cleanDeviceName as coreDevice, cleanPhoneQuestion as coreClean, PHONE_ASK as CORE_ASK, PHONE_QUESTION_MAX as CORE_MAX } from "@filow/core";
import { openSocket } from "../test/sockets";
import { createSessionServer, type SessionServer, type ServerOptions } from "./server";
import { cleanDeviceName, cleanPhoneQuestion, PHONE_ASK, PHONE_QUESTION_MAX, phoneAskText } from "./phone-ask";

// "Ask OK Filow" from a paired phone, on the session server: the presenter sees every pairing and can
// revoke it; asking is a separate right, given on the PC, off by default; the question is checked here
// (shape, length, characters) before it moves, and the PC is told which device sent it. Codes are long
// enough not to be guessed, and burned after 10 wrong tries.
let server: SessionServer;
let peer = "192.168.1.20";
afterEach(async () => {
  await server?.close();
  peer = "192.168.1.20";
});

async function start(extra: ServerOptions = {}) {
  server = createSessionServer({ now: () => Date.now(), pairLimitPerMinute: 50, pairGlobalLimitPerMinute: 200, pingMs: 60_000, autoAcceptLan: true, remoteAddress: () => peer, ...extra });
  await new Promise<void>((r) => server.httpServer.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${server.address().port}`;
}
const post = (base: string, path: string, body: unknown = {}, headers: Record<string, string> = {}) =>
  fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const ws = (base: string) => base.replace("http", "ws");
const ask = (text: unknown) => ({ type: "askOkFilow", text });

/** A session with its engine connected and one phone paired from `from` (default: the Wi-Fi), connected. */
async function withPhone(base: string, device = "Pixel 8") {
  const created = (await (await post(base, "/api/session")).json()) as { id: string; code: string; engineToken: string };
  const engine = openSocket(ws(base), created.id, { role: "engine", token: created.engineToken }, "?role=engine");
  expect((await engine.next()).t).toBe("welcome");
  engine.send({ t: "state", version: 1, state: { version: 1 } });
  const pair = (await (await post(base, "/api/session/pair", { code: created.code, device })).json()) as { viewToken: string; role: string };
  const paired = await engine.nextMeta("paired");
  const phone = openSocket(ws(base), created.id, { role: "view", token: pair.viewToken, device });
  const welcome = await phone.next();
  return { ...created, engine, pair, paired, phone, welcome };
}
async function ackOf(phone: ReturnType<typeof openSocket>, id: string) {
  for (;;) {
    const m = await phone.next();
    if (m.t === "ack" && m.id === id) return m;
  }
}

describe("the question's cleaning", () => {
  it("is the same on the server as in packages/core, on the same inputs", () => {
    const inputs: unknown[] = ["  What is\n on   the slide? ", "été", "a‮b​c\u0007d", "\u{1F600}".repeat(PHONE_QUESTION_MAX + 5),
      "x".repeat(PHONE_QUESTION_MAX), "x".repeat(PHONE_QUESTION_MAX + 1), "", "  ​ ", 42, null, { text: "hi" }, "y".repeat(5000), "tab\there"];
    for (const v of inputs) {
      expect(cleanPhoneQuestion(v), String(v).slice(0, 20)).toBe(coreClean(v));
      expect(cleanPhoneQuestion(v, true)).toBe(coreClean(v, true));
      expect(cleanDeviceName(v)).toBe(coreDevice(v));
    }
    expect(PHONE_QUESTION_MAX).toBe(CORE_MAX);
    expect(PHONE_ASK).toEqual(CORE_ASK);
  });

  it("normalises, takes out control and format characters, counts code points, and refuses more than 300 on the server", () => {
    expect(cleanPhoneQuestion("  What is\n on   the slide?  ")).toBe("What is on the slide?");
    expect(cleanPhoneQuestion("é")).toBe("é");
    expect(cleanPhoneQuestion("pay‮gnp.exe​ now\u0000")).toBe("paygnp.exe now");
    const emoji = "\u{1F600}".repeat(PHONE_QUESTION_MAX);
    expect(cleanPhoneQuestion(emoji, true)).toBe(emoji); // 300 code points, 600 UTF-16 units
    expect(cleanPhoneQuestion(emoji + "x", true)).toBeNull();
    expect(Array.from(cleanPhoneQuestion(emoji + "xyz")!)).toHaveLength(PHONE_QUESTION_MAX);
    expect(cleanPhoneQuestion("y".repeat(4097))).toBeNull();
    for (const empty of ["", "  ​⁠ ", 42, null, undefined]) expect(cleanPhoneQuestion(empty)).toBeNull();
    expect(phoneAskText(ask("hi"))).toBe("hi");
    for (const bad of [ask(42), { type: "askOkFilow" }, { ...ask("hi"), from: { device: "x" } }, { ...ask("hi"), images: [] }, ["askOkFilow", "hi"], null]) expect(phoneAskText(bad)).toBeNull();
  });
});

describe("a phone's question on the session server", () => {
  it("an auto-accepted phone cannot ask until the presenter allows it on the PC, and the PC is told which device asked", async () => {
    const base = await start();
    const { engine, phone, pair, paired, welcome } = await withPhone(base);
    expect(pair.role).toBe("controller");
    expect(welcome).toMatchObject({ t: "welcome", role: "controller", canAsk: false });
    // the PC heard about this pairing, though nobody had to accept it
    expect(paired).toMatchObject({ t: "paired", device: "Pixel 8", role: "controller", peer: "lan" });
    expect((await engine.devicesNow()).map((d) => [d.device, d.role, d.canAsk, d.approved])).toEqual([["Pixel 8", "controller", false, false]]);
    await phone.next(); // state
    phone.send({ t: "cmd", id: "q1", cmd: ask("What is on the slide?") });
    expect(await ackOf(phone, "q1")).toEqual({ t: "ack", id: "q1", ok: false, error: PHONE_ASK.notAllowed });
    // the presenter allows it
    engine.send({ t: "allowAsk", id: paired.id, allow: true });
    expect(await phone.next()).toEqual({ t: "permissions", canAsk: true });
    phone.send({ t: "cmd", id: "q2", cmd: { type: "askOkFilow", text: "What is\n on the ‮slide?" }, from: { id: "x", device: "The presenter" } });
    expect(await engine.nextOf("cmd")).toEqual({ t: "cmd", id: "q2", cmd: { type: "askOkFilow", text: "What is on the slide?" }, from: { id: paired.id, device: "Pixel 8" } });
    // and can take it back
    engine.send({ t: "allowAsk", id: paired.id, allow: false });
    expect(await phone.next()).toEqual({ t: "permissions", canAsk: false });
    phone.send({ t: "cmd", id: "q3", cmd: ask("again") });
    expect(await ackOf(phone, "q3")).toMatchObject({ error: PHONE_ASK.notAllowed });
    // the phone's own commands still go, with the device the server knows
    phone.send({ t: "cmd", id: "n1", cmd: { type: "nextSection" }, from: { id: "spoof", device: "spoof" } });
    expect(await engine.nextOf("cmd")).toEqual({ t: "cmd", id: "n1", cmd: { type: "nextSection" }, from: { id: paired.id, device: "Pixel 8" } });
    expect(engine.inbox.filter((m) => m.t === "cmd")).toEqual([]);
  });

  it("refuses any other shape, an empty question and more than 300 code points, before the PC sees it", async () => {
    const base = await start();
    const { engine, phone, paired } = await withPhone(base);
    engine.send({ t: "allowAsk", id: paired.id, allow: true });
    await phone.nextOf("permissions");
    const bad = [ask(42), ask(""), ask(" ​ "), ask("x".repeat(PHONE_QUESTION_MAX + 1)), { ...ask("hi"), images: ["data:image/png;base64,AA"] }, { type: "askOkFilow" }];
    for (const [i, cmd] of bad.entries()) {
      phone.send({ t: "cmd", id: `b${i}`, cmd });
      expect(await ackOf(phone, `b${i}`), JSON.stringify(cmd).slice(0, 40)).toMatchObject({ ok: false, error: PHONE_ASK.bad });
    }
    phone.send({ t: "cmd", id: "ok", cmd: ask("\u{1F600}".repeat(PHONE_QUESTION_MAX)) });
    expect(await engine.nextOf("cmd")).toMatchObject({ id: "ok" });
    expect(engine.inbox.filter((m) => m.t === "cmd")).toEqual([]);
  });

  it("closes a device's socket on a message over 16 KiB, unread", async () => {
    const base = await start();
    const { engine, phone, paired } = await withPhone(base);
    engine.send({ t: "allowAsk", id: paired.id, allow: true });
    await phone.nextOf("permissions");
    phone.send({ t: "cmd", id: "big", cmd: ask("x".repeat(17 * 1024)) });
    expect((await phone.closed).code).toBe(1009);
    expect(engine.inbox.filter((m) => m.t === "cmd")).toEqual([]);
  });

  it("a viewer and a waiting phone can never ask, and becoming a viewer takes the right away", async () => {
    peer = "203.0.113.9"; // through the tunnel: pending
    const base = await start();
    const { engine, phone, pair, paired, welcome } = await withPhone(base, "iPad");
    expect(pair.role).toBe("pending");
    expect(welcome).toMatchObject({ role: "pending", canAsk: false });
    expect(paired).toMatchObject({ peer: "remote", role: "pending" });
    engine.send({ t: "allowAsk", id: paired.id, allow: true }); // not a controller: ignored
    phone.send({ t: "cmd", id: "w", cmd: ask("hi") });
    expect(await ackOf(phone, "w")).toMatchObject({ error: "waiting for the presenter" });
    engine.send({ t: "pairDecision", id: paired.id, role: "controller" });
    expect(await phone.nextOf("role")).toMatchObject({ role: "controller", canAsk: false });
    engine.send({ t: "allowAsk", id: paired.id, allow: true });
    expect(await phone.nextOf("permissions")).toEqual({ t: "permissions", canAsk: true });
    engine.send({ t: "setRole", id: paired.id, role: "viewer" });
    expect(await phone.nextOf("role")).toMatchObject({ role: "viewer", canAsk: false });
    phone.send({ t: "cmd", id: "v", cmd: ask("hi") });
    expect(await ackOf(phone, "v")).toMatchObject({ error: "viewer role" });
    expect((await engine.devicesNow()).map((d) => [d.role, d.canAsk, d.approved])).toEqual([["viewer", false, true]]);
    expect(engine.inbox.filter((m) => m.t === "cmd")).toEqual([]);
  });
});

describe("the presenter's devices list", () => {
  it("revoke disconnects the device and its token stops working everywhere", async () => {
    const base = await start();
    const { id, engine, phone, pair, paired } = await withPhone(base);
    engine.send({ t: "revoke", id: paired.id });
    expect(await phone.closed).toMatchObject({ code: 4003, reason: "revoked by the presenter" });
    expect(await engine.devicesNow()).toEqual([]);
    const again = openSocket(ws(base), id, { role: "view", token: pair.viewToken });
    expect((await again.closed).code).toBe(4002);
    expect((await post(base, `/api/session/${id}/script`, { text: "# x" }, { Authorization: `Bearer ${pair.viewToken}` })).status).toBe(401);
  });

  it("a token runs out when its device stays away, and is refreshed while it is connected", async () => {
    let clock = 1_000_000;
    server = createSessionServer({ now: () => clock, pingMs: 60_000, autoAcceptLan: true, remoteAddress: () => peer, viewTokenTtlMs: 60_000 });
    await new Promise<void>((r) => server.httpServer.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const { id, engine, phone, pair } = await withPhone(base);
    clock += 50_000;
    server.sweep(); // connected: refreshed
    clock += 50_000;
    server.sweep();
    expect((await engine.devicesNow()).length).toBe(1);
    phone.ws.close();
    await phone.closed;
    await new Promise((r) => setTimeout(r, 30));
    clock += 61_000;
    server.sweep();
    expect(await engine.devicesNow()).toEqual([]);
    const back = openSocket(ws(base), id, { role: "view", token: pair.viewToken });
    expect((await back.closed).code).toBe(4002);
  });
});

describe("who is accepted without asking", () => {
  it("never this computer itself (the HTTPS proxy and the tunnel come from there) nor anything proxied", async () => {
    const base = await start();
    for (const [address, headers] of [["127.0.0.1", {}], ["::1", {}], ["::ffff:127.0.0.1", {}], ["192.168.1.20", { "x-forwarded-for": "192.168.1.30" }], ["192.168.1.20", { "cf-connecting-ip": "203.0.113.5" }], ["192.168.1.20", { forwarded: "for=1.2.3.4" }]] as const) {
      peer = address;
      const { code } = (await (await post(base, "/api/session")).json()) as { code: string };
      const r = (await (await post(base, "/api/session/pair", { code }, headers)).json()) as { role: string };
      expect(r.role, `${address} ${JSON.stringify(headers)}`).toBe("pending");
    }
    peer = "192.168.1.20";
    const { code } = (await (await post(base, "/api/session")).json()) as { code: string };
    expect(((await (await post(base, "/api/session/pair", { code })).json()) as { role: string }).role).toBe("controller");
  });

  it("the app's own floating windows, with the per-launch key, from this computer directly, and never allowed to ask", async () => {
    const base = await start({ appPairKey: "k".repeat(32) });
    peer = "127.0.0.1";
    const created = (await (await post(base, "/api/session")).json()) as { id: string; code: string; engineToken: string };
    const engine = openSocket(ws(base), created.id, { role: "engine", token: created.engineToken }, "?role=engine");
    await engine.next();
    const r = (await (await post(base, "/api/session/pair", { code: created.code, appKey: "k".repeat(32), device: "a phone" })).json()) as { role: string };
    expect(r.role).toBe("controller");
    expect(await engine.nextMeta("paired")).toMatchObject({ peer: "app", device: "Filow window", role: "controller" });
    // wrong key, or the right key through a proxy: an ordinary pairing that waits
    for (const [key, headers] of [["x".repeat(32), {}], ["k".repeat(32), { "x-forwarded-for": "127.0.0.1" }]] as const) {
      const fresh = (await (await post(base, `/api/session/${created.id}/code`, {}, { Authorization: `Bearer ${created.engineToken}` })).json()) as { code: string };
      expect(((await (await post(base, "/api/session/pair", { code: fresh.code, appKey: key }, headers)).json()) as { role: string }).role).toBe("pending");
    }
  });
});

describe("pairing codes", () => {
  it("are burned and replaced after 10 wrong tries, and the PC is sent the new one", async () => {
    const base = await start();
    const created = (await (await post(base, "/api/session")).json()) as { id: string; code: string; engineToken: string };
    const engine = openSocket(ws(base), created.id, { role: "engine", token: created.engineToken }, "?role=engine");
    await engine.next();
    for (let i = 0; i < 9; i++) expect((await post(base, "/api/session/pair", { code: "AAAAAAAA" })).status).toBe(404);
    expect(engine.inbox).toEqual([]);
    expect((await post(base, "/api/session/pair", { code: "AAAAAAAA" })).status).toBe(404);
    const rotated = await engine.next();
    expect(rotated).toMatchObject({ t: "codeRotated" });
    expect(rotated.code).not.toBe(created.code);
    expect((await post(base, "/api/session/pair", { code: created.code })).status).toBe(404);
    expect((await post(base, "/api/session/pair", { code: rotated.code })).status).toBe(200);
  });

  it("the local network and the tunnel have separate limits: one cannot lock the other out", async () => {
    server = createSessionServer({ now: () => Date.now(), pairLimitPerMinute: 100, pairGlobalLimitPerMinute: 5, pingMs: 60_000, autoAcceptLan: true, remoteAddress: () => peer, trustProxy: true, wrongCodesBeforeRotation: 1000 });
    await new Promise<void>((r) => server.httpServer.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    peer = "127.0.0.1"; // cloudflared, on this computer
    for (let i = 0; i < 5; i++) await post(base, "/api/session/pair", { code: "AAAAAAAA" }, { "cf-connecting-ip": `203.0.113.${i}` });
    expect((await post(base, "/api/session/pair", { code: "AAAAAAAA" }, { "cf-connecting-ip": "203.0.113.77" })).status).toBe(429);
    peer = "192.168.1.20";
    const { code } = (await (await post(base, "/api/session")).json()) as { code: string };
    expect((await post(base, "/api/session/pair", { code })).status).toBe(200);
  });
});
