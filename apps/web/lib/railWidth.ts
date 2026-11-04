// Width of the right rail (next section + Screen Sense) in the dark "rail" layout, set by dragging the
// splitter. Kept per viewer in localStorage; clamped so the points column always keeps most of the window.

type KeyStore = Pick<Storage, "getItem" | "setItem">;

export const DEFAULT_RAIL_WIDTH = 420;
const MIN = 280;
const MAX = 720;
const MAX_SHARE = 0.55;
const KEY = "prefs:railWidth";

export function clampRailWidth(px: number, viewportWidth: number): number {
  const upper = Math.max(MIN, Math.min(MAX, Math.floor(viewportWidth * MAX_SHARE)));
  return Math.round(Math.min(upper, Math.max(MIN, px)));
}

export function readRailWidth(store: KeyStore | undefined, viewportWidth: number): number {
  try {
    const saved = Number(store?.getItem(KEY));
    return clampRailWidth(Number.isFinite(saved) && saved > 0 ? saved : DEFAULT_RAIL_WIDTH, viewportWidth);
  } catch {
    return clampRailWidth(DEFAULT_RAIL_WIDTH, viewportWidth);
  }
}

export function writeRailWidth(store: KeyStore | undefined, px: number): void {
  try {
    store?.setItem(KEY, String(Math.round(px)));
  } catch {
    /* storage blocked: the width lasts until reload */
  }
}
