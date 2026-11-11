"use client";
// The talk timer on the phone mirror: the prompter sends its clock with the state (TimerClock.ts);
// the phone lines its own clock up with the prompter's from the time the clock was sent.
import { useLayoutEffect, useState } from "react";
import { remoteNow, type SessionState } from "@filow/core";
import { TimerCue } from "./TimerCue";

/** A clock message: when the prompter sent it (its clock) and when it got here (this device's clock). */
export type Arrival = { sentAt: number; at: number };

/** Arrivals older than this are forgotten, so a clock that was set anew is followed within a minute. */
export const ARRIVAL_KEEP_MS = 60_000;
/** No delay on a local link is this long: the gap between the two clocks itself has changed. */
export const CLOCK_JUMP_MS = 15_000;

const gap = (a: Arrival) => a.at - a.sentAt;

/**
 * Which arrival to line the clocks up with. `at - sentAt` is the gap between the two clocks plus the
 * time the message travelled (or waited: a phone that joins late first gets a clock sent up to five
 * seconds before). The gap is the same for every message, so the smallest value among the recent
 * arrivals is the closest to it: a slow message is ignored instead of moving the timer.
 */
export function bestArrival(kept: Arrival[]): Arrival | null {
  return kept.reduce<Arrival | null>((best, a) => (best && gap(best) <= gap(a) ? best : a), null);
}

/** The recent arrivals with `next` added; they start again from `next` when a clock was set anew. */
export function keepArrival(kept: Arrival[], next: Arrival): Arrival[] {
  const best = bestArrival(kept);
  if (best && gap(next) - gap(best) > CLOCK_JUMP_MS) return [next];
  return [...kept.filter((a) => next.at - a.at <= ARRIVAL_KEEP_MS), next];
}

export function TimerMirror({ state }: { state: SessionState }) {
  const clock = state.clock;
  const sentAt = clock?.sentAt;
  // Taken while rendering, so the first paint already shows the prompter's time (a phone's own clock
  // can be minutes off); later clocks are weighed before the next paint.
  const [kept, setKept] = useState<Arrival[]>(() => (sentAt !== undefined ? [{ sentAt, at: Date.now() }] : []));
  useLayoutEffect(() => {
    if (sentAt === undefined) return;
    const at = Date.now();
    setKept((k) => (k.some((a) => a.sentAt === sentAt) ? k : keepArrival(k, { sentAt, at })));
  }, [sentAt]);
  const best = bestArrival(kept);
  if (!state.script.sections.length) return null;
  const now = () => (best ? remoteNow(best, best.at, Date.now()) : Date.now());
  return (
    <div className="mirror-timer">
      <TimerCue phone script={state.script} clock={clock} sectionIdx={state.sectionIdx} points={state.points} now={now} />
    </div>
  );
}
