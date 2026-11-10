// Gauntlet replay harness (docs/local-latency-gauntlet.md, Round 0). Replays a labelled talk through
// the Engine with any decision provider and measures what the plan's targets ask for: per-call
// latency (T1), mic-to-tick delay per point (T3) and false starts / misses (T4). No network here;
// the provider is injected, so the same harness runs the mock oracle in unit tests, Clef through
// Ollama, OpenRouter, or a future embedding gate.
import { Engine, type EngineOptions } from "./engine";
import { parseScript } from "./script";
import type { DecideRequest, DecideResponse } from "./api";

/**
 * One transcript event at `sec` seconds from the start of the talk: committed text (final, as the STT
 * sends it at a sentence end) or, with only `partial`, a streaming hypothesis that the next committed
 * segment replaces and may revise (e.g. "we will raise" becomes "we will not raise").
 */
export type Segment = { sec: number; committed?: string; partial?: string };
/** Ground truth: when the speaker really started each point. */
export type Label = { pointId: string; startedAtSec: number };

/** Languages a labelled corpus can be in (docs/stt/LANGUAGES.md). */
export type CorpusLanguage = "it" | "en" | "ru" | "ro" | "ja";
const CORPUS_LANGUAGES: readonly CorpusLanguage[] = ["it", "en", "ru", "ro", "ja"];

/** Language of a corpus from its directory name ("traps-ru" is Russian); Italian when the name carries none. */
export function corpusLanguage(name: string): CorpusLanguage {
  const suffix = name.slice(name.lastIndexOf("-") + 1).toLowerCase();
  return CORPUS_LANGUAGES.find((l) => l === suffix) ?? "it";
}

export type Corpus = {
  name: string;
  language: CorpusLanguage;
  /** Markdown script, the same text the user loads in the app. */
  script: string;
  transcript: Segment[];
  labels: Label[];
  /** Points that are never started (should stay waiting or become missed). */
  neverStarted?: string[];
};

export type ReplayOptions = {
  decide: EngineOptions["decide"];
  /** Engine options under test (window, confirmCalls, maxQuestions, timeoutMs). */
  engine?: Partial<Omit<EngineOptions, "decide" | "now" | "setInterval" | "clearInterval">>;
  /** A flip counts as correct within this many seconds of the label (default 5). */
  toleranceSec?: number;
  /**
   * How the section changes during the replay. "labels" (default): jump to section k when the talk
   * reaches the first labelled start of section k, as the presenter (or the slideshow follower)
   * would. "auto": only once every point of the current section is started. "none": never.
   */
  advance?: "labels" | "auto" | "none";
};

export type PointResult = {
  pointId: string;
  /** Every confidence the model returned for this point, with the talk time, so thresholds can be tuned offline. */
  trail: Array<{ sec: number; confidence: number; started: boolean }>;
  labelSec: number | null;
  flippedSec: number | null;
  outcome: "correct" | "late" | "false-start" | "miss" | "never-started-ok" | "never-started-flipped";
  delaySec: number | null;
};

export type ReplayResult = {
  corpus: string;
  calls: number;
  /** flips after the label plus the tolerance: not counted in `correct`, included in `delaySec` */
  late: number;
  latencyMs: { p50: number; p95: number; max: number; avg: number };
  timeouts: number;
  points: PointResult[];
  /** confirming answers the claim guard rejected (guard.ts) */
  guarded: number;
  falseStarts: number;
  misses: number;
  correct: number;
  /** Median and p95 of the delay between the label and the flip, over correct points. */
  delaySec: { p50: number | null; p95: number | null };
  precision: number | null;
  recall: number | null;
};

const pct = (xs: number[], p: number): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

