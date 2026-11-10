// The talk timer (research item 3): an optional target length for the talk and for each section,
// stored with the script ("<!-- target: 20 min -->", "# Intro (3 min)", see script.ts), the time
// since the take started, and a calm "X min behind / ahead" cue. Pure: the caller passes the time.
import type { PointState, Script, SessionState, TalkClock } from "./types";

const MIN = 60_000;

/**
 * Follows a take through the engine's state: when recording starts and stops, and which section
 * shows when. `observe` is safe to call any number of times with the same state.
 *
 * A script loaded during a take (Reload, Edit, a script sent from the browser or a phone; the
 * caller says so with `scriptLoading`) starts the clock again: the engine itself goes back to the
 * first section and forgets every tick, so the old times would be measured against the wrong
 * sections.
 */
export class TalkClockTracker {
  private startedAt: number | null = null;
  private endedAt: number | null = null;
  private entries: Array<{ idx: number; at: number }> = [];
  private recording = false;
  private reloadPending = false;

  /** Call right before the engine loads a script; the next state observed during a take restarts the clock. */
  scriptLoading(): void {
    this.reloadPending = true;
  }

  /** True when the clock changed (a take started, restarted or stopped, or another section shows). */
  observe(state: Pick<SessionState, "sectionIdx"> & { engine: Pick<SessionState["engine"], "recording"> }, now: number): boolean {
    const rec = state.engine.recording;
    const reloaded = rec && this.recording && this.reloadPending;
    this.reloadPending = false;
    if ((rec && !this.recording) || reloaded) {
      this.recording = true;
      this.startedAt = now;
      this.endedAt = null;
      this.entries = [{ idx: state.sectionIdx, at: now }];
      return true;
    }
    if (!rec && this.recording) {
      this.recording = false;
      this.endedAt = now;
      return true;
    }
    const last = this.entries[this.entries.length - 1];
    if (rec && last && last.idx !== state.sectionIdx) {
      this.entries.push({ idx: state.sectionIdx, at: now });
      return true;
    }
    return false;
  }

  snapshot(now: number): TalkClock {
    return { startedAt: this.startedAt, endedAt: this.endedAt, entries: this.entries.map((e) => ({ ...e })), sentAt: now };
  }
}

/**
 * The time each section may take, in ms. A section with its own target keeps it. When the talk has a
 * target, what is left of it goes to the sections without one, in proportion to their points (at
 * least one share each). `talkMs` is the talk target, or the sum of the sections when every
 * section has one; otherwise null.
 */
export function talkBudget(script: Pick<Script, "sections" | "minutes">): { talkMs: number | null; sections: Array<number | null> } {
  const own = script.sections.map((s) => (s.minutes && s.minutes > 0 ? s.minutes * MIN : null));
  const ownSum = own.reduce<number>((a, b) => a + (b ?? 0), 0);
  const talkMs = script.minutes && script.minutes > 0 ? script.minutes * MIN : own.length > 0 && own.every((x) => x !== null) ? ownSum : null;
  if (!script.minutes || script.minutes <= 0) return { talkMs, sections: own };
  const rest = script.minutes * MIN - ownSum;
  const weight = (i: number) => Math.max(1, script.sections[i].bullets.length);
  const open = own.map((x, i) => (x === null ? i : -1)).filter((i) => i >= 0);
  const totalWeight = open.reduce((a, i) => a + weight(i), 0);
  const sections = own.map((x, i) => (x !== null ? x : rest > 0 && totalWeight > 0 ? (rest * weight(i)) / totalWeight : null));
  return { talkMs, sections };
}

/** Time spent in each section during the take, in ms (a section shown twice adds up). */
export function sectionTimes(clock: Pick<TalkClock, "entries" | "endedAt">, sectionCount: number, now: number): number[] {
  const out = new Array<number>(sectionCount).fill(0);
  const end = clock.endedAt ?? now;
  clock.entries.forEach((e, i) => {
    const until = Math.min(end, clock.entries[i + 1]?.at ?? end);
    if (e.idx >= 0 && e.idx < sectionCount) out[e.idx] += Math.max(0, until - e.at);
  });
  return out;
}

