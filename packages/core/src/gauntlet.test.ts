import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { oracleDecide, replay, type Corpus } from "./gauntlet";
import { Engine, type EngineOptions } from "./engine";
import { parseScript } from "./script";

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

// Synthetic state regressions only: keyword overlap is not a speech-quality oracle.
function loadJourney(language: Corpus["language"]): Corpus {
  const dir = new URL(`../../../docs/gauntlet/corpus/journey-${language}/`, import.meta.url);
  const transcript = JSON.parse(readFileSync(new URL("transcript.json", dir), "utf8"));
  const labels = JSON.parse(readFileSync(new URL("labels.json", dir), "utf8"));
  return {
    name: `journey-${language}`, language,
    script: readFileSync(new URL("script.md", dir), "utf8"),
    transcript: transcript.segments, labels: labels.labels, neverStarted: labels.neverStarted,
  };
}

const words = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
const keywordDecide: EngineOptions["decide"] = async (request) => {
  const spoken = words(request.transcript);
  return {
    decisions: request.bullets.map((point) => {
      const keywords = [...words(point.text)];
      const overlap = keywords.filter((word) => spoken.has(word)).length / keywords.length;
      // Full point vocabulary gets one-call confidence; partial overlap stays below
      // the 0.70 flip threshold. No point IDs, labels or timeline drive the answers.
      const confidence = overlap === 1 ? 0.95 : overlap * 0.6;
      return { id: point.id, confidence, started: confidence >= 0.7 };
    }),
    latencyMs: 1, cost: 0, model: "test-keyword-overlap",
  };
};

async function checkJourney(language: Corpus["language"]) {
  const corpus = loadJourney(language);
  const script = parseScript(corpus.script);
  const ids = script.sections.flatMap((section) => section.bullets.map((point) => point.id));
  expect(script.sections.map((section) => section.bullets.length)).toEqual([3, 3]);
  expect(ids).toEqual(["s0b0", "s0b1", "s0b2", "s1b0", "s1b1", "s1b2"]);
  expect(corpus.neverStarted).toEqual(["s1b1", "s1b2"]);

  let nowSec = 0;
  let interval: (() => void) | undefined;
  let pendingTick: Promise<void> | undefined;
  let calls = 0;
  const engine = new Engine({
    now: () => nowSec * 1000,
    decide: (request, signal) => { calls++; return keywordDecide(request, signal); },
    setInterval: (fn) => { interval = fn; return 1; },
    clearInterval: () => { interval = undefined; },
  });
  // Capture the public tick promise so injected interval callbacks can be awaited
  // exactly, without wall-clock sleeps or assumptions about microtask counts.
  const tick = engine.tick.bind(engine);
  engine.tick = () => (pendingTick = tick());
  const pulse = async () => {
    pendingTick = undefined;
    interval?.();
    await pendingTick;
  };
  const statuses = () => ids.map((id) => engine.getState().points[id]?.status ?? "waiting");
  const flips: Array<{ pointId: string; startedAtSec: number }> = [];
  const unsubscribe = engine.subscribe((state) => {
    for (const id of ids) {
      if (state.points[id]?.status === "started" && !flips.some((flip) => flip.pointId === id)) {
        flips.push({ pointId: id, startedAtSec: nowSec });
      }
    }
  });
  engine.loadScript(script);
  engine.dispatch({ type: "startTake" });
  try {
    // Corpus/replay has only committed segments and first-start labels: no command
    // events, transcript retractions or final states. Keep its file schema intact;
    // enact the documented controls here via ARCHITECTURE.md §5.4 Command.
    // Manual reopen is the supported correction, not semantic error detection.
    for (const segment of corpus.transcript) {
      nowSec = segment.sec;
      if (nowSec === 10) {
        expect(statuses()).toEqual(["started", "waiting", "waiting", "waiting", "waiting", "waiting"]);
        expect(engine.dispatch({ type: "stopTake" })).toEqual({ ok: true });
        expect(engine.getState().engine.recording).toBe(false);
        expect(interval).toBeUndefined();
      }
      if (nowSec === 18) {
        expect(engine.dispatch({ type: "startTake" })).toEqual({ ok: true });
        expect(engine.getState().engine.recording).toBe(true);
        expect(interval).toBeTypeOf("function");
        expect(engine.getState().sectionIdx).toBe(0);
      }
      if (nowSec === 34) {
        expect(statuses().slice(0, 3)).toEqual(["started", "started", "started"]);
        expect(engine.dispatch({ type: "nextSection" })).toEqual({ ok: true });
      }
      if (nowSec === 42) {
        expect(statuses()).toEqual(["started", "started", "started", "started", "waiting", "waiting"]);
        // The presenter reopens the earlier owner point for a later follow-up.
        expect(engine.dispatch({ type: "reopen", id: "s0b1" })).toEqual({ ok: true });
        expect(engine.getState().points.s0b1).toEqual({ status: "waiting", confidence: 0 });
      }
      const before = structuredClone(engine.getState().points);
      const statusesBefore = statuses();
      const callsBefore = calls;
      const flipsBefore = [...flips];
      engine.feed({ committed: `${segment.committed} ` });
      await pulse();
      nowSec += 2; // Same second pulse as replay(), including pending confirmations.
      await pulse();
      if (segment.sec === 10) {
        // stop() owns the interval (§5.5); tick() is also a public offline driver,
        // so deliberately calling tick() while stopped would not simulate a take.
        expect(engine.getState().points).toEqual(before);
        expect(calls).toBe(callsBefore);
        expect(engine.getState().sectionIdx).toBe(0);
      }
      if (segment.sec === 42) {
        expect(segment.committed).toBe(language === "en" ? "We do backups." : "Facciamo i backup.");
        expect(calls).toBeGreaterThan(callsBefore); // The fake actually evaluated the trap.
        expect(statuses()).toEqual(statusesBefore);
        expect(flips).toEqual(flipsBefore);
      }
      // Exact checkpoints catch early, out-of-order and stopped-take flips.
      expect(flips).toEqual(corpus.labels.filter((label) => label.startedAtSec <= segment.sec));
    }
    expect(statuses()).toEqual(["started", "waiting", "started", "started", "waiting", "waiting"]);
    expect(engine.getState().points.s0b1).toEqual({ status: "waiting", confidence: 0 });
    expect(engine.getState().sectionIdx).toBe(1);
    expect(engine.getState().engine.recording).toBe(true);
    expect(engine.getState().stats.costUsd).toBe(0);
    expect(engine.getState().engine.error).toBeUndefined();
  } finally {
    engine.stop();
    unsubscribe();
  }
}

