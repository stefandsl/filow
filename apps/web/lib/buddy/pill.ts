// The status pill next to the pointer and the panel's status row (docs/okfilow/PILL.md): what they
// show in each state, and the two shortcuts. Pure, so the panel, the overlay and the tests agree.
import type { OkFilowMode } from "./bridge";
import type { OkfKey } from "./text";

/** What the panel tells main, and main every overlay: the eye as it is now, and where the answer stands. */
export type PillState = {
  /** The next question would take the screen with it (the effective setting, live). */
  sees: boolean;
  /** The answer in progress is paused. */
  paused: boolean;
  /** The answer was stopped and can be carried on. */
  resumable: boolean;
};
export const PILL_IDLE: PillState = { sees: true, paused: false, resumable: false };

/** A control of the pill: what a click, or a shortcut, asks for. */
export type PillAction = "eye" | "pause" | "resume" | "stop";
export const isPillAction = (v: unknown): v is PillAction => v === "eye" || v === "pause" || v === "resume" || v === "stop";

/** The choices for the eye's shortcut and for Pause/Resume (okFilow.eyeKey, okFilow.pauseKey). The first is the default. */
export const EYE_KEYS = ["ctrl+alt+shift+h", "ctrl+alt+shift+f7", "none"] as const;
export const PAUSE_KEYS = ["ctrl+alt+shift+g", "ctrl+alt+shift+f8", "none"] as const;

/** "ctrl+alt+shift+h" as people read it: "Ctrl + Alt + Shift + H". "" for no shortcut. */
export function keyLabel(choice: string | undefined): string {
  if (!choice || choice === "none") return "";
  return choice.split("+").map((p) => (p.length <= 2 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1))).join(" + ");
}

/** A control's tooltip: what it does, and its shortcut when it has one. */
export const withKey = (what: string, key: string): string => (key ? `${what} (${key})` : what);

export type PillView = {
  /** The pill is on screen. */
  show: boolean;
  /** The eye button is part of it (not while dictating: no question is being asked). */
  eye: boolean;
  status: OkfKey;
  /** The first control: Pause while answering, Resume while paused or stopped. Null: none. */
  first: "pause" | "resume" | null;
  /** Stop, while an answer is in progress (paused or not). */
  stop: boolean;
};

/** Every status the pill can show, so its room is as wide as the widest and nothing jumps. */
export const PILL_STATUSES: OkfKey[] = ["notchLooking", "notchNotLooking", "notchAnswering", "paused", "stopped", "notchListening", "notchHandsFree", "notchDictating"];

/** The statuses of an answer in progress share one room: looking, not looking, answering and paused swap without the pill changing width. */
export const ANSWER_STATUSES: OkfKey[] = ["notchLooking", "notchNotLooking", "notchAnswering", "paused"];
/** The labels that size the status's room: the whole group for an answer in progress, the status alone otherwise. */
export const statusRoom = (status: OkfKey): OkfKey[] => (ANSWER_STATUSES.includes(status) ? ANSWER_STATUSES : [status]);

/**
 * The pill in one state. Answering: [eye] status [Pause] [Stop]; paused: [eye] "Paused" [Resume]
 * [Stop]; stopped and resumable: [eye] "Stopped" [Resume]; listening: [eye] status.
 */
export function pillView(s: { mode: OkFilowMode; purpose?: string; stopped?: boolean; pill: PillState }): PillView {
  const answering = s.mode === "thinking" || s.mode === "speaking";
  if (answering) {
    const status: OkfKey = s.pill.paused ? "paused" : s.mode === "speaking" ? "notchAnswering" : s.pill.sees ? "notchLooking" : "notchNotLooking";
    return { show: true, eye: true, status, first: s.pill.paused ? "resume" : "pause", stop: true };
  }
  if (s.mode === "listening") {
    const dictating = s.purpose === "dictate";
    return { show: true, eye: !dictating, status: dictating ? "notchDictating" : s.purpose === "handsfree" ? "notchHandsFree" : "notchListening", first: null, stop: false };
  }
  // Stopped: the pill stays with the bubble while the answer can be carried on.
  if (s.mode === "idle" && s.stopped && s.pill.resumable) return { show: true, eye: true, status: "stopped", first: "resume", stop: false };
  return { show: false, eye: false, status: "stopped", first: null, stop: false };
}

/**
 * What the Pause/Resume key does right now: pause an answer in progress, carry on a paused one or a
 * stopped one that can be continued; nothing otherwise (the same rule as main's, okfilow-stop.js).
 */
export function pauseKeyAction(mode: OkFilowMode, pill: PillState): "pause" | "resume" | null {
  if (mode === "thinking" || mode === "speaking") return pill.paused ? "resume" : "pause";
  return pill.resumable ? "resume" : null;
}
