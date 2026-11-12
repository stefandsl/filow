// A setup may answer with one model and place the points with another (setupChoices: screenHelper.pointer).
// Gemma 4 E4B reads the screen and answers well, but its [POINT] tags landed 40 to 70 pixels off
// (2 of 22 inside the target); lfm3-vl, asked only where a named thing is, placed 20 of 22
// (G:/FILOW/tmp/v17-parity/FINDINGS.md). So the answer's own POINT tags are taken out as it streams,
// and when it has ended the pointing model is asked for each named thing; its tags follow the answer.
// Both calls stay on this PC and end with the same Stop signal.

import { matchElements, pickedIndex, pickNames, placePoint, type ScreenElement } from "./ground";

/** The centre of the element nearest a guess (0 distance inside it). */
const nearestTo = (g: { x: number; y: number }, among: ScreenElement[]): { x: number; y: number } | null => {
  const away = (e: ScreenElement) => Math.hypot(Math.max(e.x1 - g.x, 0, g.x - e.x2), Math.max(e.y1 - g.y, 0, g.y - e.y2));
  const best = among.reduce<ScreenElement | null>((a, b) => (!a || away(b) < away(a) ? b : a), null);
  return best ? { x: (best.x1 + best.x2) / 2, y: (best.y1 + best.y2) / 2 } : null;
};

/** In a question: the reply must be the tag alone (the page's own follow-up uses the same words, and prompt.ts adds no screen note to it). */
export const POINT_ONLY = "[POINT:x,y:label:screenN]";
export const isPointOnly = (question: string): boolean => question.includes(POINT_ONLY);

/** The narrow question for one thing the answer named. */
export const pointQuestion = (label: string): string =>
  `Where is "${label}" on the screen? Reply with only the tag ${POINT_ONLY} for that thing, on the 0-1000 grid, and nothing else. If it is not visible, reply NONE.`;

