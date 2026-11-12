// Where things really are. A picture model guesses coordinates from a 1024-pixel screenshot, and on a
// real desktop a small target (a 33-pixel taskbar icon) is missed more often than hit: measured on this
// PC's own screens, see docs/OKF-POINTING.md. Windows already knows the name and the rectangle of most
// things on screen (UI Automation; apps/desktop/okfilow-uia.js reads them when the screenshot is taken).
// So a point or a box the answer names is placed on the element with that name, and only when no name
// fits is the model's own guess used, moved onto the nearest element when it fell just beside one.
// The list never leaves this PC: it is used here, after the answer, and is not part of any prompt.

import { GRID } from "./prompt";

/** One thing on screen: its accessible name and its rectangle on the 0-1000 grid of screen `screen` (1-based). */
export type ScreenElement = { name: string; screen: number; x1: number; y1: number; x2: number; y2: number; type?: string };

export const MAX_ELEMENTS = 600;
const MAX_NAME = 80;

/** The elements of a request body, cleaned: anything malformed is dropped, never trusted. */
export function sanitizeElements(raw: unknown, screens: number): ScreenElement[] {
  if (!Array.isArray(raw)) return [];
  const out: ScreenElement[] = [];
  for (const e of raw) {
    if (out.length >= MAX_ELEMENTS) break;
    if (!e || typeof e !== "object") continue;
    const { name, screen, x1, y1, x2, y2, type } = e as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim()) continue;
    const nums = [x1, y1, x2, y2].map((v) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(GRID, v)) : NaN));
    if (nums.some(Number.isNaN) || nums[2] <= nums[0] || nums[3] <= nums[1]) continue;
    if (typeof screen !== "number" || !Number.isInteger(screen) || screen < 1 || screen > Math.max(1, screens)) continue;
    out.push({ name: name.trim().slice(0, MAX_NAME), screen, x1: nums[0], y1: nums[1], x2: nums[2], y2: nums[3], ...(typeof type === "string" ? { type: type.slice(0, 20) } : {}) });
  }
  return out;
}

// Words a model adds around a name ("the Start button", "icona di Firefox") that say nothing about which
// thing it is. Words that name another kind of thing ("Search bar", "File menu", "Firefox settings") are
// not in this list: with them a label is only a partial match, which needs the model's guess nearby.
const FILLER = new Set([
  "the", "a", "an", "of", "on", "in", "to", "for", "button", "icon", "app",
  "il", "lo", "la", "i", "gli", "le", "di", "del", "della", "pulsante", "bottone", "icona",
  "кнопка", "кнопку", "значок", "иконка", "иконку",
  "butonul", "buton", "pictograma",
]);
const JA_FILLER = /(ボタン|アイコン|の)/g;
/** Scripts written without spaces between words. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

const fold = (s: string): string => s.normalize("NFKC").toLowerCase();
const split = (s: string): string[] => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const words = (s: string): string[] => split(fold(s));
const core = (s: string): string[] => {
  const w = words(s);
  const kept = split(fold(s).replace(JA_FILLER, " ")).filter((x) => !FILLER.has(x));
  return kept.length ? kept : w;
};
/** A taskbar button is named "Firefox - 2 running windows": the part before the dash is the thing's name. */
const head = (name: string): string => name.split(/\s[-\u2013\u2014]\s/)[0];

/** 0 to 1: how well a spoken label names an element. 1 = the same words; under 0.6 is not a match. */
export function nameScore(label: string, name: string): number {
  const l = core(label);
  if (!l.length) return 0;
  let best = 0;
  for (const candidate of new Set([name, head(name), plainName(name)])) {
    const n = core(candidate);
    if (!n.length) continue;
    let s = 0;
    if (l.join(" ") === n.join(" ")) s = 1;
    else {
      const inName = l.filter((w) => n.includes(w)).length;
      const inLabel = n.filter((w) => l.includes(w)).length;
      // every word of the label is in the name ("Firefox" for "Mozilla Firefox"): better the more of the name it covers
      if (inName === l.length) s = 0.6 + 0.3 * (l.length / n.length);
      // every word of the name is in the label ("Save" for "the blue Save button")
      else if (inLabel === n.length) s = 0.6 + 0.25 * (n.length / l.length);
      // Japanese and Chinese: one name inside the other
      const lc = l.join(""), nc = n.join("");
      if (!s && lc.length >= 2 && nc.length >= 2 && UNSPACED.test(lc) && UNSPACED.test(nc) && (nc.includes(lc) || lc.includes(nc))) s = 0.6 + 0.3 * (Math.min(lc.length, nc.length) / Math.max(lc.length, nc.length));
    }
    best = Math.max(best, s);
  }
  return best;
}
const MATCH = 0.6;
/** The elements a label names best on one screen (all those level with the best one), best first. */
export function matchElements(label: string, elements: ScreenElement[], screen: number): ScreenElement[] {
  let top = 0;
  const scored: Array<[number, ScreenElement]> = [];
  for (const e of elements) {
    if (e.screen !== screen) continue;
    const s = nameScore(label, e.name);
    if (s >= MATCH) { scored.push([s, e]); top = Math.max(top, s); }
  }
  return scored.filter(([s]) => s >= top - 0.02).map(([, e]) => e);
}
/** True when the label is the element's name, word for word (not only part of it or more than it). */
const isExact = (label: string, e: ScreenElement): boolean => nameScore(label, e.name) >= 0.999;

