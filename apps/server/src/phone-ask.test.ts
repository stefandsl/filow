import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createSessionServer, PHONE_ASK_OFF, type SessionServer } from "./server";

// "Ask OK Filow" on a paired phone is switched off until it is secured: the session server refuses
// the question from every phone, controllers included, and never relays it to the computer. A viewer,
// a phone still waiting for the presenter and a stranger never get anything through either.
let server: SessionServer;
afterEach(() => server.close());

async function start(autoAcceptLan: boolean) {
  server = createSessionServer({ now: () => 1_000_000, pairLimitPerMinute: 10, pingMs: 60_000, autoAcceptLan });
  await new Promise<void>((r) => server.httpServer.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${server.address().port}`;
}
type Msg = Record<string, unknown>;
function open(base: string, id: string, hello: Msg) {
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
  const closed = new Promise<{ code: number }>((r) => ws.on("close", (code) => r({ code })));
  ws.on("open", () => ws.send(JSON.stringify({ t: "hello", ...hello })));
  return { ws, next, closed, send: (m: Msg) => ws.send(JSON.stringify(m)), inbox };
}
const post = (base: string, path: string, body: unknown = {}) =>
  fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const ask = { type: "askOkFilow", text: "What is on the slide?" };

describe("a phone's question for OK Filow on the session server", () => {
  it("is refused even from a paired controller, while the controller's other commands still reach the computer", async () => {
    const base = await start(true);
    const { id, code, engineToken } = (await (await post(base, "/api/session")).json()) as { id: string; code: string; engineToken: string };
    const engine = open(base, id, { role: "engine", token: engineToken });
    expect((await engine.next()).t).toBe("welcome");
    engine.send({ t: "state", version: 1, state: { version: 1 } });
    const pair = (await (await post(base, "/api/session/pair", { code })).json()) as { viewToken: string; role: string };
    expect(pair.role).toBe("controller");
    const phone = open(base, id, { role: "view", token: pair.viewToken });
    await phone.next();
    await phone.next();
    expect(PHONE_ASK_OFF).toBe("okfilow:phone-off");
    phone.send({ t: "cmd", id: "q1", cmd: ask });
    expect(await phone.next()).toEqual({ t: "ack", id: "q1", ok: false, error: PHONE_ASK_OFF });
    // any shape of it: no text, extra fields
    phone.send({ t: "cmd", id: "q2", cmd: { type: "askOkFilow", text: 42, source: "phone" } });
    expect(await phone.next()).toEqual({ t: "ack", id: "q2", ok: false, error: PHONE_ASK_OFF });
    // a stage command after it still goes through, and is the first command the computer sees
    phone.send({ t: "cmd", id: "n1", cmd: { type: "nextSection" } });
    expect(await engine.next()).toMatchObject({ t: "cmd", id: "n1", cmd: { type: "nextSection" } });
    expect(engine.inbox.filter((m) => m.t === "cmd")).toEqual([]);
    engine.ws.close();
    phone.ws.close();
  });

  it("never reaches the computer from a viewer, a waiting phone or a stranger", async () => {
    const base = await start(false);
    const { id, code, engineToken } = (await (await post(base, "/api/session")).json()) as { id: string; code: string; engineToken: string };
    const engine = open(base, id, { role: "engine", token: engineToken });
    await engine.next();
    engine.send({ t: "state", version: 1, state: { version: 1 } });
    const pair = (await (await post(base, "/api/session/pair", { code })).json()) as { viewToken: string; role: string };
    expect(pair.role).toBe("pending");
    const phone = open(base, id, { role: "view", token: pair.viewToken });
    await phone.next(); // welcome
    phone.send({ t: "cmd", id: "w", cmd: ask });
    let reply = await phone.next();
    while (reply.t !== "ack") reply = await phone.next();
    expect(reply).toMatchObject({ t: "ack", id: "w", ok: false, error: "waiting for the presenter" });
    // the presenter makes it a viewer: still no questions
    engine.send({ t: "setRole", token: pair.viewToken, role: "viewer" });
    await new Promise((r) => setTimeout(r, 50));
    phone.send({ t: "cmd", id: "v", cmd: ask });
    reply = await phone.next();
    while (reply.t !== "ack") reply = await phone.next();
    expect(reply).toMatchObject({ t: "ack", id: "v", ok: false, error: PHONE_ASK_OFF });
    const stranger = open(base, id, { role: "view", token: "not-a-pairing" });
    expect((await stranger.closed).code).toBe(4002);
    await new Promise((r) => setTimeout(r, 50));
    // nothing the engine received was a question
    const seen = engine.inbox.splice(0);
    expect(seen.filter((m) => m.t === "cmd")).toEqual([]);
    engine.ws.close();
    phone.ws.close();
  });
});
