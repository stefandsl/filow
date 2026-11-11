// Cleaning up English dictations with S1-mini by Superwhisper (docs/dictation/S1-MINI.md): the request the
// model card asks for, which dictations may be cleaned, the checks on the answer, the time budget, and
// the whole thing through dictation.js's real insert().
import http from "node:http";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
type Clean = { used: boolean; text?: string; reason: string; ms: number; asked: boolean };
const cleanup = require("./dictation-cleanup.js") as {
  SYSTEM: string; NAME: string;
  controlLine(o?: Record<string, unknown>): string;
  buildRequest(t: string, o?: Record<string, unknown>): { messages: Array<{ role: string; content: string }>; temperature: number; max_tokens: number; chat_template_kwargs: { enable_thinking: boolean } };
  decide(o: Record<string, unknown>): { clean: boolean; reason: string };
  acceptCleaned(raw: string, cleaned: string, o?: Record<string, unknown>): { ok: boolean; reason: string; text?: string };
  createCleaner(o: Record<string, unknown>): { clean(raw: string, o?: Record<string, unknown>): Promise<Clean> };
};
const { createDictation } = require("./dictation.js") as { createDictation(deps: Record<string, unknown>): { insert(raw: string, o: Record<string, unknown>): Promise<{ action: string; chars: number }>; reportText(): string } };
const { createS1Runtime, MODEL } = require("./s1-runtime.js") as { createS1Runtime(d: Record<string, unknown>): { ready(): { ok: boolean; reason: string }; run(body: unknown, signal?: AbortSignal): Promise<string>; stop(): void; status(): Record<string, unknown> }; MODEL: { bytes: number; sha256: string } };

