type KeyStore = Pick<Storage, "getItem" | "setItem">;

export const DEFAULT_NEXT_HEIGHT = 240;
export const MIN_NEXT_HEIGHT = 120;
const KEY = "prefs:nextHeight";

export function maxNextHeight(contentHeight: number): number {
  return Math.max(MIN_NEXT_HEIGHT, Math.floor(Math.max(0, contentHeight || 0) * 0.7));
}

export function clampNextHeight(px: number, contentHeight: number): number {
  return Math.min(maxNextHeight(contentHeight), Math.max(MIN_NEXT_HEIGHT,
    Math.round(Number.isFinite(px) ? px : DEFAULT_NEXT_HEIGHT)));
}

export function readNextHeight(store: KeyStore | undefined, contentHeight: number, fallback = DEFAULT_NEXT_HEIGHT): number {
  try {
    const saved = Number(store?.getItem(KEY));
    return clampNextHeight(Number.isFinite(saved) && saved > 0 ? saved : fallback, contentHeight);
  } catch {
    return clampNextHeight(fallback, contentHeight);
  }
}

export function writeNextHeight(store: KeyStore | undefined, px: number): void {
  try {
    store?.setItem(KEY, String(Math.round(Number.isFinite(px) && px > 0 ? px : DEFAULT_NEXT_HEIGHT)));
  } catch {
    // A blocked store still allows resizing for the current viewer until reload.
  }
}
