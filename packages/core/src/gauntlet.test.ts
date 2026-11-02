import { describe, expect, it } from "vitest";
import { oracleDecide, replay, type Corpus } from "./gauntlet";

const CORPUS: Corpus = {
  name: "unit",
  language: "en",
  script: `# Intro
- who we are
- what we build

# Body
- the decision model
- pricing
`,
  transcript: [
    { sec: 2, committed: "good morning everyone, thanks for coming." },
    { sec: 6, committed: "let me tell you who we are: a small team from Bassano." },
    { sec: 9, committed: "still the same team, two engineers and a designer." },
    { sec: 14, committed: "today I will talk about what we build, but first a story." },
    { sec: 20, committed: "what we build is a speaking companion that listens to you." },
    { sec: 24, committed: "it listens and ticks off your points as you cover them." },
    { sec: 30, committed: "the decision model answers twice a second whether a point started." },
    { sec: 34, committed: "it runs locally or in the cloud, your choice." },
    { sec: 40, committed: "we are out of time, thank you." },
  ],
  labels: [
    { pointId: "s0b0", startedAtSec: 6 },
    { pointId: "s0b1", startedAtSec: 20 },
    { pointId: "s1b0", startedAtSec: 30 },
  ],
  neverStarted: ["s1b1"],
};

describe("gauntlet replay", () => {
  it("measures flips against labels with the oracle provider", async () => {
    const r = await replay(CORPUS, {
      decide: oracleDecide({ s0b0: "who we are", s0b1: "what we build is", s1b0: "decision model", s1b1: "pricing" }),
    });
    expect(r.calls).toBeGreaterThan(3);
    const by = Object.fromEntries(r.points.map((p) => [p.pointId, p.outcome]));
    expect(by.s0b0).toBe("correct");
    expect(by.s0b1).toBe("correct"); // the "I will talk about" announcement at 14 s did not flip it
    expect(by.s1b0).toBe("correct");
    expect(by.s1b1).toBe("never-started-ok");
    expect(r.falseStarts).toBe(0);
    expect(r.misses).toBe(0);
    expect(r.precision).toBe(1);
    expect(r.recall).toBe(1);
    expect(r.delaySec.p50).not.toBeNull();
  });

  it("counts a flip on the announcement as a false start", async () => {
    const r = await replay(CORPUS, {
      decide: oracleDecide({ s0b0: "who we are", s0b1: "what we build", s1b0: "decision model" }), // "what we build" also matches the announcement at 14 s
      toleranceSec: 2,
    });
    const s0b1 = r.points.find((p) => p.pointId === "s0b1")!;
    expect(s0b1.outcome).toBe("false-start");
    expect(r.falseStarts).toBe(1);
  });

  it("counts a point the model never sees as a miss and reports latency percentiles", async () => {
    const r = await replay(CORPUS, { decide: oracleDecide({ s0b0: "who we are" }) });
    expect(r.misses).toBe(2);
    expect(r.latencyMs.p95).toBeGreaterThanOrEqual(r.latencyMs.p50);
  });
});