describe("presentation journey regressions (synthetic, no speech-quality claims)", () => {
  it("journey EN: ordered coverage, manual correction, stop/restart and a general backup mention", async () => {
    await checkJourney("en");
  });
  it("journey IT: ordered coverage, manual correction, stop/restart and a general backup mention", async () => {
    await checkJourney("it");
  });
});

// The keyword fake above answers 0 for "we do backups" (no shared words), so the journeys alone
// cannot show that the ENGINE refuses a vague mention. Here the decider is deliberately unsure
// (0.6, started false) on both specific points, window after window: only the engine's confirmation
// rule (one answer >= 0.85, or two consecutive started answers >= 0.7) keeps them open.
describe("general mention against the engine's confirmation rule", () => {
  for (const [language, mention, script] of [
    ["en", "We do backups.", "# Backups\n- Retention policy for every snapshot\n- Restore test every quarter\n"],
    ["it", "Facciamo i backup.", "# Backup\n- Politica di conservazione per ogni snapshot\n- Test di ripristino ogni trimestre\n"],
  ] as const) {
    it(`journey ${language.toUpperCase()}: repeated unsure answers about a general backup mention flip nothing`, async () => {
      let nowSec = 0;
      let interval: (() => void) | undefined;
      let pendingTick: Promise<void> | undefined;
      let calls = 0;
      const engine = new Engine({
        now: () => nowSec * 1000,
        decide: async (request) => {
          calls++;
          return {
            decisions: request.bullets.map((point) => ({ id: point.id, confidence: 0.6, started: false })),
            latencyMs: 1, cost: 0, model: "test-unsure",
          };
        },
        setInterval: (fn) => { interval = fn; return 1; },
        clearInterval: () => { interval = undefined; },
      });
      const tick = engine.tick.bind(engine);
      engine.tick = () => (pendingTick = tick());
      const pulse = async () => { pendingTick = undefined; interval?.(); await pendingTick; };
      engine.loadScript(parseScript(script));
      engine.dispatch({ type: "startTake" });
      try {
        for (let i = 0; i < 6; i++) {
          nowSec += 2;
          engine.feed({ committed: `${mention} ` });
          await pulse();
        }
        expect(calls).toBeGreaterThan(1);
        expect(engine.getState().points.s0b0?.status ?? "waiting").toBe("waiting");
        expect(engine.getState().points.s0b1?.status ?? "waiting").toBe("waiting");
      } finally {
        engine.stop();
      }
    });
  }
});

