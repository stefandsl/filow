import assert from "node:assert/strict";
import { it } from "vitest";
import { cloudLabServer } from "./n04-windows.mjs";

it("counts one served top-level lesson document independently of other requests", async () => {
  const arrivals: unknown[] = [];
  const server = cloudLabServer({ temperature: 26, dew: 14, arrival: (row: unknown) => arrivals.push(row) });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    const root = `http://127.0.0.1:${addr.port}`;
    const get = (url: string, dest: string) => fetch(root + url, { headers: { "sec-fetch-dest": dest } });
    assert.equal((await get("/favicon.ico", "image")).status, 404);
    const page = await get("/lesson/cloud-lab", "document");
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /aria-valuetext="26 °C"/);
    assert.match(html, /aria-label="Dew point">14 °C/);
    await get("/lesson/cloud-lab", "iframe");
    assert.equal(arrivals.length, 1);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
