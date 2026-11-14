// Moving and resizing what OK Filow puts over the desktop (owner, 14/11: "I want to be able to move and
// resize the windows with the generated things on the desktop"): the 3D model window, the cards, the
// pictures, the slide and the answer bubble. A drag handle moves an item, a grip in its corner resizes it,
// arrow keys move a focused item and Shift+arrows resize it; every result stays inside the visible area,
// between the item's smallest and largest size. Where each kind was put is remembered for the session;
// "reset layout" forgets it. Pure (the store takes any Storage), so it is unit tested.
import type { Rect } from "./marks";

export type Box = { x: number; y: number; w: number; h: number };
export type Area = { x: number; y: number; width: number; height: number };
export type Limits = { minW: number; minH: number; maxW: number; maxH: number };
export type MovableKind = "model" | "cards" | "gallery" | "slide" | "bubble";
export const MOVABLE_KINDS: MovableKind[] = ["model", "cards", "gallery", "slide", "bubble"];

/** The smallest and largest size of each kind (the largest is also never more than the visible area). */
export const LIMITS: Record<MovableKind, Limits> = {
  model: { minW: 360, minH: 300, maxW: 1600, maxH: 1200 },
  cards: { minW: 220, minH: 80, maxW: 520, maxH: 2000 },
  gallery: { minW: 180, minH: 140, maxW: 1400, maxH: 1200 },
  slide: { minW: 360, minH: 160, maxW: 960, maxH: 2000 },
  bubble: { minW: 200, minH: 40, maxW: 640, maxH: 2000 },
};
/** How far one arrow key moves or resizes an item. */
export const KEY_STEP = 16;
/** How much of the area edge an item keeps away from. */
export const EDGE = 8;

const fit = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

/** The box kept to its limits and wholly inside the area (a box larger than the area is shrunk first). */
export function clampBox(b: Box, area: Area, lim: Limits): Box {
  const w = Math.round(fit(b.w, Math.min(lim.minW, area.width - EDGE * 2), Math.min(lim.maxW, area.width - EDGE * 2)));
  const h = Math.round(fit(b.h, Math.min(lim.minH, area.height - EDGE * 2), Math.min(lim.maxH, area.height - EDGE * 2)));
  const x = Math.round(fit(b.x, area.x + EDGE, area.x + area.width - EDGE - w));
  const y = Math.round(fit(b.y, area.y + EDGE, area.y + area.height - EDGE - h));
  return { x, y, w, h };
}

/** A drag of the handle by dx, dy from where the drag started. */
export function dragBox(start: Box, dx: number, dy: number, area: Area, lim: Limits): Box {
  return clampBox({ ...start, x: start.x + dx, y: start.y + dy }, area, lim);
}

export type Edge = "se" | "e" | "s";
/** A drag of the corner (se) or of the right (e) or bottom (s) edge by dx, dy: the top-left corner stays. */
export function resizeBox(start: Box, edge: Edge, dx: number, dy: number, area: Area, lim: Limits): Box {
  // the size kept to the limits and to the room right and below, so the corner opposite the grip stays put
  const w = fit(edge === "s" ? start.w : start.w + dx, lim.minW, Math.min(lim.maxW, area.x + area.width - EDGE - start.x));
  const h = fit(edge === "e" ? start.h : start.h + dy, lim.minH, Math.min(lim.maxH, area.y + area.height - EDGE - start.y));
  return clampBox({ ...start, w, h }, area, lim);
}

/** An arrow key on a focused item: moves it, or with Shift resizes it. Null for any other key. */
export function keyBox(b: Box, key: string, shift: boolean, area: Area, lim: Limits, step = KEY_STEP): Box | null {
  const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[key];
  if (!d) return null;
  return shift ? clampBox({ ...b, w: b.w + d[0], h: b.h + d[1] }, area, lim) : clampBox({ ...b, x: b.x + d[0], y: b.y + d[1] }, area, lim);
}

/** The visible area a box belongs to: the one holding its centre, else the nearest (multi-monitor). */
export function areaFor(b: Box, areas: Area[]): Area | null {
  if (!areas.length) return null;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dist = (a: Area) => Math.hypot(Math.max(a.x - cx, 0, cx - (a.x + a.width)), Math.max(a.y - cy, 0, cy - (a.y + a.height)));
  return [...areas].sort((a, b2) => dist(a) - dist(b2))[0];
}

