// OK Filow's pen marks, pure so they are unit tested: the shape of each mark (one hand-drawn style for
// all of them), its length (the pen's time follows it), and where its label goes (outside the marks,
// on screen, off the pill, never on another label) with a leader line back to the mark.
import type { BuddyMark } from "./prompt";

type P = { x: number; y: number };
export type Rect = { left: number; top: number; right: number; bottom: number };

/** A mark as the pen draws it: one stroke (`points`, drawn in order), and for an arrow a filled head. */
export type MarkShape = {
  points: P[];
  /** SVG path data of the stroke. */
  d: string;
  /** The stroke's length in px. */
  length: number;
  /** A filled, tapered arrow head (SVG path data), drawn as the shaft ends. */
  head?: string;
  /** Where the shape lies on screen (stroke included). */
  bounds: Rect;
};

/** How wide the pen is, and how far the shapes stand off what they mark. */
export const PEN_WIDTH = 4.5;
const BOX_PAD = 6;

const round = (v: number) => Math.round(v * 10) / 10;

/** A small, steady wobble so lines look drawn by hand; the same mark always wobbles the same way. */
function wobble(seed: number, k: number): number {
  return Math.sin(seed * 12.9898 + k * 2 * Math.PI * 2) * 0.6 + Math.sin(seed * 78.233 + k * 2 * Math.PI * 3) * 0.4;
}

function seedOf(m: BuddyMark): number {
  const nums = m.kind === "circle" ? [m.x, m.y, m.r] : m.kind === "underline" ? [m.x1, m.x2, m.y] : [m.x1, m.y1, m.x2, m.y2];
  return nums.reduce((a, v, i) => a + (Number(v) || 0) * (i + 1) * 0.013, 0.5) % 7;
}

/** Points along a quadratic curve. */
function quad(a: P, c: P, b: P, n: number): P[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const u = 1 - t;
    return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
  });
}

export function polylineLength(points: P[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return len;
}

function boundsOf(points: P[], pad: number): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { left: Math.min(...xs) - pad, top: Math.min(...ys) - pad, right: Math.max(...xs) + pad, bottom: Math.max(...ys) + pad };
}

const toD = (points: P[]) => "M" + points.map((p) => `${round(p.x)},${round(p.y)}`).join(" L");

/**
 * A rounded rectangle walked clockwise from its top-left corner, slightly uneven like a quick pen, and
 * carried `overlap` px past its start so it closes.
 */
function roundedBox(r: Rect, radius: number, seed: number, overlap: number): P[] {
  const w = r.right - r.left;
  const h = r.bottom - r.top;
  const rad = Math.max(2, Math.min(radius, w / 2, h / 2));
  // Corner centres, clockwise from top-right; each corner sweeps a quarter turn.
  const corners: Array<{ c: P; a0: number }> = [
    { c: { x: r.right - rad, y: r.top + rad }, a0: -Math.PI / 2 },
    { c: { x: r.right - rad, y: r.bottom - rad }, a0: 0 },
    { c: { x: r.left + rad, y: r.bottom - rad }, a0: Math.PI / 2 },
    { c: { x: r.left + rad, y: r.top + rad }, a0: Math.PI },
  ];
  const pts: P[] = [{ x: r.left + rad, y: r.top }];
  for (const { c, a0 } of corners) {
    for (let i = 0; i <= 6; i++) {
      const a = a0 + (i / 6) * (Math.PI / 2);
      pts.push({ x: c.x + Math.cos(a) * rad, y: c.y + Math.sin(a) * rad });
    }
  }
  // Densify the straight sides so the wobble bends them a little, then carry on past the start.
  const dense: P[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.round(seg / 14));
    for (let j = 0; j < n; j++) dense.push({ x: a.x + ((b.x - a.x) * j) / n, y: a.y + ((b.y - a.y) * j) / n });
  }
  const perimeter = polylineLength([...dense, dense[0]]);
  let walked = 0;
  const out: P[] = [];
  const amp = Math.min(1.6, Math.min(w, h) * 0.04);
  for (let i = 0; walked <= perimeter + overlap; i++) {
    const p = dense[i % dense.length];
    const q = dense[(i + 1) % dense.length];
    const k = walked / perimeter;
    // the wobble is pushed outwards (away from the box's centre), so the box never closes in on its subject
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    const nx = p.x - cx;
    const ny = p.y - cy;
    const nl = Math.hypot(nx, ny) || 1;
    // the overlap runs a little outside the start, like a pen that overshoots
    const drift = walked > perimeter ? ((walked - perimeter) / Math.max(1, overlap)) * 1.4 : 0;
    const off = (wobble(seed, k) + 1) * 0.5 * amp + drift;
    out.push({ x: p.x + (nx / nl) * off, y: p.y + (ny / nl) * off });
    walked += Math.hypot(q.x - p.x, q.y - p.y);
  }
  return out;
}

