// The bar at the top of the main window in full screen (components/FullScreenBar.tsx): on Windows the
// frame and the menu go with full screen, so it is the way back. The rules live here, without React.

/** apps/desktop/preload.js `windowControls` (apps/desktop/window-controls.js). Absent in a browser. */
export type WindowControlsBridge = {
  isFullScreen(): Promise<boolean>;
  exitFullScreen(): void;
  minimize(): void;
  close(): void;
  onFullScreen(fn: (on: boolean) => void): () => void;
};
export const windowControlsBridge = (): WindowControlsBridge | null =>
  (globalThis as { filow?: { windowControls?: WindowControlsBridge } }).filow?.windowControls ?? null;

/** How long the bar stays after the pointer leaves it, so a pointer that slips off by a pixel does not lose it. */
export const HIDE_DELAY_MS = 400;

/** The bar is on screen only in full screen, while the pointer is on the top edge or the bar, or a button of it has the keyboard focus. */
export function barShown(s: { fullScreen: boolean; pointer: boolean; focus: boolean }): boolean {
  return s.fullScreen && (s.pointer || s.focus);
}

type KeyLike = { key: string; defaultPrevented: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; isComposing?: boolean; target: unknown };
type DocLike = { querySelectorAll(selectors: string): ArrayLike<{ checkVisibility?: () => boolean }> };

/** Something open that Escape closes first: a dialog, a menu or another popup (an open disclosure is not one). */
export const ESCAPE_OWNERS = "dialog[open], [role='dialog'], [role='alertdialog'], [aria-modal='true'], [role='menu'], [aria-haspopup][aria-expanded='true']";
const EDITING = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

/**
 * Escape leaves full screen when nothing else wants it: not while typing in a field, not while a
 * dialog or a menu is open (Escape closes that first), not when a handler already took the key.
 */
export function escapeLeavesFullScreen(e: KeyLike, fullScreen: boolean, doc: DocLike): boolean {
  if (!fullScreen || e.key !== "Escape" || e.defaultPrevented || e.isComposing) return false;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
  const target = e.target as { closest?: (s: string) => unknown; isContentEditable?: boolean } | null;
  if (target && (target.isContentEditable || (typeof target.closest === "function" && target.closest(EDITING)))) return false;
  // a closed menu stays in the page, hidden (prompter/OverflowMenu.tsx): only one on screen counts
  return !Array.from(doc.querySelectorAll(ESCAPE_OWNERS)).some((el) => (el.checkVisibility ? el.checkVisibility() : true));
}
