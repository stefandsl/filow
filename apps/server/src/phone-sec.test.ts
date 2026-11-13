// Regression tests for the security review of "Ask OK Filow" from a paired phone (M1-M3, m1-m3, m7, m8
// on the session server). Each one was a working attack before its fix; each fails again if the fix is
// taken out. The desktop inbox (M4, m5) is in apps/desktop/okfilow-phone.test.ts, the panel and the
// model's side (m4, m6) in apps/web/lib/buddy/phoneSec.test.ts.
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { REMOTE as CORE_REMOTE } from "@filow/core";
import { openSocket } from "../test/sockets";
import { createSessionServer, defaultPairOriginAllowed, inCidr, REMOTE_BEFORE_APPROVAL, UNAUTHENTICATED_PER_ADDRESS, type SessionServer, type ServerOptions } from "./server";
import { CONTROLLER_TOKEN_TTL_MS, mintControllerToken } from "./auth";
import { isAppLabel, REMOTE } from "./phone-ask";
import { verifyControllerToken } from "../../web/lib/engineAuth";

let server: SessionServer;
/** The socket address the relay sees. */
let peer = "192.168.1.20";
afterEach(async () => {
  await server?.close();
  peer = "192.168.1.20";
});
async function start(extra: ServerOptions = {}) {
  server = createSessionServer({ now: () => Date.now(), pingMs: 60_000, autoAcceptLan: true, lanCidr: () => "192.168.1.0/24", remoteAddress: () => peer, ...extra });
  await new Promise<void>((r) => server.httpServer.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${server.address().port}`;
}
const post = (base: string, path: string, body: unknown = {}, headers: Record<string, string> = {}) =>
  fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const wsb = (b: string) => b.replace("http", "ws");
type Created = { id: string; code: string; engineToken: string };
const create = async (base: string) => (await (await post(base, "/api/session")).json()) as Created;
async function withEngine(base: string) {
  const s = await create(base);
  const engine = openSocket(wsb(base), s.id, { role: "engine", token: s.engineToken }, "?role=engine");
  expect((await engine.next()).t).toBe("welcome");
  engine.send({ t: "state", version: 1, state: { version: 1 } });
  return { ...s, engine };
}
const freshCode = async (base: string, s: Created) => ((await (await post(base, `/api/session/${s.id}/code`, {}, { Authorization: `Bearer ${s.engineToken}` })).json()) as { code: string }).code;
/** Pairs a device with the code and connects it; returns its socket, its pairing as the engine heard it, and its welcome. */
async function join(base: string, s: Created & { engine: ReturnType<typeof openSocket> }, code: string, device?: string, hello: Record<string, unknown> = {}) {
  const pair = (await (await post(base, "/api/session/pair", { code, ...(device ? { device } : {}) })).json()) as { viewToken: string; role: string };
  const paired = await s.engine.nextMeta("paired");
  const phone = openSocket(wsb(base), s.id, { role: "view", token: pair.viewToken, ...hello });
  const welcome = await phone.next();
  return { pair, paired, phone, welcome };
}
async function ackOf(phone: ReturnType<typeof openSocket>, id: string) {
  for (;;) {
    const m = await phone.next();
    if (m.t === "ack" && m.id === id) return m;
  }
}
const quiet = (ms = 40) => new Promise((r) => setTimeout(r, ms));

describe("M1: wrong codes cannot stop the presenter from pairing", () => {
  it("A: any number of wrong codes, from a stranger or from the Wi-Fi, burn nothing: the code on screen still pairs and the PC is sent no new one", async () => {
    const base = await start({ pairLimitPerMinute: 1000, pairGlobalLimitPerMinute: 1000 });
    const s = await withEngine(base);
    peer = "203.0.113.9"; // a stranger through the tunnel
    for (let i = 0; i < 25; i++) expect((await post(base, "/api/session/pair", { code: "AAAAAAAA" }, { "x-forwarded-for": "203.0.113.9" })).status).toBe(404);
    peer = "192.168.1.66"; // a host on the Wi-Fi
    for (let i = 0; i < 25; i++) expect((await post(base, "/api/session/pair", { code: "BBBBBBBB" })).status).toBe(404);
    await quiet();
    expect(s.engine.inbox).toEqual([]); // no codeRotated, nothing at all
    peer = "192.168.1.20";
    const r = await post(base, "/api/session/pair", { code: s.code, device: "legit phone" });
    expect(r.status).toBe(200);
  });

  it("a page of another site in the presenter's browser cannot pair or spend the local attempts; the app's own pages can", async () => {
    const base = await start({ pairLimitPerMinute: 3 });
    const s = await create(base);
    peer = "127.0.0.1"; // the presenter's own browser
    for (let i = 0; i < 10; i++) {
      const r = await post(base, "/api/session/pair", { code: "AAAAAAAA" }, { Origin: "https://evil.example" });
      expect(r.status).toBe(403);
      expect(r.headers.get("access-control-allow-origin")).toBe("null");
    }
    // the preflight of such a page is refused too
    expect((await fetch(base + "/api/session/pair", { method: "OPTIONS", headers: { Origin: "https://evil.example" } })).status).toBe(403);
    // the local bucket was not spent by any of it: the app's own page still pairs, and its origin is the one allowed back
    const own = "http://127.0.0.1:4747";
    const pre = await fetch(base + "/api/session/pair", { method: "OPTIONS", headers: { Origin: own } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe(own);
    const ok = await post(base, "/api/session/pair", { code: s.code }, { Origin: own });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBe(own);
    // not from a web page at all (the PowerPoint pane's relay, a script): no Origin, taken
    const s2 = await create(base);
    expect((await post(base, "/api/session/pair", { code: s2.code })).status).toBe(200);
  });

  it("the app's own origins: loopback, a browser extension, the configured origin; never a look-alike", () => {
    for (const ok of ["http://localhost:4747", "http://127.0.0.1:4747", "https://127.0.0.1:4750", "http://[::1]:4747", "chrome-extension://abcdefghijklmnop", "moz-extension://1234"]) expect(defaultPairOriginAllowed(ok, "*"), ok).toBe(true);
    for (const no of ["https://evil.example", "http://localhost.evil.example", "http://127.0.0.1.evil.example", "null", "file://", "http://8.8.8.8:4747", ""]) expect(defaultPairOriginAllowed(no, "*"), no).toBe(false);
    expect(defaultPairOriginAllowed("https://prompter.example.com", "https://prompter.example.com")).toBe(true);
    expect(defaultPairOriginAllowed("https://other.example.com", "https://prompter.example.com")).toBe(false);
  });
});

describe("M2: forwarding headers are believed only from this computer", () => {
  it("B: with the public link on, a Wi-Fi host that sends its own cf-connecting-ip or x-forwarded-for is still limited by its real address", async () => {
    const base = await start({ trustProxy: true, pairLimitPerMinute: 10, pairGlobalLimitPerMinute: 1000 });
    await create(base);
    peer = "192.168.1.66";
    let limited = 0;
    for (let i = 0; i < 40; i++) {
      const r = await post(base, "/api/session/pair", { code: "AAAAAAAA" }, i % 2 ? { "cf-connecting-ip": `198.51.100.${i}` } : { "x-forwarded-for": `198.51.100.${i}` });
      if (r.status === 429) limited++;
    }
    expect(limited).toBe(30); // 10 tries, then refused: the header changed nothing
  });

  it("the tunnel and the HTTPS proxy, which run on this computer, are still believed: each visitor has its own limit", async () => {
    const base = await start({ trustProxy: true, pairLimitPerMinute: 2, pairGlobalLimitPerMinute: 1000 });
    peer = "127.0.0.1";
    for (let i = 0; i < 6; i++) expect((await post(base, "/api/session/pair", { code: "AAAAAAAA" }, { "cf-connecting-ip": `203.0.113.${i}` })).status).toBe(404);
    for (let i = 0; i < 2; i++) expect((await post(base, "/api/session/pair", { code: "AAAAAAAA" }, { "cf-connecting-ip": "203.0.113.50" })).status).toBe(404);
    expect((await post(base, "/api/session/pair", { code: "AAAAAAAA" }, { "cf-connecting-ip": "203.0.113.50" })).status).toBe(429);
  });

  it("a Wi-Fi host cannot put a made-up address in its default name", async () => {
    const base = await start({ trustProxy: true });
    const s = await withEngine(base);
    peer = "192.168.1.66";
    await post(base, "/api/session/pair", { code: s.code }, { "cf-connecting-ip": "10.0.0.1" });
    expect(await s.engine.nextMeta("paired")).toMatchObject({ device: "device at 192.168.1.66", role: "pending" });
  });
});

describe("M3: a phone accepted without a prompt only moves and marks until the presenter accepts it on the PC", () => {
  it("D: an auto-accepted Wi-Fi controller cannot replace the script, use Look now, or start and stop the take", async () => {
    const base = await start();
    const s = await withEngine(base);
    const { pair, phone, welcome } = await join(base, s, s.code, "x");
    expect(pair.role).toBe("controller");
    expect(welcome).toMatchObject({ role: "controller", approved: false });
    await phone.next(); // state
    const big = "# injected\n" + "x".repeat(900_000);
    const r = await post(base, `/api/session/${s.id}/script`, { text: big }, { Authorization: `Bearer ${pair.viewToken}` });
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: string }).error).toBe(REMOTE.approveFirst);
    for (const type of ["lookNow", "startTake", "stopTake", "loadScript", "reset", "setLanguage", "somethingNew"]) {
      phone.send({ t: "cmd", id: type, cmd: { type } });
      expect(await ackOf(phone, type), type).toEqual({ t: "ack", id: type, ok: false, error: REMOTE.approveFirst });
    }
    // moving between sections and marking points still goes through
    const allowed = [...REMOTE_BEFORE_APPROVAL];
    expect(allowed.sort()).toEqual(["anchor", "goToSection", "markMissed", "markStarted", "nextSection", "prevSection", "reopen"]);
    for (const type of allowed) phone.send({ t: "cmd", id: `ok-${type}`, cmd: { type } });
    const seen: string[] = [];
    while (seen.length < allowed.length) {
      const m = await s.engine.next();
      expect(m.t).toBe("cmd");
      seen.push((m.cmd as { type: string }).type);
    }
    expect(seen).toEqual(allowed);
    await quiet();
    expect(s.engine.inbox).toEqual([]); // none of the refused ones, and no loadScript, reached the PC
    expect(REMOTE).toEqual(CORE_REMOTE);
  });

  it("after the presenter's accept on the PC the same phone controls everything, and is told so", async () => {
    const base = await start();
    const s = await withEngine(base);
    const { pair, paired, phone } = await join(base, s, s.code, "x");
    await phone.next(); // state
    expect((await s.engine.devicesNow()).map((d) => [d.role, d.approved])).toEqual([["controller", false]]);
    s.engine.send({ t: "pairDecision", id: paired.id, role: "controller" });
    expect(await phone.nextOf("role")).toEqual({ t: "role", role: "controller", canAsk: false, approved: true });
    expect((await s.engine.devicesNow()).map((d) => [d.role, d.approved])).toEqual([["controller", true]]);
    phone.send({ t: "cmd", id: "l", cmd: { type: "lookNow" } });
    expect(await s.engine.nextOf("cmd")).toMatchObject({ cmd: { type: "lookNow" } });
    expect((await post(base, `/api/session/${s.id}/script`, { text: "# A" }, { Authorization: `Bearer ${pair.viewToken}` })).status).toBe(200);
    expect(await s.engine.nextOf("cmd")).toMatchObject({ cmd: { type: "loadScript", text: "# A" } });
    // a phone that waited for the presenter (through the tunnel) is accepted from the start
    peer = "203.0.113.9";
    const far = await join(base, s, await freshCode(base, s), "far");
    expect(far.welcome).toMatchObject({ role: "pending", approved: false });
    s.engine.send({ t: "pairDecision", id: far.paired.id, role: "controller" });
    expect(await far.phone.nextOf("role")).toMatchObject({ role: "controller", approved: true });
  });

  it("every device's commands are rate limited, the script upload with them, each device on its own", async () => {
    let clock = 1_000_000;
    const base = await start({ now: () => clock, commandLimit: 5, commandWindowMs: 10_000 });
    const s = await withEngine(base);
    const a = await join(base, s, s.code, "a");
    await a.phone.next();
    for (let i = 0; i < 5; i++) a.phone.send({ t: "cmd", id: `n${i}`, cmd: { type: "nextSection" } });
    a.phone.send({ t: "cmd", id: "n5", cmd: { type: "nextSection" } });
    expect(await ackOf(a.phone, "n5")).toEqual({ t: "ack", id: "n5", ok: false, error: REMOTE.tooMany });
    // another device is not held back by it
    const b = await join(base, s, await freshCode(base, s), "b");
    await b.phone.next();
    b.phone.send({ t: "cmd", id: "b0", cmd: { type: "nextSection" } });
    await quiet();
    expect(s.engine.inbox.filter((m) => m.t === "cmd")).toHaveLength(6);
    // the window passes: it may send again
    clock += 10_001;
    a.phone.send({ t: "cmd", id: "n6", cmd: { type: "nextSection" } });
    await quiet();
    expect(s.engine.inbox.filter((m) => m.t === "cmd")).toHaveLength(7);
    // the script endpoint counts against the same allowance
    s.engine.send({ t: "pairDecision", id: a.paired.id, role: "controller" });
    await quiet();
    clock += 10_001;
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await post(base, `/api/session/${s.id}/script`, { text: "# A" }, { Authorization: `Bearer ${a.pair.viewToken}` })).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429, 429]);
  });
});

describe("m1: a device's name is the one it paired with", () => {
  it("C: a device cannot rename itself after pairing; the PC keeps seeing the name the presenter saw", async () => {
    const base = await start();
    const s = await withEngine(base);
    const { pair, paired, phone } = await join(base, s, s.code, "Anna's iPhone", { device: "The presenter" });
    await phone.next();
    s.engine.send({ t: "allowAsk", id: paired.id, allow: true });
    await phone.nextOf("permissions");
    phone.send({ t: "cmd", id: "q1", cmd: { type: "askOkFilow", text: "hi" } });
    expect(((await s.engine.nextOf("cmd")).from as { device: string }).device).toBe("Anna's iPhone");
    // a second connection of the same pairing with yet another name changes nothing either
    const again = openSocket(wsb(base), s.id, { role: "view", token: pair.viewToken, device: "Someone else" });
    expect((await again.next()).t).toBe("welcome");
    expect((await s.engine.devicesNow()).map((d) => d.device)).toEqual(["Anna's iPhone"]);
  });

  it("a device that paired without a name may give one in its first hello, but not once the presenter decided", async () => {
    const base = await start();
    const s = await withEngine(base);
    peer = "203.0.113.9";
    const first = await join(base, s, s.code, undefined, { device: "iPad · Safari" });
    expect(first.paired).toMatchObject({ device: "device at 203.0.113.9", role: "pending" });
    expect((await s.engine.devicesNow()).map((d) => d.device)).toEqual(["iPad · Safari"]);
    // accepted under that name: a reconnect cannot change it
    s.engine.send({ t: "pairDecision", id: first.paired.id, role: "controller" });
    await first.phone.nextOf("role");
    const second = openSocket(wsb(base), s.id, { role: "view", token: first.pair.viewToken, device: "Renamed" });
    await second.next();
    expect((await s.engine.devicesNow()).map((d) => d.device)).toEqual(["iPad · Safari"]);
    // without a name at all, accepted as "device at ...": a name sent after the accept is not taken
    const code = await freshCode(base, s);
    const pair = (await (await post(base, "/api/session/pair", { code })).json()) as { viewToken: string };
    const paired = await s.engine.nextMeta("paired");
    s.engine.send({ t: "pairDecision", id: paired.id, role: "viewer" });
    await quiet();
    const late = openSocket(wsb(base), s.id, { role: "view", token: pair.viewToken, device: "Late name" });
    await late.next();
    expect((await s.engine.devicesNow()).map((d) => d.device)).toEqual(["iPad · Safari", "device at 203.0.113.9"]);
  });

  it("a device may not take one of the app's own names, in any spelling", async () => {
    const base = await start();
    const s = await withEngine(base);
    let code = s.code;
    for (const name of ["Filow window", "OK Filow", "ＦＩＬＯＷ window", "F i l o w", "f.i.l.o.w", "FILOW", "ok-filow"]) {
      await post(base, "/api/session/pair", { code, device: name });
      expect((await s.engine.nextMeta("paired")).device, name).toBe("device at 192.168.1.20");
      code = await freshCode(base, s);
    }
    const hello = await join(base, s, code, undefined, { device: "Filow window" });
    await hello.phone.next();
    expect((await s.engine.devicesNow()).at(-1)?.device).toBe("device at 192.168.1.20");
    expect(isAppLabel("Anna's iPhone")).toBe(false);
    expect(isAppLabel("Pixel 8 · Chrome")).toBe(false);
  });
});

describe("m2: the large-message socket is the engine's alone", () => {
  it("E: without a valid engine token in its address the socket is refused before a byte of a message is read", async () => {
    const base = await start();
    const s = await withEngine(base);
    const { pair } = await join(base, s, s.code, "x");
    const other = await create(base);
    for (const query of ["?role=engine&token=", "?role=engine&x=1", "?role=engine&token=x", `?role=engine&token=${encodeURIComponent(pair.viewToken)}`, `?role=engine&token=${encodeURIComponent(other.engineToken)}`,
      `?role=engine&token=${encodeURIComponent(mintControllerToken(server.secret, s.id, 60_000))}`]) {
      const refused = openSocket(wsb(base), s.id, { role: "engine", token: s.engineToken }, query);
      expect(await refused.closed, query).toEqual({ code: 0, reason: "401" });
    }
    // and the socket anyone can open takes 16 KiB at most: a 7 MiB frame closes it unread (1009 "too big", or 1006
    // when the relay hung up before this side finished sending), never the 4002 of a hello that was read and parsed
    const ws = new WebSocket(`${wsb(base)}/ws/session/${s.id}`);
    await new Promise((r) => ws.on("open", r));
    const closed = new Promise<number>((r) => ws.on("close", (c: number) => r(c)));
    ws.on("error", () => {});
    ws.send(JSON.stringify({ t: "hello", role: "engine", token: "x", pad: "y".repeat(7 * 1024 * 1024) }));
    expect([1009, 1006]).toContain(await closed);
  });

  it("only a few sockets per address may wait for their hello; one that says hello or closes makes room", async () => {
    const base = await start();
    const s = await withEngine(base);
    const { pair } = await join(base, s, s.code, "x"); // its own socket said hello: not counted
    peer = "192.168.1.66";
    const idle: WebSocket[] = [];
    for (let i = 0; i < UNAUTHENTICATED_PER_ADDRESS; i++) {
      const ws = new WebSocket(`${wsb(base)}/ws/session/${s.id}`);
      await new Promise((r) => ws.on("open", r));
      idle.push(ws);
    }
    const refused = (address: string) => {
      peer = address;
      const ws = new WebSocket(`${wsb(base)}/ws/session/${s.id}`);
      return new Promise<number | "open">((r) => {
        ws.on("unexpected-response", (_q, res) => { r(res.statusCode ?? 0); ws.terminate(); });
        ws.on("open", () => { r("open"); idle.push(ws); });
        ws.on("error", () => {});
      });
    };
    expect(await refused("192.168.1.66")).toBe(429);
    expect(await refused("192.168.1.77")).toBe("open"); // another address is not held back
    // one closes: room for one more
    idle[0].close();
    await quiet();
    expect(await refused("192.168.1.66")).toBe("open");
    expect(await refused("192.168.1.66")).toBe(429);
    // one says hello: it no longer counts
    idle[1].send(JSON.stringify({ t: "hello", role: "view", token: pair.viewToken }));
    await quiet();
    expect(await refused("192.168.1.66")).toBe("open");
    for (const ws of idle) ws.terminate();
  });
});

describe("m3: a revoked device's controller token dies quickly", () => {
  it("lives 2 minutes, as the relay says when it hands one out", async () => {
    const clock = 1_000_000;
    const base = await start({ now: () => clock });
    const s = await withEngine(base);
    const { pair, paired } = await join(base, s, s.code, "pane");
    s.engine.send({ t: "pairDecision", id: paired.id, role: "controller" });
    await quiet();
    const r = (await (await post(base, `/api/session/${s.id}/engine-token`, {}, { Authorization: `Bearer ${pair.viewToken}` })).json()) as { engineToken: string; expiresInMs: number };
    expect(r.expiresInMs).toBe(120_000);
    expect(CONTROLLER_TOKEN_TTL_MS).toBe(120_000);
    expect(verifyControllerToken(server.secret, r.engineToken, clock + 119_000)?.sessionId).toBe(s.id);
    expect(verifyControllerToken(server.secret, r.engineToken, clock + 120_001)).toBeNull();
    // revoked: no new one
    s.engine.send({ t: "revoke", id: paired.id });
    await quiet();
    expect((await post(base, `/api/session/${s.id}/engine-token`, {}, { Authorization: `Bearer ${pair.viewToken}` })).status).toBe(401);
  });
});

describe("m7: an ack goes to the device that sent the command", () => {
  it("two devices that use the same id each get their own ack, and an id the engine made up reaches nobody", async () => {
    const base = await start();
    const s = await withEngine(base);
    const a = await join(base, s, s.code, "a");
    const b = await join(base, s, await freshCode(base, s), "b");
    await a.phone.next();
    await b.phone.next();
    a.phone.send({ t: "cmd", id: "1", cmd: { type: "nextSection" } });
    const fromA = await s.engine.nextOf("cmd");
    b.phone.send({ t: "cmd", id: "1", cmd: { type: "prevSection" } });
    const fromB = await s.engine.nextOf("cmd");
    expect(fromA.id).not.toBe(fromB.id);
    expect((fromA.from as { id: string }).id).toBe(a.paired.id);
    s.engine.send({ t: "ack", id: fromB.id, ok: false, error: "only for b" });
    expect(await b.phone.next()).toEqual({ t: "ack", id: "1", ok: false, error: "only for b" });
    s.engine.send({ t: "ack", id: "1", ok: true }); // the devices' own id means nothing to the relay
    s.engine.send({ t: "ack", id: "made-up", ok: true });
    s.engine.send({ t: "ack", id: fromB.id, ok: true }); // answered once already
    await quiet();
    expect(a.phone.inbox).toEqual([]);
    expect(b.phone.inbox).toEqual([]);
    s.engine.send({ t: "ack", id: fromA.id, ok: true });
    expect(await a.phone.next()).toEqual({ t: "ack", id: "1", ok: true });
    await quiet();
    expect(b.phone.inbox).toEqual([]);
  });
});

describe("m8: only this computer's own network counts as the Wi-Fi", () => {
  it("a WSL, VM or Docker address is private but not the Wi-Fi: it waits for the presenter like anyone else", async () => {
    const base = await start({ lanCidr: () => "192.168.1.10/24" });
    for (const [address, role] of [["172.20.0.5", "pending"], ["172.17.0.2", "pending"], ["10.0.0.7", "pending"], ["192.168.2.20", "pending"], ["192.168.1.200", "controller"], ["::ffff:192.168.1.21", "controller"]] as const) {
      peer = address;
      const s = await create(base);
      expect(((await (await post(base, "/api/session/pair", { code: s.code })).json()) as { role: string }).role, address).toBe(role);
    }
  });

  it("with no LAN address known, nobody is accepted without a prompt", async () => {
    const base = await start({ lanCidr: () => null });
    const s = await create(base);
    expect(((await (await post(base, "/api/session/pair", { code: s.code })).json()) as { role: string }).role).toBe("pending");
  });

  it("reads a subnet as a subnet", () => {
    expect(inCidr("192.168.1.20", "192.168.1.10/24")).toBe(true);
    expect(inCidr("192.168.2.20", "192.168.1.10/24")).toBe(false);
    expect(inCidr("10.1.2.3", "10.0.0.1/8")).toBe(true);
    expect(inCidr("172.20.0.5", "172.20.0.1/20")).toBe(true);
    expect(inCidr("172.20.16.5", "172.20.0.1/20")).toBe(false);
    expect(inCidr("192.168.1.20", "192.168.1.20/32")).toBe(true);
    expect(inCidr("192.168.1.21", "192.168.1.20/32")).toBe(false);
    for (const bad of [null, undefined, "", "192.168.1.10", "192.168.1.10/0", "192.168.1.10/33", "fe80::1/64", "x/24"]) expect(inCidr("192.168.1.20", bad)).toBe(false);
    expect(inCidr(undefined, "192.168.1.10/24")).toBe(false);
    expect(inCidr("::1", "192.168.1.10/24")).toBe(false);
  });
});
