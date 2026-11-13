// The decision loop as a class. No DOM, no fetch: `decide` is injected.
// Semantics follow ARCHITECTURE.md §5.4–5.5.
import { compare, type Operation } from "fast-json-patch";
import type { DecideRequest, DecideResponse, Decision, Verification } from "./api";
import { lexicalScores } from "./gate";
import { checkClaim, type ClaimCheck } from "./guard";
import { sentences } from "./text";
import { parseScript } from "./script";
import { isScreenScript, sectionFromSummary, type ScreenNote } from "./screen";
import { PHONE_ASK_OFF } from "./types";
import type { Bullet, Command, CommandResult, Evidence, PointState, ScreenSummary, Script, SessionState, SttBackendId } from "./types";

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
  /**
   * Brings the decision model back when it has gone (a local model Ollama unloaded to make room for
   * another one). A load takes longer than `timeoutMs`, and aborting the call cancels the load, so
   * every call would time out for the rest of the take. After `reloadAfter` timeouts in a row the
   * engine calls this once, asks nothing while it runs (`engine.reloading`), and asks again when it
   * settles. Never aborted by the engine. Returns undefined when there is nothing to reload (a cloud model).
   */
  reload?: () => Promise<unknown> | undefined;
  /** timeouts in a row that start a reload (default 2) */
  reloadAfter?: number;
  /**
   * The take-start warm-up of the decision model while it is still loading (undefined once it settled
   * or when there is none). A call that times out meanwhile is the model's own first load, not an
   * unloaded model: it does not count toward `reloadAfter`, and the engine asks nothing until the
   * warm-up settles instead of starting a second load. Never aborted by the engine.
   */
  warming?: () => Promise<unknown> | undefined;
  /** at most this many open points per call; the rest rotate in on later calls (default 4) */
  maxQuestions?: number;
  /**
   * While a point has one confirming answer and waits for the second, ask once more on the next tick
   * even if the transcript did not change, instead of waiting for the next transcript segment
   * (default true). Costs one extra call per pending confirmation; cuts the flip delay by a segment.
   */
  reaskOnPending?: boolean;
  /**
   * Claim guard (guard.ts, default true): a confirming answer whose point is contradicted by what was
   * said (numbers, units, direction, negation) does not count, so a contradiction never flips a point.
   */
  guard?: boolean;
  /** Called for every confirming answer the guard rejected (diagnostics, gauntlet). */
  onGuard?: (pointId: string, check: ClaimCheck) => void;
  /**
   * Verification (default true, only with a provider that says `canVerify`): a point that is ready to
   * tick first gets two focused questions in the next call (is it presented as real, is it said of
   * the same party as the point), and ticks only when both pass. Costs at most one call per tick.
   */
  verify?: boolean;
  /**
   * Lowest passing answers of the verification. Defaults: real 0.65, same party 0.5. On two case sets
   * true points answered "real" at 0.81 or more and the false ticks it stops at 0.48 or less, so 0.65
   * sits in the gap; "same party" has a thinner gap (false up to 0.50, true from 0.52, one third-party
   * point at 0.42). Numbers in docs/gauntlet/BASELINE.md.
   */
  verifyThreshold?: { real: number; sameParty: number };
  /** Called for every verification that decided a tick: `ok` false means the point stayed open. */
  onVerify?: (pointId: string, verification: Verification, ok: boolean) => void;
  sessionId?: string;
  /** Timer injection for tests. Defaults to the global timers. */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
};

export type Subscriber = (state: SessionState, ops: Operation[]) => void;

const TAIL = 160;
const COMMITTED_CAP = 6000;
/** lexical score (gate.ts) a partial hypothesis needs to mark a point "active" */
const PARTIAL_ACTIVE = 0.5;
/** speech kept for the new place by an anchor with keep "recent" (Next): the last few seconds before the press */
const ANCHOR_RECENT_MS = 6000;

