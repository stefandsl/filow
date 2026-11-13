// The 3D view's framing and its numbered part labels, pure so they are unit tested. The labels stand in
// two columns beside the model (left and right of it), each on a leader line that starts on its
// part's anchor as the model turns; they never overlap, stay on screen, and only change sides when
// their part has clearly crossed to the other half (no flicker at the middle).

type P = { x: number; y: number };
type Size = { width: number; height: number };
export type LabelSide = "left" | "right";
export type LabelSlot = { x: number; y: number; width: number; height: number; side: LabelSide; from: P; knee: P; elbow: P; to: P };

const DEG = Math.PI / 180;

/** How far the camera stands so a model of bounding radius `radius` fills `fill` of the view's smaller side. */
export function frameDistance(radius: number, fovDeg: number, aspect: number, fill = 0.7): number {
  const r = Number.isFinite(radius) && radius > 0 ? radius : 1;
  const v = Math.tan((fovDeg * DEG) / 2);
  const t = Math.min(v, v * (aspect > 0 ? aspect : 1));
  return r / (fill * t);
}

/**
 * How much nearer (>1) or further (<1) the camera must go so the model, whose widest on-screen extent
 * over a whole turn is `extent` px, fills `fill` of the view's height and stays within the free width
 * between the two label columns (`column` px each, kept to at least 40% of the view's width).
 */
export function fitScale(extent: Size, view: Size, column: number, fill = 0.7): number {
  if (!(extent.width > 0) || !(extent.height > 0) || !(view.width > 0) || !(view.height > 0)) return 1;
  const free = Math.max(view.width * 0.4, view.width - 2 * Math.max(0, column));
  return Math.min((fill * view.height) / extent.height, (0.95 * free) / extent.width);
}

/** At most this many parts get a label (the biggest ones, one per name). */
export const MAX_PART_LABELS = 10;

/**
 * Which parts get a label: one per name (the biggest of those that share it), the `max` biggest,
 * numbered in the model's own order. `sizes[i]` is part i's size (any measure that grows with it).
 */
export function labelledParts(names: string[], sizes: number[], max = MAX_PART_LABELS): number[] {
  const byName = new Map<string, number>();
  names.forEach((n, i) => {
    const key = n.trim().toLowerCase();
    if (!key) return;
    const was = byName.get(key);
    if (was === undefined || sizes[i] > sizes[was]) byName.set(key, i);
  });
  return [...byName.values()].sort((a, b) => sizes[b] - sizes[a] || a - b).slice(0, Math.max(0, max)).sort((a, b) => a - b);
}

/**
 * Lays out the labels for parts whose anchors are at `anchors` (screen px, this frame): `sizes[i]`
 * is label i's size, `centreX` the model's middle on screen, `prev` the sides of the last frame
 * (null on the first). A label keeps its side until its anchor is `hysteresis` px past the middle;
 * a column that is full gives its labels nearest the middle to the other one.
 */
