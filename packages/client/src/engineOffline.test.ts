// A paired view against the real relay: when the engine's socket closes while the relay stays up, the relay
// tells the views {t:"engineOffline"} (apps/server/src/server.ts:726). ARCHITECTURE.md (§5.8, failure table):
// views keep the last state with an "engine offline" banner. The mirror computes that banner from what the
// client reports: offline = status.startsWith("connecting") || !state (apps/web/app/mirror/page.tsx:186).
import { afterEach, expect, it } from "vitest";
import WebSocket from "ws";
import { createSessionServer, type SessionServer } from "../../../apps/server/src/server";
import { connect, type SessionClient } from "./index";

let server: SessionServer;
const clients: SessionClient[] = [];
/** Raw frames that reached the view's socket (listener registered before the client's onmessage). */
const viewFrames: string[] = [];
class Recording extends WebSocket {
  constructor(url: string) {
    super(url);
    if (!url.includes("role=engine")) this.addEventListener("message", (ev) => viewFrames.push(String(ev.data)));
  }
}
const WS = Recording as unknown as typeof globalThis.WebSocket;
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await server?.close();
  viewFrames.length = 0;
});
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(ok()).toBe(true);
};

it("a view learns that the engine went offline (the mirror's 'engine offline' banner)", async () => {
  server = createSessionServer({ pingMs: 60_000, autoAcceptLan: true, lanCidr: () => "192.168.1.0/24", remoteAddress: () => "192.168.1.20" });
  await new Promise<void>((r) => server.httpServer.listen(0, "127.0.0.1", r));
  const serverUrl = `http://127.0.0.1:${server.address().port}`;
  const s = (await (await fetch(`${serverUrl}/api/session`, { method: "POST" })).json()) as { id: string; code: string; engineToken: string };

  const engine = await connect({ serverUrl, session: { id: s.id, token: s.engineToken, role: "engine" }, WebSocketImpl: WS, reconnect: false });
  engine.publishState({ version: 1, recording: true } as never);

  const statuses: string[] = [];
  const phone = await connect({ serverUrl, code: s.code, deviceLabel: "Pixel 8", WebSocketImpl: WS, onStatus: (st, d) => statuses.push(d ? `${st}: ${d}` : st) });
  clients.push(phone);
  await until(() => phone.state !== null);
  const before = statuses.length;

  // The prompter window closes/reloads/crashes: the engine's socket closes, the relay stays up.
  engine.close();
  await until(() => viewFrames.some((f) => f.includes('"engineOffline"')));
  await new Promise((r) => setTimeout(r, 0));

  // The relay told the phone; the client must pass it on.
  const mirrorStatus = statuses.at(-1)!;
  const offline = mirrorStatus.startsWith("connecting") || !phone.state;
  expect({ notified: statuses.length > before, offline }).toEqual({ notified: true, offline: true });
});
