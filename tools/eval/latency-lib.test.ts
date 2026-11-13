import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  addNoiseFloor, bootstrapInterval, canaryHits, cellsOf, grammarBreaks, heardOk, invalidReasons, judgeVerdict, median, medianInterval,
  ollamaCallsOutsideCli, parseServer, parseTimings, quantile, rank2b, SPANS, spanValue, speechEndMs, voiceSchedule, wordDistance,
} from "./latency-lib.mjs";

const T = "2026-11-13T03:00:00.000Z ";

describe("the timing lines", () => {
  it("reads a panel line and a server line, numbers and fixed names only", () => {
    const t = parseTimings(`${T}okfilow: timings run 7 voice done t0 1731456000123: micOpen -2410, release 0, voice 4790, mark 3990 ms; afterStop 0`);
    expect(t).toEqual({ run: "7", kind: "voice", end: "done", t0: 1731456000123, marks: { micOpen: -2410, release: 0, voice: 4790, mark: 3990 }, counts: { afterStop: 0 } });
    const s = parseServer("okfilow: server run 7 main: received 0, helperResolved 210, ollamaSent 230, ollamaFirstByte 3120 ms; load 0, promptEval 2710 ms, prompt 1840 tok, eval 96 tok; images 1; model lfm3-vl");
    expect(s).toMatchObject({ run: "7", role: "main", marks: { received: 0, helperResolved: 210, ollamaSent: 230, ollamaFirstByte: 3120 }, loadMs: 0, promptEvalMs: 2710, promptTokens: 1840, evalTokens: 96, images: 1, model: "lfm3-vl" });
    expect(parseServer("okfilow: server run 7g ground: received 0 ms; ; images 0; model -")).toMatchObject({ run: "7g", role: "ground" });
  });

  it("finds any timing or server line that breaks the grammar (a word, a quote, a name with a space)", () => {
    const good = ["okfilow: timings run 1 typed done t0 5: asked 0 ms", "okfilow: server run 1 main: received 0 ms; ; images 1; model lfm3-vl", "okfilow: mode idle"];
    expect(grammarBreaks(good)).toEqual([]);
    const bad = ["okfilow: timings run 1 typed done t0 5: asked 0 ms QUOKKA-4417", "okfilow: server run 1 main: received 0 ms; ; images 1; model Where is it", "okfilow: timings run 1 typed done t0 5: asked \"x\" ms"];
    expect(grammarBreaks(bad)).toHaveLength(3);
    expect(canaryHits({ log: "fine", report: "has QUOKKA-4417" })).toEqual(["report"]);
  });
});

describe("statistics", () => {
  it("median is the mean of the two middle values; quantiles by nearest rank", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([5, 1, 3])).toBe(3);
    const twenty = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(quantile(twenty, 0.9)).toBe(18);
    expect(quantile(Array.from({ length: 40 }, (_, i) => i + 1), 0.9)).toBe(36);
    expect(medianInterval(twenty)).toEqual([6, 15]);
    expect(medianInterval(Array.from({ length: 40 }, (_, i) => i + 1))).toEqual([14, 27]);
  });

  it("the bootstrap is fixed by its seed and finds a real difference", () => {
    const a = [[1000, 1010, 990, 1005], [1020, 980, 1000, 1001]];
    const b = [[0, 10, -10, 5], [20, -20, 0, 1]];
    const one = bootstrapInterval(a, b, { resamples: 2000 });
    expect(bootstrapInterval(a, b, { resamples: 2000 })).toEqual(one);
    expect(one[0]).toBeGreaterThan(950);
    // it resamples: varied data gives an interval, not a point
    expect(one[1] - one[0]).toBeGreaterThan(5);
    expect(one[1]).toBeLessThan(1050);
    const r = bootstrapInterval([[200, 210]], [[100, 105]], { op: "ratio", resamples: 500 });
    expect(r[0]).toBeGreaterThan(1.8);
  });
});