/** The mark's shape: circles and boxes are closed, slightly uneven loops; arrows end in a filled, tapered head. */
export function markShape(m: BuddyMark): MarkShape {
  const pad = PEN_WIDTH;
  const seed = seedOf(m);
  switch (m.kind) {
    case "circle": {
      const rx = m.r * 1.12;
      const ry = m.r * 0.92;
      // A whole turn plus a short overlap; the wobble repeats every turn, so the two ends meet and cross.
      const turn = 1.08;
      const n = Math.max(36, Math.round(m.r * 0.9));
      const pts = Array.from({ length: n + 1 }, (_, i) => {
        const k = (i / n) * turn;
        const a = -2.2 + k * Math.PI * 2;
        const wob = 1 + 0.03 * wobble(seed, k % 1);
        // the overlap drifts a touch outside the start, as a pen does when it closes a loop
        const over = k > 1 ? 1 + (k - 1) * 0.35 : 1;
        return { x: m.x + Math.cos(a) * rx * wob * over, y: m.y + Math.sin(a) * ry * wob * over };
      });
      return { points: pts, d: toD(pts), length: polylineLength(pts), bounds: boundsOf(pts, pad) };
    }
    case "underline": {
      const mid = (m.x1 + m.x2) / 2;
      const pts = quad({ x: m.x1, y: m.y + 2 }, { x: mid, y: m.y - 3 }, { x: m.x2, y: m.y + 1 }, Math.max(8, Math.round(Math.abs(m.x2 - m.x1) / 12)));
      return { points: pts, d: toD(pts), length: polylineLength(pts), bounds: boundsOf(pts, pad) };
    }
    case "box": {
      const r = { left: Math.min(m.x1, m.x2) - BOX_PAD, top: Math.min(m.y1, m.y2) - BOX_PAD, right: Math.max(m.x1, m.x2) + BOX_PAD, bottom: Math.max(m.y1, m.y2) + BOX_PAD };
      const pts = roundedBox(r, 10, seed, 16);
      return { points: pts, d: toD(pts), length: polylineLength(pts), bounds: boundsOf(pts, pad) };
    }
    case "arrow": {
      const len = Math.hypot(m.x2 - m.x1, m.y2 - m.y1) || 1;
      const ux = (m.x2 - m.x1) / len;
      const uy = (m.y2 - m.y1) / len;
      const headLen = Math.min(20, Math.max(12, len * 0.22));
      const half = headLen * 0.5;
      // The shaft ends inside the head's notch, so its round cap never shows past the head.
      const notch = headLen * 0.62;
      const end = { x: m.x2 - ux * notch, y: m.y2 - uy * notch };
      const bendBy = 0.12;
      const bend = { x: (m.x1 + end.x) / 2 - (end.y - m.y1) * bendBy, y: (m.y1 + end.y) / 2 + (end.x - m.x1) * bendBy };
      // The head points along the shaft's last direction (the curve's tangent at its end), its tip on the target.
      const tx = end.x - bend.x;
      const ty = end.y - bend.y;
      const tl = Math.hypot(tx, ty) || 1;
      const hx = tx / tl;
      const hy = ty / tl;
      const tip = { x: m.x2, y: m.y2 };
      const pts = quad({ x: m.x1, y: m.y1 }, bend, { x: tip.x - hx * notch, y: tip.y - hy * notch }, Math.max(10, Math.round(len / 14)));
      const base = { x: tip.x - hx * headLen, y: tip.y - hy * headLen };
      const left = { x: base.x - hy * half, y: base.y + hx * half };
      const right = { x: base.x + hy * half, y: base.y - hx * half };
      const back = { x: tip.x - hx * headLen * 0.72, y: tip.y - hy * headLen * 0.72 };
      const head = `M${round(tip.x)},${round(tip.y)} L${round(left.x)},${round(left.y)} L${round(back.x)},${round(back.y)} L${round(right.x)},${round(right.y)} Z`;
      return { points: pts, d: toD(pts), length: polylineLength(pts), head, bounds: boundsOf([...pts, tip, left, right], pad) };
    }
  }
}

export type LabelSpot = {
  /** The label's box (top-left and size). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The leader line: from the mark's edge (`from`, where the dot sits) to the label's nearest edge (`to`). */
  from: P;
  to: P;
};