describe("S1-mini: the request", () => {
  it("is the model card's: exact system prompt, control line, thinking off, temperature 0, answer sized to the input", () => {
    const r = cleanup.buildRequest("so um send the report by uh friday", { style: "formal", lists: true });
    expect(r.messages[0]).toEqual({ role: "system", content: "You are a text normalizer for speech-to-text transcripts. The input begins with a control line specifying the styling, structure, and context settings; clean the transcript to match those settings and output only the cleaned text." });
    expect(r.messages[1].content).toBe("[Styling: formal] [Structure: lists] [Context: general]\nso um send the report by uh friday");
    expect(r.temperature).toBe(0);
    expect(r.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(r.max_tokens).toBeGreaterThan(32);
    expect(r.max_tokens).toBeLessThan(80);
    // A value the model was not trained on never reaches it.
    expect(cleanup.controlLine({ style: "shouting" })).toBe("[Styling: semi-formal] [Structure: prose] [Context: general]");
    expect(cleanup.NAME).toBe("S1-mini by Superwhisper");
  });
});

describe("S1-mini: which dictations may be cleaned", () => {
  it("English only: the chosen language, or the one the recognizer listened in; undecided is no", () => {
    expect(cleanup.decide({ enabled: true, language: "en", text: "hello there" }).clean).toBe(true);
    expect(cleanup.decide({ enabled: true, language: "auto", spokenLanguage: "en", text: "hello there" }).clean).toBe(true);
    for (const lang of ["it", "ru", "ro", "ja"]) expect(cleanup.decide({ enabled: true, language: lang, text: "ciao" })).toEqual({ clean: false, reason: `language ${lang}` });
    expect(cleanup.decide({ enabled: true, language: "auto", spokenLanguage: "it", text: "la riunione comincia domani" }).clean).toBe(false);
    expect(cleanup.decide({ enabled: true, language: "auto", spokenLanguage: "", text: "hello" })).toEqual({ clean: false, reason: "language not known" });
    expect(cleanup.decide({ enabled: false, language: "en", text: "hello" }).reason).toBe("off");
    // Said to be English, but the words are not: never sent.
    expect(cleanup.decide({ enabled: true, language: "en", text: "встреча начинается завтра" }).clean).toBe(false);
    expect(cleanup.decide({ enabled: true, language: "en", text: "会議は明日です" }).clean).toBe(false);
    expect(cleanup.decide({ enabled: true, language: "en", text: "word ".repeat(700) }).reason).toBe("too long");
  });
});

describe("S1-mini: the answer must be the same message, cleaned", () => {
  const ok = (raw: string, out: string, o?: Record<string, unknown>) => cleanup.acceptCleaned(raw, out, o);
  it("accepts the model card's own examples", () => {
    expect(ok("so um i need to like send the the report by uh friday no wait make that thursday", "I need to send the report by Thursday.").ok).toBe(true);
    expect(ok("i think the answer is forty two no sorry forty three", "I think the answer is 43.").ok).toBe(true);
    expect(ok("the invoice came to twenty three thousand four hundred and fifty dollars and it's due on march third twenty twenty six", "The invoice came to $23,450, and it's due on March 3, 2026.").ok).toBe(true);
    expect(ok("send it to support at superwhisper dot com", "Send it to support@superwhisper.com.").ok).toBe(true);
    expect(ok("hmm im gonna be late theres a cute dog outside i cant just walk past him", "I am going to be late. There is a cute dog outside. I cannot just walk past him.").ok).toBe(true);
    expect(ok("let's meet at half past two tomorrow uh actually make it three fifteen p m", "Let's meet at 3:15pm tomorrow.").ok).toBe(true);
  });
  it("refuses an empty answer, an echo of the control line or the template, and line breaks in prose", () => {
    expect(ok("send the report", "")).toMatchObject({ ok: false, reason: "empty answer" });
    expect(ok("send the report", "[Styling: semi-formal] [Structure: prose] [Context: general]\nSend the report.").reason).toBe("echo");
    expect(ok("send the report", "<think>\n\n</think>\n\nSend the report.").reason).toBe("echo");
    expect(ok("send the report today", "Send the report\ntoday.").reason).toBe("layout");
    expect(ok("we need sunscreen a first aid kit and chargers", "We need:\n- Sunscreen\n- A first aid kit\n- Chargers", { lists: true }).ok).toBe(true);
  });
  it("refuses an answer that says more, far less, or something else", () => {
    expect(ok("send the report", "Send the report. Also, I wanted to let you know that the quarterly numbers look great this time around.").reason).toBe("too long");
    expect(ok("please remind maria that the budget review moved to the second floor meeting room on tuesday afternoon", "OK.").reason).toBe("too short");
    expect(ok("send the report to maria on friday", "Deliver the document to Giulia next Monday morning.").reason).toBe("new words");
    // An answer to the dictation instead of the dictation (the model is not a chat model, but still).
    expect(ok("what is the capital of france", "The capital of France is Paris.").ok).toBe(true); // one new word is within the bound...
    expect(ok("what is the capital of france", "Paris is a beautiful city on the Seine river.").reason).toBe("new words"); // ...a new sentence is not
  });
});

describe("S1-mini: the time budget and failures", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("an answer inside the budget is used; a late one is dropped and the request is aborted", async () => {
    let aborted = false;
    const slow = (ms: number) => (_b: unknown, signal: AbortSignal) => new Promise<string>((res) => { signal.addEventListener("abort", () => { aborted = true; }); setTimeout(() => res("Send the report."), ms); });
    const fast = cleanup.createCleaner({ run: slow(200), budgetMs: () => 700 }).clean("send the report", { language: "en" });
    await vi.advanceTimersByTimeAsync(250);
    expect(await fast).toMatchObject({ used: true, text: "Send the report.", asked: true });
    const late = cleanup.createCleaner({ run: slow(2000), budgetMs: () => 700 }).clean("send the report", { language: "en" });
    await vi.advanceTimersByTimeAsync(800);
    expect(await late).toMatchObject({ used: false, reason: "slower than 700 ms" });
    expect(aborted).toBe(true);
  });
  it("a runtime that is missing or fails never throws: the raw words go in and the reason is kept", async () => {
    const calls: string[] = [];
    const missing = await cleanup.createCleaner({ run: async () => { calls.push("run"); return "x"; }, ready: () => ({ ok: false, reason: "model not on this computer" }) }).clean("send the report", { language: "en" });
    expect(missing).toMatchObject({ used: false, reason: "model not on this computer", asked: false });
    expect(calls).toEqual([]);
    const broken = await cleanup.createCleaner({ run: async () => { throw new Error("connect ECONNREFUSED 127.0.0.1"); } }).clean("send the report", { language: "en" });
    expect(broken.used).toBe(false);
    expect(broken.reason).toContain("runtime error");
    // Italian: the runtime is not even asked.
    const it2 = await cleanup.createCleaner({ run: async () => { calls.push("run"); return "x"; } }).clean("la riunione comincia domani", { language: "it" });
    expect(it2).toMatchObject({ used: false, asked: false });
    expect(calls).toEqual([]);
  });
});

