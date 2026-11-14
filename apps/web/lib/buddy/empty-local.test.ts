import { afterEach, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { askOllama } from "./providers";
import { parseBuddyAnswer } from "./prompt";
import { LANGS, t } from "@filow/core";

const servers: Server[] = [];
afterEach(async () => { for (const s of servers.splice(0)) { s.closeAllConnections(); await new Promise<void>(r => s.close(() => r())); } });
async function fixture(outputs: string[]) {
  const bodies: string[] = [];
  const server = createServer(async (req, res) => {
    if (req.url === "/api/version") { res.setHeader("Connection", "close"); res.end(JSON.stringify({ version: "0.40.0" })); return; }
    let body = ""; for await (const part of req) body += part;
    bodies.push(body);
    const output = outputs[Math.min(bodies.length - 1, outputs.length - 1)];
    res.writeHead(200, { "Content-Type": "application/x-ndjson", Connection: "close" });
    if (output === "CUT") { res.flushHeaders(); setTimeout(() => res.destroy(), 10); return; }
    res.end(output);
  });
  servers.push(server);
  await new Promise<void>(r => server.listen(4995, "127.0.0.1", r));
  const run = async (language = "en", signal?: AbortSignal) => {
    let raw = "";
    for await (const piece of askOllama({ question: "Where?", images: [], screens: [{ index: 1, width: 1000, height: 1000 }], language }, signal,
      { model: "fake", pictures: false, at: { base: "http://127.0.0.1:4995", headers: {}, server: null } })) raw += piece;
    return parseBuddyAnswer(raw, [{ index: 1, width: 1000, height: 1000 }]);
  };
  return { bodies, run };
}
const chunk = (content: string) => JSON.stringify({ message: { content }, done: true }) + "\n";
it.each(["", chunk(""), "CUT", chunk("[POINT:50,60:Button:screen1]"), chunk("[POINT:50,")])("retries words-free output once: %s", async output => {
  const { bodies, run } = await fixture([output]);
  const result = await run();
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toBe(bodies[1]);
  expect(result.text).toBe(t("local.noAnswer", "en"));
  if (output.includes("Button")) expect(result.points[0]).toMatchObject({ x: 50, y: 60 });
});
it("streams the successful retry and preserves first-attempt marks", async () => {
  const { bodies, run } = await fixture([chunk("[POINT:50,60:Button:screen1]"), chunk("Click here.")]);
  const result = await run();
  expect(bodies).toHaveLength(2); expect(result.text).toBe("Click here."); expect(result.points).toHaveLength(1);
});
it("does not retry a spoken answer", async () => {
  const { bodies, run } = await fixture([chunk("Hello.")]);
  expect((await run()).text).toBe("Hello."); expect(bodies).toHaveLength(1);
});
it.each(LANGS)("explains exhaustion in %s", async lang => {
  const { run } = await fixture([""]);
  expect((await run(lang)).text).toBe(t("local.noAnswer", lang));
});
