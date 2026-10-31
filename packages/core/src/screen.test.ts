import { describe, expect, it } from "vitest";
import { Engine } from "./engine";
import {
  FrameBudget,
  frameDiff,
  hasPresenterCue,
  notesToMarkdown,
  parseScreenSummary,
  sectionFromSummary,
  shouldCapture,
} from "./screen";
import type { ScreenSummary } from "./types";

const rgba = (fill: number, n = 16 * 16) => {
  const a = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < a.length; i += 4) {
    a[i] = a[i + 1] = a[i + 2] = fill;
    a[i + 3] = 255;
  }
  return a;
};

describe("frameDiff", () => {
  it("is 0 for identical frames and ignores alpha", () => {
    const a = rgba(100);
    const b = rgba(100);
    b[3] = 0;
    expect(frameDiff(a, b)).toBe(0);
  });
  it("measures mean channel difference", () => {
    expect(frameDiff(rgba(0), rgba(30))).toBe(30);
    expect(frameDiff(rgba(0), rgba(255))).toBe(255);
  });
  it("treats empty input as a change", () => {
    expect(frameDiff([], rgba(1))).toBe(255);
  });
});

describe("FrameBudget", () => {
  it("caps sends per sliding minute", () => {
    const b = new FrameBudget(3);
    expect(b.take(0)).toBe(true);
    expect(b.take(1_000)).toBe(true);
    expect(b.take(2_000)).toBe(true);
    expect(b.take(3_000)).toBe(false);
    expect(b.remaining(3_000)).toBe(0);
    // first send expires after 60 s
    expect(b.take(60_001)).toBe(true);
    expect(b.remaining(60_001)).toBe(0);
  });
});

describe("hasPresenterCue", () => {
  it("finds cues in several languages", () => {
    expect(hasPresenterCue("so as you can see the revenue grew")).toBe(true);
    expect(hasPresenterCue("come potete vedere qui il fatturato")).toBe(true);
    expect(hasPresenterCue("en esta diapositiva tenemos")).toBe(true);
    expect(hasPresenterCue("comme vous voyez sur cette slide")).toBe(true);
    expect(hasPresenterCue("auf dieser Folie sehen wir")).toBe(true);
  });
  it("only looks at the new part of the transcript", () => {
    const t = "as you can see here the market is big and growing fast every single year";
    expect(hasPresenterCue(t, 0)).toBe(true);
    expect(hasPresenterCue(t, 50)).toBe(false);
  });
  it("ignores plain speech", () => {
    expect(hasPresenterCue("thanks everyone for coming today")).toBe(false);
  });
});

describe("shouldCapture", () => {
  const base = { changed: false, cue: false, forced: false, now: 10_000, lastSentAt: null as number | null };
  it("forced wins even when off", () => {
    expect(shouldCapture({ ...base, mode: "off", forced: true })).toBe(true);
  });
  it("off never captures", () => {
    expect(shouldCapture({ ...base, mode: "off", changed: true, cue: true })).toBe(false);
  });
  it("slide-change ignores cues", () => {
    expect(shouldCapture({ ...base, mode: "slide-change", cue: true })).toBe(false);
    expect(shouldCapture({ ...base, mode: "slide-change", changed: true })).toBe(true);
  });
  it("balanced captures on cues too", () => {
    expect(shouldCapture({ ...base, mode: "balanced", cue: true })).toBe(true);
  });
  it("realtime spaces calls out", () => {
    expect(shouldCapture({ ...base, mode: "realtime", changed: true, lastSentAt: 8_000 })).toBe(false);
    expect(shouldCapture({ ...base, mode: "realtime", changed: true, lastSentAt: 5_000 })).toBe(true);
    expect(shouldCapture({ ...base, mode: "realtime" })).toBe(false);
  });
});

describe("parseScreenSummary", () => {
  it("parses a clean answer and caps the lists", () => {
    const s = parseScreenSummary(
      JSON.stringify({ title: "Q3", shows: "A bar chart.", pointsToMake: ["a", "b", "c", "d"], facts: ["12%", "", "2025"], mismatch: "" }),
      "screen",
      5,
    );
    expect(s).toEqual({ at: 5, source: "screen", title: "Q3", shows: "A bar chart.", pointsToMake: ["a", "b", "c"], facts: ["12%", "2025"] });
  });
  it("strips code fences and keeps mismatch", () => {
    const s = parseScreenSummary('```json\n{"shows":"x","pointsToMake":[],"facts":[],"mismatch":"slide says 2025"}\n```', "region", 1);
    expect(s.mismatch).toBe("slide says 2025");
    expect(s.unavailable).toBeUndefined();
  });
  it("marks garbage and empty answers as could-not-read", () => {
    expect(parseScreenSummary("I cannot help with that", "window", 1).unavailable).toBe("could-not-read");
    expect(parseScreenSummary('{"shows":"","pointsToMake":[],"facts":[]}', "window", 1).unavailable).toBe("could-not-read");
  });
});

