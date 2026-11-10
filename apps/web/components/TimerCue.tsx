"use client";
// The talk timer's line (research item 3): time since the take started, the target, and a calm
// "X min behind / ahead" cue. Text only: no sound, no colour flashing, nothing that moves, so it suits
// reduced motion as it is. Shared by the prompter and the phone mirror.
import { useEffect, useState, type ReactNode } from "react";
import { formatClock, scheduleCue, talkBudget, timerView, type PointState, type Script, type TalkClock } from "@filow/core";
import { useT } from "@filow/ui";
import { Icon } from "./icons";
import "./Rehearsal.css";

export function TimerCue({ script, clock, sectionIdx, points, now = Date.now, phone = false, action }: {
  script: Pick<Script, "sections" | "minutes">;
  clock: TalkClock | null | undefined;
  sectionIdx: number;
  points: Record<string, Pick<PointState, "status">>;
  /** the prompter's time (the phone passes its clock lined up with the prompter's) */
  now?: () => number;
  phone?: boolean;
  /** a button shown at the end of the line (the prompter's "Talk length") */
  action?: ReactNode;
}) {
  const t = useT();
  const [, setTick] = useState(0);
  const running = Boolean(clock && clock.startedAt !== null && clock.endedAt === null);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const view = timerView(script, clock, sectionIdx, now(), points);
  const talkMs = view?.talkMs ?? talkBudget(script).talkMs;
  if (!view && talkMs === null) return action ? <div className={`timer-cue${phone ? " phone" : ""}`}><span className="timer-spacer" />{action}</div> : null;

  const cue = scheduleCue(view?.behindMs ?? null);
  const cueText = cue.kind === "onTime" ? t("timer.onTime") : cue.kind === "behind" ? t("timer.behind", { n: cue.minutes }) : cue.kind === "ahead" ? t("timer.ahead", { n: cue.minutes }) : "";
  const section = view && view.sectionMs !== null ? view.sectionMs - view.sectionElapsedMs : null;
  return (
    <div className={`timer-cue${phone ? " phone" : ""}`} role="group" aria-label={t("timer.label")}>
      <span className="timer-main">
        <Icon name="clock" />
        <span className="timer-elapsed" role="timer">{formatClock(view?.elapsedMs ?? 0)}</span>
        {talkMs !== null && <span className="timer-target">{t("timer.of", { target: formatClock(talkMs) })}</span>}
      </span>
      {/* announced when it changes, which is at most once a minute */}
      <span className={`timer-badge${cue.kind === "behind" ? " behind" : ""}`} aria-live="polite">{cueText}</span>
      {view?.running && section !== null && (
        <span className="timer-detail">{section >= 0 ? t("timer.sectionLeft", { t: formatClock(section) }) : t("timer.sectionOver", { t: formatClock(-section) })}</span>
      )}
      {view?.running && view.pointsLeft > 0 && <span className="timer-detail">{t("timer.pointsLeft", { n: view.pointsLeft })}</span>}
      {action && <><span className="timer-spacer" />{action}</>}
    </div>
  );
}
