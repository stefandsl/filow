// The decision loop as a class. No DOM, no fetch: `decide` is injected.
// Semantics follow ARCHITECTURE.md §5.4–5.5.
import { compare, type Operation } from "fast-json-patch";
import type { DecideRequest, DecideResponse } from "./api";
import { parseScript } from "./script";
import { isScreenScript, sectionFromSummary, type ScreenNote } from "./screen";
import type { Command, CommandResult, PointState, ScreenSummary, Script, SessionState, SttBackendId } from "./types";

export type TranscriptEvent = { committed?: string; partial?: string };

export type EngineOptions = {
  /** The decision call. `signal` aborts it when the engine gives up (timeout), so a slow model does not pile up requests. */
  decide: (r: DecideRequest, signal?: AbortSignal) => Promise<DecideResponse>;
  now?: () => number;
  /** timer period; a model call happens only when the transcript changed */
  tickMs?: number;
  /** confidence needed to flip (default 0.7) */
  threshold?: number;
  /** consecutive confirming calls needed below `sureThreshold` (default 2) */
  confirmCalls?: number;
  /** a single call at or above this flips immediately (default 0.85; measured: no false starts, flips a segment earlier) */
  sureThreshold?: number;
  /** characters of recent transcript sent per call */
  window?: number;
  /** stop the take when accumulated cost reaches this (USD); null disables */
  costCapUsd?: number | null;
  /** per-call timeout; the call is aborted and the engine reports "slow" instead of an error */
  timeoutMs?: number;
  /** at most this many open points per call; the rest rotate in on later calls (default 4) */
  maxQuestions?: number;
  /**
   * While a point has one confirming answer and waits for the second, ask once more on the next tick
   * even if the transcript did not change, instead of waiting for the next transcript segment
   * (default true). Costs one extra call per pending confirmation; cuts the flip delay by a segment.
   */
  reaskOnPending?: boolean;
  sessionId?: string;
  /** Timer injection for tests. Defaults to the global timers. */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
};

export type Subscriber = (state: SessionState, ops: Operation[]) => void;

const TAIL = 160;
const COMMITTED_CAP = 6000;

export class Engine {
  private readonly o: Required<Omit<EngineOptions, "sessionId">>;
  private state: SessionState;
  private committed = "";
  private partial = "";
  private lastSent = "";
  private inFlight = false;
  /** Bumped by every command that changes what a decision is about (script, section, points, take). A reply from an older epoch is dropped. */
  private epoch = 0;
  private ctl: AbortController | null = null;
  private lastCallAt = -Infinity;
  private qCursor = 0;
  private reasked = false;
  private timer: unknown = null;
  private streak: Record<string, number> = {};
  private subs = new Set<Subscriber>();
  private unmentioned: string[] = [];
  private notes: ScreenNote[] = [];
  private lookNowSubs = new Set<() => void>();