describe("streaming partials in the replay", () => {
  it("feeds partial-only segments as STT hypotheses; only committed text is decided on", async () => {
    const seen: string[] = [];
    const corpus: Corpus = {
      name: "partials",
      language: "en",
      script: "# A\n- who we are\n",
      transcript: [
        { sec: 2, partial: "who we" },
        { sec: 4, committed: "who we are, a small team." },
      ],
      labels: [{ pointId: "s0b0", startedAtSec: 4 }],
    };
    const oracle = oracleDecide({ s0b0: "who we are" });
    const r = await replay(corpus, { decide: (req, signal) => (seen.push(req.transcript), oracle(req, signal)) });
    // partial text reaches the engine (prompter) but never the decision model (P1 step 4)
    expect(seen).toEqual(["who we are, a small team."]);
    expect(r.points[0].outcome).toBe("correct");
  });
});

// A model that falls for every surface match (numbers, negation and partial text included) but, like
// the real decision models' rubric, not for an explicit announcement. With the guard and committed-only
// flips, the trap corpora must give no false completion and still find every true point.
function loadCorpus(name: string): Corpus {
  const dir = new URL(`../../../docs/gauntlet/corpus/${name}/`, import.meta.url);
  const transcript = JSON.parse(readFileSync(new URL("transcript.json", dir), "utf8"));
  const labels = JSON.parse(readFileSync(new URL("labels.json", dir), "utf8"));
  return { name, language: name.endsWith("-en") ? "en" : "it", script: readFileSync(new URL("script.md", dir), "utf8"), transcript: transcript.segments, labels: labels.labels, neverStarted: labels.neverStarted };
}
const ANNOUNCE = /\b(parler[oò]|vi parlo|tra poco|più avanti|later i will|i will also cover|i'll (also )?(talk|cover))\b/i;
const stems = (t: string) => new Set((t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/\p{L}{4,}/gu) ?? []).map((w) => w.slice(0, 5)));
const gullibleDecide: EngineOptions["decide"] = async (r) => {
  const last = r.transcript.split(/(?<=[.!?])\s+/).filter((s) => !ANNOUNCE.test(s)).join(" ");
  const heard = stems(last);
  return {
    decisions: r.bullets.map((b) => {
      const ws = [...stems(b.text)];
      const share = ws.filter((w) => heard.has(w)).length / Math.max(1, ws.length);
      return { id: b.id, started: share >= 0.6, confidence: share >= 0.6 ? 0.95 : 0.1 };
    }),
    latencyMs: 1,
    cost: 0,
    model: "gullible",
  };
};

describe("trap corpora with a gullible model", () => {
  for (const name of ["traps-it", "traps-en"]) {
    it(`${name}: no false completion, every true point found`, async () => {
      const r = await replay(loadCorpus(name), { decide: gullibleDecide });
      const wrong = r.points.filter((p) => p.outcome === "false-start" || p.outcome === "never-started-flipped").map((p) => p.pointId);
      expect(wrong).toEqual([]);
      expect(r.recall).toBe(1);
      expect(r.guarded).toBeGreaterThan(0);
    });

    it(`${name}: without the guard the same model is fooled (the corpus really has traps)`, async () => {
      const r = await replay(loadCorpus(name), { decide: gullibleDecide, engine: { guard: false } });
      expect(r.falseStarts).toBeGreaterThanOrEqual(3);
    });
  }
});