export function layoutPartLabels(anchors: P[], sizes: Size[], view: Size, centreX: number, prev: LabelSide[] | null = null, edge = 10, gap = 6, hysteresis = 18): LabelSlot[] {
  const n = anchors.length;
  const sides: LabelSide[] = anchors.map((a, i) => {
    const was = prev?.[i];
    if (was === "left") return a.x > centreX + hysteresis ? "right" : "left";
    if (was === "right") return a.x < centreX - hysteresis ? "left" : "right";
    return a.x < centreX ? "left" : "right";
  });
  // A column holds as many labels as fit in the view's height.
  const fits = (side: LabelSide) => {
    let used = 0;
    let count = 0;
    for (let i = 0; i < n; i++) if (sides[i] === side) { used += sizes[i].height + (count ? gap : 0); count++; }
    return used <= view.height - 2 * edge;
  };
  for (const side of ["left", "right"] as const) {
    const other = side === "left" ? "right" : "left";
    let guard = n;
    while (!fits(side) && guard-- > 0) {
      const mine = anchors.map((a, i) => ({ a, i })).filter(({ i }) => sides[i] === side);
      if (!mine.length) break;
      mine.sort((p, q) => Math.abs(p.a.x - centreX) - Math.abs(q.a.x - centreX));
      sides[mine[0].i] = other;
      if (!fits(other)) { sides[mine[0].i] = side; break; }
    }
  }
  const ys = new Array<number>(n).fill(0);
  for (const side of ["left", "right"] as const) {
    const col = anchors.map((a, i) => ({ a, i })).filter(({ i }) => sides[i] === side).sort((p, q) => p.a.y - q.a.y || p.i - q.i);
    // Each label as near its anchor's height as the labels above it allow, then pushed up from the bottom edge.
    let bottom = edge - gap;
    for (const { a, i } of col) {
      const h = sizes[i].height;
      ys[i] = Math.max(a.y - h / 2, bottom + gap, edge);
      bottom = ys[i] + h;
    }
    let top = view.height - edge + gap;
    for (let k = col.length - 1; k >= 0; k--) {
      const { i } = col[k];
      const h = sizes[i].height;
      ys[i] = Math.min(ys[i], top - gap - h);
      top = ys[i];
    }
  }
  // Every leader runs level from its anchor out past all the anchors (the knee), straight across to the
  // column's inner line (the elbow, level with its label), then level into its label. Level runs never
  // cross (they are parallel and at different heights), and the straight runs of one side lie between
  // two upright lines with their ends in the same order, so no two leaders ever cross.
  const xs = anchors.map((a) => a.x);
  const innerL = Math.max(edge, ...anchors.map((_, i) => (sides[i] === "left" ? edge + sizes[i].width : edge))) + 4;
  const innerR = Math.min(view.width - edge, ...anchors.map((_, i) => (sides[i] === "right" ? view.width - edge - sizes[i].width : view.width - edge))) - 4;
  const kneeL = Math.max(innerL, Math.min(...xs) - 10);
  const kneeR = Math.min(innerR, Math.max(...xs) + 10);
  return anchors.map((a, i) => {
    const { width: w, height: h } = sizes[i];
    const side = sides[i];
    const left = side === "left";
    const x = left ? edge : view.width - edge - w;
    const y = ys[i];
    const mid = y + h / 2;
    return { x, y, width: w, height: h, side, from: { x: a.x, y: a.y }, knee: { x: left ? kneeL : kneeR, y: a.y }, elbow: { x: left ? innerL : innerR, y: mid }, to: { x: left ? x + w : x, y: mid } };
  });
}

/** The labels' numbers in reading order: down the left column, then down the right one (1, 2, 3... with no gaps). */
export function readingOrder(slots: LabelSlot[]): number[] {
  const order = slots.map((s, i) => ({ s, i })).sort((p, q) => (p.s.side === q.s.side ? p.s.y - q.s.y || p.i - q.i : p.s.side === "left" ? -1 : 1));
  const n = new Array<number>(slots.length);
  order.forEach(({ i }, k) => { n[i] = k + 1; });
  return n;
}

/** A label's leader as a polyline: anchor, knee, elbow, label edge. */
export const leaderPoints = (s: LabelSlot): P[] => [s.from, s.knee, s.elbow, s.to];

/** Whether two segments cross (touching at a shared end does not count). */
function segmentsCross(a: P, b: P, c: P, d: P): boolean {
  const o = (p: P, q: P, r: P) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const same = (p: P, q: P) => Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9;
  if (same(a, c) || same(a, d) || same(b, c) || same(b, d)) return false;
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** Whether any two leaders cross (for the tests and the measurement). */
export function leadersCross(slots: LabelSlot[]): boolean {
  const segs = slots.flatMap((s, i) => {
    const p = leaderPoints(s);
    return p.slice(1).map((q, k) => [p[k], q, i]) as Array<[P, P, number]>;
  });
  return segs.some(([a, b, i], k) => segs.some(([c, d, j], m) => m > k && i !== j && segmentsCross(a, b, c, d)));
}

/** Whether any two label slots overlap (for the tests and the measurement). */
export function slotsOverlap(slots: LabelSlot[]): boolean {
  return slots.some((a, i) => slots.some((b, j) => j > i && a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y));
}