  constructor(opts: EngineOptions) {
    this.o = {
      decide: opts.decide,
      now: opts.now ?? (() => Date.now()),
      tickMs: opts.tickMs ?? 500,
      threshold: opts.threshold ?? 0.7,
      confirmCalls: opts.confirmCalls ?? 2,
      sureThreshold: opts.sureThreshold ?? 0.85,
      window: opts.window ?? 900,
      costCapUsd: opts.costCapUsd === undefined ? 1 : opts.costCapUsd,
      timeoutMs: opts.timeoutMs ?? 2500,
      maxQuestions: opts.maxQuestions ?? 4,
      reaskOnPending: opts.reaskOnPending ?? true,
      setInterval: opts.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms)),
      clearInterval: opts.clearInterval ?? ((t) => globalThis.clearInterval(t as ReturnType<typeof setInterval>)),
    };
    this.state = {
      id: opts.sessionId ?? "local",
      version: 0,
      script: { sections: [] },
      sectionIdx: 0,
      points: {},
      transcriptTail: "",
      stats: { calls: 0, totalMs: 0, avgMs: 0, costUsd: 0, model: "" },
      engine: { backend: null, recording: false },
      screen: null,
      unmentioned: [],
      screenStats: { frames: 0, costUsd: 0, analysing: false },
    };
  }

  // ---- read ---------------------------------------------------------------
  getState(): SessionState {
    return this.state;
  }
  get transcript(): string {
    return (this.committed + " " + this.partial).trim();
  }
  /** On-screen facts the model says were not mentioned yet (gap detector). */
  getUnmentioned(): string[] {
    return this.unmentioned;
  }
  /** One note per screen summary received during the take (§6.4 live notes). */
  getNotes(): ScreenNote[] {
    return this.notes;
  }
  /** Surfaces that own a capture subscribe here; `lookNow` from any view calls them. */
  onLookNow(fn: () => void): () => void {
    this.lookNowSubs.add(fn);
    return () => this.lookNowSubs.delete(fn);
  }
  subscribe(fn: Subscriber): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  // ---- script ---------------------------------------------------------------
  loadScript(script: Script): void {
    this.invalidate();
    this.committed = "";
    this.partial = "";
    this.lastSent = "";
    this.streak = {};
    this.unmentioned = [];
    this.update((s) => {
      s.script = script;
      s.sectionIdx = 0;
      s.points = {};
      s.transcriptTail = "";
    });
  }

  // ---- inputs -----------------------------------------------------------------
  feed(e: TranscriptEvent): void {
    if (e.committed) this.committed = (this.committed + e.committed).slice(-COMMITTED_CAP);
    if (e.partial !== undefined) this.partial = e.partial;
    const tail = this.transcript.slice(-TAIL);
    if (tail !== this.state.transcriptTail) this.update((s) => (s.transcriptTail = tail));
  }

  /**
   * A new screen summary. Cost is added to the session total (same cap as decisions).
   * With no script loaded, each readable summary becomes a section (§6.3) and the
   * engine moves to it. A note is kept for the live-notes export.
   */
  feedScreen(summary: ScreenSummary | null, cost: number | null = 0): void {
    const s = this.state;
    if (summary && !summary.unavailable) {
      this.notes.push({ at: summary.at, summary, transcriptTail: s.transcriptTail, sectionTitle: s.script.sections[s.sectionIdx]?.title });
    }
    const grow = summary && !summary.unavailable && isScreenScript(s.script) && (summary.pointsToMake.length || summary.facts.length);
    this.update((st) => {
      st.screen = summary;
      st.unmentioned = [];
      const ss = st.screenStats ?? { frames: 0, costUsd: 0, analysing: false };
      ss.analysing = false;
      if (summary && !summary.unavailable) ss.frames += 1;
      ss.costUsd = cost === null || ss.costUsd === null ? null : ss.costUsd + cost;
      st.screenStats = ss;
      if (cost && st.stats.costUsd !== null) st.stats.costUsd += cost;
      if (grow && summary) {
        const section = sectionFromSummary(summary, st.script.sections.length);
        st.script = { sections: [...st.script.sections, section], source: "screen" };
        st.sectionIdx = st.script.sections.length - 1;
      }
    });
    this.unmentioned = [];
    if (grow) this.lastSent = "";
    this.checkCap();
  }

  /** Shows the "analysing" badge while a frame is at the vision model. */
  setAnalysing(on: boolean): void {
    if ((this.state.screenStats?.analysing ?? false) === on) return;
    this.update((st) => {
      st.screenStats = { ...(st.screenStats ?? { frames: 0, costUsd: 0, analysing: false }), analysing: on };
    });
  }

  setBackend(id: SttBackendId | null): void {
    this.update((s) => (s.engine.backend = id));
  }
  setError(message: string | undefined): void {
    this.update((s) => (s.engine.error = message));
  }

  // ---- commands ---------------------------------------------------------------
  dispatch(cmd: Command): CommandResult {
    const s = this.state;
    const last = s.script.sections.length - 1;
    switch (cmd.type) {
      case "nextSection":
        return this.goTo(s.sectionIdx + 1);
      case "prevSection":
        return this.goTo(s.sectionIdx - 1);
      case "goToSection":
        return this.goTo(cmd.idx);
      case "resetSection": {
        const section = s.script.sections[s.sectionIdx];
        if (!section) return { ok: false, error: "no section" };
        this.update((st) => {
          for (const b of section.bullets) delete st.points[b.id];
        });
        for (const b of section.bullets) delete this.streak[b.id];
        this.lastSent = "";
        this.invalidate();
        return { ok: true };
      }
      case "markStarted":
        return this.setPoint(cmd.id, { status: "started", confidence: 1, startedAt: this.o.now() });
      case "markMissed":
        return this.setPoint(cmd.id, { status: "missed", confidence: this.state.points[cmd.id]?.confidence ?? 0 });
      case "reopen":
        return this.setPoint(cmd.id, { status: "waiting", confidence: 0 });
      case "startTake":
        this.start();
        return { ok: true };
      case "stopTake":
        this.stop();
        return { ok: true };
      case "loadScript":
        this.loadScript(parseScript(cmd.text));
        return { ok: true };
      case "slideChanged": {
        this.update((st) => (st.slide = { index: cmd.index, total: cmd.total, title: cmd.title }));
        if (s.script.source === "slides" && cmd.index <= last) return this.goTo(cmd.index);
        return { ok: true };
      }
      case "forgetScreen":
        this.unmentioned = [];
        this.notes = [];
        this.update((st) => {
          st.screen = null;
          st.unmentioned = [];
        });
        return { ok: true };
      case "lookNow":
        // Capture is owned by the surface (desktop / web); the engine relays the request.
        for (const fn of this.lookNowSubs) fn();
        return { ok: true };
    }
  }

  private setPoint(id: string, state: PointState): CommandResult {
    const known = this.state.script.sections.some((sec) => sec.bullets.some((b) => b.id === id));
    if (!known) return { ok: false, error: `unknown point ${id}` };
    this.update((st) => (st.points[id] = state));
    delete this.streak[id];
    this.invalidate();
    return { ok: true };
  }

  /** Forward moves mark every waiting point of the passed sections as missed. Backward marks nothing. */
  private goTo(idx: number): CommandResult {
    const s = this.state;
    const n = s.script.sections.length;
    if (n === 0) return { ok: false, error: "no script" };
    const target = Math.max(0, Math.min(n - 1, idx));
    this.update((st) => {
      if (target > st.sectionIdx) {
        for (const sec of st.script.sections.slice(st.sectionIdx, target)) {
          for (const b of sec.bullets) {
            const cur = st.points[b.id];
            if (!cur || cur.status === "waiting") st.points[b.id] = { status: "missed", confidence: cur?.confidence ?? 0 };
          }
        }
      }
      st.sectionIdx = target;
    });
    this.lastSent = "";
    if (target !== s.sectionIdx) this.invalidate();
    return { ok: true };
  }

  // ---- loop ---------------------------------------------------------------------
  start(): void {
    if (this.timer) return;
    this.invalidate();
    this.lastSent = "";
    this.notes = [];
    this.update((s) => {
      s.engine.recording = true;
      s.engine.error = undefined;
    });
    this.timer = this.o.setInterval(() => void this.tick(), this.o.tickMs);
  }

  stop(): void {
    if (this.timer) this.o.clearInterval(this.timer);
    this.timer = null;
    this.invalidate();
    this.update((s) => {
      s.engine.recording = false;
      s.engine.backend = null;
    });
  }

  /**
   * The world a pending decision was asked about no longer exists: abort the call and make
   * sure its reply, should it still arrive, changes nothing. Called by every command that
   * changes the script, the section, a point or the take.
   */
  private invalidate(): void {
    this.epoch++;
    this.ctl?.abort();
  }

  /** One iteration. Public so tests and surfaces can drive it without timers. */
  async tick(): Promise<void> {
    if (this.inFlight) return;
    const s = this.state;
    const section = s.script.sections[s.sectionIdx];
    if (!section) return;
    // Adaptive pace: a model slower than the tick is asked no more often than it can answer.
    const now = this.o.now();
    const avg = s.stats.avgMs;
    if (avg > this.o.tickMs && now - this.lastCallAt < Math.round(avg * 1.2)) return;
    const windowText = this.transcript.slice(-this.o.window);
    if (!windowText) return;
    const allOpen = section.bullets.filter((b) => (s.points[b.id]?.status ?? "waiting") === "waiting");
    if (!allOpen.length) return;
    if (windowText === this.lastSent) {
      // Same text as last time: only worth a call when a point is one confirmation away, and only once.
      const pending = allOpen.some((b) => (this.streak[b.id] ?? 0) > 0 && (this.streak[b.id] ?? 0) < this.o.confirmCalls);
      if (!this.o.reaskOnPending || !pending || this.reasked) return;
      this.reasked = true;
    } else {
      this.reasked = false;
    }
    // Question cap: the next few open points in script order, rotating so every point gets its turn.
    let open = allOpen;
    if (allOpen.length > this.o.maxQuestions) {
      const start = this.qCursor % allOpen.length;
      open = [...allOpen.slice(start), ...allOpen.slice(0, start)].slice(0, this.o.maxQuestions);
      this.qCursor = start + this.o.maxQuestions;
    }

    this.inFlight = true;
    this.lastSent = windowText;
    this.lastCallAt = now;
    const req: DecideRequest = {
      transcript: windowText,
      bullets: open,
      sectionTitle: section.title,
      covered: section.bullets.filter((b) => s.points[b.id]?.status === "started").map((b) => b.text),
      upcoming: s.script.sections[s.sectionIdx + 1]?.bullets.map((b) => b.text) ?? [],
      onScreen: s.screen?.facts?.length ? s.screen.facts : undefined,
    };
    const ctl = new AbortController();
    this.ctl = ctl;
    const epoch = this.epoch;
    try {
      const data = await withTimeout(this.o.decide(req, ctl.signal), this.o.timeoutMs, ctl);
      if (epoch !== this.epoch) return; // stale: the script, section, points or take changed meanwhile
      this.apply(data, open.map((b) => b.id));
    } catch (err) {
      if (epoch !== this.epoch) return; // aborted by invalidate(): not an error, nothing to report
      if (err instanceof TimeoutError) {
        // Slow, not broken: the request was aborted, the next tick asks again with fresher text.
        this.lastSent = "";
        this.update((st) => {
          st.engine.slowMs = this.o.timeoutMs;
          st.engine.error = undefined;
        });
      } else {
        this.update((st) => (st.engine.error = (err as Error).message));
      }
    } finally {
      this.inFlight = false;
      if (this.ctl === ctl) this.ctl = null;
    }
  }

  private apply(data: DecideResponse, askedIds: string[]): void {
    const now = this.o.now();
    this.unmentioned = data.unmentioned ?? [];
    this.update((st) => {
      st.engine.error = undefined;
      st.engine.slowMs = data.latencyMs > this.o.tickMs * 2 ? data.latencyMs : undefined;
      st.unmentioned = data.unmentioned ?? [];
      const calls = st.stats.calls + 1;
      const totalMs = st.stats.totalMs + data.latencyMs;
      const costUsd =
        data.cost === null || st.stats.costUsd === null ? null : st.stats.costUsd + data.cost;
      st.stats = { calls, totalMs, avgMs: Math.round(totalMs / calls), costUsd, model: data.model };

      for (const d of data.decisions) {
        if (!askedIds.includes(d.id)) continue;
        const cur = st.points[d.id] ?? { status: "waiting" as const, confidence: 0 };
        if (cur.status !== "waiting") continue;
        const confirming = d.started && d.confidence >= this.o.threshold;
        this.streak[d.id] = confirming ? (this.streak[d.id] ?? 0) + 1 : 0;
        const flip =
          confirming && (d.confidence >= this.o.sureThreshold || this.streak[d.id] >= this.o.confirmCalls);
        st.points[d.id] = flip
          ? { status: "started", confidence: d.confidence, startedAt: now }
          : { status: "waiting", confidence: d.confidence };
      }
    });
    this.checkCap();
  }

  private checkCap(): void {
    const cap = this.o.costCapUsd;
    const cost = this.state.stats.costUsd;
    if (cap !== null && cost !== null && cost >= cap && this.state.engine.recording) {
      this.stop();
      this.update((st) => (st.engine.error = `cost cap of $${cap} reached; take stopped`));
    }
  }

  // ---- state plumbing -----------------------------------------------------------
  private update(mutate: (draft: SessionState) => void): void {
    const prev = this.state;
    const next: SessionState = structuredClone(prev);
    mutate(next);
    next.version = prev.version + 1;
    const ops = compare(prev, next);
    this.state = next;
    for (const fn of this.subs) fn(next, ops);
  }
}

export class TimeoutError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number, ctl?: AbortController): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      ctl?.abort();
      reject(new TimeoutError(`decision timed out after ${ms} ms`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Points with status "missed", resolved against the script, in script order. */
export function missedPoints(state: SessionState) {
  return state.script.sections.flatMap((s) => s.bullets).filter((b) => state.points[b.id]?.status === "missed");
}