export type TimerView = {
  running: boolean;
  elapsedMs: number;
  /** the talk target, when there is one */
  talkMs: number | null;
  /** talk target minus elapsed (negative: over) */
  remainingMs: number | null;
  sectionElapsedMs: number;
  sectionMs: number | null;
  /** positive: behind the plan, negative: ahead; null when the plan is incomplete */
  behindMs: number | null;
  /** points of the current section not covered yet */
  pointsLeft: number;
};

/**
 * What the timer shows now. Null before the first take. The cue needs a budget for every section
 * (from their own targets or the talk target): it compares when the furthest section reached
 * started with when the plan wanted it, plus any time since beyond its budget. Going back to an
 * earlier section (to make a point again) counts as time spent in the furthest one, not as a
 * restart of the talk.
 */
export function timerView(
  script: Pick<Script, "sections" | "minutes">,
  clock: Pick<TalkClock, "startedAt" | "endedAt" | "entries"> | null | undefined,
  sectionIdx: number,
  now: number,
  points: Record<string, Pick<PointState, "status">> = {},
): TimerView | null {
  if (!clock || clock.startedAt === null || clock.entries.length === 0) return null;
  const end = clock.endedAt ?? now;
  const elapsedMs = Math.max(0, end - clock.startedAt);
  const budget = talkBudget(script);
  const last = clock.entries[clock.entries.length - 1];
  const idx = clock.endedAt === null ? sectionIdx : last.idx;
  const enteredAt = last.idx === idx ? last.at : end;
  const sectionElapsedMs = Math.max(0, end - enteredAt);
  const sectionMs = budget.sections[idx] ?? null;
  let behindMs: number | null = null;
  if (budget.sections.length > 0 && budget.sections.every((b) => b !== null)) {
    const furthest = Math.max(idx, ...clock.entries.map((e) => e.idx));
    const reachedAt = clock.entries.find((e) => e.idx === furthest)?.at ?? enteredAt;
    const plannedStart = budget.sections.slice(0, furthest).reduce<number>((a, b) => a + (b ?? 0), 0);
    behindMs = reachedAt - clock.startedAt - plannedStart + Math.max(0, end - reachedAt - (budget.sections[furthest] ?? 0));
  }
  const section = script.sections[idx];
  const pointsLeft = section ? section.bullets.filter((b) => points[b.id]?.status !== "started").length : 0;
  return {
    running: clock.endedAt === null,
    elapsedMs,
    talkMs: budget.talkMs,
    remainingMs: budget.talkMs === null ? null : budget.talkMs - elapsedMs,
    sectionElapsedMs,
    sectionMs,
    behindMs,
    pointsLeft,
  };
}

/** Within half a minute either way counts as on time; otherwise whole minutes, at least one. */
export function scheduleCue(behindMs: number | null): { kind: "none" | "onTime" | "behind" | "ahead"; minutes: number } {
  if (behindMs === null) return { kind: "none", minutes: 0 };
  if (Math.abs(behindMs) < 30_000) return { kind: "onTime", minutes: 0 };
  return { kind: behindMs > 0 ? "behind" : "ahead", minutes: Math.max(1, Math.round(Math.abs(behindMs) / MIN)) };
}

/** "4:05", "1:02:09"; a negative time keeps its sign. */
export function formatClock(ms: number): string {
  const sign = ms < 0 ? "-" : "";
  const s = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${sign}${h}:${String(m).padStart(2, "0")}:${ss}` : `${sign}${m}:${ss}`;
}

/**
 * The prompter's clock on another device: the offset between the two clocks is taken from `sentAt`
 * when the clock arrives (network delay of a local link is far below the timer's one second).
 */
export function remoteNow(clock: Pick<TalkClock, "sentAt">, receivedAt: number, localNow: number): number {
  return localNow - (receivedAt - clock.sentAt);
}
