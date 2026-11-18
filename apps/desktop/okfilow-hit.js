// Which parts of a click-through window take the mouse, decided in the main process from the real
// cursor position (screen.getCursorScreenPoint), never from the page's pointer events. The page only
// reports where its controls are (rectangles in window coordinates). Pointer events raced: a canvas
// "leave" after a tools "enter", a drag handle that swallows "enter", a click before the IPC round
// trip; the window then ignored a click on its close button. A rectangle under the real cursor
// always takes the mouse. Pure, so the decision is unit tested (okfilow-hit.test.ts).

/** At most this many rectangles per window (labels, tools, media items). */
const MAX_RECTS = 64;
const GRIP_MARGIN = 160;

const finite = (v) => typeof v === "number" && Number.isFinite(v);

function clipRect({ left, top, right, bottom }, bounds) {
  if (bounds) {
    const x = bounds.left ?? 0, y = bounds.top ?? 0;
    left = Math.max(x, left); top = Math.max(y, top);
    right = Math.min(x + bounds.width, right); bottom = Math.min(y + bounds.height, bottom);
  }
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

/** Keep ordinary hits alongside the active grip so ownership can transfer without another IPC. */
function cleanHitReport(list, bounds, display = bounds, includeBubble = true) {
  const base = [], rects = [];
  let padded = null;
  for (let r of Array.isArray(list) ? list.slice(0, MAX_RECTS) : []) {
    if (!r || typeof r !== "object" || ![r.left, r.top, r.right, r.bottom].every(finite)) continue;
    if (!includeBubble && r.bubble === true) continue;
    if (r.right <= r.left || r.bottom <= r.top) continue;
    // Large or restored items still need their right-side controls and bottom-right grip.
    // Cap the visible item before adding any grip margin.
    if (display && (r.right - r.left > display.width * 0.8 || r.bottom - r.top > display.height * 0.8)) {
      const visible = clipRect(r, bounds);
      if (!visible) continue;
      r = { ...r, ...visible, left: Math.max(visible.left, visible.right - display.width * 0.8),
        top: Math.max(visible.top, visible.bottom - display.height * 0.8) };
    }
    const ordinary = clipRect(r, bounds);
    if (ordinary) base.push(ordinary);
    let rect = ordinary;
    // A report carries the normal item box plus an optional hit box. Intersect with
    // the item's fixed margin, never accept a free-standing oversized hit area.
    // Only one item per report can have padding. All other items retain normal hover.
    const h = r.hit;
    if (!padded && h && [h.left, h.top, h.right, h.bottom].every(finite) && h.right > h.left && h.bottom > h.top) {
      rect = clipRect({
        left: Math.max(r.left - GRIP_MARGIN, Math.min(r.left, h.left)),
        top: Math.max(r.top - GRIP_MARGIN, Math.min(r.top, h.top)),
        right: Math.min(r.right + GRIP_MARGIN, Math.max(r.right, h.right)),
        bottom: Math.min(r.bottom + GRIP_MARGIN, Math.max(r.bottom, h.bottom)),
      }, bounds);
      if (rect && (!ordinary || rect.left < ordinary.left || rect.top < ordinary.top || rect.right > ordinary.right || rect.bottom > ordinary.bottom)) padded = rect;
    }
    if (r.bubble === true) {
      if (ordinary) ordinary.bubble = true;
      if (rect) rect.bubble = true;
    }
    if (rect) rects.push(rect);
  }
  return { base, rects, padded };
}

function cleanRects(list, bounds, display = bounds) {
  return cleanHitReport(list, bounds, display).rects;
}

/** True when the point (window coordinates) is inside one of the rectangles: left and top edges in, right and bottom out, as a page hit-tests. */
function insideAny(p, rects) {
  if (!p || !finite(p.x) || !finite(p.y)) return false;
  return rects.some((r) => p.x >= r.left && p.x < r.right && p.y >= r.top && p.y < r.bottom);
}

/** Window coordinates; the model's captured grip can visit its padded rect outside native bounds. */
function localPoint(cursor, bounds, outside = false) {
  if (!cursor || !bounds) return null;
  const x = cursor.x - bounds.x;
  const y = cursor.y - bounds.y;
  return outside || (x >= 0 && y >= 0 && x <= bounds.width && y <= bounds.height) ? { x, y } : null;
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

module.exports = { MAX_RECTS, GRIP_MARGIN, cleanHitReport, cleanRects, insideAny, localPoint, createHitTarget };
