// Where OK Filow's 3D view goes (okfilow.js showModel): beside the pointer the question was asked at,
// never on the pointer itself, clear of the answer bubble (which sits to the pointer's lower right),
// and wholly inside the work area of the pointer's display. Pure, so it is unit tested.

/** The 3D view's size in DIP: room for the model at ~70% of its height and a column of labels on each side. */
const MODEL_VIEW = { width: 760, height: 460 };
/** How far the view stands off the pointer, and the square around the pointer it never covers (half its side). */
const POINTER_CLEAR = 48;
const MODEL_GAP = POINTER_CLEAR + 8;
/** Where the answer bubble usually is, relative to the pointer (overlay/page.tsx bubblePlacement, max-width 380). */
const BUBBLE = { dx: 30, dy: 18, width: 380, height: 180 };

const area = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/**
 * The view's bounds for a pointer at `cursor` on a display whose work area is `work` ({ x, y, width, height }).
 * Tried in order: left of the pointer, above it, below-left, above-right, right of it; the first that
 * covers neither the pointer nor the bubble wins, else the one covering the least.
 */
function modelBounds(cursor, work, size = MODEL_VIEW, edge = 8) {
  const w = Math.min(size.width, work.width - 2 * edge);
  const h = Math.min(size.height, work.height - 2 * edge);
  const c = cursor;
  const g = MODEL_GAP;
  const cands = [
    { x: c.x - g - w, y: c.y - h / 2 },
    { x: c.x - w / 2, y: c.y - g - h },
    { x: c.x - g - w, y: c.y + g },
    { x: c.x + g, y: c.y - g - h },
    { x: c.x + g, y: c.y - h / 2 },
  ];
  const pointer = { x: c.x - POINTER_CLEAR, y: c.y - POINTER_CLEAR, width: 2 * POINTER_CLEAR, height: 2 * POINTER_CLEAR };
  const bubble = { x: c.x + BUBBLE.dx, y: c.y + BUBBLE.dy, width: BUBBLE.width, height: BUBBLE.height };
  const clamp = (p) => ({ x: Math.round(Math.max(work.x + edge, Math.min(p.x, work.x + work.width - edge - w))), y: Math.round(Math.max(work.y + edge, Math.min(p.y, work.y + work.height - edge - h))), width: w, height: h });
  let best = null;
  let bestCost = Infinity;
  cands.forEach((p, i) => {
    const r = clamp(p);
    const cost = area(r, pointer) * 1000 + area(r, bubble) + i * 0.01;
    if (cost < bestCost) { best = r; bestCost = cost; }
  });
  return best;
}

module.exports = { modelBounds, MODEL_VIEW, MODEL_GAP, POINTER_CLEAR, BUBBLE };
