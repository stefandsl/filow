// OK Filow: the push-to-talk screen helper (docs/BUDDY-PLAN.md). Behaviour ported from
// farzaa/clicky (MIT): the model sees one screenshot per display and may point with
// [POINT:x,y:label:screenN] tags, which are stripped from the spoken text.

import { BUDDY_LANG_NAMES, buddyLang } from "./lang";
import { DRAW_PROMPT, extractVisuals, VISUALS_PROMPT, type BuddyCard, type BuddyModel, type BuddyDrawing } from "./visuals";
export type { BuddyCard, BuddyModel, BuddyDrawing } from "./visuals";

export type BuddyScreen = {
  /** 1-based, matches "screenN" in the prompt and in POINT tags. */
  index: number;
  /** Size of the image sent to the model, in image pixels (told to the model for context; points use a 0-1000 grid). */
  width: number;
  height: number;
  /** True for the display the mouse is on. */
  cursor?: boolean;
};

export type BuddyTurn = { role: "user" | "assistant"; text: string };

export type BuddyPoint = { x: number; y: number; label: string; screen: number };

/** Something drawn on screen while the answer is spoken. Coordinates are on the 0-1000 grid. */
export type BuddyMark =
  | { kind: "circle"; x: number; y: number; r: number; label: string; screen: number }
  | { kind: "arrow"; x1: number; y1: number; x2: number; y2: number; label: string; screen: number }
  | { kind: "box"; x1: number; y1: number; x2: number; y2: number; label: string; screen: number }
  | { kind: "underline"; x1: number; y: number; x2: number; label: string; screen: number };

export function buddySystemPrompt(screens: BuddyScreen[], language: string, opts: { pictures?: boolean } = {}): string {
  if (opts.pictures === false) {
    // No screenshot is sent: the user switched "Look at my screen" off, or the setup for this computer
    // answers from text (pictures are too slow here)
    const spoken = buddyLang(language);
    const lang = spoken ? BUDDY_LANG_NAMES[spoken] : "the language the user speaks";
    return [
      "You are OK Filow, a friendly helper that lives next to the user's mouse pointer.",
      "Right now you cannot see the screen. Answer from the question and from any text the user selected, which is quoted in the question.",
      "If the answer needs to see the screen, say so in one sentence and ask the user to select the text or describe what they see.",
      "Your answer is read aloud, so write plain spoken sentences: no markdown, no lists, no emoji, no URLs unless asked.",
      "Be short: one to three sentences, unless the user asks for a step-by-step walkthrough; then give one step at a time.",
      `Answer in ${lang}.`,
      "Never write tags in square brackets such as [POINT], [BOX] or [CARD]: you cannot see where things are.",
      // Drawing needs no screenshot: without this the model was never told it can draw, and said it cannot.
      DRAW_PROMPT,
    ].join("\n");
  }
  const list = screens
    .map((s) => `- screen${s.index}${s.cursor ? " (the mouse is on this one)" : ""}`)
    .join("\n");
  const code = buddyLang(language);
  const lang = code ? BUDDY_LANG_NAMES[code] : "the language the user speaks";
  return [
    "You are OK Filow, a friendly helper that lives next to the user's mouse pointer.",
    "The user holds a key, asks a question out loud and you see a screenshot of each of their screens.",
    "Your answer is read aloud, so write plain spoken sentences: no markdown, no lists, no emoji, no URLs unless asked.",
    "Be short: one to three sentences, unless the user asks for a step-by-step walkthrough; then give one step at a time.",
    `Answer in ${lang}.`,
    "",
    "Screens you can see, in the order of the images:",
    list,
    "",
    "To point at something on screen, put a tag where you mention it: [POINT:x,y:label:screenN]",
    "x and y are on a 0 to 1000 grid over that screen, never pixels: 0,0 is the top-left corner, 1000,1000 the bottom-right, 500,500 the centre. label is two to four words naming the thing.",
    "Point at the centre of the button, field or text you mean. Use at most three tags, and only for things you can actually see.",
    "Whenever your answer refers to something visible on screen, always point at it or draw on it: the user is looking for it. Never just describe where it is in words.",
    "Example. User: where do I save this? You: Click Save, top left [POINT:42,31:Save button:screen1].",
    "Example. User: what does this part do? You: That panel [BOX:620,140,980,560:Layers panel] lists your layers.",
    "",
    "You can also draw on the screen to teach, like a person with a pen. Same grid, same optional :screenN at the end:",
    "[CIRCLE:x,y,r:label] circles an area (r is the radius on the grid, 15 to 150).",
    "[ARROW:x1,y1,x2,y2:label] draws an arrow that ends at x2,y2.",
    "[BOX:x1,y1,x2,y2:label] draws a rectangle around a region, x1,y1 top-left.",
    "[UNDERLINE:x1,y,x2:label] underlines text from x1 to x2 at height y.",
    "Put each drawing where you talk about it; they appear in that order. Use at most four drawings per answer.",
    "If the user asks where something is and it is not visible, say so and suggest where to look.",
    VISUALS_PROMPT,
  ].join("\n");
}

