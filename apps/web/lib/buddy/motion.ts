// OK Filow motion helpers, pure so they are unit tested.
type P = { x: number; y: number };

/** An answer's marks begin to draw one after another, at least this far apart. */
export const STROKE_GAP_MS = 900;
/** Marks released together by the voice (two in one sentence) follow each other this closely. */
export const SENTENCE_GAP_MS = 450;

/**
 * The pen's ease: ink from the first frame, then settling. A gentle ease-out (top speed 1.4x the mean),
 * so a 400-700 ms stroke never jumps more than ~7% of its length in one 60 Hz frame; a steeper one
 * (`.2,.7,.3,1`, top speed 3.5x) jumps 12% per frame on a 500 ms stroke.
 */
export const PEN_EASE = [0.3, 0.42, 0.5, 1] as const;
export const PEN_EASE_CSS = `cubic-bezier(${PEN_EASE.join(",")})`;

/** How long the pen takes over a stroke `lengthPx` long: longer strokes take longer, within 300-700 ms. */
export function strokeMs(lengthPx: number): number {
  const len = Number.isFinite(lengthPx) && lengthPx > 0 ? lengthPx : 0;
  return Math.round(Math.min(700, Math.max(300, 260 + 0.5 * len)));
}

/** A CSS cubic-bezier easing (x1, y1, x2, y2) as a function of time fraction 0..1 to progress 0..1. */
export function cubicBezier([x1, y1, x2, y2]: readonly [number, number, number, number]) {
  const bx = (s: number) => 3 * x1 * s * (1 - s) ** 2 + 3 * x2 * s * s * (1 - s) + s ** 3;
  const by = (s: number) => 3 * y1 * s * (1 - s) ** 2 + 3 * y2 * s * s * (1 - s) + s ** 3;
  /** The curve's parameter where x (time) is `x`, by bisection (x is monotonic for 0 <= x1, x2 <= 1). */
  const solve = (x: number, f: (s: number) => number) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (f(mid) < x) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  return {
    /** Progress at time fraction `t`. */
    at: (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : by(solve(t, bx))),
    /** Time fraction at which progress reaches `p`. */
    timeFor: (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : bx(solve(p, by))),
  };
}

const pen = cubicBezier(PEN_EASE);

/**
 * When a mark's parts start, in ms after the mark's own start: the stroke at once, its label when the
 * pen has drawn ~70% of the line (not after a fixed wait), the arrow head as the shaft ends.
 */
export function markTiming(lengthPx: number, labelAt = 0.7): { strokeMs: number; labelMs: number; headMs: number } {
  const d = strokeMs(lengthPx);
  return { strokeMs: d, labelMs: Math.round(d * pen.timeFor(labelAt)), headMs: Math.round(d * pen.timeFor(0.92)) };
}

/**
 * How long the marks take to go away on Clear: each mark fades as one piece (stroke, head, leader and
 * label together), so no frame holds a stub of it.
 */
export const MARK_EXIT = { fadeMs: 220 } as const;
export const MARK_EXIT_MS = MARK_EXIT.fadeMs;

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
 * When each of an answer's marks starts (on the drawing clock), as marks arrive: those already timed keep
 * their start; each new one starts `now`, or `gapMs` after the one before it when several come at once
 * (the marks of one sentence, or every mark of an answer read without a voice). `done` marks (drawn before
 * a Stop) started long ago.
 */
export function appendStarts(prev: number[], total: number, now: number, gapMs = STROKE_GAP_MS, done = 0): number[] {
  const out = prev.slice(0, total);
  for (let i = out.length; i < total; i++) out.push(i < done ? -Infinity : Math.max(now, (out[i - 1] ?? -Infinity) + gapMs));
  return out;
}

/** How many marks have begun to draw at `now` (a Stop keeps these and drops the rest). */
export function marksBegun(starts: number[], now: number): number {
  let n = 0;
  while (n < starts.length && starts[n] <= now) n++;
  return n;
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

/**
 * How long the pointer flies `distancePx`: longer flights take longer (so the dot never jumps far
 * in one frame), within 380-900 ms.
 */
export function flightMs(distancePx: number): number {
  const d = Number.isFinite(distancePx) && distancePx > 0 ? distancePx : 0;
  return Math.round(Math.min(900, Math.max(380, 320 + 0.75 * d)));
}

/**
 * Where the pointer's tip stops for a spot: just below and right of it, so the glyph (which points up
 * and to the left) points at the spot without covering it. The arrival ring is centred on the spot.
 */
export const POINT_STANDOFF = { x: 7, y: 9 } as const;
export function pointerLanding(spot: P): P {
  return { x: spot.x + POINT_STANDOFF.x, y: spot.y + POINT_STANDOFF.y };
}

/** How far through its flight the pointer is when its label docks at the tip (it then comes in with the dot). */
export const POINT_LABEL_AT = 0.7;
/** The label's room beside the tip (the CSS of .okf-label: 14 px text, at most this wide in practice). */
export const POINT_LABEL_ROOM = { width: 240, height: 36 } as const;

/**
 * Which side of the tip the pointer's label docks on: to its right and a little above it, or to its
 * left near the right edge of the screen, or below the tip near the top edge (never off screen).
 */
export function pointLabelFlip(to: P, view: { width: number; height: number }, room: { width: number; height: number } = POINT_LABEL_ROOM): { left: boolean; down: boolean } {
  return { left: to.x > view.width - room.width, down: to.y < room.height };
}

/** Quadratic bezier from `from` to `to`, bowing up and to the side like a thrown arc (Clicky's flight). */
export function bezierPoint(from: P, to: P, k: number): P {
  const t = ease(Math.max(0, Math.min(1, k)));
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  // a short, gentle arc: long flights bow a little, never a wide loop across the screen
  const lift = Math.min(90, dist * 0.22);
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
