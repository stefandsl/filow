// Moving and resizing the 3D model window from its own handle and grip (owner, 14/11: "I want to be able to
// move and resize the windows with the generated things on the desktop"). The page sends how far the
// pointer went (the window is frameless and transparent, so the system's own drag and edges are not used);
// main moves or resizes the window and keeps it inside the work area of the display it is on (the one
// holding its centre: dragged onto another screen, it stays there, wholly visible). Pure: unit tested.

const EDGE = 8;
/** The model window's smallest and largest size. */
const MODEL_LIMITS = { minW: 360, minH: 300, maxW: 1600, maxH: 1200 };

const fit = (v, lo, hi) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
const finite = (v) => typeof v === "number" && Number.isFinite(v);

/** The work area holding the centre of the bounds, else the nearest one. */
function areaFor(b, areas) {
  if (!Array.isArray(areas) || !areas.length) return null;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const dist = (a) => Math.hypot(Math.max(a.x - cx, 0, cx - (a.x + a.width)), Math.max(a.y - cy, 0, cy - (a.y + a.height)));
  return areas.slice().sort((a, c) => dist(a) - dist(c))[0];
}

/** Bounds kept to the limits and wholly inside a work area. */
function clampBounds(b, areas, lim = MODEL_LIMITS) {
  const a = areaFor(b, areas);
  if (!a) return b;
  const width = Math.round(fit(b.width, Math.min(lim.minW, a.width - EDGE * 2), Math.min(lim.maxW, a.width - EDGE * 2)));
  const height = Math.round(fit(b.height, Math.min(lim.minH, a.height - EDGE * 2), Math.min(lim.maxH, a.height - EDGE * 2)));
  return {
    x: Math.round(fit(b.x, a.x + EDGE, a.x + a.width - EDGE - width)),
    y: Math.round(fit(b.y, a.y + EDGE, a.y + a.height - EDGE - height)),
    width,
    height,
  };
}

/** The window after one step of a drag (dx, dy) or of a resize from its corner (dw, dh). Null for a bad message. */
function movedBounds(b, d, areas, lim = MODEL_LIMITS) {
  if (!b || !d || typeof d !== "object") return null;
  const dx = finite(d.dx) ? d.dx : 0;
  const dy = finite(d.dy) ? d.dy : 0;
  const dw = finite(d.dw) ? d.dw : 0;
  const dh = finite(d.dh) ? d.dh : 0;
  if (Math.abs(dx) > 10000 || Math.abs(dy) > 10000 || Math.abs(dw) > 10000 || Math.abs(dh) > 10000) return null;
  return clampBounds({ x: b.x + dx, y: b.y + dy, width: b.width + dw, height: b.height + dh }, areas, lim);
}

/** Where the window is, in an overlay's own coordinates, or null when it is not on that overlay's display. */
function localRect(b, overlay) {
  if (!b || !overlay) return null;
  const left = Math.max(b.x, overlay.x) - overlay.x;
  const top = Math.max(b.y, overlay.y) - overlay.y;
  const right = Math.min(b.x + b.width, overlay.x + overlay.width) - overlay.x;
  const bottom = Math.min(b.y + b.height, overlay.y + overlay.height) - overlay.y;
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

module.exports = { EDGE, MODEL_LIMITS, areaFor, clampBounds, movedBounds, localRect };