class FakeItem { constructor(public data: Record<string, unknown>) {} get types() { return Object.keys(this.data); } async getType(t: string) { return this.data[t]; } }
function dictation(settings: Record<string, unknown>, answer: (said: string) => string) {
  const st = { items: [new FakeItem({ "text/plain": "theirs" })] as FakeItem[] };
  const pasted: string[] = []; const asked: string[] = []; const log: string[] = [];
  const d = createDictation({
    getSettings: () => ({ dictation: { v: 2, ...settings } }), saveSettings: () => {}, logLine: (l: string) => log.push(l),
    clipboard: { read: async () => st.items, readText: async () => String(st.items[0]?.data["text/plain"] ?? ""), write: async (i: FakeItem[]) => { st.items = i; }, writeText: async () => {}, clear: async () => {} },
    ClipboardItem: FakeItem, BrowserWindow: { getFocusedWindow: () => null },
    sendPaste: () => { pasted.push(String(st.items[0]?.data["text/plain"])); },
    cleaner: cleanup.createCleaner({ run: async (body: { messages: Array<{ content: string }> }) => { const said = body.messages[1].content.split("\n")[1]; asked.push(said); return answer(said); } }),
    cleanupStatus: () => ({ model: true, runtime: true, running: true, startedMs: 900, error: "" }),
    platform: "linux", env: {},
  });
  return { d, pasted, asked, log };
}

describe("S1-mini in a dictation", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const go = async (m: ReturnType<typeof dictation>, raw: string, o: Record<string, unknown> = {}) => { (m.d as unknown as { diag: { begin(k: string): void } }).diag.begin("hold"); const r = m.d.insert(raw, { hook: {}, ...o }); await vi.advanceTimersByTimeAsync(500); return r; };

  it("an English dictation is typed as the model wrote it, and the report has the stage without the words", async () => {
    const m = dictation({ language: "en" }, () => "I need to send the report by Thursday.");
    await go(m, "so um i need to like send the the report by uh friday no wait make that thursday");
    expect(m.pasted).toEqual(["I need to send the report by Thursday."]);
    expect(m.asked).toEqual(["so um i need to like send the the report by uh friday no wait make that thursday"]); // the raw words, fillers included
    const report = m.d.reportText();
    expect(report).toMatch(/cleanup used \(\d+ ms\)/);
    expect(report).toContain("cleanup (English only): S1-mini by Superwhisper, on, style semi-formal, lists off; model on this computer, runtime in this build");
    expect(report).not.toContain("Thursday");
  });

  it("Italian, Russian, Romanian and Japanese dictations never reach the model and keep Filow's own cleanup", async () => {
    for (const [lang, said, typed] of [["it", "ehm la riunione comincia domani", "la riunione comincia domani"], ["ru", "встреча начинается завтра", "встреча начинается завтра"], ["ro", "ședința începe mâine", "ședința începe mâine"], ["ja", "会議は明日です", "会議は明日です"]]) {
      const m = dictation({ language: lang }, () => "TRANSLATED");
      await go(m, said);
      expect(m.asked).toEqual([]);
      expect(m.pasted).toEqual([typed]);
      expect(m.d.reportText()).toContain(`cleanup skipped (language ${lang})`);
    }
    // "auto" with a recognizer that listened in Italian: the same.
    const auto = dictation({}, () => "TRANSLATED");
    await go(auto, "la riunione comincia domani", { spokenLanguage: "it" });
    expect(auto.asked).toEqual([]);
  });

  it("an answer that fails the checks is dropped: the words go in with Filow's own filler removal", async () => {
    const m = dictation({ language: "en" }, () => "Sure! Here is a much longer text that the speaker never said at all, about something else entirely.");
    await go(m, "um send the report on friday");
    expect(m.pasted).toEqual(["send the report on friday"]);
    expect(m.d.reportText()).toMatch(/cleanup skipped \((too long|new words)/);
  });

  it("the switch off: nothing is asked", async () => {
    const m = dictation({ language: "en", cleanup: false }, () => "X");
    await go(m, "send the report");
    expect(m.asked).toEqual([]);
    expect(m.pasted).toEqual(["send the report"]);
  });
});

