"use client";
// The talk timer on the phone mirror: the prompter sends its clock with the state (TimerClock.ts);
// the phone lines its own clock up with the prompter's from the time the clock was sent.
import { useEffect, useState } from "react";
import { remoteNow, type SessionState } from "@filow/core";
import { TimerCue } from "./TimerCue";

export function TimerMirror({ state }: { state: SessionState }) {
  const clock = state.clock;
  const sentAt = clock?.sentAt;
  const [received, setReceived] = useState<{ sentAt: number; at: number } | null>(null);
  useEffect(() => {
    if (sentAt !== undefined) setReceived({ sentAt, at: Date.now() });
  }, [sentAt]);
  if (!state.script.sections.length) return null;
  const now = () => (received ? remoteNow(received, received.at, Date.now()) : Date.now());
  return (
    <div className="mirror-timer">
      <TimerCue phone script={state.script} clock={clock} sectionIdx={state.sectionIdx} points={state.points} now={now} />
    </div>
  );
}
