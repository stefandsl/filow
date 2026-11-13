// Drawn in step with the words (HeyClicky: a line's drawing starts when that line's audio starts). Each
// mark belongs to the sentence its tag stands in, and is drawn when the voice starts that sentence, not
// all at once when the text arrives. Pure, so it is unit tested; the panel releases the marks
// (app/okfilow/panel/page.tsx) and the overlay appends them to the drawing without restarting the others.
import { parseBuddyAnswer, type BuddyMark, type BuddyScreen } from "./prompt";
import { splitSentences } from "./turn";
import { appendStarts, SENTENCE_GAP_MS, STROKE_GAP_MS } from "./motion";

type AnyMark = Pick<BuddyMark, "kind" | "label"> & Partial<Record<"x" | "y" | "r" | "x1" | "y1" | "x2" | "y2", number>>;
const KEYS = ["kind", "label", "x", "y", "r", "x1", "y1", "x2", "y2"] as const;
/** The same mark (place, shape and label), whatever else rides along (`done`, the start delay). */
export const sameMark = (a: AnyMark, b: AnyMark): boolean => KEYS.every((k) => a[k] === b[k]);
/** `next` is `prev` with more marks after it (the voice reached the next sentence), not a new drawing. */
export const extendsMarks = (prev: AnyMark[], next: AnyMark[]): boolean => prev.length > 0 && next.length >= prev.length && prev.every((m, i) => sameMark(m, next[i]));

/**
 * When each mark of a drawing starts, on the drawing clock: a drawing that only grew keeps the starts of
 * the marks already there and starts the new ones now (SENTENCE_GAP_MS apart); a new drawing starts its
 * marks one after another (STROKE_GAP_MS apart), the first `from` (drawn before a Stop) as done.
 * The panel and the overlay both use it, so a Stop drops the same marks in both.
 */
export function drawingStarts(prev: { list: AnyMark[]; starts: number[] } | null, next: AnyMark[], now: number, from = 0): { starts: number[]; grew: boolean } {
  if (prev && from === 0 && extendsMarks(prev.list, next)) {
    // A newly spoken sentence starts its first mark now, without inheriting the previous
    // sentence's pen gap. Only marks released together are staggered. Keep pending order.
    const start = Math.max(now, prev.starts.at(-1) ?? now);
    return { starts: [...prev.starts, ...appendStarts([], next.length - prev.starts.length, start, SENTENCE_GAP_MS)], grew: true };
  }
  return { starts: appendStarts([], next.length, now, STROKE_GAP_MS, from), grew: false };
}

const TAG = /\[(?:CIRCLE|ARROW|BOX|UNDERLINE):[^[\]]*\]/gi;

/**
 * For each mark parseBuddyAnswer finds in `raw` (same order, same count), the index of the sentence of
 * the shown text it belongs to: the sentence its tag stands in, or the one just ended when the tag
 * follows a full stop ("That panel lists your layers. [BOX:...]" belongs to that sentence).
 */
export function markSentences(raw: string, screens: BuddyScreen[], defaultScreen = 1): number[] {
  const out: number[] = [];
  let seen = 0;
  for (const m of raw.matchAll(TAG)) {
    const end = (m.index ?? 0) + m[0].length;
    const count = parseBuddyAnswer(raw.slice(0, end), screens, defaultScreen).marks.length;
    if (count <= seen) continue;
    const before = parseBuddyAnswer(raw.slice(0, m.index), screens, defaultScreen).text;
    const at = Math.max(0, splitSentences(before).length - 1);
    for (; seen < count; seen++) out.push(at);
  }
  // marks the tag scan could not tell apart (never expected): with the last sentence
  const total = parseBuddyAnswer(raw, screens, defaultScreen).marks.length;
  while (out.length < total) out.push(out.at(-1) ?? 0);
  return out.slice(0, total);
}

/**
 * How many of the marks (in order) may be drawn now: those whose sentence the voice has reached
 * (`spoken`, the bubble's sentence index; -1 before the first). A mark waits for the ones before it.
 */
export function marksReleased(sentences: number[], spoken: number): number {
  let n = 0;
  while (n < sentences.length && sentences[n] <= spoken) n++;
  return n;
}
