// Hands-free dictation (issue #2, like Wispr Flow): the microphone stays open and the words go into the
// focused field phrase by phrase, after each pause. Pure logic for the OK Filow panel, unit tested.
//
// Two things happen while the user speaks: the recognizer closes phrases (stt-worker.js: a streaming model
// at its endpoint, a phrase model at every short silence, so often several per sentence), and the
// voice-activity detector OK Filow's hands-free questions use (lib/buddy/listen.ts createVad) hears a real
// pause. Text is typed when both have happened: closed phrases wait for the pause, and a pause that came
// before the recognizer closed its phrase types that phrase the moment it arrives.

import { joinTranscript } from "@/lib/buddy/bridge";

export type PhraseFlow = {
  /** The recognizer closed a phrase at time `now` (ms). Returns the text to type now, or "". */
  committed(text: string, now: number): string;
  /** The voice-activity detector heard a pause after speech. Returns the text to type now, or "". */
  pause(now: number): string;
  /**
   * Called with every microphone reading. Returns the text to type now, or "": closed phrases that the
   * detector never followed with a pause (it learns the room from quiet moments and can be late when the
   * user speaks from the very first instant) are typed once no new phrase has closed for `idleMs`.
   */
  tick(now: number): string;
  /** Closed phrases not typed yet (they are typed at the next pause, or when the dictation stops). */
  pending(): string[];
  /** How many times text was handed out to be typed. */
  readonly typed: number;
};

/**
 * `dueMs`: how long after a pause a phrase that closes late still counts as belonging to that pause.
 * `maxHoldMs`: closed phrases never wait longer than this for a pause (a noisy room where the level never
 * drops): they are typed with the next phrase that closes.
 * `idleMs`: see tick().
 */
export function createPhraseFlow(o: { dueMs?: number; maxHoldMs?: number; idleMs?: number } = {}): PhraseFlow {
  const dueMs = o.dueMs ?? 2500;
  const maxHoldMs = o.maxHoldMs ?? 6000;
  const idleMs = o.idleMs ?? 2000;
  let held: string[] = [];
  let heldSince = -1;
  let lastClosed = -1;
  let pausedAt = -1;
  let typed = 0;
  const take = (): string => {
    const text = joinTranscript(held, "");
    held = [];
    heldSince = -1;
    pausedAt = -1;
    if (text) typed++;
    return text;
  };
  return {
    committed(text, now) {
      const t = String(text || "").trim();
      if (!t) return "";
      if (!held.length) heldSince = now;
      held.push(t);
      lastClosed = now;
      if (pausedAt >= 0 && now - pausedAt <= dueMs) return take();
      pausedAt = -1;
      return now - heldSince >= maxHoldMs ? take() : "";
    },
    pause(now) {
      if (held.length) return take();
      pausedAt = now;
      return "";
    },
    tick(now) {
      return held.length && now - lastClosed >= idleMs ? take() : "";
    },
    pending: () => [...held],
    get typed() { return typed; },
  };
}
