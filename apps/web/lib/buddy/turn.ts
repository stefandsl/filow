// The answer in progress, so the user can stop it (the Stop button, Escape, or the talk keys pressed
// again), pause it and carry on later. A stop is not an error: what was already said stays, and the
// conversation keeps it so the next question still makes sense. After a stop the answer can be
// resumed (docs/okfilow/PILL.md): the model carries on from the last whole sentence, or the voice
// from the first sentence it has not spoken.
import type { BuddyTurn } from "./prompt";

export type StoppedAnswer = {
  question: string;
  /** What was on screen when the answer was stopped ("" when it had not started). */
  shown: string;
  /** The conversation after the stop. */
  history: BuddyTurn[];
};

/**
 * What Resume does after a stop:
 *   continue - the text was still arriving: the model carries on from the part shown;
 *   again    - nothing was shown yet: the same question is asked again;
 *   speak    - the whole answer was there: the voice and the pen carry on, no request to the model.
 */
export type ResumeOffer = { kind: "continue" | "again" | "speak"; question: string; shown: string };

const MARKS = ".!?…";
const WIDE_MARKS = "。！？";
const CLOSERS = "\"')]»”’」』）";
/** The text ends with a closing mark (a full stop, also a Japanese one), quotes and brackets after it allowed. */
const ENDED = /[.!?…。！？]["')\]»”’」』）]*$/;

/** Where each sentence of a text starts and ends. A line break ends one too; the last may be unfinished. */
function sentenceRanges(text: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let start = 0;
  const push = (end: number) => {
    if (text.slice(start, end).trim()) out.push({ start, end });
    start = end;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") { push(i + 1); continue; }
    const wide = WIDE_MARKS.includes(ch);
    if (!wide && !MARKS.includes(ch)) continue;
    let j = i + 1;
    while (j < text.length && (MARKS + WIDE_MARKS + CLOSERS).includes(text[j])) j++;
    // A Latin mark ends a sentence only before a space or at the end ("3.5" and "file.txt" stay whole).
    if (wide || j >= text.length || /\s/.test(text[j])) push(j);
    i = j - 1;
  }
  push(text.length);
  return out;
}

/** The sentences of a text, in order, each trimmed. The last one may be unfinished. */
export const splitSentences = (text: string): string[] => sentenceRanges(text).map((r) => text.slice(r.start, r.end).trim());

/** The text up to the end of its last whole sentence ("" when it has none yet). */
export function cutToSentence(shown: string): string {
  const ranges = sentenceRanges(shown);
  while (ranges.length && !ENDED.test(shown.slice(ranges[ranges.length - 1].start, ranges[ranges.length - 1].end).trim())) ranges.pop();
  return ranges.length ? shown.slice(0, ranges[ranges.length - 1].end).trim() : "";
}

/** A sentence without spacing, marks and capitals, to tell a repeat from new words. */
const bare = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
const WIDE_TEXT = /[\u3001-\u30ff\u3400-\u9fff\uff00-\uffef]/;

/**
 * The stopped answer with its continuation. A model asked to carry on often starts by saying again
 * what it had said: the leading sentences of `continuation` that `shown` already has are dropped.
 * `partial`: the continuation is still arriving, so a first sentence that so far reads like the start
 * of one already shown is held back until it is whole (nothing appears and then goes away).
 */
export function joinContinuation(shown: string, continuation: string, opts: { partial?: boolean } = {}): string {
  const have = splitSentences(shown).map(bare).filter(Boolean);
  const ranges = sentenceRanges(continuation);
  let from = 0;
  for (let i = 0; i < ranges.length; i++) {
    const piece = continuation.slice(ranges[i].start, ranges[i].end).trim();
    const b = bare(piece);
    const whole = ENDED.test(piece) || i < ranges.length - 1;
    const repeat = !b || (whole ? have.includes(b) : opts.partial === true && have.some((h) => h.startsWith(b)));
    if (!repeat) break;
    from = ranges[i].end;
  }
  const rest = continuation.slice(from).trim();
  const head = shown.trimEnd();
  if (!rest) return head;
  if (!head) return rest;
  // A list goes on with a new line; text written without spaces is joined without one.
  const glue = /^([-*•]|\d+[.)])\s/.test(rest) ? "\n" : WIDE_TEXT.test(head.slice(-1)) || WIDE_TEXT.test(rest[0]) ? "" : " ";
  return head + glue + rest;
}

/**
 * What a Resume starts from. "continue": the part shown is cut back to its last whole sentence and
 * the conversation's last answer becomes that part, so the model carries on from it. When no whole
 * sentence was shown the question is simply asked again (and leaves the conversation until it is
 * answered).
 */
