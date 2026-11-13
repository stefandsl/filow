// Marks that land on the real thing. The model draws from a 1024-pixel screenshot, so its box is a few
// tens of pixels off and its underline too short or too long. Windows knows the rectangle of most
// things on screen (UI Automation, apps/desktop/okfilow-uia.js, read with the screenshot): a mark that
// names one of them, or lies on one, is fitted to its rectangle with a small, even padding (the pen's
// own BOX_PAD in marks.ts), here in the display's pixels. Pure, so it is unit tested.
// The same rectangles tell the overlay where real text is, so labels and the pointer keep off it.
import type { BuddyMark, DisplayRect } from "./prompt";
import { GRID } from "./prompt";
import { nameScore, type ScreenElement } from "./ground";

/** A named thing on screen in global DIP pixels (what the overlays draw in). */
export type ElementRect = { name: string; screen: number; left: number; top: number; right: number; bottom: number; type?: string };
export type PlainRect = { left: number; top: number; right: number; bottom: number };

/** Grid (0-1000 per display) to the display's pixels, without rounding: the helper gives 0.1 grid steps. */
export function elementRects(elements: ScreenElement[], displays: Array<{ index: number; bounds: DisplayRect }>): ElementRect[] {
  const out: ElementRect[] = [];
  for (const e of elements) {
    const d = displays.find((x) => x.index === e.screen)?.bounds;
    if (!d) continue;
    const X = (v: number) => d.x + (v / GRID) * d.width;
    const Y = (v: number) => d.y + (v / GRID) * d.height;
    out.push({ name: e.name, screen: e.screen, left: X(e.x1), top: Y(e.y1), right: X(e.x2), bottom: Y(e.y2), ...(e.type ? { type: e.type } : {}) });
  }
  return out;
}

/** A guess this close to an element (px) was meant for it. */
export const SNAP_REACH_PX = 24;
/** An underline is drawn this far below the text it underlines. */
export const UNDERLINE_DROP = 4;
/** A circle stands this far off the thing it rings. */
const CIRCLE_AIR = 6;
/** Larger than this share of the display is a region (a window, a panel), not a thing a mark fits. */
const MAX_SHARE = 0.25;

const w = (r: PlainRect) => r.right - r.left;
const h = (r: PlainRect) => r.bottom - r.top;
const areaOf = (r: PlainRect) => Math.max(0, w(r)) * Math.max(0, h(r));
const inter = (a: PlainRect, b: PlainRect) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
const iou = (a: PlainRect, b: PlainRect) => { const i = inter(a, b); return i ? i / (areaOf(a) + areaOf(b) - i) : 0; };
const away = (x: number, y: number, r: PlainRect) => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
const centre = (r: PlainRect) => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 });

/** The mark's own rough extent. */
function roughRect(m: BuddyMark): PlainRect {
  switch (m.kind) {
    case "circle": return { left: m.x - m.r, top: m.y - m.r, right: m.x + m.r, bottom: m.y + m.r };
    case "underline": return { left: Math.min(m.x1, m.x2), top: m.y - 20, right: Math.max(m.x1, m.x2), bottom: m.y };
    default: return { left: Math.min(m.x1, m.x2), top: Math.min(m.y1, m.y2), right: Math.max(m.x1, m.x2), bottom: Math.max(m.y1, m.y2) };
  }
}

/** How well element `e` fits the mark: higher is better, null when it is not the mark's thing. */
function fitScore(m: BuddyMark, e: ElementRect, named: boolean): number | null {
  const r = roughRect(m);
  switch (m.kind) {
    case "box": {
      const o = iou(r, e);
      const c = centre(r);
      if (named) return o >= 0.05 || away(c.x, c.y, e) <= 4 * SNAP_REACH_PX ? 1 + o : null;
      // unnamed: the box all but covers it, and is of its size
      const ratio = areaOf(r) / Math.max(1, areaOf(e));
      return o >= 0.35 && ratio <= 4 && ratio >= 0.25 ? o : null;
    }
    case "underline": {
      const over = Math.max(0, Math.min(r.right, e.right) - Math.max(r.left, e.left));
      const dy = Math.abs(m.y - e.bottom);
      const share = over / Math.max(1, Math.min(w(r), w(e)));
      if (named) return dy <= 4 * SNAP_REACH_PX && (share > 0 || away(centre(r).x, m.y, e) <= 4 * SNAP_REACH_PX) ? 1 + share - dy / 1000 : null;
      return dy <= SNAP_REACH_PX && share >= 0.5 ? share - dy / 100 : null;
    }
    case "circle": {
      const d = away(m.x, m.y, e);
      const half = Math.max(w(e), h(e)) / 2;
      if (named) return d <= m.r + 4 * SNAP_REACH_PX ? 1 - d / 1000 : null;
      return d <= SNAP_REACH_PX && half <= 2.5 * m.r && half >= 0.3 * m.r ? 1 - d / 100 : null;
    }
    case "arrow": {
      const d = away(m.x2, m.y2, e);
      if (named) return d <= 4 * SNAP_REACH_PX ? 1 - d / 1000 : null;
      return d <= SNAP_REACH_PX ? 1 - d / 100 - areaOf(e) / 1e7 : null;
    }
  }
}

