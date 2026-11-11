// The answer in progress, so the user can stop it (the Stop button, Escape, or the talk keys pressed
// again). A stop is not an error: what was already said stays, and the conversation keeps it so the
// next question still makes sense.
import type { BuddyTurn } from "./prompt";

export type StoppedAnswer = {
  question: string;
  /** What was on screen when the answer was stopped ("" when it had not started). */
  shown: string;
  /** The conversation after the stop. */
  history: BuddyTurn[];
};

export function createAnswerTurn() {
  let cur: { id: number; question: string; shown: string; kept: boolean; abort?: AbortController } | null = null;
  return {
    /** A new answer starts: `abort` ends its request to the model. */
    begin(id: number, question: string, abort?: AbortController) {
      cur = { id, question, shown: "", kept: false, abort };
    },
    /** The text shown so far (tags and unfinished blocks already taken out). */
    progress(id: number, shown: string) {
      if (cur?.id === id) cur.shown = shown;
    },
    /** The whole answer is in the conversation already (it is being spoken or drawn now). */
    kept(id: number) {
      if (cur?.id === id) cur.kept = true;
    },
    /** The answer ended by itself. */
    end(id: number) {
      if (cur?.id === id) cur = null;
    },
    active: () => cur !== null,
    /**
     * Stops the answer in progress: its request is aborted (the server then stops the model) and the
     * part already shown goes into the conversation as the answer. Null when nothing was in progress.
     */
    stop(history: BuddyTurn[]): StoppedAnswer | null {
      const c = cur;
      if (!c) return null;
      cur = null;
      c.abort?.abort();
      const shown = c.shown.trim();
      // Nothing was said yet: the question is dropped too, so no question is left without an answer.
      const next = c.kept || !shown ? history : [...history, { role: "user" as const, text: c.question }, { role: "assistant" as const, text: shown }].slice(-12);
      return { question: c.question, shown, history: next };
    },
  };
}
export type AnswerTurn = ReturnType<typeof createAnswerTurn>;
