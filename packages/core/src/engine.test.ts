import { describe, expect, it } from "vitest";
import { Engine, missedPoints } from "./engine";
import { parseScript } from "./script";
import type { DecideRequest, DecideResponse } from "./api";

const SCRIPT = parseScript(`# Intro
- hello everyone
- what we build today

# Body
- the decision model
- costs

# End
- recap
`);

type Answer = Record<string, number>; // id -> confidence

function makeEngine(answers: Answer[] = [], cost: number | null = 0.001) {
  const calls: DecideRequest[] = [];
  let i = 0;
  const decide = async (r: DecideRequest): Promise<DecideResponse> => {
    calls.push(r);
    const a = answers[Math.min(i++, answers.length - 1)] ?? {};
    return {
      decisions: r.bullets.map((b) => ({ id: b.id, confidence: a[b.id] ?? 0, started: (a[b.id] ?? 0) >= 0.7 })),
      latencyMs: 100,
      cost,
      model: "test",
    };
  };
  const e = new Engine({ decide, now: () => 1000, setInterval: () => 0, clearInterval: () => {} });
  e.loadScript(SCRIPT);
  return { e, calls };
}

describe("Engine flip rule", () => {
  it("flips at >= 0.70 only after two confirming calls", async () => {
    const { e } = makeEngine([{ s0b0: 0.75 }, { s0b0: 0.8 }]);
    e.feed({ committed: "hello folks " });
    await e.tick();
    expect(e.getState().points.s0b0.status).toBe("waiting");
    e.feed({ committed: "welcome " });
    await e.tick();
    expect(e.getState().points.s0b0.status).toBe("started");
  });

  it("flips at >= 0.90 on a single call", async () => {
    const { e } = makeEngine([{ s0b0: 0.95 }]);
    e.feed({ committed: "hello everyone" });
    await e.tick();
    expect(e.getState().points.s0b0.status).toBe("started");
  });

  it("a non-confirming call resets the streak", async () => {
    const { e } = makeEngine([{ s0b0: 0.75 }, { s0b0: 0.2 }, { s0b0: 0.75 }]);
    e.feed({ committed: "a" });
    await e.tick();
    e.feed({ committed: "b" });
    await e.tick();
    e.feed({ committed: "c" });
    await e.tick();
    expect(e.getState().points.s0b0.status).toBe("waiting");
  });

  it("does not call the model when the transcript is unchanged", async () => {
    const { e, calls } = makeEngine([{}]);
    e.feed({ committed: "same" });
    await e.tick();
    await e.tick();
    expect(calls).toHaveLength(1);
  });

  it("sends covered and upcoming context", async () => {
    const { e, calls } = makeEngine([{ s0b0: 0.95 }, {}]);
    e.feed({ committed: "hello everyone" });
    await e.tick();
    e.feed({ committed: " more" });
    await e.tick();
    expect(calls[1].covered).toEqual(["hello everyone"]);
    expect(calls[1].upcoming).toEqual(["the decision model", "costs"]);
    expect(calls[1].bullets.map((b) => b.id)).toEqual(["s0b1"]);
  });
});

describe("Engine navigation", () => {
  it("nextSection marks waiting points missed, backwards marks nothing", () => {
    const { e } = makeEngine();
    e.dispatch({ type: "markStarted", id: "s0b0" });
    e.dispatch({ type: "nextSection" });
    expect(e.getState().sectionIdx).toBe(1);
    expect(missedPoints(e.getState()).map((b) => b.id)).toEqual(["s0b1"]);
    e.dispatch({ type: "prevSection" });
    expect(missedPoints(e.getState()).map((b) => b.id)).toEqual(["s0b1"]);
  });

  it("goToSection far forward marks every passed section", () => {
    const { e } = makeEngine();
    e.dispatch({ type: "goToSection", idx: 2 });
    expect(missedPoints(e.getState())).toHaveLength(4);
    expect(e.getState().sectionIdx).toBe(2);
  });

  it("reopen returns a missed point to waiting", () => {
    const { e } = makeEngine();
    e.dispatch({ type: "nextSection" });
    e.dispatch({ type: "reopen", id: "s0b0" });
    expect(e.getState().points.s0b0.status).toBe("waiting");
  });

  it("resetSection clears only the current section", () => {
    const { e } = makeEngine();
    e.dispatch({ type: "markStarted", id: "s0b0" });
    e.dispatch({ type: "nextSection" });
    e.dispatch({ type: "markStarted", id: "s1b0" });
    e.dispatch({ type: "resetSection" });
    expect(e.getState().points.s1b0).toBeUndefined();
    expect(e.getState().points.s0b0.status).toBe("started");
  });

  it("slideChanged only navigates for slide-sourced scripts", () => {
    const { e } = makeEngine();
    e.dispatch({ type: "slideChanged", index: 2, total: 3 });
    expect(e.getState().sectionIdx).toBe(0);
    expect(e.getState().slide).toEqual({ index: 2, total: 3, title: undefined });
    e.loadScript({ ...SCRIPT, source: "slides" });
    e.dispatch({ type: "slideChanged", index: 2, total: 3 });
    expect(e.getState().sectionIdx).toBe(2);
  });

  it("rejects unknown point ids", () => {
    const { e } = makeEngine();
    expect(e.dispatch({ type: "markStarted", id: "nope" })).toEqual({ ok: false, error: "unknown point nope" });
  });
});

describe("Engine stats and cost cap", () => {
  it("accumulates stats and stops at the cap", async () => {
    const { e } = makeEngine([{}], 0.6);
    e.start();
    e.feed({ committed: "one" });
    await e.tick();
    expect(e.getState().stats).toMatchObject({ calls: 1, avgMs: 100, costUsd: 0.6 });
    expect(e.getState().engine.recording).toBe(true);
    e.feed({ committed: " two" });
    await e.tick();
    expect(e.getState().engine.recording).toBe(false);
    expect(e.getState().engine.error).toMatch(/cost cap/);
  });

  it("reports null cost when the provider does not", async () => {
    const { e } = makeEngine([{}], null);
    e.feed({ committed: "x" });
    await e.tick();
    expect(e.getState().stats.costUsd).toBeNull();
  });

  it("emits one patch per change with increasing versions", () => {
    const { e } = makeEngine();
    const versions: number[] = [];
    e.subscribe((s, ops) => {
      versions.push(s.version);
      expect(ops.length).toBeGreaterThan(0);
    });
    e.dispatch({ type: "nextSection" });
    e.feed({ committed: "hi" });
    expect(versions).toEqual([versions[0], versions[0] + 1]);
  });
});