/** The element a mark is about: by its label's words first, else by where it lies. Null when none fits. */
export function markTarget(m: BuddyMark, rects: ElementRect[], display: DisplayRect | null = null): ElementRect | null {
  const limit = display ? display.width * display.height * MAX_SHARE : Infinity;
  const here = rects.filter((e) => e.screen === m.screen && w(e) > 1 && h(e) > 1 && areaOf(e) <= limit);
  if (!here.length) return null;
  const label = (m.label ?? "").trim();
  let best: ElementRect | null = null;
  let bestScore = -Infinity;
  if (label) {
    // the elements the label names (the best name score, and those level with it)
    const scored = here.map((e) => [nameScore(label, e.name), e] as const).filter(([s]) => s >= 0.6);
    const top = Math.max(0, ...scored.map(([s]) => s));
    for (const [s, e] of scored) {
      if (s < top - 0.02) continue;
      const f = fitScore(m, e, true);
      if (f !== null && f > bestScore) { best = e; bestScore = f; }
    }
    if (best) return best;
  }
  for (const e of here) {
    const f = fitScore(m, e, false);
    if (f !== null && f > bestScore) { best = e; bestScore = f; }
  }
  return best;
}

/** The point of `r`'s outline nearest `p`, pushed `out` px outside it. */
function edgeToward(r: PlainRect, p: { x: number; y: number }, out: number): { x: number; y: number } {
  const c = centre(r);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  // where the line from the centre to p leaves the rectangle
  const sx = dx === 0 ? Infinity : (w(r) / 2) / Math.abs(dx);
  const sy = dy === 0 ? Infinity : (h(r) / 2) / Math.abs(dy);
  const s = Math.min(sx, sy);
  const len = Math.hypot(dx, dy) || 1;
  if (!Number.isFinite(s)) return { x: c.x, y: r.top - out };
  return { x: c.x + dx * s + (dx / len) * out, y: c.y + dy * s + (dy / len) * out };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * The mark fitted to the thing it is about (global DIP in, global DIP out). A box takes the element's
 * rectangle (the pen pads it by BOX_PAD), an underline its width just below it, a circle rings it, an
 * arrow's tip stops at its edge. A mark with nothing under it is returned as it was.
 */
export function snapMark(m: BuddyMark, rects: ElementRect[], display: DisplayRect | null = null): BuddyMark {
  const e = markTarget(m, rects, display);
  if (!e) return m;
  switch (m.kind) {
    case "box": return { ...m, x1: r1(e.left), y1: r1(e.top), x2: r1(e.right), y2: r1(e.bottom) };
    case "underline": return { ...m, x1: r1(e.left), x2: r1(e.right), y: r1(e.bottom + UNDERLINE_DROP) };
    case "circle": {
      // the pen's loop is 1.12 r wide and 0.92 r high (marks.ts): big enough to ring the whole thing
      const r = Math.max((w(e) / 2 + CIRCLE_AIR) / 1.12, (h(e) / 2 + CIRCLE_AIR) / 0.92);
      const c = centre(e);
      return { ...m, x: r1(c.x), y: r1(c.y), r: r1(r) };
    }
    case "arrow": {
      const tip = edgeToward(e, { x: m.x1, y: m.y1 }, 3);
      return { ...m, x2: r1(tip.x), y2: r1(tip.y) };
    }
  }
}

/** Every mark of an answer fitted (snapMark), each against its own display. */
export function snapMarks(marks: BuddyMark[], rects: ElementRect[], displays: Array<{ index: number; bounds: DisplayRect }> = []): BuddyMark[] {
  if (!rects.length) return marks;
  return marks.map((m) => snapMark(m, rects, displays.find((d) => d.index === m.screen)?.bounds ?? null));
}

/** The rectangles of one display in an overlay's own coordinates (its window's top-left at 0,0), for labels and the pointer to keep off. */
export function localRects(rects: PlainRect[], origin: { x: number; y: number; width: number; height: number }): PlainRect[] {
  return rects
    .filter((r) => r.right > origin.x && r.left < origin.x + origin.width && r.bottom > origin.y && r.top < origin.y + origin.height)
    .map((r) => ({ left: r.left - origin.x, top: r.top - origin.y, right: r.right - origin.x, bottom: r.bottom - origin.y }));
}

/** At most this many rectangles go to the overlays (the smallest first: text and buttons, not panels). */
export const MAX_AVOID = 300;
/** The things labels and the pointer keep off: small named things (text, buttons), not windows or panels. */
export function avoidRects(rects: ElementRect[], displays: Array<{ index: number; bounds: DisplayRect }>): PlainRect[] {
  return rects
    .filter((r) => {
      const d = displays.find((x) => x.index === r.screen)?.bounds;
      return d && w(r) > 2 && h(r) > 2 && areaOf(r) <= d.width * d.height * 0.04;
    })
    .sort((a, b) => areaOf(a) - areaOf(b))
    .slice(0, MAX_AVOID)
    .map((r) => ({ left: r1(r.left), top: r1(r.top), right: r1(r.right), bottom: r1(r.bottom) }));
}
