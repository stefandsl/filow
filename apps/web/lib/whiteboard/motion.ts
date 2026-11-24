// Presentation-only motion and static emphasis for directed whiteboard edges and sequence messages (X-10).
// Pure: no DOM, no side effects. Driven by explicit `customData.wb` metadata (`from`, `to`, `order`)
// on prepared Excalidraw elements so older boards without metadata stay silent and unchanged, moved
// endpoints are followed automatically, and no transient cue ever enters the scene or exports.
import { pathPoints } from "./check";
import { drawMsFor, type Slot } from "./pace";
import { stepOf, type ExEl, type Scene } from "./scene";

export type Pt = { x: number; y: number };
export type ReceiverBox = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  shape: string;
  roundness: boolean;
};
export type EdgeCue = {
  id: string;
  key: string;
  step: number;
  fromId: string;
  toId: string;
  order: number;
  /** Original prepared arrow polyline from sender to receiver. */
  points: Pt[];
  /** Label-cleared travel path (identical to `points` unless a bound label sits directly on the arrow). */
  travelPoints: Pt[];
  color: string;
  receiver: ReceiverBox | null;
  tip: { x: number; y: number; angle: number };
  labelBox: { x: number; y: number; w: number; h: number } | null;
};
export type ScheduledCue = {
  cue: EdgeCue;
  startMs: number;
  travelMs: number;
  arrivalMs: number;
  endMs: number;
};
export type ActiveSignal = {
  edgeId: string;
  fromId: string;
  toId: string;
  x: number;
  y: number;
  angle: number;
  progress: number;
  trail: Pt[];
  color: string;
  overLabel: boolean;
};
export type ActiveArrival = {
  edgeId: string;
  receiver: ReceiverBox;
  tip: { x: number; y: number; angle: number };
  intensity: number;
  color: string;
};
export type StaticCueEmphasis = {
  edgeId: string;
  fromId: string;
  toId: string;
  tip: { x: number; y: number; angle: number };
  tail: Pt[];
  receiver: ReceiverBox | null;
  color: string;
};
export type CueMode = "motion" | "static" | "off";
export type CuePhase = "idle" | "travel" | "arrival" | "done" | "static";
export type CueFrame = {
  phase: CuePhase;
  active: boolean;
  signals: ActiveSignal[];
  arrivals: ActiveArrival[];
  staticEmphasis: StaticCueEmphasis[];
};

