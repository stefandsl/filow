// OK Filow motion helpers, pure so they are unit tested.
type P = { x: number; y: number };

/** An answer's marks begin to draw one after another, this far apart. */
export const STROKE_GAP_MS = 900;

const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

/**
 * How many of an answer's marks have begun to draw `elapsedMs` after they arrived (one every
 * `gapMs`, the first at once). A Stop keeps these and drops the rest.
 */
export function marksStarted(count: number, elapsedMs: number, gapMs: number): number {
  if (count <= 0 || !(elapsedMs >= 0)) return 0;
  return Math.min(count, Math.floor(elapsedMs / gapMs) + 1);
}

/**
 * Whether the pointer is on the Stop button of the pill (a few pixels of margin, so the edge is not
 * a trap). `rect` is null while no button is shown.
 */
export function overStopButton(pointer: P | null, rect: { left: number; top: number; right: number; bottom: number } | null, margin = 4): boolean {
  if (!pointer || !rect || rect.right <= rect.left) return false;
  return pointer.x >= rect.left - margin && pointer.x <= rect.right + margin && pointer.y >= rect.top - margin && pointer.y <= rect.bottom + margin;
}

/** Whether the pointer is on any control of the pill (the eye, Pause, Resume, Stop). */
export function overControls(pointer: P | null, rects: Array<{ left: number; top: number; right: number; bottom: number } | null | undefined>, margin = 4): boolean {
  return rects.some((r) => overStopButton(pointer, r ?? null, margin));
}

/**
 * A clock that stands still during a pause: the pointer's flight and the pen strokes are timed on
 * it, so they freeze with the answer and carry on from the same spot.
 */
export function createPausableClock() {
  let lost = 0;
  let since: number | null = null;
  return {
    /** The time on this clock when the real clock says `now`. */
    at: (now: number) => (since ?? now) - lost,
    pause(now: number) {
      if (since === null) since = now;
    },
    resume(now: number) {
      if (since === null) return;
      lost += now - since;
      since = null;
    },
    paused: () => since !== null,
  };
}

/** Quadratic bezier from `from` to `to`, bowing up and to the side like a thrown arc (Clicky's flight). */
export function bezierPoint(from: P, to: P, k: number): P {
  const t = ease(Math.max(0, Math.min(1, k)));
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const lift = Math.min(160, dist * 0.35);
  const control = { x: from.x + dx / 2 - (dy / (dist || 1)) * lift * 0.4, y: Math.min(from.y, to.y) - lift };
  const a = (1 - t) * (1 - t);
  const b = 2 * (1 - t) * t;
  const c = t * t;
  return { x: a * from.x + b * control.x + c * to.x, y: a * from.y + b * control.y + c * to.y };
}

type Rect = { left: number; top: number; right: number; bottom: number };
/** The bubble never comes closer than this to an edge of the screen, or to the pill. */
export const BUBBLE_EDGE = 8;

/**
 * Puts the bubble to the lower right of the dot, flipping left or up when there is no room, and
 * always wholly on screen. `avoid` is the pill at the top of the screen (null when there is none):
 * a bubble that would lie over it goes below it instead.
 */
export function bubblePlacement(dot: P, size: { width: number; height: number }, view: { width: number; height: number }, gap = 18, avoid: Rect | null = null): P {
  const edge = BUBBLE_EDGE;
  let x = dot.x + gap + 12;
  let y = dot.y + gap;
  if (x + size.width > view.width - edge) x = dot.x - gap - size.width;
  if (y + size.height > view.height - edge) y = dot.y - gap - size.height;
  return bubbleOnScreen({ x, y }, size, view, avoid);
}

/**
 * The nearest place to `at` where the bubble is wholly on screen and clear of the pill (`avoid`):
 * for a bubble that holds still while its text grows, and the last step of every placement.
 */
export function bubbleOnScreen(at: P, size: { width: number; height: number }, view: { width: number; height: number }, avoid: Rect | null = null): P {
  const edge = BUBBLE_EDGE;
  const x = Math.max(edge, Math.min(at.x, view.width - edge - size.width));
  let y = Math.max(edge, Math.min(at.y, view.height - edge - size.height));
  if (avoid && avoid.right > avoid.left && x < avoid.right + edge && x + size.width > avoid.left - edge && y < avoid.bottom + edge && y + size.height > avoid.top - edge) {
    y = avoid.bottom + edge;
  }
  return { x, y };
}

/** How far from the bubble the pointer may go before the bubble follows it again. */
export const BUBBLE_REACH = 96;
/**
 * Whether an answer's bubble holds still: it does while the pointer is on it or within `reach` of
 * it, so the pointer can go onto it (to scroll it, to close it) instead of pushing it away; a
 * pointer that goes further takes the bubble along again. `rect` is where the bubble is now.
 */
export function bubbleSticks(pointer: P | null, rect: Rect | null, reach = BUBBLE_REACH): boolean {
  if (!pointer || !rect || rect.right <= rect.left || rect.bottom <= rect.top) return false;
  const dx = Math.max(rect.left - pointer.x, 0, pointer.x - rect.right);
  const dy = Math.max(rect.top - pointer.y, 0, pointer.y - rect.bottom);
  return Math.hypot(dx, dy) <= reach;
}

/** Whether the pointer is on the bubble itself (a pixel of margin). */
export function overBubble(pointer: P | null, rect: Rect | null): boolean {
  return bubbleSticks(pointer, rect, 1);
}

/**
 * Where the bubble's text must be scrolled so the sentence being spoken is in view: the scroll
 * position unchanged when the sentence is already wholly visible, else the sentence's top a line
 * below the top edge (a sentence taller than the view starts at its beginning). Never past the ends.
 */
export function followScroll(sentence: { top: number; height: number }, view: { scrollTop: number; clientHeight: number; scrollHeight: number }, lead = 20): number {
  const max = Math.max(0, view.scrollHeight - view.clientHeight);
  const visible = sentence.top >= view.scrollTop && sentence.top + sentence.height <= view.scrollTop + view.clientHeight;
  if (visible) return Math.min(max, Math.max(0, view.scrollTop));
  return Math.min(max, Math.max(0, sentence.top - lead));
}
