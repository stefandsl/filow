// Contract: ARCHITECTURE.md:148 — {t:"ping"} / {t:"pong"} every 15 s, close after 2 missed.
// Only setInterval is faked (the relay's pinger); sockets use real loopback IO. No sleeps.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openSocket, type Msg } from "../test/sockets";
import { createSessionServer, type SessionServer } from "./server";

const PING = 15_000;
let server: SessionServer;
let base: string;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  server = createSessionServer({ now: () => Date.now(), pingMs: PING, autoAcceptLan: true, lanCidr: () => "192.168.1.0/24", remoteAddress: () => "192.168.1.20" });
  await new Promise<void>((r) => server.httpServer.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  await server.close();
  vi.useRealTimers();
});

const post = (path: string, body: unknown = {}) =>
  fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const open = (id: string, hello: Msg) => openSocket(base.replace("http", "ws"), id, hello);

/** Is the relay still serving this socket? Sends our own ping: a pong means open, a close means dropped. */
async function stillOpen(s: ReturnType<typeof open>) {
  s.send({ t: "ping" });
  return Promise.race([s.nextOf("pong").then(() => true), s.closed.then(() => false)]);
}

describe("relay keepalive", () => {
  it("keeps an engine that missed only one ping", async () => {
    const { id, engineToken } = (await (await post("/api/session")).json()) as { id: string; engineToken: string };
    const engine = open(id, { role: "engine", token: engineToken });
    expect((await engine.next()).t).toBe("welcome");

    vi.advanceTimersByTime(PING); // ping #1, engine stays silent (missed one)
    expect(await engine.nextOf("ping")).toMatchObject({ t: "ping" });
    vi.advanceTimersByTime(PING); // one missed ping so far: must not be closed yet
    expect(await stillOpen(engine), "engine closed after a single missed pong").toBe(true);
  });

  it("drops an engine after two missed pings in a row", async () => {
    const { id, engineToken } = (await (await post("/api/session")).json()) as { id: string; engineToken: string };
    const engine = open(id, { role: "engine", token: engineToken });
    expect((await engine.next()).t).toBe("welcome");
    const pingOrClose = () => Promise.race([engine.nextOf("ping").then(() => "ping"), engine.closed.then(() => "closed")]);
    vi.advanceTimersByTime(PING);
    expect(await pingOrClose()).toBe("ping");
    vi.advanceTimersByTime(PING);
    expect(await pingOrClose()).toBe("ping");
    vi.advanceTimersByTime(PING); // two pings unanswered: closed now
    expect(await stillOpen(engine)).toBe(false);
  });

  it("keeps a phone that missed only one ping", async () => {
    const { id, code, engineToken } = (await (await post("/api/session")).json()) as { id: string; code: string; engineToken: string };
    const engine = open(id, { role: "engine", token: engineToken });
    expect((await engine.next()).t).toBe("welcome");
    engine.ws.on("message", (d) => { if (JSON.parse(String(d)).t === "ping") engine.send({ t: "pong" }); });

    const pair = (await (await post("/api/session/pair", { code })).json()) as { viewToken: string };
    const view = open(id, { role: "view", token: pair.viewToken });
    expect((await view.next()).t).toBe("welcome");

    vi.advanceTimersByTime(PING); // ping #1, phone tab throttled: no pong
    expect(await view.nextOf("ping")).toMatchObject({ t: "ping" });
    vi.advanceTimersByTime(PING);
    expect(await stillOpen(view), "phone closed after a single missed pong").toBe(true);
  });
});