const POINT_TAG = /\[POINT:\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*(?::([^[\]]*?))?(?::\s*screen\s*(\d+))?\s*\]/gi;
/** "[", "[PO", "[POINT:12,3": a POINT tag that may still be on its way at the end of a piece. */
const POINT_START = /^\[(?:P(?:O(?:I(?:N(?:T(?::[^[\]]*)?)?)?)?)?)?$/i;
export const MAX_POINTS = 3;
/** The longest a POINT tag can be: two numbers, a label of 60 characters, a screen. */
const MAX_TAG_CHARS = 100;
/** One answer of the pointing model: a tag is about 20 tokens, and it has this long (0.3 s measured once loaded). */
export const POINTER_MAX_TOKENS = 60;
export const POINTER_MS = 8000;
/** All the pointing work after one answer (choosing from names, the pointing model, up to three labels) together. */
export const POINTING_TOTAL_MS = 16_000;

/**
 * The place a pointing model's reply names, on the grid. A small model often garbles the tag itself
 * ("[IPS:911,62:Share]", "[400, 800:label=Save]": 1 reply in 6 measured with lfm3-vl on real screens)
 * while the two numbers are right, so the "x,y" pair that opens a bracket counts. "NONE" is no place.
 */
export function lenientPoint(reply: string): { x: number; y: number } | null {
  if (/^\W*none\b/i.test(reply)) return null;
  // Only the pair that opens a bracket ("[XYZ:911,62") or is the whole reply ("911, 62"): numbers in a sentence are not a place.
  const m = /^\s*\(?\s*(\d{1,4}(?:\.\d+)?)\s*,\s*(\d{1,4}(?:\.\d+)?)\s*\)?\s*$/.exec(reply) ?? /\[[^\]\d-]{0,24}(\d{1,4}(?:\.\d+)?)\s*,\s*(\d{1,4}(?:\.\d+)?)(?![\d.])/.exec(reply);
  if (!m) return null;
  const [x, y] = [Number(m[1]), Number(m[2])];
  return x <= 1000 && y <= 1000 ? { x, y } : null;
}

/**
 * The answer without its own POINT tags, followed by the pointing model's tag for each thing those
 * tags named (at most three, each once). `ground(label)` asks the pointing model and returns its
 * reply; a reply without a usable tag ("NONE", an error) adds nothing. Other marks ([BOX], [CARD],
 * drawings) pass through untouched.
 */
export async function* withPointer(
  answer: AsyncIterable<string>,
  ground: (label: string) => Promise<string>,
  stopped: () => boolean = () => false,
  /** What Windows names on the screens (lib/buddy/ground.ts); empty = the pointing model alone, as before. */
  elements: ScreenElement[] = [],
  /** Asks a model on this PC which of `names` the label means (ground.ts pickQuestion); its reply is a number. */
  pick?: (label: string, names: string[]) => Promise<string>,
): AsyncGenerator<string> {
  const labels: Array<{ label: string; screen: string }> = [];
  const take = (text: string) =>
    text.replace(POINT_TAG, (_m, label: string | undefined, screen: string | undefined) => {
      const l = (label ?? "").trim().slice(0, 60);
      if (l && labels.length < MAX_POINTS && !labels.some((x) => x.label.toLowerCase() === l.toLowerCase())) labels.push({ label: l, screen: screen ?? "" });
      return "";
    });
  let held = "";
  for await (const piece of answer) {
    held = take(held + piece);
    // An unfinished tag at the end waits for the rest of it; everything before it goes out now.
    const open = held.lastIndexOf("[");
    // (A real tag is short: a "[POINT:" that runs on without its "]" is the answer's text and is not kept waiting.)
    const keep = open >= 0 && held.length - open <= MAX_TAG_CHARS && POINT_START.test(held.slice(open)) ? open : held.length;
    if (keep > 0) yield held.slice(0, keep);
    held = held.slice(keep);
  }
  // A tag the model never closed is not shown.
  if (held && !POINT_START.test(held)) yield held;
  for (const { label, screen } of labels) {
    if (stopped()) return;
    // Windows knows one thing by that name on that screen: its centre, and the pointing model is not asked at all.
    const known = elements.length ? placePoint(label, null, elements, screen ? Number(screen) : 1) : null;
    if (known) {
      yield ` [POINT:${Math.round(known.x)},${Math.round(known.y)}:${label}${screen ? `:screen${screen}` : ""}]`;
      continue;
    }
    // No name has the label's words ("File Explorer" for "Esplora file"): the answering model chooses from the names.
    let among = elements;
    if (pick && elements.length && !matchElements(label, elements, screen ? Number(screen) : 1).length) {
      const names = pickNames(elements, screen ? Number(screen) : 1);
      let chosen: number | null = null;
      try {
        chosen = pickedIndex(await pick(label, names), names.length);
      } catch {
        chosen = null;
      }
      if (stopped()) return;
      if (chosen !== null) {
        const same = elements.filter((e) => e.screen === (screen ? Number(screen) : 1) && e.name === names[chosen]);
        if (same.length === 1) {
          yield ` [POINT:${Math.round((same[0].x1 + same[0].x2) / 2)},${Math.round((same[0].y1 + same[0].y2) / 2)}:${label}${screen ? `:screen${screen}` : ""}]`;
          continue;
        }
        // several things carry the chosen name: the pointing model's guess decides between them
        among = same;
      }
    }
    let reply: string;
    try {
      reply = await ground(label);
    } catch {
      continue;
    }
    if (stopped()) return;
    const m = /\[POINT:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?::[^[\]]*?)?(?::\s*screen\s*(\d+))?\s*\]/i.exec(reply);
    const guess = m ? { x: Number(m[1]), y: Number(m[2]) } : lenientPoint(reply);
    if (!guess || !(guess.x >= 0 && guess.x <= 1000 && guess.y >= 0 && guess.y <= 1000)) continue;
    // The answering model's own words for the thing; the screen the pointing model found it on, else the one the answer named.
    const on = m?.[3] ?? screen;
    // Several things by that name: the one nearest the guess. None: the guess, moved onto the element it fell beside.
    const { x, y } = (among !== elements ? nearestTo(guess, among) : elements.length ? placePoint(label, guess, elements, on ? Number(on) : 1) : null) ?? guess;
    yield ` [POINT:${Math.round(x)},${Math.round(y)}:${label}${on ? `:screen${on}` : ""}]`;
  }
}
