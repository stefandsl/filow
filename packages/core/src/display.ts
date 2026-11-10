// Camera-ready display of the prompter: text size, line width, where the current point sits on the
// screen (the eyeline), a mirror flip for teleprompter glass and a high-contrast option. Pure: the
// surfaces keep the choice (browser storage of the device) and turn it into CSS.

export const DISPLAY_SIZES = ["s", "m", "l", "xl"] as const;
export const DISPLAY_WIDTHS = ["narrow", "medium", "full"] as const;
export const DISPLAY_EYELINES = ["top", "upper", "middle"] as const;
export type DisplaySize = (typeof DISPLAY_SIZES)[number];
export type DisplayWidth = (typeof DISPLAY_WIDTHS)[number];
export type DisplayEyeline = (typeof DISPLAY_EYELINES)[number];

export type DisplayPrefs = {
  size: DisplaySize;
  /** how long a line may get: short lines keep the eyes close to the lens */
  width: DisplayWidth;
  /** where the current point is kept: near the top (under a webcam), a third down, or the middle */
  eyeline: DisplayEyeline;
  /** flipped left to right, for the glass of a teleprompter rig */
  mirror: boolean;
  /** black and white, no tints */
  contrast: boolean;
};

export const DEFAULT_DISPLAY: DisplayPrefs = { size: "m", width: "full", eyeline: "upper", mirror: false, contrast: false };

/** Text scale of each size (1 = the app's normal prompter text). */
export const DISPLAY_SCALE: Record<DisplaySize, number> = { s: 0.875, m: 1, l: 1.375, xl: 1.875 };
/** Longest line, in characters; "full" uses the width of the window. */
export const DISPLAY_MEASURE: Record<DisplayWidth, string> = { narrow: "28ch", medium: "42ch", full: "none" };
/** Height of the eyeline as a share of the visible reading area, from its top. */
export const EYELINE_RATIO: Record<DisplayEyeline, number> = { top: 0.1, upper: 0.33, middle: 0.5 };

const pick = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

/** A stored or received value made safe: unknown fields dropped, bad ones back to the default. */
export function normalizeDisplay(value: unknown): DisplayPrefs {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    size: pick(DISPLAY_SIZES, v.size, DEFAULT_DISPLAY.size),
    width: pick(DISPLAY_WIDTHS, v.width, DEFAULT_DISPLAY.width),
    eyeline: pick(DISPLAY_EYELINES, v.eyeline, DEFAULT_DISPLAY.eyeline),
    mirror: v.mirror === true,
    contrast: v.contrast === true,
  };
}

/**
 * The scroll position that puts the top of the current point on the eyeline: `itemTop` is the
 * point's top in the scrolled content, `viewport` the visible height, `maxScroll` the furthest the
 * area can scroll. Clamped, so a short list is not pushed off the screen.
 */
export function eyelineScrollTop(itemTop: number, viewport: number, eyeline: DisplayEyeline, maxScroll: number): number {
  const want = itemTop - viewport * EYELINE_RATIO[eyeline];
  return Math.round(Math.max(0, Math.min(maxScroll, want)));
}

/** The CSS custom properties the prompter reads. */
export function displayStyle(p: DisplayPrefs): Record<string, string> {
  return {
    "--display-scale": String(DISPLAY_SCALE[p.size]),
    "--display-measure": DISPLAY_MEASURE[p.width],
    "--display-room-vh": `${Math.round((1 - EYELINE_RATIO[p.eyeline]) * 100)}vh`,
  };
}
