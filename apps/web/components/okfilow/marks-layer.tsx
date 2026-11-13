"use client";
// The answer's pen marks on the overlay: one drawing layer that stays mounted for the overlay's whole
// life (a new answer's marks are new children in it, never a new layer), so the first stroke shows on the
// next frame. Each mark: a dark under-stroke and the ink stroke drawn by the pen (its time follows its
// length), a small pen tip leading it, then a leader line and the label once the pen is ~70% along.
// Marks that go away (Clear, the bubble goes) erase backwards after their labels fade.
import { useMemo, useRef, type CSSProperties } from "react";
import type { BuddyMark } from "@/lib/buddy/prompt";
import { markShape, placeLabels, type LabelSpot, type MarkShape, type Rect } from "@/lib/buddy/marks";
import { markTiming, PEN_EASE_CSS } from "@/lib/buddy/motion";

export type DrawnMark = BuddyMark & { done?: boolean; delay?: number };
/** One answer's marks; `leaving` while they erase. */
export type MarkSet = { id: number; list: DrawnMark[]; leaving?: boolean; texts?: Rect[] };

/** The label's font, padding and height (the CSS of .okf-mark-label says the same). */
const LABEL_FONT = "600 15px system-ui, sans-serif";
const LABEL_PAD_X = 11;
const LABEL_HEIGHT = 30;
const LABEL_MAX = 260;

let ctx: CanvasRenderingContext2D | null = null;
function labelSize(text: string): { width: number; height: number } {
  if (!ctx && typeof document !== "undefined") ctx = document.createElement("canvas").getContext("2d");
  let w = text.length * 8.4;
  if (ctx) {
    ctx.font = LABEL_FONT;
    w = ctx.measureText(text).width;
  }
  return { width: Math.min(LABEL_MAX, Math.ceil(w) + LABEL_PAD_X * 2), height: LABEL_HEIGHT };
}

type Laid = { shape: MarkShape; spot: LabelSpot | null; delay: number; stroke: number; label: number; head: number };

function layout(list: DrawnMark[], avoid: Rect[], texts: Rect[], keep: Laid[] = []): Laid[] {
  const view = { width: window.innerWidth, height: window.innerHeight };
  const spots = placeLabels(list, list.map((m) => (m.label ? labelSize(m.label) : null)), view, avoid, 18, 8, { texts, keep: keep.map(l => l.spot) });
  return list.map((m, i) => {
    if (keep[i]) return keep[i];
    const shape = markShape(m);
    const t = markTiming(shape.length);
    return { shape, spot: spots[i], delay: m.done ? 0 : (m.delay ?? 0), stroke: t.strokeMs, label: t.labelMs, head: t.headMs };
  });
}

const ms = (v: number) => `${Math.round(v)}ms`;

export function MarksLayer({ sets, avoid }: { sets: MarkSet[]; avoid: () => Rect[] }) {
  // Laid out once per list (a Stop that drops the marks not yet begun gives a new list; the ones kept keep their places).
  const cache = useRef(new Map<number, Laid[]>());
  const laid = useMemo(() => {
    for (const id of cache.current.keys()) if (!sets.some(s => s.id === id)) cache.current.delete(id);
    return sets.map((s) => {
    let l = cache.current.get(s.id);
    if (!l || l.length !== s.list.length) {
      l = layout(s.list, avoid(), s.texts ?? [], l).slice(0, s.list.length);
      cache.current.set(s.id, l);
    }
    return l;
    });
  }, [sets, avoid]);
  const groups = sets.flatMap((s, si) => s.list.map((m, i) => ({ key: `${s.id}-${i}`, m, l: laid[si][i], leaving: Boolean(s.leaving) })));
  const cls = (base: string, g: (typeof groups)[number]) => base + (g.m.done ? " okf-mark--done" : "") + (g.leaving ? " okf-mark--leaving" : "");
  const vars = (g: (typeof groups)[number]) => ({ "--okf-d": ms(g.l.delay), "--okf-s": ms(g.l.stroke), "--okf-l": ms(g.l.delay + g.l.label), "--okf-h": ms(g.l.delay + g.l.head), "--okf-ease": PEN_EASE_CSS }) as CSSProperties;
  return (
    <>
      <svg className="okf-draw okf-marks" width="100%" height="100%">
        {groups.map((g) => (
          <g key={g.key} className={cls("okf-mark", g)} style={vars(g)}>
            <path className="okf-mark-halo" d={g.l.shape.d} pathLength={1} />
            <path className="okf-mark-ink" d={g.l.shape.d} pathLength={1} />
            {g.l.shape.head && <path className="okf-mark-head" d={g.l.shape.head} />}
            {g.l.spot && (
              <g className="okf-mark-leader">
                <line x1={g.l.spot.from.x} y1={g.l.spot.from.y} x2={g.l.spot.to.x} y2={g.l.spot.to.y} pathLength={1} />
                <circle cx={g.l.spot.from.x} cy={g.l.spot.from.y} r={2} />
              </g>
            )}
          </g>
        ))}
      </svg>
      <div className="okf-marks-over">
        {groups.map((g) => (
          <div key={g.key} className={cls("okf-mark", g)} style={vars(g)}>
            {!g.m.done && !g.leaving && <i className="okf-pen" style={{ offsetPath: `path("${g.l.shape.d}")` }} />}
            {g.l.spot && (
              <span className="okf-mark-label" style={{ left: g.l.spot.x, top: g.l.spot.y, maxWidth: LABEL_MAX }}>{g.m.label}</span>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