describe("S1-mini: the runtime (llama-server as a child process)", () => {
  it("says why it cannot run, starts on this computer only with a key, and returns the answer's text", async () => {
    const seen: { auth: string[]; bodies: unknown[]; args: string[] } = { auth: [], bodies: [], args: [] };
    const server = http.createServer((req, res) => {
      seen.auth.push(String(req.headers.authorization));
      if (req.url === "/health") { res.writeHead(200); return res.end('{"status":"ok"}'); }
      let data = ""; req.on("data", (c) => { data += c; }); req.on("end", () => { seen.bodies.push(JSON.parse(data)); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ choices: [{ message: { content: "Send the report." } }] })); });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
    let present = false;
    const rt = createS1Runtime({
      userData: "X:/profile", logLine: () => {}, serverFile: () => (present ? "X:/llama-server.exe" : ""), modelExists: () => present,
      spawn: (_exe: string, args: string[]) => { seen.args = args; return child; },
      // the stand-in listens on its own port: requests for the port Filow picked are sent there
      fetch: (url: string, init?: RequestInit) => fetch(String(url).replace(/127\.0\.0\.1:\d+/, `127.0.0.1:${port}`), init),
    });
    expect(rt.ready()).toEqual({ ok: false, reason: "runtime not in this build" });
    present = true;
    expect(rt.ready().ok).toBe(true);
    expect(await rt.run(cleanup.buildRequest("send the report"))).toBe("Send the report.");
    expect(seen.args).toEqual(expect.arrayContaining(["--host", "127.0.0.1", "--jinja", "--chat-template-kwargs", '{"enable_thinking":false}', "--temp", "0", "--api-key"]));
    const key = seen.args[seen.args.indexOf("--api-key") + 1];
    expect(key).toMatch(/^[0-9a-f]{48}$/);
    expect(seen.auth.at(-1)).toBe(`Bearer ${key}`);
    expect((seen.bodies[0] as { chat_template_kwargs: unknown }).chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(rt.status()).toMatchObject({ runtime: true, model: true, running: true });
    rt.stop();
    expect(child.kill).toHaveBeenCalled();
    server.close();
    expect(MODEL.bytes).toBe(484219808);
    expect(MODEL.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("S1-mini: Filow's own sample set (tools/dictation/s1-samples.json)", () => {
  it("has 40 English samples with exact expected text, and no sample in another language is ever sent", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const s = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "tools", "dictation", "s1-samples.json"), "utf8")) as { en: Array<{ said: string; want: string }>; it: string[]; ru: string[]; ro: string[]; ja: string[] };
    expect(s.en.length).toBeGreaterThanOrEqual(40);
    expect(s.it.length).toBeGreaterThanOrEqual(10);
    const sent: string[] = [];
    const cleaner = cleanup.createCleaner({ run: async (b: { messages: Array<{ content: string }> }) => { sent.push(b.messages[1].content); return ""; } });
    for (const lang of ["it", "ru", "ro", "ja"] as const) for (const said of s[lang]) {
      await cleaner.clean(said, { language: lang });
      await cleaner.clean(said, { language: "auto", spokenLanguage: lang });
      await cleaner.clean(said, { language: "auto" });
    }
    expect(sent).toEqual([]);
    // The expected English outputs themselves pass the safety net (else a perfect answer would be thrown away).
    const refused = s.en.filter((x) => x.want && !cleanup.acceptCleaned(x.said, x.want).ok).map((x) => `${x.said} -> ${cleanup.acceptCleaned(x.said, x.want).reason}`);
    expect(refused).toEqual([]);
  });
});