// The session client against the real relay (apps/server): the engine's socket carries its token in the
// address, a command's sender comes with how it is connected, and a view learns whether the presenter
// accepted it on the computer.
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createSessionServer, type SessionServer } from "../../../apps/server/src/server";
import { connect, type CommandFrom, type SessionClient } from "./index";

let server: SessionServer;
let peer = "192.168.1.20";
const clients: SessionClient[] = [];
/** Every address the client opened a socket to. */
const opened: string[] = [];
class Recording extends WebSocket {
  constructor(url: string) {
    opened.push(url);
    super(url);
  }
}
const WS = Recording as unknown as typeof globalThis.WebSocket;
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await server?.close();
  peer = "192.168.1.20";
  opened.length = 0;
});
async function start() {
  server = createSessionServer({ pingMs: 60_000, autoAcceptLan: true, lanCidr: () => "192.168.1.0/24", remoteAddress: () => peer });
  await new Promise<void>((r) => server.httpServer.listen(0, "127.0.0.1", r));
  const serverUrl = `http://127.0.0.1:${server.address().port}`;
  const created = (await (await fetch(`${serverUrl}/api/session`, { method: "POST" })).json()) as { id: string; code: string; engineToken: string };
  return { serverUrl, ...created };
}
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(ok()).toBe(true);
};

describe("the session client", () => {
  it("opens the engine's socket with the engine token in its address, and a device's without any", async () => {
    const s = await start();
    const engine = await connect({ serverUrl: s.serverUrl, session: { id: s.id, token: s.engineToken, role: "engine" }, WebSocketImpl: WS, reconnect: false });
    clients.push(engine);
    expect(engine.status).toBe("open");
    expect(opened).toEqual([`${s.serverUrl.replace("http", "ws")}/ws/session/${s.id}?role=engine&token=${encodeURIComponent(s.engineToken)}`]);
    const phone = await connect({ serverUrl: s.serverUrl, code: s.code, deviceLabel: "Pixel 8", WebSocketImpl: WS, reconnect: false });
    clients.push(phone);
    expect(opened[1]).toBe(`${s.serverUrl.replace("http", "ws")}/ws/session/${s.id}`);
    // a wrong token never gets a socket
    await expect(connect({ serverUrl: s.serverUrl, session: { id: s.id, token: "nope", role: "engine" }, WebSocketImpl: WS, reconnect: false })).rejects.toThrow();
  });

  it("tells the engine who sent a command and how that device is connected, and the device whether it was accepted on the computer", async () => {
    const s = await start();
    const engine = await connect({ serverUrl: s.serverUrl, session: { id: s.id, token: s.engineToken, role: "engine" }, WebSocketImpl: WS, reconnect: false });
    clients.push(engine);
    const seen: Array<CommandFrom | undefined> = [];
    engine.onCommand((_cmd, ack, from) => { seen.push(from); ack({ ok: true }); });
    engine.publishState({ version: 1 } as never);
    const said: Array<{ canAsk: boolean; approved: boolean }> = [];
    const watch = await connect({ serverUrl: s.serverUrl, session: { id: s.id, token: s.engineToken, role: "engine" }, WebSocketImpl: WS, reconnect: false }).catch(() => null);
    expect(watch).toBeNull(); // one engine at a time
    const phone = await connect({ serverUrl: s.serverUrl, code: s.code, deviceLabel: "Pixel 8", WebSocketImpl: WS, reconnect: false, onPermissions: (p) => said.push(p) });
    clients.push(phone);
    // auto-accepted on the Wi-Fi: a controller the presenter has not accepted yet
    expect(phone.role).toBe("controller");
    expect(phone.approved).toBe(false);
    expect(said.at(-1)).toEqual({ canAsk: false, approved: false });
    expect(await phone.send({ type: "nextSection" })).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ id: expect.any(String), device: "Pixel 8", peer: "lan" });
    expect(await phone.send({ type: "lookNow" } as never)).toEqual({ ok: false, error: "remote:approve-first" });
    // the presenter accepts it on the computer
    const pairing = seen[0]!.id;
    engine.decidePair(pairing, "controller");
    await until(() => phone.approved);
    expect(said.at(-1)).toEqual({ canAsk: false, approved: true });
    expect(await phone.send({ type: "lookNow" } as never)).toEqual({ ok: true });
    engine.allowAsk(pairing, true);
    await until(() => phone.canAsk);
    // a permissions message says nothing of the accept: it stays as it was
    expect(said.at(-1)).toEqual({ canAsk: true, approved: true });
  });
});