/** Points use a 0-1000 grid per screen: the native output of Gemma and Gemini, and size-independent. */
export const GRID = 1000;

const NUM = String.raw`\s*(-?\d+(?:\.\d+)?)\s*`;
const MARK_RE = new RegExp(String.raw`\[(CIRCLE|ARROW|BOX|UNDERLINE):${NUM},${NUM}(?:,${NUM})?(?:,${NUM})?(?::([^[\]]*?))?(?::\s*screen\s*(\d+))?\s*\]`, "gi");
const ARITY: Record<string, number> = { CIRCLE: 3, ARROW: 4, BOX: 4, UNDERLINE: 3 };
const TAGS = ["POINT", "CIRCLE", "ARROW", "BOX", "UNDERLINE", "CARD"];
/** True for an unfinished tag at the end of a streamed answer ("[CIR", "[BOX:10,2"). */
function isTagPrefix(tail: string): boolean {
  const m = /^\[([A-Z]*)(:[^\]]*)?$/i.exec(tail);
  if (!m) return false;
  const name = m[1].toUpperCase();
  return m[2] !== undefined ? TAGS.includes(name) : TAGS.some((t) => t.startsWith(name));
}

// Labels may contain ":" ("Photosynthesis: light reactions"); only "[" and "]" end them.
const POINT_RE = /\[POINT:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?::([^[\]]*?))?(?::\s*screen\s*(\d+))?\s*\]/gi;
/** A tag the model never closed: cut before the next tag starts, so it cannot swallow that tag. */
const UNCLOSED_TAG_RE = /\[(?:POINT|CIRCLE|ARROW|BOX|UNDERLINE|CARD)\b[^[\]]*(?=\[)/gi;
/** A closed tag that did not parse (wrong arity, junk inside): never shown. */
const BROKEN_TAG_RE = /\[(?:POINT|CIRCLE|ARROW|BOX|UNDERLINE|CARD)\b[^[\]]*\]/gi;

/**
 * Splits a (complete or partial) answer into the text to show and speak, and the points.
 * A trailing unfinished tag ("[POINT:12,3") is held back so it never flashes in the bubble.
 * Points whose screen is unknown fall back to `defaultScreen`; ones outside the image are dropped.
 */
export function parseBuddyAnswer(raw: string, screens: BuddyScreen[], defaultScreen = 1): { text: string; points: BuddyPoint[]; marks: BuddyMark[]; cards: BuddyCard[]; model: BuddyModel | null; drawing: BuddyDrawing | null } {
  const visuals = extractVisuals(raw, (n) => screens.some((s) => s.index === n), defaultScreen);
  let body = visuals.body;
  const open = body.lastIndexOf("[");
  if (open >= 0 && !body.slice(open).includes("]") && isTagPrefix(body.slice(open))) body = body.slice(0, open);
  body = body.replace(UNCLOSED_TAG_RE, "");
  const points: BuddyPoint[] = [];
  const marks: BuddyMark[] = [];
  const onGrid = (...v: number[]) => v.every((n) => Number.isFinite(n) && n >= 0 && n <= GRID);
  body = body.replace(MARK_RE, (_m, kind: string, a: string, b: string, c: string | undefined, d: string | undefined, label: string | undefined, screen: string | undefined) => {
    const k = kind.toUpperCase();
    const nums = [a, b, c, d].filter((v) => v !== undefined).map(Number);
    const index = screen ? Number(screen) : defaultScreen;
    const l = (label ?? "").trim().slice(0, 60);
    if (nums.length !== ARITY[k] || !screens.some((s) => s.index === index)) return "";
    if (k === "CIRCLE" && onGrid(nums[0], nums[1]) && nums[2] > 0 && nums[2] <= GRID / 2) marks.push({ kind: "circle", x: nums[0], y: nums[1], r: nums[2], label: l, screen: index });
    else if ((k === "ARROW" || k === "BOX") && onGrid(...nums)) marks.push({ kind: k === "ARROW" ? "arrow" : "box", x1: nums[0], y1: nums[1], x2: nums[2], y2: nums[3], label: l, screen: index });
    else if (k === "UNDERLINE" && onGrid(...nums)) marks.push({ kind: "underline", x1: nums[0], y: nums[1], x2: nums[2], label: l, screen: index });
    return "";
  });
  const text = body
    .replace(POINT_RE, (_m, x: string, y: string, label: string | undefined, screen: string | undefined) => {
      const index = screen ? Number(screen) : defaultScreen;
      const s = screens.find((c) => c.index === index);
      const px = Number(x);
      const py = Number(y);
      if (s && px >= 0 && py >= 0 && px <= GRID && py <= GRID) points.push({ x: px, y: py, label: (label ?? "").trim().slice(0, 60), screen: index });
      return "";
    })
    .replace(BROKEN_TAG_RE, "")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    // Small local models copy the label of the prompt's examples ("You: Click Save"): it is not part of the answer.
    .replace(/^You\s*:\s*/, "");
  return { text, points, marks: marks.slice(0, 4), cards: visuals.cards, model: visuals.model, drawing: visuals.drawing };
}

export type DisplayRect = { x: number; y: number; width: number; height: number };

/** 0-1000 grid on screen N -> global DIP coordinates of that display (what Electron windows use). */
/** Grid -> pixel on one axis, kept inside the display (1000 would be one pixel past the last row). */
function axis(v: number, start: number, size: number): number {
  return Math.min(start + size - 1, Math.max(start, Math.round(start + (v / GRID) * size)));
}

export function pointToDisplay(point: BuddyPoint, display: DisplayRect): { x: number; y: number } {
  return { x: axis(point.x, display.x, display.width), y: axis(point.y, display.y, display.height) };
}

/** Maps a mark from the 0-1000 grid to global DIP coordinates of its display (radius scales with the shorter side). */
export function markToDisplay(mark: BuddyMark, display: DisplayRect): BuddyMark {
  const X = (v: number) => axis(v, display.x, display.width);
  const Y = (v: number) => axis(v, display.y, display.height);
  switch (mark.kind) {
    case "circle": return { ...mark, x: X(mark.x), y: Y(mark.y), r: Math.round((mark.r / GRID) * Math.min(display.width, display.height)) };
    case "underline": return { ...mark, x1: X(mark.x1), y: Y(mark.y), x2: X(mark.x2) };
    default: return { ...mark, x1: X(mark.x1), y1: Y(mark.y1), x2: X(mark.x2), y2: Y(mark.y2) };
  }
}

/** Keeps the last few turns so follow-ups ("and then?") work, without growing forever. */
export function trimHistory(history: BuddyTurn[], maxTurns = 6, maxChars = 4000): BuddyTurn[] {
  const out: BuddyTurn[] = [];
  let chars = 0;
  for (let i = history.length - 1; i >= 0 && out.length < maxTurns; i--) {
    const t = history[i];
    if (!t || (t.role !== "user" && t.role !== "assistant") || typeof t.text !== "string") continue;
    chars += t.text.length;
    if (chars > maxChars) break;
    out.unshift({ role: t.role, text: t.text.slice(0, 2000) });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}