const overlaps = (a: Rect, b: Rect, margin = 0) => a.left < b.right + margin && a.right > b.left - margin && a.top < b.bottom + margin && a.bottom > b.top - margin;
const area = (a: Rect, b: Rect) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/** The point of the mark the leader starts from: the mark's edge nearest the label. */
function anchorOf(m: BuddyMark, shape: MarkShape, to: P): P {
  if (m.kind === "arrow") return { x: m.x1, y: m.y1 };
  // The stroke point nearest the label's centre.
  let best = shape.points[0];
  let bd = Infinity;
  for (const p of shape.points) {
    const d = Math.hypot(p.x - to.x, p.y - to.y);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

function nearestOnRect(r: Rect, p: P): P {
  return { x: Math.max(r.left, Math.min(p.x, r.right)), y: Math.max(r.top, Math.min(p.y, r.bottom)) };
}

/** Candidate places for a label around a mark, best first. */
function candidates(m: BuddyMark, b: Rect, w: number, h: number, gap: number): Array<{ x: number; y: number }> {
  const cx = (b.left + b.right) / 2;
  const cy = (b.top + b.bottom) / 2;
  const below = { x: b.left, y: b.bottom + gap };
  const above = { x: b.left, y: b.top - gap - h };
  const right = { x: b.right + gap, y: cy - h / 2 };
  const left = { x: b.left - gap - w, y: cy - h / 2 };
  const aboveRight = { x: cx + (b.right - cx) * 0.4, y: b.top - gap - h };
  const belowRight = { x: cx + (b.right - cx) * 0.4, y: b.bottom + gap };
  const belowEnd = { x: b.right - w, y: b.bottom + gap };
  const aboveEnd = { x: b.right - w, y: b.top - gap - h };
  switch (m.kind) {
    // Above the circle: the answer bubble usually sits below the buddy.
    case "circle": return [aboveRight, right, above, left, belowRight, below];
    // On the trailing side first: rows and lists start with their badges, numbers and icons at the
    // left, so a label below-left of a box or a line lands on them (the 01 and 03 badges).
    case "box": return [right, aboveEnd, belowEnd, above, below, left];
    case "underline": return [right, belowEnd, aboveEnd, below, above, left];
    case "arrow": {
      // Beside the tail, on the side away from the head.
      const tail = { x: m.x1, y: m.y1 };
      const awayX = m.x1 >= m.x2 ? 1 : -1;
      const awayY = m.y1 >= m.y2 ? 1 : -1;
      const tailOut = { x: awayX > 0 ? tail.x + gap * 0.6 : tail.x - gap * 0.6 - w, y: awayY > 0 ? tail.y + gap * 0.6 : tail.y - gap * 0.6 - h };
      const tailSide = { x: awayX > 0 ? tail.x + gap : tail.x - gap - w, y: tail.y - h / 2 };
      const tailEnd = { x: tail.x - w / 2, y: awayY > 0 ? tail.y + gap : tail.y - gap - h };
      return [tailOut, tailSide, tailEnd, below, above, right, left];
    }
  }
}

/**
 * Places each mark's label (`sizes[i]` its measured size; null for a mark with no label): outside every
 * mark, wholly on screen, off the `avoid` boxes (the pill), and never on another label. Labels that find
 * no free spot among their candidates are pushed down (or up) until they are clear of the other labels.
 */
export function placeLabels(marks: BuddyMark[], sizes: Array<{ width: number; height: number } | null>, view: { width: number; height: number }, avoid: Rect[] = [], gap = 18, edge = 8): Array<LabelSpot | null> {
  const shapes = marks.map(markShape);
  const placed: Rect[] = [];
  const clamp = (c: { x: number; y: number }, w: number, h: number) => ({ x: Math.max(edge, Math.min(c.x, view.width - edge - w)), y: Math.max(edge, Math.min(c.y, view.height - edge - h)) });
  return marks.map((m, i) => {
    const size = sizes[i];
    if (!size || !m.label) return null;
    const { width: w, height: h } = size;
    const rectAt = (c: { x: number; y: number }): Rect => ({ left: c.x, top: c.y, right: c.x + w, bottom: c.y + h });
    const cost = (c: { x: number; y: number }) => {
      const r = rectAt(c);
      let bad = 0;
      for (const p of placed) bad += area(r, p) * 100 + (overlaps(r, p, 6) ? 1000 : 0);
      for (const a of avoid) bad += area(r, a) * 100 + (overlaps(r, a, 6) ? 1000 : 0);
      for (const s of shapes) bad += area(r, s.bounds) + (overlaps(r, s.bounds, 2) ? 10 : 0);
      return bad;
    };
    const cands = candidates(m, shapes[i].bounds, w, h, gap).map((c) => clamp(c, w, h));
    let best = cands[0];
    let bestCost = Infinity;
    for (const c of cands) {
      const k = cost(c);
      if (k < bestCost) { best = c; bestCost = k; }
      if (k === 0) break;
    }
    // Still on another label or the pill: walk down, then up, in small steps until it is clear.
    const clear = (c: { x: number; y: number }) => !placed.some((p) => overlaps(rectAt(c), p, 6)) && !avoid.some((a) => overlaps(rectAt(c), a, 6));
    if (!clear(best)) {
      const start = best;
      for (let step = 1; step < 200 && !clear(best); step++) {
        const dy = (step % 2 ? 1 : -1) * Math.ceil(step / 2) * 6;
        const next = clamp({ x: start.x, y: start.y + dy }, w, h);
        if (clear(next)) best = next;
      }
    }
    const r = rectAt(best);
    placed.push(r);
    const centre = { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
    const from = anchorOf(m, shapes[i], centre);
    return { x: best.x, y: best.y, width: w, height: h, from, to: nearestOnRect(r, from) };
  });
}

/** Whether any two labels overlap (for the tests and the measurement). */
export function labelsOverlap(spots: Array<LabelSpot | null>): boolean {
  const rs = spots.filter((s): s is LabelSpot => Boolean(s)).map((s) => ({ left: s.x, top: s.y, right: s.x + s.width, bottom: s.y + s.height }));
  return rs.some((a, i) => rs.some((b, j) => j > i && overlaps(a, b)));
}
