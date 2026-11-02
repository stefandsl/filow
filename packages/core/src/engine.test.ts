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

function makeEngine(answers: Answer[] = [], cost: number | null = 0.001, extra: Partial<ConstructorParameters<typeof Engine>[0]> = {}) {
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
  const e = new Engine({ decide, now: () => 1000, setInterval: () => 0, clearInterval: () => {}, ...extra });
  e.loadScript(SCRIPT);
  return { e, calls };
}

const BIG = parseScript(`# One
- p1
- p2
- p3
- p4
- p5
- p6
`);

describe("Engine pacing (Step 1 hygiene)", () => {
  it("caps the questions per call and rotates through the open points", async () => {
    const { e, calls } = makeEngine([], 0, { maxQuestions: 4 });
    e.loadScript(BIG);
    e.feed({ committed: "a " });
    await e.tick();
    e.feed({ committed: "b " });
    await e.tick();
    e.feed({ committed: "c " });
    await e.tick();
    expect(calls[0].bullets.map((b) => b.text)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(calls[1].bullets.map((b) => b.text)).toEqual(["p5", "p6", "p1", "p2"]);
    expect(calls[2].bullets.map((b) => b.text)).toEqual(["p3", "p4", "p5", "p6"]);
  });

  it("aborts a slow call, reports slow instead of an error, and asks again next tick", async () => {
    let aborted = false;
    const decide = (_r: DecideRequest, signal?: AbortSignal) =>
      new Promise<DecideResponse>((_res, rej) => {
        signal?.addEventListener("abort", () => {
          aborted = true;
          rej(new Error("aborted"));
        });
      });
    const e = new Engine({ decide, now: () => 1000, setInterval: () => 0, clearInterval: () => {}, timeoutMs: 20 });
    e.loadScript(SCRIPT);
    e.feed({ committed: "hello" });
    await e.tick();
    expect(aborted).toBe(true);
    expect(e.getState().engine.slowMs).toBe(20);
    expect(e.getState().engine.error).toBeUndefined();
    // the same transcript is sent again: lastSent was cleared by the timeout
    let calls = 0;
    const e2 = new Engine({
      decide: async (r) => {
        calls++;
        return { decisions: r.bullets.map((b) => ({ id: b.id, confidence: 0, started: false })), latencyMs: 1, cost: 0, model: "t" };
      },
      now: () => 1000,
      setInterval: () => 0,
      clearInterval: () => {},
    });
    e2.loadScript(SCRIPT);
    e2.feed({ committed: "x" });
    await e2.tick();
    await e2.tick();
    expect(calls).toBe(1);
  });

  it("paces calls to the model's own speed when it is slower than the tick", async () => {
    let t = 1000;
    const calls: number[] = [];
    const e = new Engine({
      decide: async (r) => {
        calls.push(t);
        return { decisions: r.bullets.map((b) => ({ id: b.id, confidence: 0, started: false })), latencyMs: 2000, cost: 0, model: "t" };
      },
      now: () => t,
      setInterval: () => 0,
      clearInterval: () => {},
      tickMs: 500,
    });
    e.loadScript(SCRIPT);
    e.feed({ committed: "a" });
    await e.tick(); // first call: avg becomes 2000 ms
    t += 500;
    e.feed({ committed: "b" });
    await e.tick(); // too soon: 500 < 2400
    t += 2000;
    e.feed({ committed: "c" });
    await e.tick(); // 2500 >= 2400: allowed
    expect(calls).toEqual([1000, 3500]);
    expect(e.getState().engine.slowMs).toBe(2000);
  });
});

describe("Engine stale replies (plan step 3: state validity)", () => {
  /** A decide whose reply is released by the test, so a command can land while the call is in flight. */
  function slowEngine(conf = 0.95) {
    let release: (() => void) | null = null;
    let aborted = 0;
    let started = 0;
    const decide = (r: DecideRequest, signal?: AbortSignal) =>
      new Promise<DecideResponse>((res) => {
        started++;
        signal?.addEventListener("abort", () => aborted++);
        release = () => res({ decisions: r.bullets.map((b) => ({ id: b.id, confidence: conf, started: true })), latencyMs: 50, cost: 0.01, model: "t" });
      });
    const e = new Engine({ decide, now: () => 1000, setInterval: () => 0, clearInterval: () => {} });
    e.loadScript(SCRIPT);
    e.feed({ committed: "hello everyone, what we build today" });
    const pending = e.tick();
    return { e, pending, release: () => release!(), aborted: () => aborted, started: () => started };
  }

  it("a reply that lands after the script was reloaded does not mark points of the new script", async () => {
    const { e, pending, release, aborted } = slowEngine();
    e.loadScript(parseScript(["# Other", "- a different point", "- and another"].join("\n")));
    expect(aborted()).toBe(1);
    release();
    await pending;
    expect(e.getState().points).toEqual({});
    expect(e.getState().stats.calls).toBe(0);
    expect(e.getState().engine.error).toBeUndefined();
  });

  it("a reply that lands after stopTake changes nothing", async () => {
    const { e, pending, release } = slowEngine();
    e.dispatch({ type: "startTake" });
    e.dispatch({ type: "stopTake" });
    release();
    await pending;
    expect(e.getState().points).toEqual({});
    expect(e.getState().stats.costUsd).toBe(0);
  });

  it("a reply that lands after a section change or a reset does not resurrect the old section", async () => {
    const { e, pending, release } = slowEngine();
    e.dispatch({ type: "nextSection" });
    release();
    await pending;
    expect(e.getState().points["s0b0"]?.status).toBe("missed");
    expect(e.getState().points["s0b1"]?.status).toBe("missed");

    const r = slowEngine();
    r.e.dispatch({ type: "resetSection" });
    r.release();
    await r.pending;
    expect(r.e.getState().points).toEqual({});
  });

  it("a reply that lands after a manual mark does not override it", async () => {
    const { e, pending, release } = slowEngine();
    e.dispatch({ type: "markMissed", id: "s0b0" });
    release();
    await pending;
    expect(e.getState().points["s0b0"]?.status).toBe("missed");
    expect(e.getState().points["s0b1"]).toBeUndefined();
  });

  it("the engine is free to ask again right after an invalidated call", async () => {
    const { e, pending, release, started } = slowEngine();
    e.dispatch({ type: "nextSection" });
    release();
    await pending;
    e.feed({ committed: " and now the decision model" });
    void e.tick();
    expect(started()).toBe(2);
    release();
  });

  it("a reply from the same epoch still applies", async () => {
    const { e, pending, release } = slowEngine();
    release();
    await pending;
    expect(e.getState().points["s0b0"]?.status).toBe("started");
  });
});

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