export class Engine {
  private readonly o: Required<Omit<EngineOptions, "sessionId" | "onGuard" | "onVerify" | "reload" | "warming">> & Pick<EngineOptions, "onGuard" | "onVerify" | "reload" | "warming">;
  private state: SessionState;
  private committed = "";
  private partial = "";
  private lastSent = "";
  private inFlight = false;
  /** Bumped by every command that changes what a decision is about (script, section, points, take). A reply from an older epoch is dropped. */
  private epoch = 0;
  private ctl: AbortController | null = null;
  /** decision calls that timed out since the last answer */
  private timeouts = 0;
  /** the model reload in progress: no call is made until it settles */
  private reloading: Promise<unknown> | null = null;
  /** the take-start warm-up a timed-out call waits for: no call is made until it settles */
  private warmWait: Promise<unknown> | null = null;
  private lastCallAt = -Infinity;
  private qCursor = 0;
  private reasked = false;
  private timer: unknown = null;
  private streak: Record<string, number> = {};
  /** points ready to tick that wait for their verification, asked with the next call */
  private held = new Set<string>();
  /** length of all committed text ever fed; with `segs`, dates any offset of the committed stream */
  private committedTotal = 0;
  /** committed segments still inside `committed`: where each ends in the stream and when it arrived */
  private segs: Array<{ end: number; at: number }> = [];
  /** per section: offset of the committed stream where its decisions start, set by Reset (words said before it count no more) */
  private fences = new Map<number, number>();
  /** a Reset came while words were still being transcribed: the section whose fence moves past the segment that commits them */
  private fenceNextCommit: number | null = null;
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
      reload: opts.reload,
      warming: opts.warming,
      reloadAfter: opts.reloadAfter ?? 2,
      maxQuestions: opts.maxQuestions ?? 4,
      reaskOnPending: opts.reaskOnPending ?? true,
      guard: opts.guard ?? true,
      onGuard: opts.onGuard,
      verify: opts.verify ?? true,
      verifyThreshold: opts.verifyThreshold ?? { real: 0.65, sameParty: 0.5 },
      onVerify: opts.onVerify,
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
    this.segs = [];
    this.partial = "";
    this.lastSent = "";
    this.fences.clear();
    this.fenceNextCommit = null;
    this.streak = {};
    this.held.clear();
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
    if (e.committed) {
      this.committed = (this.committed + e.committed).slice(-COMMITTED_CAP);
      this.committedTotal += e.committed.length;
      this.segs.push({ end: this.committedTotal, at: this.o.now() });
      const keepFrom = this.committedTotal - this.committed.length;
      while (this.segs.length > 1 && this.segs[0].end <= keepFrom) this.segs.shift();
      if (this.fenceNextCommit !== null) this.fences.set(this.fenceNextCommit, this.committedTotal);
      this.fenceNextCommit = null;
    } else if (e.partial === "") {
      this.fenceNextCommit = null; // the words in progress at the Reset were dropped, never committed
    }
    if (e.partial !== undefined) this.partial = e.partial;
    const tail = this.transcript.slice(-TAIL);
    if (tail !== this.state.transcriptTail) this.update((s) => (s.transcriptTail = tail));
    if (e.partial) this.hintFromPartial();
  }

  /**
   * Partial text is a hypothesis the STT may still revise ("we will raise" becomes "we will not
   * raise"), so it never reaches the decision model and can never flip a point. It may only mark an
   * open point of this section "active" when its words match; the model's next answer about that
   * point, made on committed text, replaces the hint.
   */
  private hintFromPartial(): void {
    const s = this.state;
    const section = s.script.sections[s.sectionIdx];
    if (!section) return;
    const open = section.bullets.filter((b) => (s.points[b.id]?.status ?? "waiting") === "waiting");
    if (!open.length) return;
    const hot = this.partialMatches(open);
    const on = open.filter((b) => hot.has(b.id) && !s.points[b.id]?.active).map((b) => b.id);
    const off = open.filter((b) => !hot.has(b.id) && s.points[b.id]?.active).map((b) => b.id);
    if (!on.length && !off.length) return;
    this.update((st) => {
      for (const id of on) st.points[id] = { ...(st.points[id] ?? { status: "waiting", confidence: 0 }), active: true };
      for (const id of off) delete st.points[id].active;
    });
  }

  /** Points the current partial text is about (lexical stage, gate.ts). */
  private partialMatches(points: Bullet[]): Set<string> {
    if (!this.partial.trim() || !points.length) return new Set();
    const lex = lexicalScores(this.partial, points);
    return new Set(points.filter((b) => (lex.get(b.id) ?? 0) >= PARTIAL_ACTIVE).map((b) => b.id));
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
        for (const b of section.bullets) {
          delete this.streak[b.id];
          this.held.delete(b.id);
        }
        // Start the section over: only what is said from now on is asked about. Without the fence the
        // next call sends the same words again and every point ticks back within a second or two.
        // Words still being transcribed at the Reset were said before it: their segment is fenced off
        // too when it commits.
        this.fences.set(s.sectionIdx, this.committedTotal);
        this.fenceNextCommit = this.partial.trim() ? s.sectionIdx : null;
        this.lastSent = "";
        this.invalidate();
        return { ok: true };
      }
      case "markStarted": {
        const at = this.o.now();
        return this.setPoint(cmd.id, { status: "started", confidence: 1, startedAt: at, evidence: { source: "manual", fromMs: at, toMs: at } });
      }
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
      case "anchor":
        return this.anchor(cmd.idx, cmd.pointId, cmd.keep);
      case "askOkFilow":
        // Never the engine's: questions from a phone are switched off (lib/buddy/phoneAsk.ts sessionCommand).
        return { ok: false, error: PHONE_ASK_OFF };
    }
  }

  /**
   * Re-anchoring (the "anchor" command): the presenter says they are at section `idx`, on point
   * `pointId` if given. Rules:
   * - a move never ticks a point: the open points of the sections passed going forward are missed
   *   (as with Next), the points of the target section before `pointId` are left as they are;
   * - the target section's missed points (from `pointId` on) are open again: they were missed by an
   *   earlier move past them, and the presenter is back to say them;
   * - moving to another section, the words said before the move are not asked about for it (a fence,
   *   as Reset sets); words still being transcribed at the move do count. `keep: "recent"` keeps the
   *   last ANCHOR_RECENT_MS of speech (Next: people start the next part, then press); `keep: "all"`
   *   sets no new fence (going back after a move made by mistake);
   * - moving, the target section's pending confirmations start over and a decision asked before the
   *   move is dropped when it answers;
   * - staying in the section (a click on one of its points) changes nothing in the tracking: its words,
   *   pending confirmations and the decision in flight all stand;
   * - the open points from `pointId` on are asked first.
   */
  anchor(idx: number, pointId?: string, keep?: "recent" | "all"): CommandResult {
    const s = this.state;
    const sections = s.script.sections;
    if (!sections.length) return { ok: false, error: "no script" };
    if (!Number.isInteger(idx) || idx < 0 || idx >= sections.length) return { ok: false, error: `no section ${idx}` };
    const bullets = sections[idx].bullets;
    const from = pointId === undefined ? 0 : bullets.findIndex((b) => b.id === pointId);
    if (from < 0) return { ok: false, error: `unknown point ${pointId} in section ${idx}` };
    const moved = idx !== s.sectionIdx;
    this.update((st) => {
      for (const sec of st.script.sections.slice(st.sectionIdx, Math.max(st.sectionIdx, idx))) {
        for (const b of sec.bullets) {
          const cur = st.points[b.id];
          if (!cur || cur.status === "waiting") st.points[b.id] = { status: "missed", confidence: cur?.confidence ?? 0 };
        }
      }
      for (const b of bullets.slice(from)) if (st.points[b.id]?.status === "missed") delete st.points[b.id];
      for (const p of Object.values(st.points)) delete p.active;
      st.sectionIdx = idx;
      if (pointId === undefined) delete st.here;
      else st.here = pointId;
    });
    const open = bullets.filter((b) => (this.state.points[b.id]?.status ?? "waiting") === "waiting");
    const first = open.findIndex((b) => bullets.indexOf(b) >= from);
    this.qCursor = Math.max(0, first);
    if (!moved) return { ok: true };
    for (const b of bullets) {
      delete this.streak[b.id];
      this.held.delete(b.id);
    }
    if (keep !== "all") {
      // the end of the last committed segment older than the kept stretch (none: all of it is recent)
      let cut = this.committedTotal;
      if (keep === "recent") {
        const oldest = this.o.now() - ANCHOR_RECENT_MS;
        cut = 0;
        for (const g of this.segs) if (g.at <= oldest) cut = g.end;
      }
      this.fences.set(idx, Math.max(this.fences.get(idx) ?? 0, cut));
    }
    this.lastSent = "";
    this.invalidate();
    return { ok: true };
  }

  private setPoint(id: string, state: PointState): CommandResult {
    const known = this.state.script.sections.some((sec) => sec.bullets.some((b) => b.id === id));
    if (!known) return { ok: false, error: `unknown point ${id}` };
    this.update((st) => (st.points[id] = state));
    delete this.streak[id];
    this.held.delete(id);
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
      for (const p of Object.values(st.points)) delete p.active;
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

  /**
   * A call timed out while the take-start warm-up is still loading the model: wait for it (no call
   * meanwhile, nothing counted, no reload banner). True when there was a warm-up to wait for.
   */
  private waitForWarmup(): boolean {
    const w = this.o.warming?.();
    if (!w) return false;
    const done = () => {
      this.warmWait = null;
    };
    this.warmWait = w.then(done, done);
    return true;
  }

  /**
   * One reload of the decision model (`reload` option), never aborted: no call is made until it
   * settles (tick() returns at once), then the next tick asks again with the current text, whatever
   * the outcome (a failed reload leaves the next timeouts in a row to start another one).
   */
  private startReload(): void {
    this.timeouts = 0;
    const p = this.o.reload?.();
    if (!p) return;
    const done = () => {
      this.reloading = null;
      this.update((st) => {
        delete st.engine.reloading;
      });
    };
    this.reloading = p.then(done, done);
    this.update((st) => {
      st.engine.reloading = true;
      st.engine.slowMs = undefined;
    });
  }

  /**
   * One iteration. Public so tests and surfaces can drive it without timers.
   * `verifyNow` is the engine's own follow-up call for a point that just became ready to tick: it
   * skips the pacing and the "same text" rule, which exist to stop idle or piled-up calls, not this one.
   */
  async tick(verifyNow = false): Promise<void> {
    if (this.inFlight || this.reloading || this.warmWait) return;
    const s = this.state;
    const section = s.script.sections[s.sectionIdx];
    if (!section) return;
    // Adaptive pace: a model slower than the tick is asked no more often than it can answer.
    const now = this.o.now();
    const avg = s.stats.avgMs;
    if (!verifyNow && avg > this.o.tickMs && now - this.lastCallAt < Math.round(avg * 1.2)) return;
    // Decisions, and so flips, are made on committed text only (P1 step 4): see hintFromPartial().
    const raw = this.committed;
    const end = raw.trimEnd().length;
    let startIdx = Math.max(0, end - this.o.window);
    // start at a word boundary: "quattrocentocinquanta" must not become "centocinquanta"
    if (startIdx > 0 && !/\s/.test(raw[startIdx - 1])) while (startIdx < end && !/\s/.test(raw[startIdx])) startIdx++;
    // nothing said before this section's Reset is asked about again (the fence sits between two committed segments)
    const fenceIdx = (this.fences.get(s.sectionIdx) ?? 0) - (this.committedTotal - raw.length);
    if (fenceIdx > startIdx) startIdx = fenceIdx;
    while (startIdx < end && /\s/.test(raw[startIdx])) startIdx++;
    const windowText = raw.slice(startIdx, end);
    /** offset of the window in the whole committed stream, to date the evidence of a flip */
    const windowAbs = this.committedTotal - raw.length + startIdx;
    if (!windowText) return;
    const allOpen = section.bullets.filter((b) => (s.points[b.id]?.status ?? "waiting") === "waiting");
    if (!allOpen.length) return;
    if (windowText === this.lastSent) {
      // Same text as last time: only worth a call when a point is one confirmation or its verification away, and only once.
      const pending = allOpen.some((b) => ((this.streak[b.id] ?? 0) > 0 && (this.streak[b.id] ?? 0) < this.o.confirmCalls) || this.held.has(b.id));
      if (!verifyNow && (!this.o.reaskOnPending || !pending || this.reasked)) return;
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
      // A point waiting for its verification is asked now, whatever the rotation says.
      const waiting = allOpen.filter((b) => this.held.has(b.id) && !open.includes(b));
      if (waiting.length) open = [...waiting, ...open].slice(0, this.o.maxQuestions);
    }
    // Verify in this same call the points that one more answer could tick.
    const verify = this.o.verify ? open.filter((b) => (this.streak[b.id] ?? 0) > 0 || this.held.has(b.id)).map((b) => b.id) : [];

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
      ...(verify.length ? { verify } : {}),
    };
    const ctl = new AbortController();
    this.ctl = ctl;
    const epoch = this.epoch;
    const heldBefore = this.held.size;
    let verifyNext = false;
    try {
      const data = await withTimeout(this.o.decide(req, ctl.signal), this.o.timeoutMs, ctl);
      this.timeouts = 0; // the model answered: it is loaded
      if (epoch !== this.epoch) return; // stale: the script, section, points or take changed meanwhile
      this.apply(data, req, windowAbs);
      // A point became ready to tick in this answer and waits for its verification: ask now, not on
      // the next timer tick. Once only, so a provider that never answers cannot loop.
      verifyNext = !verifyNow && this.held.size > heldBefore;
    } catch (err) {
      if (epoch !== this.epoch) return; // aborted by invalidate(): not an error, nothing to report
      if (err instanceof TimeoutError) {
        // Slow, not broken: the request was aborted, the next tick asks again with fresher text.
        this.lastSent = "";
        this.update((st) => {
          st.engine.slowMs = this.o.timeoutMs;
          st.engine.error = undefined;
        });
        if (!this.waitForWarmup() && ++this.timeouts >= this.o.reloadAfter) this.startReload();
      } else {
        this.update((st) => (st.engine.error = (err as Error).message));
      }
    } finally {
      this.inFlight = false;
      if (this.ctl === ctl) this.ctl = null;
    }
    if (verifyNext && epoch === this.epoch) await this.tick(true);
  }

  private apply(data: DecideResponse, req: DecideRequest, windowAbs: number): void {
    const now = this.o.now();
    const asked = new Map(req.bullets.map((b) => [b.id, b]));
    // The claim check runs outside the state update: it reads only the request and the answer. It
    // finds the sentence a confirming answer rests on (the evidence) and, with the guard on, rejects
    // the answer when every sentence about the point contradicts it.
    // an answer that does not flip a point keeps its "active" hint while the partial still matches it
    const stillHot = this.partialMatches(req.bullets);
    const checks = new Map<string, ClaimCheck>();
    const rejected = new Set<string>();
    for (const d of data.decisions) {
      const b = asked.get(d.id);
      if (!b || !d.started || d.confidence < this.o.threshold) continue;
      const check = checkClaim(b.text, req.transcript);
      checks.set(d.id, check);
      if (this.o.guard && !check.ok) {
        rejected.add(d.id);
        this.o.onGuard?.(d.id, check);
      }
    }
    this.unmentioned = data.unmentioned ?? [];
    this.update((st) => {
      st.engine.error = undefined;
      // "Slow" means close to the timeout, where answers start being dropped. A model slower than the
      // tick is normal (a local one takes about 1.1 s): the pacing above already adapts to it.
      st.engine.slowMs = data.latencyMs > Math.max(this.o.tickMs * 2, this.o.timeoutMs * 0.6) ? data.latencyMs : undefined;
      st.unmentioned = data.unmentioned ?? [];
      const calls = st.stats.calls + 1;
      const totalMs = st.stats.totalMs + data.latencyMs;
      const costUsd =
        data.cost === null || st.stats.costUsd === null ? null : st.stats.costUsd + data.cost;
      st.stats = { calls, totalMs, avgMs: Math.round(totalMs / calls), costUsd, model: data.model };

      for (const d of data.decisions) {
        if (!asked.has(d.id)) continue;
        const cur = st.points[d.id] ?? { status: "waiting" as const, confidence: 0 };
        if (cur.status !== "waiting") continue;
        const confirming = d.started && d.confidence >= this.o.threshold && !rejected.has(d.id);
        this.streak[d.id] = confirming ? (this.streak[d.id] ?? 0) + 1 : 0;
        let flip =
          confirming && (d.confidence >= this.o.sureThreshold || this.streak[d.id] >= this.o.confirmCalls);
        if (!confirming) this.held.delete(d.id);
        if (flip && this.o.verify && data.canVerify) {
          const v = d.verification;
          if (!v) {
            // Ready to tick but not verified yet: hold it, the next call asks the two questions.
            flip = false;
            this.held.add(d.id);
          } else {
            const ok = v.real >= this.o.verifyThreshold.real && v.sameParty >= this.o.verifyThreshold.sameParty;
            this.held.delete(d.id);
            this.o.onVerify?.(d.id, v, ok);
            if (!ok) {
              // Cancelled, denied, ironic or said of someone else: the point stays open and starts over.
              flip = false;
              this.streak[d.id] = 0;
            }
          }
        }
        st.points[d.id] = flip
          ? { status: "started", confidence: d.confidence, startedAt: now, evidence: this.evidenceFor(checks.get(d.id)!, req.transcript, windowAbs, d, data.model) }
          : { status: "waiting", confidence: d.confidence, ...(cur.active && stillHot.has(d.id) ? { active: true } : {}) };
      }
    });
    this.checkCap();
  }

  /**
   * The evidence record of a flip: the sentence the claim check found (or, when no sentence shares
   * the point's words, the window's latest sentence), and when the STT committed its first and last
   * words, from the committed segments' arrival times.
   */
  private evidenceFor(check: ClaimCheck, windowText: string, windowAbs: number, d: Decision, model: string): Evidence {
    const s = check.evidence ?? sentences(windowText).at(-1) ?? { text: windowText, start: 0, end: windowText.length };
    const from = windowAbs + s.start;
    const to = windowAbs + s.end;
    const segFrom = this.segs.find((g) => g.end > from) ?? this.segs.at(-1);
    const segTo = this.segs.find((g) => g.end >= to) ?? this.segs.at(-1);
    const now = this.o.now();
    return {
      source: "model",
      quote: s.text,
      fromMs: segFrom?.at ?? now,
      toMs: segTo?.at ?? now,
      decision: d.confidence,
      ...(d.gate !== undefined ? { gate: d.gate } : {}),
      lexical: check.evidence ? check.lexical : 0,
      model,
      ...(d.verification ? { verified: { real: d.verification.real, sameParty: d.verification.sameParty } } : {}),
    };
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