// "How do I start a new document?" holds the word Start and is not about the Start button. Only a
// question that asks where a thing is, or to find, show, open or click it, is taken to name one.
const LOCATING = /(?:^|[^\p{L}])(?:where|find|locate|show|point|open|click|press|launch|which|dov[e'’][eè]?|trova|mostra|indica|apri|clicca|premi|quale|где|найди|найти|покажи|укажи|открой|открыть|нажми|unde|găsește|gaseste|arată|arata|deschide|apasă|apasa|care)(?![\p{L}])|どこ|探し|見せ|開い|開き|押し|クリック/iu;
export const asksWhere = (question: string): boolean => LOCATING.test(question.normalize("NFKC"));

// ---- the thing the question itself names ----
// "Where is Audacity?" with a 33-pixel Audacity icon in the taskbar: measured, the answering model
// said "it is not visible" for 3 small targets in 4 and wrote no tag at all. The question's own words
// are matched against the names; the model is told where those things are, and when its answer still
// carries no point, the point is added.

const MAX_NAMED = 3;
/** Windows adds a state to a taskbar button's name ("Audacity pinned", "Audacity bloccato"). */
const STATE = /\s+(?:pinned|bloccato|bloccata|закреплено|fixat|ピン留め済み)$/iu;
/** The thing's own name: no window count, no state. */
export const plainName = (name: string): string => head(name).replace(STATE, "").trim();

/**
 * The elements whose whole name stands in the question, longest name first, at most three. A name two
 * elements share is left out (which one?), and so is a name of one short word ("File", "Home"): it
 * is too often just a word of the sentence. Nothing for a question that does not ask where a thing is
 * or to find, show, open or click it (asksWhere).
 */
export function namedInQuestion(question: string, elements: ScreenElement[]): ScreenElement[] {
  if (!asksWhere(question)) return [];
  const q = ` ${words(question).join(" ")} `;
  const folded = fold(question), unspaced = UNSPACED.test(question);
  const found = new Map<string, ScreenElement | null>();
  for (const e of elements) {
    const n = words(plainName(e.name));
    const key = n.join(" ");
    if (!n.length || key.length < 3 || /^[\d ]+$/.test(key) || (n.length === 1 && key.length < 5)) continue;
    // whole words; in Japanese, where words are not set apart, anywhere in the sentence
    if (!q.includes(` ${key} `) && !(unspaced && folded.includes(key))) continue;
    const id = `${e.screen}:${key}`;
    found.set(id, found.has(id) ? null : e);
  }
  return [...found.values()]
    .filter((e): e is ScreenElement => e !== null)
    .sort((a, b) => plainName(b.name).length - plainName(a.name).length)
    .slice(0, MAX_NAMED);
}

/** What the answering model is told about them, after the question. Only names the question already holds. */
export const screenHint = (named: ScreenElement[], screens: number): string =>
  named.length
    ? `\n(Found on the screen: ${named.map((e) => `"${plainName(e.name)}" is at ${Math.round((e.x1 + e.x2) / 2)},${Math.round((e.y1 + e.y2) / 2)}${screens > 1 ? ` on screen ${e.screen}` : ""}`).join("; ")}. It is visible: if the question is about it, point at it with exactly that position.)`
    : "";

const ANY_PLACE_TAG = /\[(?:POINT|CIRCLE|BOX|ARROW|UNDERLINE):/i;
/** An answer that points at nothing although the question named a thing on screen: the same answer, then the point. */
export async function* withNamedPoint(answer: AsyncIterable<string>, named: ScreenElement[], screens: number): AsyncGenerator<string> {
  let all = "";
  for await (const piece of answer) { all += piece; yield piece; }
  const e = named[0];
  if (!e || !all.trim() || ANY_PLACE_TAG.test(all) || all.includes("\n[ERROR]")) return;
  yield ` [POINT:${Math.round((e.x1 + e.x2) / 2)},${Math.round((e.y1 + e.y2) / 2)}:${plainName(e.name).replace(/[[\]:]/g, " ").slice(0, 60)}${screens > 1 ? `:screen${e.screen}` : ""}]`;
}

const centre = (e: ScreenElement) => ({ x: (e.x1 + e.x2) / 2, y: (e.y1 + e.y2) / 2 });
const area = (e: ScreenElement) => (e.x2 - e.x1) * (e.y2 - e.y1);
/** Distance from a point to a rectangle, 0 inside it. */
const away = (x: number, y: number, e: ScreenElement) => Math.hypot(Math.max(e.x1 - x, 0, x - e.x2), Math.max(e.y1 - y, 0, y - e.y2));

/** A guess this close to an element (on the grid: 30 = 3% of the screen, about 40 pixels on a 1360 screen) was meant for it. */
export const SNAP_REACH = 30;
/** A partial name match counts when the guess is within this of the element (a fifth of the screen). */
export const NAME_REACH = 200;
/** Things larger than this (a twentieth of the screen) are regions, not targets a point snaps to. */
const SNAP_MAX_AREA = (GRID * GRID) / 20;

/** `on`: the element the point was put on (absent for a bare guess). */
export type Placed = { x: number; y: number; how: "name" | "name-near" | "snap" | "guess"; on?: ScreenElement };

/**
 * Where a point with this label goes. `guess` is the model's own coordinate (grid), if it gave one.
 * - one element carries exactly that name: its centre, whatever the model guessed;
 * - one carries part of it, or the label says more ("Search bar" for "Search", "Firefox settings" for
 *   "Settings"): its centre only when the guess is in its part of the screen (NAME_REACH), since the
 *   label may mean another thing that Windows does not list;
 * - several do (two "Close" buttons): the one nearest the guess, on the same terms; nothing certain without a guess;
 * - none does: the guess, moved to the centre of the small element it is in or right beside.
 * Without elements (no list on this system, or an app that exposes nothing) the guess is returned as it is.
 */
export function placePoint(label: string, guess: { x: number; y: number } | null, elements: ScreenElement[], screen: number): Placed | null {
  const named = matchElements(label, elements, screen);
  const agrees = (e: ScreenElement) => isExact(label, e) || (guess !== null && away(guess.x, guess.y, e) <= NAME_REACH);
  if (named.length === 1 && agrees(named[0])) return { ...centre(named[0]), how: "name", on: named[0] };
  if (named.length > 1 && guess) {
    const nearest = named.reduce((a, b) => (away(guess.x, guess.y, b) < away(guess.x, guess.y, a) ? b : a));
    if (agrees(nearest)) return { ...centre(nearest), how: "name-near", on: nearest };
  }
  if (!guess) return null;
  let best: ScreenElement | null = null;
  for (const e of elements) {
    if (e.screen !== screen || area(e) > SNAP_MAX_AREA) continue;
    const d = away(guess.x, guess.y, e);
    if (d > SNAP_REACH) continue;
    // the nearest; among those the guess is inside, the smallest (the button, not the toolbar around it)
    if (!best || d < away(guess.x, guess.y, best) || (d === 0 && away(guess.x, guess.y, best) === 0 && area(e) < area(best))) best = e;
  }
  return best ? { ...centre(best), how: "snap", on: best } : { ...guess, how: "guess" };
}

// ---- when no name fits by its words: a model on this PC chooses from the names ----
// "File Explorer" for "Esplora file", "the browser" for "Firefox": the same thing in other words.
// Asked without a picture, of a model that runs on this PC only (the names of open windows and files
// are the user's own: the ask route never gives them to an online provider).

export const PICK_SYSTEM = "You match a label to the name of a thing on a computer screen. The names may be in another language than the label. Reply with only the number of the item the label means, or 0 if none of them is that thing.";
/** The same choice for a whole question (the panel's second, narrow request when an answer pointed at nothing). */
export const ASKED_SYSTEM = "You are given a user's question and the names of the things on their computer screen. The names may be in another language than the question. If the question asks where one of these things is, or how to find, open or use it, reply with only that item's number. If the question is about anything else, reply 0.";
export const PICK_MAX_TOKENS = 8;
/** A choice is one number (0.3 to 1.2 s measured); past this the pointing model looks instead. */
export const PICK_MS = 4000;
/** At most this many names go into the question (about 2,000 tokens). */
export const PICK_MAX_NAMES = 250;

/**
 * Models measured good enough to choose (labels reworded by Gemma, 154 real targets): Gemma 4 E4B
 * found the right name for 86% in 0.34 s; lfm3-vl for 40%, with wrong choices, so it is not asked.
 */
export const canPick = (model: string): boolean => /^gemma4:e4b\b/.test(model);

/** The different names on one screen, in the order Windows gave them (topmost first). */
export const pickNames = (elements: ScreenElement[], screen: number): string[] => [...new Set(elements.filter((e) => e.screen === screen).map((e) => e.name))].slice(0, PICK_MAX_NAMES);
/**
 * The names a whole question may be about, when "All my screens" sends several: the screen with the
 * mouse first, then the others. A chosen name counts only when it is on one screen alone (askedElement).
 */
export const askedNames = (elements: ScreenElement[], first: number): string[] =>
  [...new Set([...elements.filter((e) => e.screen === first), ...elements.filter((e) => e.screen !== first)].map((e) => e.name))].slice(0, PICK_MAX_NAMES);
/** The one element with that name on any screen, or null when there is none or it is on screen more than once (the pointing model looks then). */
export function askedElement(elements: ScreenElement[], name: string | undefined): ScreenElement | null {
  const same = name === undefined ? [] : elements.filter((e) => e.name === name);
  return same.length === 1 ? same[0] : null;
}
export const pickQuestion = (label: string, names: string[]): string => `Label: "${label}"\nItems:\n${names.slice(0, PICK_MAX_NAMES).map((n, i) => `${i + 1}. ${n}`).join("\n")}\nNumber:`;
/** The 0-based index a reply names, or null (0, no number, or a number past the list). */
export function pickedIndex(reply: string, count: number): number | null {
  const m = /\d+/.exec(reply);
  if (!m) return null;
  const n = Number(m[0]);
  return n >= 1 && n <= count ? n - 1 : null;
}

const NUM = String.raw`\s*(-?\d+(?:\.\d+)?)\s*`;
const TAIL = String.raw`(?::([^[\]]*?))?(?::\s*screen\s*(\d+))?\s*\]`;
const PLACE_TAG = new RegExp(String.raw`\[(?:(POINT):${NUM},${NUM}|(CIRCLE):${NUM},${NUM},${NUM}|(BOX):${NUM},${NUM},${NUM},${NUM})${TAIL}`, "gi");
const NAMES = ["POINT", "CIRCLE", "BOX"];
/** "[", "[BO", "[CIRCLE:12,3": one of these tags that may still be on its way at the end of a piece. */
const tagOnItsWay = (s: string): boolean => {
  const m = /^\[([a-z]*)(:[^[\]]*)?$/i.exec(s);
  if (!m) return false;
  const word = m[1].toUpperCase();
  return m[2] === undefined ? NAMES.some((n) => n.startsWith(word)) : NAMES.includes(word);
};
const MAX_TAG_CHARS = 120;
const r1 = (v: number) => String(Math.round(v));

/** One finished answer (or piece of one): its POINT, CIRCLE and BOX tags put where the things really are. */
export function placeTags(text: string, elements: ScreenElement[], opts: { points?: boolean } = {}): string {
  if (!elements.length) return text;
  return text.replace(PLACE_TAG, (tag, point, px, py, circle, cx, cy, cr, _box, x1, y1, x2, y2, label: string | undefined, screen: string | undefined) => {
    const name = (label ?? "").trim();
    const on = screen ? Number(screen) : 1;
    const tail = `${name ? `:${name}` : ""}${screen ? `:screen${screen}` : ""}]`;
    if (point) {
      if (opts.points === false) return tag;
      const p = placePoint(name, { x: Number(px), y: Number(py) }, elements, on);
      return p && p.how !== "guess" ? `[POINT:${r1(p.x)},${r1(p.y)}${tail}` : tag;
    }
    if (circle) {
      const p = placePoint(name, { x: Number(cx), y: Number(cy) }, elements, on);
      if (!p || p.how === "guess" || !p.on) return tag;
      // round the thing itself: half its longer side and a little air, inside the sizes the overlay draws
      const r = Math.max(15, Math.min(150, Math.max(p.on.x2 - p.on.x1, p.on.y2 - p.on.y1) * 0.6));
      return `[CIRCLE:${r1(p.x)},${r1(p.y)},${r1(r)}${tail}`;
    }
    const b = placeBox(name, { x1: Math.min(Number(x1), Number(x2)), y1: Math.min(Number(y1), Number(y2)), x2: Math.max(Number(x1), Number(x2)), y2: Math.max(Number(y1), Number(y2)) }, elements, on);
    if (!b) return "";
    return b.how === "guess" ? tag : `[BOX:${r1(b.x1)},${r1(b.y1)},${r1(b.x2)},${r1(b.y2)}${tail}`;
  });
}

/**
 * A streamed answer with its tags placed as they complete (placeTags). A tag cut in two by the stream
 * waits for its other half; everything before it goes out at once. `points: false` leaves POINT tags
 * alone (a pointing model places them afterwards, lib/buddy/pointer.ts).
 */
export async function* withPlacedTags(answer: AsyncIterable<string>, elements: ScreenElement[], opts: { points?: boolean } = {}): AsyncGenerator<string> {
  if (!elements.length) { yield* answer; return; }
  let held = "";
  for await (const piece of answer) {
    held = placeTags(held + piece, elements, opts);
    const open = held.lastIndexOf("[");
    const keep = open >= 0 && held.length - open <= MAX_TAG_CHARS && tagOnItsWay(held.slice(open)) ? open : held.length;
    if (keep > 0) yield held.slice(0, keep);
    held = held.slice(keep);
  }
  if (held) yield held;
}

export type Box = { x1: number; y1: number; x2: number; y2: number };
const iou = (a: Box, b: Box): number => {
  const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1), h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  return inter / ((a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter);
};

// "This area", "here", "quest'area": a box that names nothing. In the five languages of OK Filow.
const VAGUE = /^(?:(?:this|that|the|questa?|quest'|quell[ao']?|la|этот|эта|это|эту|această|acest|この|その)\s*)?(?:area|region|zone|part|section|spot|place|here|there|zona|parte|sezione|punto|qui|qua|область|зона|часть|место|здесь|тут|zonă|parte|aici|エリア|領域|部分|ここ|そこ)$/iu;
export const isVagueLabel = (label: string): boolean => VAGUE.test(label.trim());
/** A box this many times larger than the element of that name is around something else (the app's window, not its taskbar icon). */
const BOX_FAR_LARGER = 6;

/** A model's box overlaps a real element this much: it meant that element. */
export const BOX_AGREES = 0.5;

/**
 * Where a box with this label goes: the rectangle of the element that carries the name (when the box
 * overlaps it or is about its size); else the element the model's box all but covers; else the model's
 * own box, unless its label is one that names nothing ("This area"), in which case no box is drawn at
 * all (null): an arbitrary rectangle helps nobody. A box without any label is kept.
 * Without elements the box is returned as it is.
 */
export function placeBox(label: string, box: Box, elements: ScreenElement[], screen: number): (Box & { how: "name" | "overlap" | "guess" }) | null {
  const here = elements.filter((e) => e.screen === screen);
  if (!here.length) return { ...box, how: "guess" };
  const named = matchElements(label, here, screen);
  if (named.length) {
    const cx = (box.x1 + box.x2) / 2, cy = (box.y1 + box.y2) / 2;
    const pick = named.reduce((a, b) => (iou(box, b) > iou(box, a) || (iou(box, b) === iou(box, a) && away(cx, cy, b) < away(cx, cy, a)) ? b : a));
    // the box overlaps it, or is of its size and (the very name, or drawn in its part of the screen)
    const sameSize = (box.x2 - box.x1) * (box.y2 - box.y1) <= BOX_FAR_LARGER * area(pick);
    if (iou(box, pick) >= 0.1 || (sameSize && ((named.length === 1 && isExact(label, pick)) || away(cx, cy, pick) <= NAME_REACH))) return { x1: pick.x1, y1: pick.y1, x2: pick.x2, y2: pick.y2, how: "name" };
  }
  let best: ScreenElement | null = null;
  for (const e of here) if (iou(box, e) >= BOX_AGREES && (!best || iou(box, e) > iou(box, best))) best = e;
  if (best) return { x1: best.x1, y1: best.y1, x2: best.x2, y2: best.y2, how: "overlap" };
  return isVagueLabel(label) ? null : { ...box, how: "guess" };
}
