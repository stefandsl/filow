"use client";
// The whiteboard itself: one SVG drawn from a layout (lib/whiteboard/layout.ts). Rough.js gives
// the hand-drawn strokes (seeded, so a shape looks the same on every redraw); labels are SVG text;
// formulas are set by KaTeX into DOM nodes. Nothing the model wrote is ever inserted as markup:
// text goes in as text, a formula goes through KaTeX's parser with trust off, a plot through
// lib/whiteboard/plot.ts, a free sketch through the validated shapes of lib/buddy/visuals.ts.
import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import rough from "roughjs";
import { drawingSvg } from "@/lib/buddy/visuals";
import { arrowHead, type BoardLayout, type Box, type PlacedBlock } from "@/lib/whiteboard/layout";
import { parseExpr, sampleCurve } from "@/lib/whiteboard/plot";

export type BoardPalette = { board: string; ink: string; soft: string; accent: string; mark: string; fill: string; highlight: string; curve: string };
export const BOARD_PALETTES: Record<"light" | "dark", BoardPalette> = {
  light: { board: "#fbfaf6", ink: "#1f2430", soft: "#565d6b", accent: "#1d4ed8", mark: "#c2410c", fill: "#eef2fb", highlight: "#fde68a", curve: "#0f766e" },
  dark: { board: "#14171d", ink: "#f1f3f7", soft: "#aab2c0", accent: "#8ab4ff", mark: "#ffb44a", fill: "#222835", highlight: "#5b4a12", curve: "#5eead4" },
};
const FONT = '"Segoe UI", system-ui, -apple-system, "Noto Sans", "Hiragino Sans", "Yu Gothic UI", sans-serif';

const generator = rough.generator();
function seedOf(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return (h >>> 0) % 2147483646 + 1;
}

type PenOptions = { seed: number; roughness: number; bowing: number; stroke: string; strokeWidth: number; disableMultiStroke?: boolean };
/** What draws a stroke: path data for a line, a box, an ellipse, a curve or a run of points. */
type Pen = {
  line(x1: number, y1: number, x2: number, y2: number, o: PenOptions): string[];
  rectangle(x: number, y: number, w: number, h: number, o: PenOptions): string[];
  ellipse(cx: number, cy: number, w: number, h: number, o: PenOptions): string[];
  path(d: string, o: PenOptions): string[];
  linearPath(points: Array<[number, number]>, o: PenOptions): string[];
};
const paths = (drawable: ReturnType<typeof generator.line>) => generator.toPaths(drawable).map((info) => info.d);
/** The hand-drawn pen (Rough.js). */
const SKETCH_PEN: Pen = {
  line: (x1, y1, x2, y2, o) => paths(generator.line(x1, y1, x2, y2, o)),
  rectangle: (x, y, w, h, o) => paths(generator.rectangle(x, y, w, h, o)),
  ellipse: (cx, cy, w, h, o) => paths(generator.ellipse(cx, cy, w, h, o)),
  path: (d, o) => paths(generator.path(d, o)),
  linearPath: (points, o) => paths(generator.linearPath(points, o)),
};
/** The plain pen of the Lite tier: exact shapes, no library work per stroke. */
const PLAIN_PEN: Pen = {
  line: (x1, y1, x2, y2) => [`M${x1} ${y1} L${x2} ${y2}`],
  rectangle: (x, y, w, h) => [`M${x} ${y} H${x + w} V${y + h} H${x} Z`],
  ellipse: (cx, cy, w, h) => [`M${cx - w / 2} ${cy} A${w / 2} ${h / 2} 0 1 0 ${cx + w / 2} ${cy} A${w / 2} ${h / 2} 0 1 0 ${cx - w / 2} ${cy} Z`],
  path: (d) => [d],
  linearPath: (points) => [points.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ")],
};
type Draw = (make: (g: Pen, o: PenOptions) => string[], key: string, stroke: string, width: number, delay?: number) => ReactNode;

/** The KaTeX formula of one block, scaled down when it is wider than its room. */
function Formula({ tex, box, color }: { tex: string; box: Box; color: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    void import("katex").then(({ default: katex }) => {
      const el = host.current;
      if (!live || !el) return;
      // render() builds DOM nodes from the parsed formula: no HTML string is involved
      katex.render(tex, el, { displayMode: true, throwOnError: false, trust: false, strict: "ignore", maxExpand: 200, maxSize: 20, output: "html" });
      const inner = el.firstElementChild as HTMLElement | null;
      if (!inner) return;
      inner.style.margin = "0";
      const scale = Math.min(1, (box.w - 12) / Math.max(1, inner.scrollWidth), (box.h - 6) / Math.max(1, inner.scrollHeight));
      inner.style.transform = scale < 1 ? `scale(${scale})` : "";
      inner.style.transformOrigin = "center";
      el.dataset.ready = "1";
    });
    return () => { live = false; };
  }, [tex, box.w, box.h]);
  return (
    <foreignObject x={box.x} y={box.y} width={box.w} height={box.h}>
      <div ref={host} className="wb-formula" role="math" aria-label={tex} style={{ color, fontSize: 24, width: box.w, height: box.h, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }} />
    </foreignObject>
  );
}

