import { afterEach, describe, expect, it, vi } from "vitest";
import { askOllama, type BuddyAskRequest, type LocalHelper } from "./providers";
import { createServerTiming, logServerTiming, mark, serverTimingLine, takeOllamaDone, type ServerTiming } from "./timing";

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { __filowPerfLog?: unknown }).__filowPerfLog;
});

describe("server timing (the speed baseline's server marks)", () => {
  it("measures only a request that names its run, the answer or its grounding request", () => {
    for (const bad of [null, undefined, "", "abc", "7; rm", "7gg", "-1", "1234567890"]) expect(createServerTiming(bad), String(bad)).toBeNull();
    expect(createServerTiming("7", 1000)).toEqual({ run: "7", marks: { received: 1000 }, ollama: {} });
    expect(createServerTiming(" 12g ", 5)?.run).toBe("12g");
  });

  it("keeps the first time of each mark", () => {
    const t = createServerTiming("3", 100)!;
    mark(t, "ollamaFirstByte", 400);
    mark(t, "ollamaFirstByte", 900);
    mark(null, "ollamaSent", 1);
    expect(t.marks.ollamaFirstByte).toBe(400);
  });

  it("writes whole milliseconds from `received`, Ollama's own durations and counts, the image count and the model", () => {
    const t = createServerTiming("7", 1000)!;
    Object.assign(t.marks, { helperResolved: 1210.4, ollamaSent: 1230, ollamaFirstByte: 4120 });
    takeOllamaDone(t, { load_duration: 0, prompt_eval_duration: 2_710_000_000, prompt_eval_count: 1840, eval_count: 96 });
    Object.assign(t, { images: 1, model: "lfm3-vl" });
    expect(serverTimingLine(t)).toBe("okfilow: server run 7 main: received 0, helperResolved 210, ollamaSent 230, ollamaFirstByte 3120 ms; load 0, promptEval 2710 ms, prompt 1840 tok, eval 96 tok; images 1; model lfm3-vl");
  });

  it("never lets a word through: strings, unknown names, non-finite values and odd model names are dropped", () => {
    const t = createServerTiming("7g", 0)!;
    (t.marks as Record<string, unknown>).helperResolved = "QUOKKA-4417";
    (t.marks as Record<string, unknown>).secret = 5;
    t.marks.ollamaSent = Number.NaN;
    t.marks.ollamaFirstByte = Number.POSITIVE_INFINITY;
    takeOllamaDone(t, { load_duration: "QUOKKA", prompt_eval_duration: -5, prompt_eval_count: 1.5, eval_count: "9" });
    Object.assign(t, { images: "QUOKKA", model: "Where is QUOKKA-4417?" });
    const line = serverTimingLine(t);
    expect(line).toBe("okfilow: server run 7g ground: received 0 ms; ; images 0; model -");
    expect(line).not.toMatch(/QUOKKA|secret|NaN|Infinity/);
  });

  it("goes to the desktop shell's log function when there is one, and to nowhere otherwise", () => {
    const t = createServerTiming("1", 0)!;
    expect(() => logServerTiming(t)).not.toThrow();
    const lines: string[] = [];
    (globalThis as { __filowPerfLog?: (l: string) => void }).__filowPerfLog = (l) => lines.push(l);
    logServerTiming(t);
    logServerTiming(null);
    expect(lines).toEqual([serverTimingLine(t)]);
    (globalThis as { __filowPerfLog?: (l: string) => void }).__filowPerfLog = () => { throw new Error("disk full"); };
    expect(() => logServerTiming(t)).not.toThrow();
  });
});

describe("askOllama marks the request it sends and what Ollama says", () => {
  const stream = (lines: string[]) => new ReadableStream<Uint8Array>({
    start(c) { for (const l of lines) c.enqueue(new TextEncoder().encode(l + "\n")); c.close(); },
  });
  const req: BuddyAskRequest = { question: "Where is Pay now?", images: [], screens: [], history: [] } as unknown as BuddyAskRequest;
  const helper = { model: "lfm3-vl", pictures: false } as LocalHelper;

  it("sets ollamaSent before the call, ollamaFirstByte at the first line and the counts from the done line", async () => {
    let calledAt = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calledAt = Date.now();
      return new Response(stream([JSON.stringify({ message: { content: "Top right." } }), JSON.stringify({ done: true, load_duration: 5_000_000, prompt_eval_duration: 2_000_000_000, prompt_eval_count: 900, eval_count: 12 })]), { status: 200 });
    }));
    const t: ServerTiming = createServerTiming("4", Date.now())!;
    let said = "";
    for await (const piece of askOllama(req, undefined, helper, undefined, t)) said += piece;
    expect(said).toBe("Top right.");
    expect(t.marks.ollamaSent).toBeLessThanOrEqual(calledAt);
    expect(t.marks.ollamaFirstByte).toBeGreaterThanOrEqual(calledAt);
    expect(t.ollama).toEqual({ loadMs: 5, promptEvalMs: 2000, promptTokens: 900, evalTokens: 12 });
  });

  it("works unmeasured as before", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream([JSON.stringify({ message: { content: "Hi" }, done: true })]), { status: 200 })));
    let said = "";
    for await (const piece of askOllama(req, undefined, helper)) said += piece;
    expect(said).toBe("Hi");
  });
});
