// The decision loop as a class. No DOM, no fetch: `decide` is injected.
// Semantics follow ARCHITECTURE.md §5.4–5.5.
import { compare, type Operation } from "fast-json-patch";
import type { DecideRequest, DecideResponse } from "./api";
import { parseScript } from "./script";
import type { Command, CommandResult, PointState, ScreenSummary, Script, SessionState, SttBackendId } from "./types";

export type TranscriptEvent = { committed?: string; partial?: string };

export type EngineOptions = {
  decide: (r: DecideRequest) => Promise<DecideResponse>;
  now?: () => number;
  /** timer period; a model call happens only when the transcript changed */
  tickMs?: number;
  /** confidence needed to flip (default 0.7) */
  threshold?: number;
  /** consecutive confirming calls needed below `sureThreshold` (default 2) */
  confirmCalls?: number;
  /** a single call at or above this flips immediately (default 0.9) */
  sureThreshold?: number;
  /** characters of recent transcript sent per call */
  window?: number;
  /** stop the take when accumulated cost reaches this (USD); null disables */
  costCapUsd?: number | null;
  /** per-call timeout */
  timeoutMs?: number;
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
  private timer: unknown = null;
  private streak: Record<string, number> = {};
  private subs = new Set<Subscriber>();
  private unmentioned: string[] = [];

  constructor(opts: EngineOptions) {
    this.o = {
      decide: opts.decide,
      now: opts.now ?? (() => Date.now()),
      tickMs: opts.tickMs ?? 500,
      threshold: opts.threshold ?? 0.7,
      confirmCalls: opts.confirmCalls ?? 2,
      sureThreshold: opts.sureThreshold ?? 0.9,
      window: opts.window ?? 900,
      costCapUsd: opts.costCapUsd === undefined ? 1 : opts.costCapUsd,
      timeoutMs: opts.timeoutMs ?? 2500,
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
  subscribe(fn: Subscriber): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  // ---- script ---------------------------------------------------------------
  loadScript(script: Script): void {
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

  feedScreen(summary: ScreenSummary | null): void {
    this.update((s) => (s.screen = summary));
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
        this.update((st) => (st.screen = null));
        return { ok: true };
      case "lookNow":
        // Capture is owned by the surface; the engine only records the request.
        return { ok: true };
    }
  }

  private setPoint(id: string, state: PointState): CommandResult {
    const known = this.state.script.sections.some((sec) => sec.bullets.some((b) => b.id === id));
    if (!known) return { ok: false, error: `unknown point ${id}` };
    this.update((st) => (st.points[id] = state));
    delete this.streak[id];
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
    return { ok: true };
  }

  // ---- loop ---------------------------------------------------------------------
  start(): void {
    if (this.timer) return;
    this.lastSent = "";
    this.update((s) => {
      s.engine.recording = true;
      s.engine.error = undefined;
    });
    this.timer = this.o.setInterval(() => void this.tick(), this.o.tickMs);
  }

  stop(): void {
    if (this.timer) this.o.clearInterval(this.timer);
    this.timer = null;
    this.update((s) => {
      s.engine.recording = false;
      s.engine.backend = null;
    });
  }

  /** One iteration. Public so tests and surfaces can drive it without timers. */
  async tick(): Promise<void> {
    if (this.inFlight) return;
    const s = this.state;
    const section = s.script.sections[s.sectionIdx];
    if (!section) return;
    const windowText = this.transcript.slice(-this.o.window);
    if (!windowText || windowText === this.lastSent) return;
    const open = section.bullets.filter((b) => (s.points[b.id]?.status ?? "waiting") === "waiting");
    if (!open.length) return;

    this.inFlight = true;
    this.lastSent = windowText;
    const req: DecideRequest = {
      transcript: windowText,
      bullets: open,
      sectionTitle: section.title,
      covered: section.bullets.filter((b) => s.points[b.id]?.status === "started").map((b) => b.text),
      upcoming: s.script.sections[s.sectionIdx + 1]?.bullets.map((b) => b.text) ?? [],
      onScreen: s.screen?.facts?.length ? s.screen.facts : undefined,
    };
    try {
      const data = await withTimeout(this.o.decide(req), this.o.timeoutMs);
      this.apply(data, open.map((b) => b.id));
    } catch (err) {
      this.update((st) => (st.engine.error = (err as Error).message));
    } finally {
      this.inFlight = false;
    }
  }

  private apply(data: DecideResponse, askedIds: string[]): void {
    const now = this.o.now();
    this.unmentioned = data.unmentioned ?? [];
    this.update((st) => {
      st.engine.error = undefined;
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
    const cap = this.o.costCapUsd;
    const cost = this.state.stats.costUsd;
    if (cap !== null && cost !== null && cost >= cap) {
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

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`decision timed out after ${ms} ms`)), ms);
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