export const EMPTY_CUE_FRAME: CueFrame = {
  phase: "idle",
  active: false,
  signals: [],
  arrivals: [],
  staticEmphasis: [],
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const easeInOut = (u: number) => {
  const t = clamp(u, 0, 1);
  return t * t * (3 - 2 * t);
};

function cumulativeLengths(pts: Pt[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) {
    out.push(out[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  return out;
}

/** Point and tangent angle (radians) along a polyline at arc-length fraction `frac` in [0, 1]. */
export function samplePolyline(pts: Pt[], frac: number): { x: number; y: number; angle: number } {
  if (pts.length === 0) return { x: 0, y: 0, angle: 0 };
  if (pts.length === 1) return { x: pts[0].x, y: pts[0].y, angle: 0 };
  const lengths = cumulativeLengths(pts);
  const total = lengths[lengths.length - 1];
  if (total <= 1e-6) return { x: pts[0].x, y: pts[0].y, angle: 0 };
  const dist = clamp(frac, 0, 1) * total;
  let seg = 0;
  while (seg < lengths.length - 2 && lengths[seg + 1] < dist) seg++;
  const segLen = lengths[seg + 1] - lengths[seg];
  const local = segLen > 1e-6 ? (dist - lengths[seg]) / segLen : 0;
  const a = pts[seg];
  const b = pts[seg + 1];
  return {
    x: a.x + (b.x - a.x) * local,
    y: a.y + (b.y - a.y) * local,
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

/** Sub-polyline between two arc-length fractions in [0, 1]. */
export function slicePolyline(pts: Pt[], fromFrac: number, toFrac: number): Pt[] {
  if (pts.length < 2) return pts;
  const lo = clamp(Math.min(fromFrac, toFrac), 0, 1);
  const hi = clamp(Math.max(fromFrac, toFrac), 0, 1);
  if (hi - lo <= 1e-4) return [];
  const lengths = cumulativeLengths(pts);
  const total = lengths[lengths.length - 1];
  if (total <= 1e-6) return [];
  const d0 = lo * total;
  const d1 = hi * total;
  const start = samplePolyline(pts, lo);
  const end = samplePolyline(pts, hi);
  const out: Pt[] = [{ x: start.x, y: start.y }];
  for (let i = 1; i < pts.length - 1; i++) {
    if (lengths[i] > d0 && lengths[i] < d1) out.push(pts[i]);
  }
  out.push({ x: end.x, y: end.y });
  return out;
}

/**
 * Extracts explicitly marked directed edges for `step`, sorted in reveal order.
 * Older boards without `from`/`to`/`order` on `customData.wb` return an empty list.
 */
export function extractStepCues(scene: Scene, step: number): EdgeCue[] {
  const byId = new Map<string, ExEl>();
  for (const e of scene.elements) {
    if (!e.isDeleted) byId.set(e.id, e);
  }
  const candidates: Array<{ el: ExEl; order: number; index: number; fromId: string; toId: string; key: string }> = [];
  scene.elements.forEach((e, index) => {
    if (e.isDeleted || e.type !== "arrow" || stepOf(e) !== step) return;
    if (e.endArrowhead === null) return;
    const wb = e.customData?.wb;
    if (!wb || wb.role !== "edge") return;
    if (typeof wb.from !== "string" || !wb.from || typeof wb.to !== "string" || !wb.to) return;
    if (typeof wb.order !== "number" || !Number.isFinite(wb.order)) return;
    candidates.push({ el: e, order: wb.order, index, fromId: wb.from, toId: wb.to, key: wb.key });
  });
  candidates.sort((a, b) => a.order - b.order || a.index - b.index);

  const cues: EdgeCue[] = [];
  for (const item of candidates) {
    const pts = pathPoints(item.el, 24);
    if (pts.length < 2) continue;
    const lengths = cumulativeLengths(pts);
    const total = lengths[lengths.length - 1];
    if (total < 4) continue;
    const endPt = pts[pts.length - 1];
    const backFrac = Math.max(0, 1 - Math.min(14, total * 0.25) / total);
    const backPt = samplePolyline(pts, backFrac);
    const tipAngle = Math.atan2(endPt.y - backPt.y, endPt.x - backPt.x);
    const toEl = byId.get(item.toId);
    const receiver: ReceiverBox | null =
      toEl && toEl.width > 0 && toEl.height > 0
        ? {
            id: toEl.id,
            x: toEl.x,
            y: toEl.y,
            w: toEl.width,
            h: toEl.height,
            shape: toEl.type,
            roundness: Boolean(toEl.roundness),
          }
        : null;
    const boundText = scene.elements.find((x) => !x.isDeleted && x.type === "text" && x.containerId === item.el.id);
    const labelBox =
      boundText && boundText.width > 0 && boundText.height > 0
        ? { x: boundText.x, y: boundText.y, w: boundText.width, h: boundText.height }
        : null;
    const travelPoints = clearBoundLabel(pts, labelBox, 11);
    cues.push({
      id: item.el.id,
      key: item.key,
      step,
      fromId: item.fromId,
      toId: item.toId,
      order: item.order,
      points: pts,
      travelPoints,
      color: typeof item.el.strokeColor === "string" ? item.el.strokeColor : "#495057",
      receiver,
      tip: { x: endPt.x, y: endPt.y, angle: tipAngle },
      labelBox,
    });
  }
  return cues;
}

/**
 * Keeps a travelling signal off a bound midpoint label (such as Excalidraw arrow labels drawn
 * directly on the stroke) by smoothly gliding along the outward side of the label box while
 * rejoining the exact arrow endpoints and arrowhead. Returns `pts` unchanged when no overlap exists.
 */
function clearBoundLabel(
  pts: Pt[],
  labelBox: { x: number; y: number; w: number; h: number } | null,
  clearance: number,
): Pt[] {
  if (!labelBox || pts.length < 2) return pts;
  const touches = pts.some((p) => pointNearBox(p, labelBox, clearance - 1));
  if (!touches) return pts;

  const start = pts[0];
  const end = pts[pts.length - 1];
  const chordMid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const curveMid = samplePolyline(pts, 0.5);
  let nx = curveMid.x - chordMid.x;
  let ny = curveMid.y - chordMid.y;
  const bend = Math.hypot(nx, ny);
  if (bend >= 2) {
    nx /= bend;
    ny /= bend;
  } else {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy) || 1;
    nx = -dy / len;
    ny = dx / len;
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
    }
  }
  const tx = -ny;
  const ty = nx;
  const lc = { x: labelBox.x + labelBox.w / 2, y: labelBox.y + labelBox.h / 2 };
  const halfN = Math.abs(nx) * (labelBox.w / 2) + Math.abs(ny) * (labelBox.h / 2);
  const halfT = Math.abs(tx) * (labelBox.w / 2) + Math.abs(ty) * (labelBox.h / 2);
  const ramp = 26;
  const lengths = cumulativeLengths(pts);
  const total = lengths[lengths.length - 1] || 1;

  return pts.map((p, i) => {
    const frac = lengths[i] / total;
    const endFade = clamp(Math.min(frac, 1 - frac) / 0.04, 0, 1);
    const along = Math.abs((p.x - lc.x) * tx + (p.y - lc.y) * ty);
    const spanFade = along <= halfT ? 1 : along >= halfT + ramp ? 0 : easeInOut(1 - (along - halfT) / ramp);
    const projN = (p.x - lc.x) * nx + (p.y - lc.y) * ny;
    const need = Math.max(0, halfN + clearance - projN);
    const shift = need * spanFade * easeInOut(endFade);
    return { x: p.x + nx * shift, y: p.y + ny * shift };
  });
}

/**
 * Schedules every eligible edge of a step inside the step's time slot, strictly sequential in reveal order.
 */
export function scheduleStepCues(
  cues: EdgeCue[],
  timing: Map<string, Slot> | undefined,
  stepMs: number,
): ScheduledCue[] {
  if (!cues.length) return [];
  const budget = clamp(stepMs > 0 ? drawMsFor(stepMs) : 2200, 900, 12_000);
  const gap = 40;
  const raw: ScheduledCue[] = [];
  let cursor = 0;

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const slot = timing?.get(cue.key);
    const baseStart = slot
      ? slot.at + Math.min(220, Math.round(slot.len * 0.18))
      : i === 0
        ? 180
        : cursor;
    const startMs = Math.max(cursor, baseStart);
    const travelMs = slot ? clamp(Math.round(slot.len * 0.65), 520, 960) : 780;
    const arrivalMs = slot ? clamp(Math.round(slot.len * 0.34), 320, 480) : 420;
    const endMs = startMs + travelMs + arrivalMs;
    raw.push({ cue, startMs, travelMs, arrivalMs, endMs });
    cursor = endMs + gap;
  }

  const lastEnd = raw[raw.length - 1].endMs;
  if (lastEnd <= budget) return raw;

  // Compress proportionally inside [0, budget] while preserving reveal order and non-overlap.
  const firstStart = Math.min(raw[0].startMs, Math.round(budget * 0.12));
  const span = Math.max(200, budget - firstStart);
  const totalDur = raw.reduce((sum, s) => sum + s.travelMs + s.arrivalMs, 0);
  const scale = span / Math.max(1, totalDur);
  let at = firstStart;
  return raw.map((s, idx) => {
    const travelMs = Math.max(120, Math.round(s.travelMs * scale));
    const arrivalMs = Math.max(80, Math.round(s.arrivalMs * scale));
    const startMs = Math.min(Math.round(at), Math.max(0, budget - travelMs - arrivalMs));
    const endMs = idx === raw.length - 1 ? Math.min(budget, startMs + travelMs + arrivalMs) : startMs + travelMs + arrivalMs;
    const clampedArrival = Math.max(0, endMs - startMs - travelMs);
    at = endMs;
    return { cue: s.cue, startMs, travelMs, arrivalMs: clampedArrival, endMs };
  });
}

function pointNearBox(pt: Pt, box: { x: number; y: number; w: number; h: number } | null, pad = 4): boolean {
  if (!box) return false;
  return pt.x >= box.x - pad && pt.x <= box.x + box.w + pad && pt.y >= box.y - pad && pt.y <= box.y + box.h + pad;
}

/** Pure frame evaluation at `elapsedMs` from the start of the step. */
export function evaluateCues(scheduled: ScheduledCue[], elapsedMs: number): CueFrame {
  if (!scheduled.length) return EMPTY_CUE_FRAME;
  const maxEnd = scheduled[scheduled.length - 1].endMs;
  if (elapsedMs < 0) return EMPTY_CUE_FRAME;
  if (elapsedMs > maxEnd) return { phase: "done", active: false, signals: [], arrivals: [], staticEmphasis: [] };

  const signals: ActiveSignal[] = [];
  const arrivals: ActiveArrival[] = [];

  for (const item of scheduled) {
    if (elapsedMs < item.startMs || elapsedMs > item.endMs) continue;
    const travelEnd = item.startMs + item.travelMs;
    if (elapsedMs < travelEnd) {
      const progress = easeInOut((elapsedMs - item.startMs) / Math.max(1, item.travelMs));
      const path = item.cue.travelPoints;
      const sample = samplePolyline(path, progress);
      const trail = slicePolyline(path, Math.max(0, progress - 0.16), progress);
      signals.push({
        edgeId: item.cue.id,
        fromId: item.cue.fromId,
        toId: item.cue.toId,
        x: sample.x,
        y: sample.y,
        angle: sample.angle,
        progress,
        trail,
        color: item.cue.color,
        overLabel: pointNearBox(sample, item.cue.labelBox, 3),
      });
    } else if (item.cue.receiver && item.arrivalMs > 0) {
      const a = clamp((elapsedMs - travelEnd) / item.arrivalMs, 0, 1);
      const intensity = a < 0.22 ? a / 0.22 : 1 - (a - 0.22) / 0.78;
      if (intensity > 0.01) {
        arrivals.push({
          edgeId: item.cue.id,
          receiver: item.cue.receiver,
          tip: item.cue.tip,
          intensity,
          color: item.cue.color,
        });
      }
    }
  }

  const phase: CuePhase = signals.length > 0 ? "travel" : arrivals.length > 0 ? "arrival" : "idle";
  return { phase, active: true, signals, arrivals, staticEmphasis: [] };
}

/** Static emphasis for reduced motion and Lite: zero moving signals, clear direction and recipient. */
export function staticStepCues(cues: EdgeCue[]): CueFrame {
  if (!cues.length) return EMPTY_CUE_FRAME;
  return {
    phase: "static",
    active: true,
    signals: [],
    arrivals: [],
    staticEmphasis: cues.map((cue) => {
      const rawTail = slicePolyline(cue.points, 0.78, 1);
      const tail = cue.labelBox ? rawTail.filter((p) => !pointNearBox(p, cue.labelBox, 3)) : rawTail;
      return {
        edgeId: cue.id,
        fromId: cue.fromId,
        toId: cue.toId,
        tip: cue.tip,
        tail: tail.length >= 2 ? tail : [],
        receiver: cue.receiver,
        color: cue.color,
      };
    }),
  };
}

/** High-contrast, theme-aware accent colour for signal and arrival cues. */
export function cueAccentColor(strokeColor: string | undefined, dark: boolean): string {
  const c = (strokeColor ?? "").trim().toLowerCase();
  if (dark) {
    if (c === "#e8590c") return "#ffa94d";
    if (c === "#2f9e44") return "#69db7c";
    if (c === "#9c36b5") return "#da77f2";
    if (c === "#c2255c") return "#f783ac";
    if (c === "#0c8599") return "#66d9e8";
    return "#74c0fc";
  }
  if (c === "#e8590c") return "#d9480f";
  if (c === "#2f9e44") return "#2b8a3e";
  if (c === "#9c36b5") return "#862e9c";
  if (c === "#c2255c") return "#a61e4d";
  if (c === "#0c8599") return "#0b7285";
  return "#1971c2";
}

/** Removes any transient `[data-wb-cue]` nodes from a cloned SVG before export or video capture. */
export function stripCueNodes(root: ParentNode): number {
  const nodes = root.querySelectorAll("[data-wb-cue]");
  let count = 0;
  nodes.forEach((n) => {
    n.remove();
    count++;
  });
  return count;
}

export type CueSessionOptions = {
  mode: CueMode;
  cues: EdgeCue[];
  scheduled: ScheduledCue[];
  now: () => number;
  scheduleFrame: (cb: () => void) => number;
  cancelFrame: (id: number) => void;
  onFrame: (frame: CueFrame) => void;
};

/**
 * Presentation-only cue session controller.
 * Cancelling stops any pending frame immediately and clears transient cue state before the next view.
 */
export function createCueSession(opts: CueSessionOptions): { cancel: () => void } {
  let cancelled = false;
  let rafId: number | null = null;

  if (opts.mode === "off" || !opts.cues.length) {
    opts.onFrame(EMPTY_CUE_FRAME);
    return { cancel: () => {} };
  }

  if (opts.mode === "static") {
    opts.onFrame(staticStepCues(opts.cues));
    return {
      cancel: () => {
        if (cancelled) return;
        cancelled = true;
        opts.onFrame(EMPTY_CUE_FRAME);
      },
    };
  }

  if (!opts.scheduled.length) {
    opts.onFrame(EMPTY_CUE_FRAME);
    return { cancel: () => {} };
  }

  const startedAt = opts.now();
  const maxEnd = opts.scheduled[opts.scheduled.length - 1].endMs;

  const tick = () => {
    rafId = null;
    if (cancelled) return;
    const elapsed = opts.now() - startedAt;
    const frame = evaluateCues(opts.scheduled, elapsed);
    opts.onFrame(frame);
    if (!cancelled && elapsed <= maxEnd) {
      rafId = opts.scheduleFrame(tick);
    }
  };

  // Emit initial frame immediately so t=0 is deterministic, then schedule animation loop.
  opts.onFrame(evaluateCues(opts.scheduled, 0));
  rafId = opts.scheduleFrame(tick);

  return {
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      if (rafId !== null) {
        opts.cancelFrame(rafId);
        rafId = null;
      }
      opts.onFrame(EMPTY_CUE_FRAME);
    },
  };
}