describe("sectionFromSummary", () => {
  it("uses the title and points, falling back to facts", () => {
    const s: ScreenSummary = { at: 0, source: "screen", title: "Pricing", shows: "", pointsToMake: ["x"], facts: ["$9"] };
    expect(sectionFromSummary(s, 2)).toEqual({ id: "s2", title: "Pricing", bullets: [{ id: "s2b0", text: "x" }] });
    const noPoints = { ...s, title: undefined, pointsToMake: [] };
    expect(sectionFromSummary(noPoints, 0)).toEqual({ id: "s0", title: "Slide 1", bullets: [{ id: "s0b0", text: "$9" }] });
  });
});

describe("Engine + Screen Sense", () => {
  const summary = (title: string, at = 1): ScreenSummary => ({
    at,
    source: "screen",
    title,
    shows: `The ${title} slide.`,
    pointsToMake: [`talk about ${title}`],
    facts: ["42"],
  });

  it("grows a script from summaries when none is loaded and navigates to the new section", () => {
    const e = new Engine({ decide: async () => ({ decisions: [], latencyMs: 0, cost: 0, model: "m" }) });
    e.feedScreen(summary("Intro"));
    e.feedScreen(summary("Pricing"));
    const s = e.getState();
    expect(s.script.source).toBe("screen");
    expect(s.script.sections.map((x) => x.title)).toEqual(["Intro", "Pricing"]);
    expect(s.sectionIdx).toBe(1);
    expect(s.screenStats?.frames).toBe(2);
  });

  it("does not touch a loaded script, adds vision cost to the session total and keeps notes", () => {
    const e = new Engine({ decide: async () => ({ decisions: [], latencyMs: 0, cost: 0, model: "m" }) });
    e.loadScript({ sections: [{ id: "s0", title: "Mine", bullets: [{ id: "s0b0", text: "p" }] }] });
    e.feed({ committed: "hello there" });
    e.feedScreen(summary("Other"), 0.001);
    const s = e.getState();
    expect(s.script.sections).toHaveLength(1);
    expect(s.stats.costUsd).toBeCloseTo(0.001);
    expect(s.screenStats?.costUsd).toBeCloseTo(0.001);
    expect(e.getNotes()).toHaveLength(1);
    expect(e.getNotes()[0].transcriptTail).toBe("hello there");
    expect(e.getNotes()[0].sectionTitle).toBe("Mine");
  });

  it("stops a running take when vision cost reaches the cap", () => {
    const e = new Engine({ decide: async () => ({ decisions: [], latencyMs: 0, cost: 0, model: "m" }), costCapUsd: 0.01, setInterval: () => 1, clearInterval: () => undefined });
    e.loadScript({ sections: [{ id: "s0", title: "A", bullets: [{ id: "s0b0", text: "p" }] }] });
    e.start();
    e.feedScreen(summary("A"), 0.02);
    expect(e.getState().engine.recording).toBe(false);
    expect(e.getState().engine.error).toMatch(/cost cap/);
  });

  it("forgetScreen clears summary, gap list and notes; lookNow reaches the subscriber", () => {
    const e = new Engine({ decide: async () => ({ decisions: [], latencyMs: 0, cost: 0, model: "m" }) });
    let looks = 0;
    e.onLookNow(() => looks++);
    e.feedScreen(summary("A"));
    expect(e.dispatch({ type: "forgetScreen" })).toEqual({ ok: true });
    expect(e.getState().screen).toBeNull();
    expect(e.getNotes()).toEqual([]);
    e.dispatch({ type: "lookNow" });
    expect(looks).toBe(1);
  });

  it("publishes unmentioned facts from the decision", async () => {
    const e = new Engine({ decide: async () => ({ decisions: [{ id: "s0b0", started: false, confidence: 0.1 }], unmentioned: ["42"], latencyMs: 1, cost: 0, model: "m" }) });
    e.loadScript({ sections: [{ id: "s0", title: "A", bullets: [{ id: "s0b0", text: "p" }] }] });
    e.feedScreen(summary("A"));
    e.feed({ committed: "some words" });
    await e.tick();
    expect(e.getState().unmentioned).toEqual(["42"]);
  });
});

describe("notesToMarkdown", () => {
  it("renders one heading per note with points, facts and speech", () => {
    const md = notesToMarkdown([
      { at: 0, summary: { at: 0, source: "screen", title: "Intro", shows: "Title slide.", pointsToMake: ["welcome"], facts: ["2026"] }, transcriptTail: "hi all" },
      { at: 1, summary: { at: 1, source: "screen", shows: "", pointsToMake: [], facts: [], unavailable: "capped" }, transcriptTail: "" },
    ]);
    expect(md).toContain("## 1. Intro");
    expect(md).toContain("- welcome");
    expect(md).toContain("- 2026");
    expect(md).toContain("> Said: …hi all");
    expect(md).toContain("Screen not read: capped");
  });
});
