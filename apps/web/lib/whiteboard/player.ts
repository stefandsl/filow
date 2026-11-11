// The step player: which step is on the board, whether the lesson is playing, and what happens
// when a step has been spoken, when the next one arrives from the model, and when the user presses
// a control. Pure state: the page speaks and draws, this decides.

export type PlayerState = {
  /** The step shown (-1: nothing yet). */
  index: number;
  /** Steps that have arrived. */
  total: number;
  /** Steps the lesson will have once the model is done (the outline says how many). */
  expected: number;
  playing: boolean;
  /** showing: the step is being drawn and spoken. waiting: the next step has not arrived. done: the end. */
  phase: "idle" | "showing" | "waiting" | "done";
  /** Goes up every time a step is (re)shown: the page speaks and animates once per value. */
  turn: number;
};

export type PlayerAction =
  | { type: "reset"; expected: number }
  | { type: "expect"; expected: number }
  | { type: "arrived"; total: number }
  | { type: "spoken"; turn: number }
  | { type: "play" | "pause" | "next" | "back" | "replay" }
  | { type: "goto"; index: number };

export const initialPlayer: PlayerState = { index: -1, total: 0, expected: 0, playing: false, phase: "idle", turn: 0 };

const show = (s: PlayerState, index: number, extra: Partial<PlayerState> = {}): PlayerState => ({ ...s, ...extra, index, phase: "showing", turn: s.turn + 1 });

export function playerReducer(s: PlayerState, a: PlayerAction): PlayerState {
  switch (a.type) {
    case "reset":
      return { ...initialPlayer, expected: a.expected, playing: true, phase: "waiting", turn: s.turn };
    case "expect": {
      const expected = Math.max(a.expected, s.total);
      const atEnd = s.index + 1 >= s.total;
      // more steps are coming (a follow-up): the end is no longer the end
      if (s.phase === "done" && expected > s.total) return { ...s, expected, phase: "waiting", playing: true };
      // the steps the lesson was waiting for will not come (the model stopped early): this is the end
      if (s.phase === "waiting" && expected <= s.total && atEnd && s.total > 0) return { ...s, expected, phase: "done", playing: false };
      return { ...s, expected };
    }
    case "arrived": {
      const next = { ...s, total: Math.max(s.total, a.total), expected: Math.max(s.expected, a.total) };
      // the lesson was waiting for exactly this step
      return next.phase === "waiting" && next.playing && next.index + 1 < next.total ? show(next, next.index + 1) : next;
    }
    case "spoken":
      // a step that is no longer the one on the board, or a paused lesson, does not move on
      if (a.turn !== s.turn || !s.playing || s.phase !== "showing") return s;
      if (s.index + 1 < s.total) return show(s, s.index + 1);
      return s.total < s.expected ? { ...s, phase: "waiting" } : { ...s, phase: "done", playing: false };
    case "play":
      if (s.total === 0) return { ...s, playing: true };
      if (s.phase === "done") return show(s, 0, { playing: true });
      // a paused step is spoken again from its start
      return s.phase === "waiting" ? { ...s, playing: true } : show(s, Math.max(0, s.index), { playing: true });
    case "pause":
      return { ...s, playing: false };
    case "next":
      return s.index + 1 < s.total ? show(s, s.index + 1) : s;
    case "back":
      return s.index > 0 ? show(s, s.index - 1) : s;
    case "replay":
      return s.index >= 0 ? show(s, s.index) : s;
    case "goto":
      return a.index >= 0 && a.index < s.total ? show(s, a.index, { playing: true }) : s;
  }
}

/** How long a step stays on the board when no voice reads it: reading time for its sentence. */
export const readingMs = (say: string) => Math.min(12_000, Math.max(2_600, 1_600 + Array.from(say).length * 60));
