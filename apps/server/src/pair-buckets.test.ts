// C9: a request refused by its own per-address limit must not spend the shared pairing bucket.
import { afterEach, expect, it } from "vitest";
import { createSessionServer, type SessionServer } from "./server";

let server: SessionServer;
afterEach(async () => {
  await server?.close();
});

it("one tunnel visitor posting wrong codes cannot lock a phone at another address out of pairing", async () => {
  // Shipped defaults: 10 per address, 60 per bucket. Tunnel on: cloudflared on this computer, TRUST_PROXY.
  server = createSessionServer({ now: () => 1_000_000, pingMs: 60_000, trustProxy: true, remoteAddress: () => "127.0.0.1" });
  await new Promise<void>((r) => server.httpServer.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const { code } = (await (await post("/api/session", {})).json()) as { code: string };

  const statuses: number[] = [];
  for (let i = 0; i < 61; i++) statuses.push((await post("/api/session/pair", { code: "AAAAAAAA" }, { "cf-connecting-ip": "203.0.113.66" })).status);
  expect(statuses.slice(0, 10).every((s) => s === 404)).toBe(true);
  expect(statuses.slice(10).every((s) => s === 429)).toBe(true); // the attacker is held by its own limit

  const phone = await post("/api/session/pair", { code }, { "cf-connecting-ip": "198.51.100.7" });
  expect(phone.status).toBe(200);
});