describe("the voice files", () => {
  const wav = (samples: number[]) => {
    const data = Buffer.alloc(samples.length * 2);
    samples.forEach((v, i) => data.writeInt16LE(v, i * 2));
    const head = Buffer.alloc(44);
    head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVE", 8); head.write("fmt ", 12); head.writeUInt32LE(16, 16);
    head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(16000, 24); head.writeUInt32LE(32000, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
    head.write("data", 36); head.writeUInt32LE(data.length, 40);
    return Buffer.concat([head, data]);
  };
  it("speech ends at the last sample above -40 dBFS, and the noise floor stays below it", () => {
    const s = new Array(16000).fill(0);
    s[7999] = 5000;
    const buf = addNoiseFloor(wav(s));
    expect(speechEndMs(buf)).toBe(500);
    expect(speechEndMs(addNoiseFloor(wav(new Array(1600).fill(0))))).toBe(0);
  });

  it("the heard check allows one word off only when the keys went up early", () => {
    expect(heardOk("Where is the Pay now button?", "where is the pay now button", 0)).toBe(true);
    expect(heardOk("Where is the Pay now button?", "Where is the Pay now", 0)).toBe(false);
    expect(heardOk("Where is the Pay now button?", "Where is the Pay now", -200)).toBe(true);
    expect(heardOk("Where is the Pay now button?", "Where is Pay", -200)).toBe(false);
    expect(wordDistance("Ｐａｙ now", "pay NOW!")).toBe(0);
  });

  it("the schedule gives every question its share and turns the offsets the same way every time", () => {
    const s = voiceSchedule(5, [-200, 0, 300], 40);
    expect(s).toHaveLength(40);
    expect(voiceSchedule(5, [-200, 0, 300], 40)).toEqual(s);
    for (let q = 0; q < 5; q++) expect(s.filter((x) => x.question === q)).toHaveLength(8);
    const per = [-200, 0, 300].map((o) => s.filter((x) => x.offset === o).length);
    expect(Math.max(...per) - Math.min(...per)).toBeLessThanOrEqual(1);
    expect(() => voiceSchedule(5, [0], 42)).toThrow();
  });
});

// A typed sample, as the harness reads it from the two lines.
const typed = (question: number, base: Partial<Record<string, number>>, delay = 0) => ({
  question, kind: "typed",
  timings: { end: "done", marks: { asked: 0, agentChecked: 5, captured: 60, recipients: 62, fetchStart: 70, firstToken: 3000 + delay, text: 3100 + delay, sentence: 3600 + delay, synth: 3900 + delay, voice: 4200 + delay, mark: 3200 + delay, ...base } },
  server: { images: 1, model: "lfm3-vl", marks: { received: 0, helperResolved: 20, ollamaSent: 25, ollamaFirstByte: 2800 + delay }, promptEvalMs: 2500, promptTokens: 1800 },
});
const jitter = (i: number) => ((i * 37) % 23) - 11;

describe("the 1000 ms judge", () => {
  const plain = Array.from({ length: 20 }, (_, i) => typed(i % 5, { firstToken: 3000 + jitter(i) * 10, voice: 4200 + jitter(i) * 12 }));
  const delayed = Array.from({ length: 20 }, (_, i) => typed(i % 5, { firstToken: 4000 + jitter(i + 3) * 10, voice: 5200 + jitter(i + 3) * 12 }, 1000));
  const opts = { resamples: 2000 };

  it("passes when the held request shows exactly in fetchStart -> firstToken and in t0 -> voice, not before the fetch", () => {
    const v = judgeVerdict(plain, delayed, opts);
    expect(v.checks.fetch.pass).toBe(true);
    expect(v.checks.before.pass).toBe(true);
    expect(v.checks.voice.pass).toBe(true);
    expect(v.pass).toBe(true);
  });

  it("fails without the delay", () => {
    const v = judgeVerdict(plain, plain.map((s) => ({ ...s })), opts);
    expect(v.checks.fetch.pass).toBe(false);
    expect(v.pass).toBe(false);
  });

  it("fails when the span table reads the wrong marks (the request span taken from captured to fetchStart)", () => {
    const swapped = SPANS.map((s) => (s.name === "fetchStart->firstToken" ? { ...s, from: "captured", to: "fetchStart" } : s));
    expect(judgeVerdict(plain, delayed, { ...opts, spans: swapped }).checks.fetch.pass).toBe(false);
  });

  it("fails when the hold lands before the fetch (the pre-fetch spans must not move)", () => {
    const early = delayed.map((s) => ({ ...s, timings: { ...s.timings, marks: { ...s.timings.marks, fetchStart: s.timings.marks.fetchStart + 1000 } } }));
    const v = judgeVerdict(plain, early, opts);
    expect(v.checks.before.pass).toBe(false);
    expect(v.checks.fetch.pass).toBe(false);
  });
});

describe("validity", () => {
  const tier = { picture: true, model: "lfm3-vl", split: "100% CPU" };
  it("counts a complete typed sample and names every reason otherwise", () => {
    expect(invalidReasons(typed(0, {}), tier)).toEqual([]);
    const bad = typed(0, { voice: undefined as unknown as number });
    bad.server.images = 0;
    bad.server.model = "gemma4:e4b";
    expect(invalidReasons({ ...bad, mode: "error", ttsLevels: ["light"], interference: true, split: "50%/50% CPU/GPU" }, tier)).toEqual(["missing voice", "images 0", "model", "mode error", "tts level", "interference", "processor split"]);
    expect(invalidReasons({ kind: "typed", timings: null, timedOut: true }, tier)).toEqual(["no timing line in time"]);
    expect(invalidReasons({ kind: "voice", heardOk: false, timings: { end: "superseded", marks: {} }, server: { images: 1, model: "lfm3-vl" } }, tier)[0]).toBe("heard check");
    expect(invalidReasons({ kind: "stop", timings: { end: "stopped", marks: { stopAt: 0, silent: 20 } } }, tier)).toEqual([]);
  });
});

describe("Phase 2b ranking", () => {
  const voice = (i: number) => ({
    timings: { marks: { release: 0, sttStop: 150, sttLast: 300, heard: 700, agentChecked: 1200, captured: 1300, recipients: 1310, fetchStart: 1320, firstToken: 6000, text: 6100, sentence: 6800 + i, synth: 7300 + i, voice: 7600 + i, mark: 6200 } },
    server: { marks: { received: 0, helperResolved: 230 }, promptEvalMs: 4000, promptTokens: 2000 },
  });
  it("ranks by realistic saving, drops what is under 100 ms and sends the 2b note to the owner when the top two are under 20%", () => {
    const r = rank2b(Array.from({ length: 10 }, (_, i) => voice(i)), { tokensSmall: 1200, clauseShare: 0.5 });
    expect(r.ranked.map((c) => c.id).slice(0, 3)).toEqual(["promptEval", "agent", "firstSentence"]);
    expect(r.ranked.find((c) => c.id === "promptEval")!.saving).toBe(1600);
    expect(r.ranked.find((c) => c.id === "firstSentence")!.saving).toBe(402.25);
    expect(r.dropped.map((c) => c.id)).toContain("recipients");
    expect(r.top2).toBe(1600 + 500);
    expect(r.total).toBe(7604.5);
    expect(r.share).toBeCloseTo(2100 / 7604.5, 6);
    expect(r.gateToOwner).toBe(false);
    expect(r.gateToOwner).toBe(r.share < 0.2);
    expect(spanValue(voice(0), SPANS.find((s) => s.name === "sttStop->heard")!)).toBe(550);
    expect(cellsOf([{ a: 1, c: "x" }, { a: 2, c: "y" }, { a: 3, c: "x" }], (s) => s.a, (s) => s.c)).toEqual([[1, 3], [2]]);
  });
});

describe("the harness talks to Ollama only through ollamaCli", () => {
  it("latency.mjs starts no ollama process anywhere else", () => {
    const src = fs.readFileSync(new URL("./latency.mjs", import.meta.url), "utf8");
    expect(src).toContain("function ollamaCli(");
    expect(ollamaCallsOutsideCli(src)).toEqual([]);
  });
  it("the scan finds a call outside it", () => {
    const src = "function ollamaCli(tier, args, { detached = false } = {}) { return spawn(OLLAMA_EXE, args); }\nfunction other() { execFileSync(OLLAMA_EXE, [\"ps\"]); }";
    expect(ollamaCallsOutsideCli(src)).toHaveLength(1);
  });
});