// ---- remembered for the session ----

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const KEY = "filow.okf.layout";
const okBox = (v: unknown): v is Box => !!v && typeof v === "object" && ["x", "y", "w", "h"].every((k) => Number.isFinite((v as Record<string, unknown>)[k]));

/** Where each kind was put this session (absent: where OK Filow puts it). */
export function readLayout(store: Store | null): Partial<Record<MovableKind, Box>> {
  try {
    const raw = JSON.parse(store?.getItem(KEY) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(MOVABLE_KINDS.filter((k) => okBox(raw[k])).map((k) => [k, raw[k] as Box]));
  } catch {
    return {};
  }
}
export function rememberBox(store: Store | null, kind: MovableKind, b: Box): void {
  try { store?.setItem(KEY, JSON.stringify({ ...readLayout(store), [kind]: b })); } catch { /* private or full: not remembered */ }
}
export function resetLayout(store: Store | null): void {
  try { store?.removeItem(KEY); } catch { /* nothing kept */ }
}

// ---- the bubble keeps off what it belongs to, and stands beside it ----

/**
 * Where the answer's bubble goes when its answer shows something (pictures, a slide, a 3D model): beside
 * that item, like its caption: to its right, top edges level; else left, below or above; on screen, off
 * every box and off the pill. Null when there is no such spot (the bubble then stays by the pointer).
 */
export function bubbleBeside(item: Rect, size: { width: number; height: number }, view: { width: number; height: number }, boxes: Rect[], pill: Rect | null = null, gap = 12): { x: number; y: number } | null {
  const all = pill ? [...boxes, pill] : boxes;
  const fits = (p: { x: number; y: number }) => p.x >= EDGE && p.y >= EDGE && p.x + size.width <= view.width - EDGE && p.y + size.height <= view.height - EDGE && all.every((b) => !hits({ left: p.x, top: p.y, right: p.x + size.width, bottom: p.y + size.height }, b, gap - 1));
  const top = fit(item.top, EDGE, view.height - EDGE - size.height);
  const left = fit(item.left, EDGE, view.width - EDGE - size.width);
  const spots = [{ x: item.right + gap, y: top }, { x: item.left - gap - size.width, y: top }, { x: left, y: item.bottom + gap }, { x: left, y: item.top - gap - size.height }];
  return spots.find(fits) ?? null;
}

const hits = (a: Rect, b: Rect, m: number) => a.left < b.right + m && a.right > b.left - m && a.top < b.bottom + m && a.bottom > b.top - m;

/**
 * Where the answer's bubble goes so it never covers the 3D model, the pictures or the slide it belongs to:
 * `at` when it is clear of them, else the nearest spot beside one of them (right, left, below, above)
 * that is clear of all of them and on screen. When there is no such spot, `at`.
 */
export function bubbleClear(at: { x: number; y: number }, size: { width: number; height: number }, view: { width: number; height: number }, boxes: Rect[], gap = 12): { x: number; y: number } {
  const rectAt = (p: { x: number; y: number }): Rect => ({ left: p.x, top: p.y, right: p.x + size.width, bottom: p.y + size.height });
  const clear = (p: { x: number; y: number }) => boxes.every((b) => !hits(rectAt(p), b, gap - 1));
  const onScreen = (p: { x: number; y: number }) => p.x >= EDGE && p.y >= EDGE && p.x + size.width <= view.width - EDGE && p.y + size.height <= view.height - EDGE;
  if (!boxes.length || clear(at)) return at;
  const spots: Array<{ x: number; y: number }> = [];
  for (const b of boxes) {
    const y = fit(at.y, b.top, b.bottom - size.height);
    const x = fit(at.x, b.left, b.right - size.width);
    spots.push({ x: b.right + gap, y }, { x: b.left - gap - size.width, y }, { x, y: b.bottom + gap }, { x, y: b.top - gap - size.height });
  }
  const ok = spots.filter((p) => onScreen(p) && clear(p)).sort((p, q) => Math.hypot(p.x - at.x, p.y - at.y) - Math.hypot(q.x - at.x, q.y - at.y));
  return ok[0] ?? at;
}
