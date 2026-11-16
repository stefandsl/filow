import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { openSocket } from "../test/sockets";
import { createSessionServer, type SessionServer } from "./server";

// Claim C4: in desktop LAN mode the app's own floating windows reach the relay at this PC's LAN IP
// (preload sessionUrl), so the per-launch app key is ignored and they pair as an unapproved Wi-Fi phone.
const LAN_IP = "192.168.1.10"; // this PC's own LAN address (FILOW_LAN_IP)
const APP_KEY = "k".repeat(32);
let server: SessionServer;
afterEach(async () => {
  await server?.close();
});

/** What the preload gives the page as sessionUrl in LAN mode (preload.js run as-is with a stub electron). */
function preloadSessionUrl(env: Record<string, string>): string {
  let exposed: Record<string, unknown> = {};
  const src = readFileSync(new URL("../../desktop/preload.js", import.meta.url), "utf8");
  const electron = { contextBridge: { exposeInMainWorld: (_k: string, v: Record<string, unknown>) => (exposed = v) }, ipcRenderer: { on() {}, send() {}, invoke() {}, removeListener() {} } };
  vm.runInNewContext(src, { require: (m: string) => (m === "electron" ? electron : {}), process: { env, platform: "win32" }, console });
  return exposed.sessionUrl as string;
}

describe("the app's own floating window in desktop LAN mode", () => {
  it("pairs as the app (peer app, approved, 'Filow window') when it reaches the relay at the PC's LAN IP", async () => {
    // main.js startServers (LAN mode) sets these; the preload builds the floating window's relay URL from them.
    const env = { FILOW_LAN_IP: LAN_IP, SESSION_PORT: "4748", FILOW_APP_PAIR_KEY: APP_KEY, PORT: "4747" };
    const url = preloadSessionUrl(env);
    expect(url).toBe(`http://${LAN_IP}:4748`); // so the window's TCP peer address at the relay is LAN_IP, not 127.0.0.1

    server = createSessionServer({
      now: () => Date.now(), pingMs: 60_000, autoAcceptLan: true, appPairKey: APP_KEY,
      lanCidr: () => "192.168.1.10/24", // lanCidrFromEnv(): the LAN IP with its interface prefix
      remoteAddress: () => new URL(url).hostname, // a socket from this PC to its own LAN IP has that IP as source
    });
    await new Promise<void>((r) => server.httpServer.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (path: string, body: unknown = {}) =>
      fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

    const created = (await (await post("/api/session")).json()) as { id: string; code: string; engineToken: string };
    const engine = openSocket(base.replace("http", "ws"), created.id, { role: "engine", token: created.engineToken }, "?role=engine");
    await engine.next();
    // What packages/client pair() sends from the overlay / points window: the code, its default label and the app key.
    const r = (await (await post("/api/session/pair", { code: created.code, device: "Windows · Chrome", appKey: APP_KEY })).json()) as { role: string };
    const paired = await engine.nextMeta("paired");
    expect(r.role).toBe("controller");
    expect(paired).toMatchObject({ peer: "app", device: "Filow window", role: "controller" });
  });
});
