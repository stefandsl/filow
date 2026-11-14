import { afterEach, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { askOllama, type AskShape } from "./providers";
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
  const run = async (language = "en", signal?: AbortSignal, uiLanguage?: string, question = "Where?", shape?: AskShape) => {
    let raw = "";
    for await (const piece of askOllama({ question, images: [], screens: [{ index: 1, width: 1000, height: 1000 }], language, uiLanguage }, signal,
      { model: "fake", pictures: false, at: { base: "http://127.0.0.1:4995", headers: {}, server: null } }, shape)) raw += piece;
    return parseBuddyAnswer(raw, [{ index: 1, width: 1000, height: 1000 }]);
  };
  return { bodies, run };
}
const chunk = (content: string) => JSON.stringify({ message: { content }, done: true }) + "\n";
it.each(["", chunk(""), "CUT", chunk("[POINT:50,"), chunk("[POINT:1001,60:Button:screen1]"), chunk("[BOX:1,2,3:Button]")])("retries truly empty output once: %s", async output => {
  const { bodies, run } = await fixture([output]);
  const result = await run();
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toBe(bodies[1]);
  expect(result.text).toBe(t("local.noAnswer", "en"));
});
it("streams a successful retry", async () => {
  const { bodies, run } = await fixture([chunk("[POINT:50,"), chunk("Click here. [POINT:50,60:Button:screen1]")]);
  const result = await run();
  expect(bodies).toHaveLength(2); expect(result.text).toBe("Click here."); expect(result.points).toHaveLength(1);
});
it.each(["POINT:50,60", "BOX:50,60", "BOX:40,50,60,70", "CIRCLE:50,60,20", "ARROW:40,50,60,70", "UNDERLINE:40,50,60"])("accepts a valid mark without retry: %s", async tag => {
  const { bodies, run } = await fixture([chunk(`[${tag}:Button:screen1]`)]);
  const result = await run();
  expect(bodies).toHaveLength(1);
  expect(result.text).toBe("Button: here.");
  expect(result.points.length + result.marks.length).toBe(1);
});
it.each(LANGS)("builds labelled and unlabelled words in UI language %s", async lang => {
  const { bodies, run } = await fixture([chunk("[POINT:50,60:Button:screen1]"), chunk("[POINT:50,60]")]);
  const labelled = await run("en", undefined, lang);
  expect(labelled.text).toBe(t("local.pointerLabel", lang, {label:"Button"}));
  expect(labelled.appWordsLanguage).toBe(lang);
  expect((await run("en", undefined, lang)).text).toBe(t("local.pointerHere", lang));
  expect(bodies).toHaveLength(2);
});
it("logs app provenance without the label, and never for model words", async () => {
  const log = vi.fn(); vi.stubGlobal("__filowPerfLog", log);
  try {
    const { run } = await fixture([chunk("[POINT:50,60:Private label]"), chunk("Model sentence.")]);
    await run(); await run();
    expect(log.mock.calls).toEqual([["okfilow: answer words source=app reason=pointer-only run=-"]]);
  } finally { vi.unstubAllGlobals(); }
});
it("never retries or adds words after Stop", async () => {
  const { bodies, run } = await fixture([chunk("[POINT:50,60:Button]")]);
  const abort = new AbortController(); abort.abort();
  expect((await run("en", abort.signal)).text).toBe(""); expect(bodies).toHaveLength(0);
});
it("leaves internal tag-only and structured calls to their own validation", async () => {
  const { bodies, run } = await fixture([chunk("[POINT:50,60:Button]"), ""]);
  const point = await run("en", undefined, undefined, "Reply only [POINT:x,y:label:screenN]");
  expect(point.text).toBe(""); expect(point.appWordsLanguage).toBeUndefined(); expect(point.points).toHaveLength(1);
  expect((await run("en", undefined, undefined, "Internal", { system: "Return JSON", format: {} })).text).toBe("");
  expect(bodies).toHaveLength(2);
});
it("keeps model-written prose beside a mark", async () => {
  const { bodies, run } = await fixture([chunk("Click this. [BOX:50,60:Button]")]);
  const result = await run();
  expect(result.text).toBe("Click this."); expect(result.appWordsLanguage).toBeUndefined(); expect(bodies).toHaveLength(1);
});
it("keeps a valid mark when a second tag was left unfinished", async () => {
  const { bodies, run } = await fixture([chunk("[POINT:50,60:Button][BOX:10,")]);
  const result = await run();
  expect(result.text).toBe("Button: here."); expect(result.points).toHaveLength(1); expect(bodies).toHaveLength(1);
});
it("does not retry a spoken answer", async () => {
  const { bodies, run } = await fixture([chunk("Hello.")]);
  expect((await run()).text).toBe("Hello."); expect(bodies).toHaveLength(1);
});
it.each(LANGS)("explains exhaustion in %s", async lang => {
  const { run } = await fixture([""]);
  expect((await run(lang)).text).toBe(t("local.noAnswer", lang));
});
