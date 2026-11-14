// Which parts of a click-through window take the mouse, decided in the main process from the real
// cursor position (screen.getCursorScreenPoint), never from the page's pointer events. The page only
// reports where its controls are (rectangles in window coordinates). Pointer events raced: a canvas
// "leave" after a tools "enter", a drag handle that swallows "enter", a click before the IPC round
// trip; the window then ignored a click on its close button. A rectangle under the real cursor
// always takes the mouse. Pure, so the decision is unit tested (okfilow-hit.test.ts).

/** At most this many rectangles per window (labels, tools, media items). */
const MAX_RECTS = 64;

const finite = (v) => typeof v === "number" && Number.isFinite(v);

/** The rectangles a page reported, kept to sane ones: { left, top, right, bottom }, with a size. */
function cleanRects(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const r of list.slice(0, MAX_RECTS)) {
    if (!r || typeof r !== "object" || ![r.left, r.top, r.right, r.bottom].every(finite)) continue;
    if (r.right <= r.left || r.bottom <= r.top) continue;
    out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  }
  return out;
}

/** True when the point (window coordinates) is inside one of the rectangles (edges included). */
function insideAny(p, rects) {
  if (!p || !finite(p.x) || !finite(p.y)) return false;
  return rects.some((r) => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom);
}

/** The cursor (screen DIP) in a window's own coordinates, or null when it is outside the window. */
function localPoint(cursor, bounds) {
  if (!cursor || !bounds) return null;
  const x = cursor.x - bounds.x;
  const y = cursor.y - bounds.y;
  return x >= 0 && y >= 0 && x <= bounds.width && y <= bounds.height ? { x, y } : null;
}

/**
 * One window's mouse: `setIgnore(true)` is click-through. `rects(list)`: where the controls are now;
 * `hold(on)`: the page needs the mouse wherever it is (a drag in progress, the pointer on a 3D part);
 * `at(point)`: the cursor in window coordinates (null: not over the window). The window is told only
 * when its state changes. Returns whether it takes the mouse.
 */
function createHitTarget({ setIgnore }) {
  let rects = [];
  let held = false;
  let last = null;
  let point = null;
  const decide = () => {
    const take = held || insideAny(point, rects);
    if (take !== last) {
      last = take;
      setIgnore(!take);
    }
    return take;
  };
  return {
    rects(list) { rects = cleanRects(list); return decide(); },
    hold(on) { held = on === true; return decide(); },
    at(p) { point = p || null; return decide(); },
    takes: () => last === true,
  };
}

module.exports = { MAX_RECTS, cleanRects, insideAny, localPoint, createHitTarget };
