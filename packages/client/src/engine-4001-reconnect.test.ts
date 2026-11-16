// C18: the engine's client gives up for good when the relay refuses its reconnect with 4001
// while the old, half-open engine socket is still OPEN on the relay.
import { afterEach, describe, expect, it } from "vitest";
import net from "node:net";
import WebSocket from "ws";
import { createSessionServer, type SessionServer } from "../../../apps/server/src/server";
import { connect, type SessionClient } from "./index";

let server: SessionServer;
let proxy: net.Server;
let client: SessionClient | null = null;
const closeCodes: number[] = [];
class Recording extends WebSocket {
  constructor(url: string) {
    super(url);
    this.addEventListener("close", (ev) => closeCodes.push(ev.code));
  }
}
const WS = Recording as unknown as typeof globalThis.WebSocket;

/** A loopback TCP hop standing in for the network between the laptop and a hosted relay. */
const pairs: Array<{ down: net.Socket; up: net.Socket }> = [];
afterEach(async () => {
  client?.close();
  for (const p of pairs) { p.down.destroy(); p.up.destroy(); }
  pairs.length = 0;
  closeCodes.length = 0;
  await new Promise<void>((r) => proxy.close(() => r()));
  await server.close();
});

const waitFor = (ok: () => boolean, ms: number) =>
  new Promise<boolean>((resolve) => {
    const t0 = Date.now();
    const tick = () => (ok() ? resolve(true) : Date.now() - t0 > ms ? resolve(false) : setTimeout(tick, 10));
    tick();
  });

describe("engine reconnect after a network break (C18)", () => {
  it("keeps retrying after a 4001 refusal and takes the session back once the relay dropped the old socket", async () => {
    // Keepalive far away: the relay still thinks the old engine socket is OPEN (its real ping is 15 s).
    server = createSessionServer({ pingMs: 60_000 });
    await new Promise<void>((r) => server.httpServer.listen(0, "127.0.0.1", r));
    const upPort = server.address().port;
    proxy = net.createServer((down) => {
      const up = net.connect(upPort, "127.0.0.1");
      // A broken network carries no FIN to the relay: only the laptop side sees the break.
      down.on("error", () => undefined);
      up.on("error", () => undefined);
      down.on("data", (d) => up.write(d));
      up.on("data", (d) => { if (!down.destroyed) down.write(d); });
      up.on("close", () => down.destroy());
      pairs.push({ down, up });
    });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
    const serverUrl = `http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`;
    const created = (await (await fetch(`http://127.0.0.1:${upPort}/api/session`, { method: "POST" })).json()) as { id: string; engineToken: string };

    const statuses: string[] = [];
    client = await connect({
      serverUrl,
      session: { id: created.id, token: created.engineToken, role: "engine" },
      WebSocketImpl: WS,
      onStatus: (s, d) => statuses.push(d ? `${s}: ${d}` : s),
    });
    expect(client.status).toBe("open");

    // The network breaks: the laptop's socket dies without a close frame reaching the relay.
    const first = pairs[0];
    first.down.removeAllListeners("data");
    first.down.destroy();

    // The client retries after 500 ms; the relay still holds the old socket OPEN and answers 4001.
    expect(await waitFor(() => closeCodes.includes(4001), 3000)).toBe(true);

    // Now the relay's keepalive drops the old socket (simulated: its TCP connection ends).
    first.up.destroy();

    // Contract (ConnectOptions.reconnect, ARCHITECTURE 5.4 / risk table): the engine reconnects and takes the session back.
    const back = await waitFor(() => client!.status === "open", 4000);
    expect({ back, statuses }).toEqual({ back: true, statuses: expect.any(Array) });
  }, 15_000);
});
