// OK Filow motion helpers, pure so they are unit tested.
type P = { x: number; y: number };

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

/** Puts the bubble to the lower right of the dot, flipping left or up so it stays on screen. */
export function bubblePlacement(dot: P, size: { width: number; height: number }, view: { width: number; height: number }, gap = 18): P {
  let x = dot.x + gap + 12;
  let y = dot.y + gap;
  if (x + size.width > view.width - 8) x = dot.x - gap - size.width;
  if (y + size.height > view.height - 8) y = dot.y - gap - size.height;
  return { x: Math.max(8, x), y: Math.max(8, y) };
}