function Plot({ block, palette, draw }: { block: Extract<PlacedBlock, { kind: "plot" }>; palette: BoardPalette; draw: Draw }) {
  const { box } = block;
  const expr = parseExpr(block.expr);
  const curve = expr ? sampleCurve(expr, block.xmin, block.xmax) : null;
  const pad = { l: 44, r: 14, t: 30, b: 26 };
  const inner = { x: box.x + pad.l, y: box.y + pad.t, w: box.w - pad.l - pad.r, h: box.h - pad.t - pad.b };
  const num = (v: number) => (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0) ? v.toExponential(1) : String(Math.round(v * 100) / 100));
  const label = <text x={box.x + 6} y={box.y + 19} fontSize={16} fill={palette.ink} className="wb-fade">{`y = ${block.expr}`}</text>;
  if (!curve) return <g>{label}</g>;
  const sx = (x: number) => inner.x + ((x - curve.xmin) / (curve.xmax - curve.xmin)) * inner.w;
  const sy = (y: number) => inner.y + inner.h - ((y - curve.ymin) / (curve.ymax - curve.ymin)) * inner.h;
  // the axes sit on zero when zero is in view, else on the left and bottom edges
  const axisY = curve.ymin <= 0 && curve.ymax >= 0 ? sy(0) : inner.y + inner.h;
  const axisX = curve.xmin <= 0 && curve.xmax >= 0 ? sx(0) : inner.x;
  return (
    <g>
      {label}
      {draw((g, o) => g.line(inner.x, axisY, inner.x + inner.w, axisY, o), `${block.key}-ax`, palette.soft, 1.6)}
      {draw((g, o) => g.line(axisX, inner.y + inner.h, axisX, inner.y, o), `${block.key}-ay`, palette.soft, 1.6)}
      {curve.runs.map((run, i) => (
        <path key={i} className="wb-stroke" pathLength={1} d={run.map(([x, y], k) => `${k ? "L" : "M"}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`).join(" ")} fill="none" stroke={palette.curve} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      <g fontSize={13} fill={palette.soft} className="wb-fade">
        <text x={inner.x} y={box.y + box.h - 6} textAnchor="middle">{num(curve.xmin)}</text>
        <text x={inner.x + inner.w} y={box.y + box.h - 6} textAnchor="middle">{num(curve.xmax)}</text>
        <text x={inner.x - 6} y={inner.y + inner.h} textAnchor="end">{num(curve.ymin)}</text>
        <text x={inner.x - 6} y={inner.y + 10} textAnchor="end">{num(curve.ymax)}</text>
        <text x={inner.x + inner.w + 2} y={axisY - 6} textAnchor="end">x</text>
      </g>
    </g>
  );
}

export type BoardProps = {
  layout: BoardLayout;
  /** The step whose items are new: they draw on, the rest is already there. */
  current: number;
  palette: BoardPalette;
  /** Hand-drawn strokes (false: plain shapes, for the Lite tier). */
  sketchy: boolean;
  label: string;
  /** A box was clicked (or Enter pressed on it): explain that part again. */
  onPick?: (id: string, text: string) => void;
  pickLabel?: (text: string) => string;
};

export function Board({ layout, current, palette, sketchy, label, onPick, pickLabel }: BoardProps) {
  const p = palette;
  const pen = sketchy ? SKETCH_PEN : PLAIN_PEN;
  const draw: Draw = (make, key, stroke, width, delay = 0) => {
    return make(pen, { seed: seedOf(key), roughness: 1.1, bowing: 1, stroke, strokeWidth: width }).map((d, i) => (
      <path key={`${key}-${i}`} className="wb-stroke" pathLength={1} d={d} fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" style={delay ? ({ animationDelay: `${delay}ms` } as CSSProperties) : undefined} />
    ));
  };
  const fresh = (step: number) => (step === current ? "wb-new" : undefined);
  const onKey = (id: string, text: string) => (ev: KeyboardEvent<SVGGElement>) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      onPick?.(id, text);
    }
  };
  const highlights = layout.marks.filter((m) => m.style === "highlight");
  const overMarks = layout.marks.filter((m) => m.style !== "highlight");

  return (
    <svg className="wb-board" viewBox={`0 0 ${layout.w} ${layout.h}`} xmlns="http://www.w3.org/2000/svg" role="group" aria-label={label} fontFamily={FONT} data-shape={layout.shape} data-step={current}>
      <rect x={0} y={0} width={layout.w} height={layout.h} rx={18} fill={p.board} />
      <text x={layout.title.x} y={layout.title.y} fontSize={layout.title.font} fontWeight={700} fill={p.ink}>{layout.title.text}</text>
      {draw((g, o) => g.line(layout.title.x, 58, layout.w - layout.title.x, 58, o), "title-rule", p.soft, 1.4)}

      {highlights.map((m) => (
        <rect key={m.key} className={`wb-fade ${fresh(m.step) ?? ""}`} x={m.box.x - 8} y={m.box.y - 8} width={m.box.w + 16} height={m.box.h + 16} rx={14} fill={p.highlight} />
      ))}

      {layout.edges.map((e, i) => {
        const head = arrowHead(e);
        const wing = (da: number) => ({ x: head.x - 15 * Math.cos(head.angle + da), y: head.y - 15 * Math.sin(head.angle + da) });
        const a = wing(0.42);
        const b = wing(-0.42);
        return (
          <g key={e.key} className={fresh(e.step)} data-edge={`${e.from}>${e.to}`}>
            {draw((g, o) => g.path(`M${e.x1.toFixed(1)} ${e.y1.toFixed(1)} Q${e.cx.toFixed(1)} ${e.cy.toFixed(1)} ${e.x2.toFixed(1)} ${e.y2.toFixed(1)}`, { ...o, disableMultiStroke: true }), e.key, p.soft, 2.2, 120 + i * 60)}
            {draw((g, o) => g.linearPath([[a.x, a.y], [head.x, head.y], [b.x, b.y]], { ...o, disableMultiStroke: true }), `${e.key}-h`, p.soft, 2.2, 420 + i * 60)}
            {e.label && (
              <g className="wb-fade">
                <rect x={e.label.box.x} y={e.label.box.y} width={e.label.box.w} height={e.label.box.h} rx={6} fill={p.board} opacity={0.92} />
                {e.label.lines.map((ln, k) => (
                  <text key={k} x={e.label!.box.x + e.label!.box.w / 2} y={e.label!.box.y + 4 + e.label!.font * 0.95 + k * e.label!.font * 1.2} fontSize={e.label!.font} textAnchor="middle" fill={p.accent} fontStyle="italic">{ln}</text>
                ))}
              </g>
            )}
          </g>
        );
      })}

      {layout.nodes.map((nd) => {
        const { w, h } = nd.box;
        const lineH = nd.font * 1.22;
        const top = (h - nd.lines.length * lineH) / 2;
        const picks = Boolean(onPick);
        return (
          <g
            key={nd.id}
            className={`wb-node ${fresh(nd.step) ?? ""}`}
            style={{ transform: `translate(${nd.box.x}px, ${nd.box.y}px)` }}
            data-node={nd.id}
            {...(picks ? { role: "button", tabIndex: 0, "aria-label": pickLabel ? pickLabel(nd.text) : nd.text, onClick: () => onPick?.(nd.id, nd.text), onKeyDown: onKey(nd.id, nd.text) } : {})}
          >
            <rect className="wb-fade wb-node-fill" x={0} y={0} width={w} height={h} rx={10} fill={p.fill} />
            {draw((g, o) => g.rectangle(0, 0, w, h, o), `n-${nd.id}`, p.ink, 2.2)}
            {nd.lines.map((ln, k) => (
              <text key={k} className="wb-fade" x={w / 2} y={top + k * lineH + nd.font * 0.92} fontSize={nd.font} textAnchor="middle" fill={p.ink}>{ln}</text>
            ))}
          </g>
        );
      })}

      {overMarks.map((m) => (
        <g key={m.key} className={fresh(m.step)}>
          {m.style === "circle"
            ? draw((g, o) => g.ellipse(m.box.x + m.box.w / 2, m.box.y + m.box.h / 2, m.box.w + 30, m.box.h + 26, o), m.key, p.mark, 3, 200)
            : draw((g, o) => g.line(m.box.x + 6, m.box.y + m.box.h + 8, m.box.x + m.box.w - 6, m.box.y + m.box.h + 8, o), m.key, p.mark, 3.4, 200)}
        </g>
      ))}

      {layout.blocks.map((b) => {
        const { box } = b;
        if (b.kind === "formula") return <g key={b.key} className={`wb-fade ${fresh(b.step) ?? ""}`} data-block="formula"><Formula tex={b.tex} box={box} color={p.ink} /></g>;
        if (b.kind === "plot") return <g key={b.key} className={fresh(b.step)} data-block="plot"><Plot block={b} palette={p} draw={draw} /></g>;
        if (b.kind === "sketch") {
          return (
            <g key={b.key} className={`wb-fade ${fresh(b.step) ?? ""}`} data-block="sketch">
              {/* our own SVG from validated shapes, shown as a picture: it cannot run anything */}
              <image href={`data:image/svg+xml;utf8,${encodeURIComponent(drawingSvg(b.drawing))}`} x={box.x} y={box.y} width={box.w} height={box.h} preserveAspectRatio="xMidYMid meet" />
              {draw((g, o) => g.rectangle(box.x, box.y, box.w, box.h, o), b.key, p.soft, 1.6)}
            </g>
          );
        }
        const lineH = b.font * 1.3;
        return (
          <g key={b.key} className={fresh(b.step)} data-block={b.kind}>
            {b.kind === "card" ? draw((g, o) => g.rectangle(box.x + 2, box.y + 2, box.w - 4, box.h - 4, o), b.key, p.soft, 1.8) : draw((g, o) => g.line(box.x + 6, box.y + 6, box.x + 6, box.y + box.h - 6, o), b.key, p.mark, 3)}
            {b.lines.map((ln, k) => (
              <text key={k} className="wb-fade" x={box.x + 18} y={box.y + 11 + k * lineH + b.font * 0.92} fontSize={b.font} fill={p.ink}>{ln}</text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