export function resumePlan(offer: ResumeOffer, history: BuddyTurn[]): { kind: ResumeOffer["kind"]; question: string; shown: string; history: BuddyTurn[] } {
  if (offer.kind !== "continue") return { ...offer, history };
  const cut = cutToSentence(offer.shown);
  const last = history[history.length - 1];
  const prev = history[history.length - 2];
  const ours = last?.role === "assistant" && last.text === offer.shown && prev?.role === "user" && prev.text === offer.question;
  if (!cut) return { kind: "again", question: offer.question, shown: "", history: ours ? history.slice(0, -2) : history };
  // The conversation no longer ends with this answer (it was cleared or changed): ask again rather than continue something else.
  if (!ours) return { kind: "again", question: offer.question, shown: "", history };
  return { kind: "continue", question: offer.question, shown: cut, history: [...history.slice(0, -1), { role: "assistant", text: cut }] };
}

export function createAnswerTurn() {
  let cur: { id: number; question: string; shown: string; kept: boolean; resumable: boolean; abort?: AbortController; paused: boolean; buffered: string | null; waiting: Array<(go: boolean) => void> } | null = null;
  let offer: ResumeOffer | null = null;
  /** Lets go of whoever waits for a Resume: `go` false when the answer is over instead. */
  const release = (c: NonNullable<typeof cur>, go: boolean) => {
    const list = c.waiting;
    c.waiting = [];
    for (const fn of list) fn(go);
  };
  return {
    /**
     * A new answer starts: `abort` ends its request to the model. `resumable` false: a stop of this
     * answer offers no Resume (a drawing request). Any earlier offer is gone: a new question was asked.
     */
    begin(id: number, question: string, abort?: AbortController, opts: { resumable?: boolean } = {}) {
      if (cur) release(cur, false);
      offer = null;
      cur = { id, question, shown: "", kept: false, resumable: opts.resumable !== false, abort, paused: false, buffered: null, waiting: [] };
    },
    /**
     * The text so far (tags and unfinished blocks already taken out). True when it may be shown now;
     * false while paused: it is kept and handed out by resume(), and a stop does not count it as said.
     */
    progress(id: number, shown: string): boolean {
      if (cur?.id !== id) return false;
      if (cur.paused) { cur.buffered = shown; return false; }
      cur.shown = shown;
      return true;
    },
    /** The whole answer is in the conversation already (it is being spoken or drawn now). */
    kept(id: number) {
      if (cur?.id === id) cur.kept = true;
    },
    /** The answer ended by itself. */
    end(id: number) {
      if (cur?.id !== id) return;
      release(cur, false);
      cur = null;
    },
    active: () => cur !== null,
    /** Pauses the answer in progress. False when there is none or it is paused already. */
    pause(): boolean {
      if (!cur || cur.paused) return false;
      cur.paused = true;
      return true;
    },
    paused: () => cur?.paused === true,
    /**
     * Carries on after a pause. Null when nothing was paused; else the text that arrived meanwhile
     * (to show now), or "" when none did.
     */
    resume(): string | null {
      if (!cur?.paused) return null;
      cur.paused = false;
      const text = cur.buffered;
      cur.buffered = null;
      if (text !== null) cur.shown = text;
      release(cur, true);
      return text ?? "";
    },
    /**
     * Resolves at once while the answer `id` is not paused, else when it is resumed (true), or when it
     * was stopped or replaced meanwhile (false): what waits behind it (the next marks, the voice, an
     * error) must not happen during a pause.
     */
    unpaused(id: number): Promise<boolean> {
      if (cur?.id !== id) return Promise.resolve(false);
      if (!cur.paused) return Promise.resolve(true);
      const c = cur;
      return new Promise((resolve) => c.waiting.push(resolve));
    },
    /**
     * Stops the answer in progress: its request is aborted (the server then stops the model) and the
     * part already shown goes into the conversation as the answer. Null when nothing was in progress.
     * What Resume would do is kept (offer()) until a new question, or discard().
     */
    stop(history: BuddyTurn[]): StoppedAnswer | null {
      const c = cur;
      if (!c) return null;
      cur = null;
      release(c, false);
      c.abort?.abort();
      const shown = c.shown.trim();
      // Nothing was said yet: the question is dropped too, so no question is left without an answer.
      const next = c.kept || !shown ? history : [...history, { role: "user" as const, text: c.question }, { role: "assistant" as const, text: shown }].slice(-12);
      offer = c.resumable ? { kind: c.kept ? "speak" : shown ? "continue" : "again", question: c.question, shown } : null;
      return { question: c.question, shown, history: next };
    },
    /** What Resume would do for the answer that was stopped, or null when it cannot be continued. */
    offer: () => offer,
    /** Resume is no longer possible: a new question was asked, or the conversation was cleared. */
    discard() {
      offer = null;
    },
  };
}
export type AnswerTurn = ReturnType<typeof createAnswerTurn>;