/** Replays the corpus; the clock is the transcript's own timeline, so model latency is measured but does not shift the timeline. */
export async function replay(corpus: Corpus, opts: ReplayOptions): Promise<ReplayResult> {
  const tolerance = opts.toleranceSec ?? 5;
  let nowSec = 0;
  const latencies: number[] = [];
  let timeouts = 0;
  const trails = new Map<string, Array<{ sec: number; confidence: number; started: boolean }>>();
  const decide: EngineOptions["decide"] = async (r: DecideRequest, signal?: AbortSignal) => {
    const t0 = Date.now();
    try {
      const out: DecideResponse = await opts.decide(r, signal);
      latencies.push(Date.now() - t0);
      for (const d of out.decisions) {
        if (!trails.has(d.id)) trails.set(d.id, []);
        trails.get(d.id)!.push({ sec: nowSec, confidence: Math.round(d.confidence * 100) / 100, started: d.started });
      }
      return out;
    } catch (err) {
      if ((err as Error).name === "AbortError" || /timed out/.test(String((err as Error).message))) timeouts++;
      throw err;
    }
  };
  let guarded = 0;
  const engine = new Engine({
    ...opts.engine,
    onGuard: (id, check) => {
      guarded++;
      opts.engine?.onGuard?.(id, check);
    },
    decide,
    now: () => Math.round(nowSec * 1000),
    setInterval: () => 0,
    clearInterval: () => {},
    costCapUsd: null,
  });
  const script = parseScript(corpus.script);
  engine.loadScript(script);
  const flipped = new Map<string, number>();
  engine.subscribe((s) => {
    for (const [id, p] of Object.entries(s.points)) {
      if (p.status === "started" && !flipped.has(id)) flipped.set(id, nowSec);
    }
  });

  const segments = [...corpus.transcript].sort((a, b) => a.sec - b.sec);
  const advance = opts.advance ?? (corpus.labels.length ? "labels" : "auto");
  const labelSecOf = new Map(corpus.labels.map((l) => [l.pointId, l.startedAtSec]));
  // first labelled start per section: when the presenter is "on" that section
  const sectionStart = script.sections.map((sec) => Math.min(...sec.bullets.map((b) => labelSecOf.get(b.id) ?? Infinity)));
  for (const seg of segments) {
    nowSec = seg.sec;
    if (advance === "labels") {
      let target = engine.getState().sectionIdx;
      for (let k = target + 1; k < sectionStart.length; k++) if (sectionStart[k] <= nowSec) target = k;
      if (target !== engine.getState().sectionIdx) engine.dispatch({ type: "goToSection", idx: target });
    }
    if (seg.committed !== undefined) engine.feed({ committed: seg.committed.endsWith(" ") ? seg.committed : `${seg.committed} `, partial: "" });
    else if (seg.partial !== undefined) engine.feed({ partial: seg.partial });
    await engine.tick();
    // The app keeps ticking between segments; a second tick 2 s later (past the pacing gap of a slow
    // model) lets the re-ask-on-pending rule act. Flips it causes are stamped at that later time.
    nowSec += 2;
    await engine.tick();
    if (advance === "auto") {
      const s = engine.getState();
      const section = s.script.sections[s.sectionIdx];
      if (section && section.bullets.every((b) => s.points[b.id]?.status === "started") && s.sectionIdx < s.script.sections.length - 1) {
        engine.dispatch({ type: "nextSection" });
      }
    }
  }
  const endSec = segments.length ? segments[segments.length - 1].sec : 0;

  const labelById = new Map(corpus.labels.map((l) => [l.pointId, l.startedAtSec]));
  const never = new Set(corpus.neverStarted ?? []);
  const points: PointResult[] = [];
  for (const section of script.sections) {
    for (const b of section.bullets) {
      const labelSec = labelById.get(b.id) ?? null;
      const flippedSec = flipped.get(b.id) ?? null;
      let outcome: PointResult["outcome"];
      if (labelSec === null) {
        outcome = flippedSec === null ? "never-started-ok" : "never-started-flipped";
      } else if (flippedSec === null) {
        outcome = "miss";
      } else if (flippedSec < labelSec - tolerance) {
        outcome = "false-start";
      } else if (flippedSec <= labelSec + tolerance) {
        outcome = "correct";
      } else {
        outcome = "late";
      }
      if (!never.has(b.id) && labelSec === null && flippedSec !== null) outcome = "never-started-flipped";
      points.push({ pointId: b.id, trail: trails.get(b.id) ?? [], labelSec, flippedSec, outcome, delaySec: labelSec !== null && flippedSec !== null ? Math.round((flippedSec - labelSec) * 10) / 10 : null });
    }
  }
  const falseStarts = points.filter((p) => p.outcome === "false-start" || p.outcome === "never-started-flipped").length;
  const misses = points.filter((p) => p.outcome === "miss").length;
  const correct = points.filter((p) => p.outcome === "correct").length;
  const late = points.filter((p) => p.outcome === "late").length;
  // Delay is measured over every flip that happened after its label, late ones included: a late flip is
  // precisely the delay this harness exists to show. Recall counts only flips within the tolerance.
  const delays = points.filter((p) => p.outcome === "correct" || p.outcome === "late").map((p) => p.delaySec as number);
  const labelled = points.filter((p) => p.labelSec !== null).length;
  const flips = correct + late + falseStarts;
  void endSec;
  return {
    corpus: corpus.name,
    late,
    calls: latencies.length,
    latencyMs: { p50: pct(latencies, 50), p95: pct(latencies, 95), max: latencies.length ? Math.max(...latencies) : 0, avg: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0 },
    timeouts,
    points,
    guarded,
    falseStarts,
    misses,
    correct,
    delaySec: { p50: delays.length ? pct(delays, 50) : null, p95: delays.length ? pct(delays, 95) : null },
    precision: flips ? Math.round((correct / flips) * 1000) / 1000 : null,
    recall: labelled ? Math.round((correct / labelled) * 1000) / 1000 : null,
  };
}

/**
 * An oracle provider for tests: answers "started" for a point once the transcript contains its
 * `cue` phrase. Lets the harness itself be tested without a model.
 */
export function oracleDecide(cues: Record<string, string>, confidence = 0.95): EngineOptions["decide"] {
  return async (r: DecideRequest) => ({
    decisions: r.bullets.map((b) => {
      const cue = cues[b.id];
      const hit = Boolean(cue) && r.transcript.toLowerCase().includes(cue.toLowerCase());
      return { id: b.id, started: hit, confidence: hit ? confidence : 0.05 };
    }),
    latencyMs: 1,
    cost: 0,
    model: "oracle",
  });
}
