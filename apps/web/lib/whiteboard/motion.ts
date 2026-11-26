// Presentation-only motion and static emphasis for directed whiteboard edges and sequence messages (X-10).
// Pure: no DOM, no side effects. Driven by explicit `customData.wb` metadata (`from`, `to`, `order`)
// on prepared Excalidraw elements so older boards without metadata stay silent and unchanged, moved
// endpoints are followed automatically, and no transient cue ever enters the scene or exports.
export { samplePolyline } from "./check";
import { cumulativeLengths, pathPoints, samplePolyline } from "./check";
import { drawMsFor, type Slot } from "./pace";
import { stepOf, type ExEl, type Scene } from "./scene";

export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type ReceiverBox = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  shape: string;
  roundness: boolean;
};
export type SignalStyle = {
  fill: string;
  ringStroke: string;
  chevronStroke: string;
  haloOpacity: number;
  overLabelHaloOpacity: number;
  dotRadiusPx: number;
  overLabelDotRadiusPx: number;
  haloRadiusPx: number;
  overLabelHaloRadiusPx: number;
};
export type EdgeCue = {
  id: string;
  key: string;
  step: number;
  fromId: string;
  toId: string;
  order: number;
  /** Original prepared arrow polyline from sender to receiver (the exact path the signal rides). */
  points: Pt[];
  color: string;
  receiver: ReceiverBox | null;
  /** Safe outward padding (scene units) for the receiver outline so it never crosses any visible text. */
  outlinePad: number;
  tip: { x: number; y: number; angle: number };
  labelBox: Rect | null;
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
  outlinePad: number;
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
  outlinePad: number;
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
 * The bounding box where Excalidraw actually renders a text element: bound arrow labels are
 * always drawn centered on the arrow's midpoint (ignoring stored x/y), while unbound labels and
 * node labels sit at their stored coordinates.
 */
export function renderedTextBox(t: ExEl, byId: Map<string, ExEl>): Rect | null {
  if (t.isDeleted || t.type !== "text" || t.width <= 0 || t.height <= 0) return null;
  if (t.containerId) {
    const host = byId.get(t.containerId);
    if (host && host.type === "arrow") {
      const pts = pathPoints(host, 24);
      const mid = pts[Math.floor(pts.length / 2)] ?? { x: host.x + host.width / 2, y: host.y + host.height / 2 };
      return { x: mid.x - t.width / 2, y: mid.y - t.height / 2, w: t.width, h: t.height };
    }
  }
  return { x: t.x, y: t.y, w: t.width, h: t.height };
}

function findEdgeLabelBox(scene: Scene, byId: Map<string, ExEl>, edge: ExEl, key: string): Rect | null {
  const bound = scene.elements.find((x) => !x.isDeleted && x.type === "text" && x.containerId === edge.id);
  if (bound) return renderedTextBox(bound, byId);
  const unbound =
    scene.elements.find((x) => !x.isDeleted && x.type === "text" && !x.containerId && x.id === `${edge.id}-t`) ??
    scene.elements.find(
      (x) =>
        !x.isDeleted &&
        x.type === "text" &&
        !x.containerId &&
        x.customData?.wb?.key === key &&
        x.customData?.wb?.role === "label",
    );
  return unbound ? renderedTextBox(unbound, byId) : null;
}

/**
 * Computes outward padding for a receiver outline so `pad + halfStroke` stays clear of every
 * visible text box outside the receiver.
 */
export function receiverOutlinePad(
  receiver: ReceiverBox,
  textBoxes: Rect[],
  desiredPad = 4,
  halfStroke = 4,
): number {
  let maxExpand = desiredPad + halfStroke;
  for (const tb of textBoxes) {
    const dx = Math.max(tb.x - (receiver.x + receiver.w), receiver.x - (tb.x + tb.w));
    const dy = Math.max(tb.y - (receiver.y + receiver.h), receiver.y - (tb.y + tb.h));
    const gap = Math.max(dx, dy);
    if (gap >= 0) {
      maxExpand = Math.min(maxExpand, gap - 1);
    }
  }
  return Math.max(-halfStroke, Math.min(desiredPad, Math.floor((maxExpand - halfStroke) * 10) / 10));
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

  const visibleTexts = scene.elements.filter((e) => !e.isDeleted && e.type === "text" && stepOf(e) <= step);
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
    const labelBox = findEdgeLabelBox(scene, byId, item.el, item.key);
    const externalTextBoxes = receiver
      ? visibleTexts
          .filter((t) => t.containerId !== receiver.id)
          .map((t) => renderedTextBox(t, byId))
          .filter((b): b is Rect => b !== null)
      : [];
    const outlinePad = receiver ? receiverOutlinePad(receiver, externalTextBoxes, 4, 4) : 4;
    cues.push({
      id: item.el.id,
      key: item.key,
      step,
      fromId: item.fromId,
      toId: item.toId,
      order: item.order,
      points: pts,
      color: typeof item.el.strokeColor === "string" ? item.el.strokeColor : "#495057",
      receiver,
      outlinePad,
      tip: { x: endPt.x, y: endPt.y, angle: tipAngle },
      labelBox,
    });
  }
  return cues;
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

function pointNearBox(pt: Pt, box: Rect | null, pad = 4): boolean {
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
      // The moving signal always rides directly along the drawn arrow path (never drifts off-stroke).
      const path = item.cue.points;
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
          outlinePad: item.cue.outlinePad,
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

/** Static emphasis for reduced motion and Lite: zero moving signals, one receiver at a time in reveal order. */
export function staticStepCues(cues: EdgeCue[]): CueFrame {
  if (!cues.length) return EMPTY_CUE_FRAME;
  const cue = cues.reduce((first, next) => next.order < first.order ? next : first);
  const rawTail = slicePolyline(cue.points, 0.78, 1);
  const tail = cue.labelBox ? rawTail.filter((p) => !pointNearBox(p, cue.labelBox, 3)) : rawTail;
  return {
    phase: "static",
    active: true,
    signals: [],
    arrivals: [],
    staticEmphasis: [
      {
        edgeId: cue.id,
        fromId: cue.fromId,
        toId: cue.toId,
        tip: cue.tip,
        tail: tail.length >= 2 ? tail : [],
        receiver: cue.receiver,
        outlinePad: cue.outlinePad,
        color: cue.color,
      },
    ],
  };
}

/** Clamps a signal halo radius in scene units so the halo stays clear of every visible text box. */
export function cueHaloRadius(center: Pt, desiredRadius: number, minRadius: number, textBoxes: Rect[]): number {
  let maxRadius = desiredRadius;
  for (const tb of textBoxes) {
    const cx = clamp(center.x, tb.x, tb.x + tb.w);
    const cy = clamp(center.y, tb.y, tb.y + tb.h);
    const dist = Math.hypot(center.x - cx, center.y - cy);
    maxRadius = Math.min(maxRadius, dist - 1);
  }
  return Math.max(minRadius, Math.min(desiredRadius, maxRadius));
}

/** High-contrast, theme-aware accent colour for signal and arrival cues (>= 4.4:1 against #ffffff and >= 7:1 against #121212). */
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

/** Screen-px sizing and high-contrast ring/chevron/halo palette for both board looks. */
export function cueSignalStyle(strokeColor: string | undefined, dark: boolean): SignalStyle {
  const fill = cueAccentColor(strokeColor, dark);
  return {
    fill,
    ringStroke: dark ? "#f8f9fa" : "#ffffff",
    chevronStroke: dark ? "#0b1320" : "#ffffff",
    haloOpacity: dark ? 0.38 : 0.28,
    overLabelHaloOpacity: dark ? 0.35 : 0.2,
    dotRadiusPx: 7,
    overLabelDotRadiusPx: 5.5,
    haloRadiusPx: 13,
    overLabelHaloRadiusPx: 10,
  };
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
