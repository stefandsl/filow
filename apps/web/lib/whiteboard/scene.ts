// The whiteboard as an Excalidraw scene: the one format a lesson is drawn, saved, edited and
// exported in (standard Excalidraw element JSON, so any .excalidraw file opens here and every board
// saved here opens in Excalidraw). The model never gives coordinates: layout.ts places the lesson,
// and this file turns the placed board into elements, following the design rules of the
// Excalidraw skill (transparent shapes with coloured strokes, a small palette, pre-wrapped text,
// bound arrows, ids on everything) and drawing each thing as shape, then label, then arrows.
// Pure and deterministic: the same lesson up to the same step always gives the same elements
// (seeds come from the ids), so going back, replaying and exporting show the same picture.
import { drawingSvg } from "@/lib/buddy/visuals";
import { CELL_ROW, type BoardLayout, type Box, type PlacedBlock, type PlacedEdge, type PlacedNode } from "./layout";
import { LIMITS, cleanText, type Lesson } from "./lesson";
import { evalExpr, parseExpr, sampleCurve } from "./plot";
import { texToText } from "./tex";

/** One Excalidraw element. Typed loosely on purpose: the board reads files written elsewhere. */
export type ExEl = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: string;
  strokeWidth?: number;
  strokeStyle?: string;
  roughness?: number;
  opacity?: number;
  roundness?: { type: number } | null;
  seed?: number;
  version?: number;
  versionNonce?: number;
  isDeleted?: boolean;
  groupIds?: string[];
  frameId?: string | null;
  boundElements?: Array<{ id: string; type: "text" | "arrow" }> | null;
  updated?: number;
  link?: string | null;
  locked?: boolean;
  text?: string;
  originalText?: string;
  fontSize?: number;
  fontFamily?: number;
  textAlign?: string;
  verticalAlign?: string;
  containerId?: string | null;
  autoResize?: boolean;
  lineHeight?: number;
  points?: Array<[number, number]>;
  startBinding?: { elementId: string; focus: number; gap: number } | null;
  endBinding?: { elementId: string; focus: number; gap: number } | null;
  startArrowhead?: string | null;
  endArrowhead?: string | null;
  elbowed?: boolean;
  fileId?: string | null;
  status?: string;
  scale?: [number, number];
  /** Filow's own note on an element: the lesson step it belongs to and the timing key of the thing it draws. */
  customData?: { wb?: WbMeta } & Record<string, unknown>;
  [k: string]: unknown;
};
export type WbMeta = { step: number; key: string; role: "frame" | "title" | "node" | "label" | "edge" | "mark" | "block" | "pointer" };
export type BinaryFile = { id: string; mimeType: string; dataURL: string; created: number };
export type Scene = { elements: ExEl[]; files: Record<string, BinaryFile> };

/** Excalidraw's font numbers (FONT_FAMILY in @excalidraw/excalidraw 0.18). */
export const FONT = { excalifont: 5, liberation: 9, cascadia: 3 } as const;
/** Ink of the board (light; the dark board is the same scene drawn with Excalidraw's dark mode). */
export const INK = { text: "#1e1e1e", soft: "#495057", faint: "#868e96", mark: "#e03131", highlight: "#ffec99", curve: ["#1971c2", "#e8590c", "#2f9e44"] } as const;
/** One colour per step, so the board shows which step drew what (the voice says the same order). */
export const STEP_COLOURS = ["#1971c2", "#2f9e44", "#9c36b5", "#e8590c", "#0c8599", "#c2255c", "#5f3dc4"] as const;
export const stepColour = (step: number) => STEP_COLOURS[((step % STEP_COLOURS.length) + STEP_COLOURS.length) % STEP_COLOURS.length];
/** Excalifont is wider than the sans-serif layout.ts measures with: labels are set this much smaller. */
export const HAND_SCALE = 0.9;
export const LINE_HEIGHT = 1.25;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 2147483646) + 1;
}
/** An id Excalidraw and a CSS selector both accept. */
export const safeId = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 64);
const r1 = (n: number) => Math.round(n * 10) / 10;

function el(id: string, type: string, box: Box, meta: WbMeta, rest: Partial<ExEl> = {}): ExEl {
  return {
    id, type, x: r1(box.x), y: r1(box.y), width: r1(box.w), height: r1(box.h), angle: 0,
    strokeColor: INK.text, backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid",
    roughness: 1, opacity: 100, roundness: null, seed: hash(id), version: 1, versionNonce: hash(`${id}:v`), isDeleted: false,
    groupIds: [], frameId: null, boundElements: null, updated: 1, link: null, locked: false,
    customData: { wb: meta },
    ...rest,
  };
}

/** A rough width estimate of a line in Excalifont (the browser measures exactly before drawing). */
export function handWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of Array.from(text)) {
    const c = ch.codePointAt(0) ?? 0;
    w += c >= 0x2e80 ? 1.0 : ch === " " ? 0.32 : /[iljtfI.,:;'|!()]/.test(ch) ? 0.36 : /[mwMW]/.test(ch) ? 0.9 : /[A-Z]/.test(ch) ? 0.7 : c >= 0x400 && c <= 0x4ff ? 0.66 : 0.58;
  }
  return w * size * 1.04;
}

/** A text element. `container`: the shape it is written in (Excalidraw keeps it centred there). */
function text(id: string, lines: string[], size: number, at: { cx: number; cy: number } | { x: number; y: number }, meta: WbMeta, rest: Partial<ExEl> = {}): ExEl {
  const width = Math.max(4, ...lines.map((ln) => handWidth(ln, size)));
  const height = lines.length * size * LINE_HEIGHT;
  const x = "cx" in at ? at.cx - width / 2 : at.x;
  const y = "cy" in at ? at.cy - height / 2 : at.y;
  const body = lines.join("\n");
  return el(id, "text", { x, y, w: width, h: height }, meta, {
    text: body, originalText: rest.originalText ?? body, fontSize: r1(size), fontFamily: FONT.excalifont,
    textAlign: "cx" in at ? "center" : "left", verticalAlign: "cx" in at ? "middle" : "top", containerId: null, autoResize: true, lineHeight: LINE_HEIGHT,
    ...rest,
  });
}

/** A shape with its label bound inside it (Excalidraw keeps the two together when either moves). */
function labelled(shape: ExEl, label: ExEl): [ExEl, ExEl] {
  shape.boundElements = [...(shape.boundElements ?? []), { id: label.id, type: "text" }];
  label.containerId = shape.id;
  return [shape, label];
}

function arrow(id: string, pts: Array<{ x: number; y: number }>, meta: WbMeta, rest: Partial<ExEl> = {}): ExEl {
  const x0 = pts[0].x;
  const y0 = pts[0].y;
  const rel = pts.map((p) => [r1(p.x - x0), r1(p.y - y0)] as [number, number]);
  const xs = rel.map((p) => p[0]);
  const ys = rel.map((p) => p[1]);
  return el(id, "arrow", { x: x0, y: y0, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }, meta, {
    strokeColor: INK.soft, roundness: pts.length > 2 ? { type: 2 } : null, points: rel, lastCommittedPoint: null,
    startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: "arrow", elbowed: false,
    ...rest,
  });
}
const line = (id: string, pts: Array<{ x: number; y: number }>, meta: WbMeta, rest: Partial<ExEl> = {}) =>
  arrow(id, pts, meta, { endArrowhead: null, ...rest, type: "line", polygon: false } as Partial<ExEl>);

const nodeId = (id: string) => `n-${safeId(id)}`;

function nodeEls(nd: PlacedNode): ExEl[] {
  const colour = stepColour(nd.step);
  const meta: WbMeta = { step: nd.step, key: `n:${nd.id}`, role: "node" };
  const shape = el(nodeId(nd.id), "rectangle", nd.box, meta, { strokeColor: colour, roundness: { type: 3 }, strokeWidth: 2 });
  const size = Math.max(15, Math.round(nd.font * HAND_SCALE));
  const label = text(`${nodeId(nd.id)}-t`, nd.lines, size, { cx: nd.box.x + nd.box.w / 2, cy: nd.box.y + nd.box.h / 2 }, { ...meta, role: "label" }, { originalText: nd.text });
  return labelled(shape, label);
}

/** The middle of the quadratic curve layout.ts gives an arrow: Excalidraw draws a curve through it. */
const mid = (e: PlacedEdge) => ({ x: 0.25 * e.x1 + 0.5 * e.cx + 0.25 * e.x2, y: 0.25 * e.y1 + 0.5 * e.cy + 0.25 * e.y2 });

function edgeEls(e: PlacedEdge, used: Set<string>, shapes: Map<string, ExEl>): ExEl[] {
  let id = `a-${safeId(e.from)}-${safeId(e.to)}`;
  for (let k = 2; used.has(id); k++) id = `a-${safeId(e.from)}-${safeId(e.to)}-${k}`;
  used.add(id);
  const meta: WbMeta = { step: e.step, key: e.key, role: "edge" };
  const straight = Math.abs((e.cx - (e.x1 + e.x2) / 2)) < 2 && Math.abs(e.cy - (e.y1 + e.y2) / 2) < 2;
  const from = shapes.get(nodeId(e.from));
  const to = shapes.get(nodeId(e.to));
  const a = arrow(id, straight ? [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }] : [{ x: e.x1, y: e.y1 }, mid(e), { x: e.x2, y: e.y2 }], meta, {
    startBinding: from ? { elementId: from.id, focus: 0, gap: 6 } : null,
    endBinding: to ? { elementId: to.id, focus: 0, gap: 6 } : null,
  });
  if (from) from.boundElements = [...(from.boundElements ?? []), { id, type: "arrow" }];
  if (to && to !== from) to.boundElements = [...(to.boundElements ?? []), { id, type: "arrow" }];
  if (!e.label) return [a];
  const size = Math.round(e.label.font * 0.95);
  const lb = e.label.box;
  const label = text(`${id}-t`, e.label.lines, size, { cx: lb.x + lb.w / 2, cy: lb.y + lb.h / 2 }, { ...meta, role: "label" }, { strokeColor: INK.soft, originalText: e.label.lines.join(" ") });
  return labelled(a, label);
}

function markEls(m: BoardLayout["marks"][number], targetColour: string): ExEl[] {
  const meta: WbMeta = { step: m.step, key: m.key, role: "mark" };
  const id = `m-${safeId(m.target)}-${m.style}`;
  const b = m.box;
  if (m.style === "circle") return [el(id, "ellipse", { x: b.x - 16, y: b.y - 14, w: b.w + 32, h: b.h + 28 }, meta, { strokeColor: INK.mark, strokeWidth: 2.5 })];
  if (m.style === "underline") return [line(id, [{ x: b.x + 6, y: b.y + b.h + 9 }, { x: b.x + b.w - 6, y: b.y + b.h + 9 }], meta, { strokeColor: INK.mark, strokeWidth: 3 })];
  return [el(id, "rectangle", { x: b.x - 8, y: b.y - 8, w: b.w + 16, h: b.h + 16 }, meta, { strokeColor: targetColour, backgroundColor: INK.highlight, opacity: 45, roundness: { type: 3 }, strokeWidth: 1 })];
}

const num = (v: number) => (Math.abs(v) >= 1e7 || (Math.abs(v) < 0.01 && v !== 0) ? v.toExponential(1) : Math.abs(v) >= 1000 ? String(Math.round(v)) : String(Math.round(v * 100) / 100));

function plotEls(b: Extract<PlacedBlock, { kind: "plot" }>, meta: WbMeta, base: string): ExEl[] {
  const out: ExEl[] = [];
  const { box } = b;
  const trees = [b.expr, ...(b.more ?? [])].map((src) => ({ src, tree: parseExpr(src) })).flatMap((t) => (t.tree ? [{ src: t.src, tree: t.tree, sampled: sampleCurve(t.tree, b.xmin, b.xmax) }] : [])).filter((t) => t.sampled);
  const head = trees.map((t) => `y = ${t.src}`).join("   ");
  out.push(text(`${base}-title`, [head || `y = ${b.expr}`], 17, { x: box.x + 4, y: box.y + 2 }, meta));
  if (!trees.length) return out;
  const pad = { l: 46, r: 16, t: 32, b: 28 };
  const inner = { x: box.x + pad.l, y: box.y + pad.t, w: box.w - pad.l - pad.r, h: box.h - pad.t - pad.b };
  const ymin = Math.min(...trees.map((t) => t.sampled!.ymin));
  const ymax = Math.max(...trees.map((t) => t.sampled!.ymax));
  const sx = (x: number) => inner.x + ((x - b.xmin) / (b.xmax - b.xmin)) * inner.w;
  const sy = (y: number) => inner.y + inner.h - ((y - ymin) / (ymax - ymin || 1)) * inner.h;
  const axisY = ymin <= 0 && ymax >= 0 ? sy(0) : inner.y + inner.h;
  const axisX = b.xmin <= 0 && b.xmax >= 0 ? sx(0) : inner.x;
  out.push(arrow(`${base}-ax`, [{ x: inner.x - 4, y: axisY }, { x: inner.x + inner.w + 8, y: axisY }], meta, { strokeColor: INK.soft, strokeWidth: 1.5 }));
  out.push(arrow(`${base}-ay`, [{ x: axisX, y: inner.y + inner.h + 4 }, { x: axisX, y: inner.y - 10 }], meta, { strokeColor: INK.soft, strokeWidth: 1.5 }));
  trees.forEach((t, n) => {
    t.sampled!.runs.forEach((run, k) => {
      // every other sample: a smooth curve with fewer points to draw
      const pts = run.filter((_, i) => i % 2 === 0 || i === run.length - 1).map(([x, y]) => ({ x: sx(x), y: sy(y) }));
      if (pts.length >= 2) out.push(line(`${base}-c${n}-${k}`, pts, meta, { strokeColor: INK.curve[n % 3], strokeWidth: 2.5, roughness: 0, roundness: { type: 2 } }));
    });
  });
  // where the first two curves meet
  if (trees.length > 1) {
    const a = trees[0].tree;
    const c = trees[1].tree;
    let before = NaN;
    for (let k = 0; k <= 240; k++) {
      const x = b.xmin + ((b.xmax - b.xmin) * k) / 240;
      const d = evalExpr(a, x) - evalExpr(c, x);
      if (Number.isFinite(d) && Number.isFinite(before) && (d === 0 || d * before < 0) && k > 4 && k < 236) {
        const step = (b.xmax - b.xmin) / 240;
        const at = d === 0 ? x : x - step * (d / (d - before));
        const y = evalExpr(a, at);
        if (y >= ymin && y <= ymax) {
          out.push(el(`${base}-meet`, "ellipse", { x: sx(at) - 6, y: sy(y) - 6, w: 12, h: 12 }, meta, { strokeColor: INK.text, backgroundColor: INK.text, roughness: 0 }));
          out.push(text(`${base}-meet-t`, [`(${num(at)}, ${num(y)})`], 15, { x: sx(at) + 10, y: sy(y) - 24 }, meta));
        }
        break;
      }
      before = d;
    }
  }
  out.push(text(`${base}-x0`, [num(b.xmin)], 14, { cx: inner.x, cy: box.y + box.h - 10 }, meta, { strokeColor: INK.faint }));
  out.push(text(`${base}-x1`, [num(b.xmax)], 14, { cx: inner.x + inner.w, cy: box.y + box.h - 10 }, meta, { strokeColor: INK.faint }));
  out.push(text(`${base}-y0`, [num(ymin)], 14, { x: box.x + 2, y: inner.y + inner.h - 10 }, meta, { strokeColor: INK.faint }));
  out.push(text(`${base}-y1`, [num(ymax)], 14, { x: box.x + 2, y: inner.y - 4 }, meta, { strokeColor: INK.faint }));
  const xName = b.xName || "x";
  out.push(text(`${base}-xn`, [xName], 14, { x: inner.x + inner.w - handWidth(xName, 14) - 2, y: axisY + 6 }, meta, { strokeColor: INK.soft }));
  if (b.yName) out.push(text(`${base}-yn`, [b.yName], 14, { x: axisX + 8, y: inner.y - 16 }, meta, { strokeColor: INK.soft }));
  return out;
}

function cellsEls(b: Extract<PlacedBlock, { kind: "cells" }>, meta: WbMeta, base: string): ExEl[] {
  const out: ExEl[] = [];
  const { box } = b;
  const colour = stepColour(meta.step);
  const size = Math.max(14, Math.round(b.font * 0.95));
  if (b.column) {
    b.values.forEach((v, k) => {
      const cell = { x: box.x + 28, y: box.y + 3 + k * CELL_ROW, w: box.w - 28, h: CELL_ROW };
      const on = k === b.pointer;
      out.push(...labelled(
        el(`${base}-c${k}`, "rectangle", cell, meta, { strokeColor: on ? INK.mark : colour, backgroundColor: on ? INK.highlight : "transparent", strokeWidth: on ? 2 : 1.5 }),
        text(`${base}-c${k}-t`, [v], size, { cx: cell.x + cell.w / 2, cy: cell.y + cell.h / 2 }, { ...meta, role: "label" }),
      ));
    });
    if (b.pointer >= 0) {
      const py = box.y + 3 + (b.pointer + 0.5) * CELL_ROW;
      out.push(arrow(`${base}-p`, [{ x: box.x + 2, y: py }, { x: box.x + 24, y: py }], { ...meta, role: "pointer" }, { strokeColor: INK.mark, strokeWidth: 2.5 }));
    }
    return out;
  }
  const cw = box.w / b.values.length;
  const ch = 46;
  b.values.forEach((v, k) => {
    const cell = { x: box.x + k * cw, y: box.y, w: cw, h: ch };
    const on = k === b.pointer;
    out.push(...labelled(
      el(`${base}-c${k}`, "rectangle", cell, meta, { strokeColor: on ? INK.mark : colour, backgroundColor: on ? INK.highlight : "transparent", strokeWidth: on ? 2 : 1.5 }),
      text(`${base}-c${k}-t`, [v], size, { cx: cell.x + cell.w / 2, cy: cell.y + ch / 2 }, { ...meta, role: "label" }),
    ));
  });
  if (b.pointer >= 0) {
    const px = box.x + (b.pointer + 0.5) * cw;
    out.push(arrow(`${base}-p`, [{ x: px, y: box.y + ch + 28 }, { x: px, y: box.y + ch + 6 }], { ...meta, role: "pointer" }, { strokeColor: INK.mark, strokeWidth: 2.5 }));
  }
  return out;
}

/** A free sketch (online path only) as a picture: our own SVG from validated shapes, it cannot run anything. */
function sketchFile(svg: string, id: string): BinaryFile | null {
  const whole = (svg as string & { toWellFormed?: () => string }).toWellFormed?.() ?? svg;
  try {
    return { id, mimeType: "image/svg+xml", dataURL: `data:image/svg+xml;base64,${typeof btoa === "function" ? btoa(unescape(encodeURIComponent(whole))) : Buffer.from(whole, "utf8").toString("base64")}`, created: 1 };
  } catch {
    return null;
  }
}

function blockEls(b: PlacedBlock, files: Record<string, BinaryFile>): ExEl[] {
  const meta: WbMeta = { step: b.step, key: b.key, role: "block" };
  const base = `b-${safeId(b.key)}`;
  const colour = stepColour(b.step);
  const { box } = b;
  if (b.kind === "formula") {
    const formula = texToText(b.tex);
    const size = Math.max(16, Math.min(28, Math.floor((box.w - 36) / Math.max(1, handWidth(formula, 1)))));
    return labelled(
      el(base, "rectangle", { x: box.x + 2, y: box.y + 2, w: box.w - 4, h: box.h - 4 }, meta, { strokeColor: colour, roundness: { type: 3 }, strokeWidth: 2 }),
      text(`${base}-t`, [formula], size, { cx: box.x + box.w / 2, cy: box.y + box.h / 2 }, { ...meta, role: "label" }, { fontFamily: FONT.excalifont, customData: { wb: { ...meta, role: "label" }, tex: b.tex } }),
    );
  }
  if (b.kind === "plot") return plotEls(b, meta, base);
  if (b.kind === "cells") return cellsEls(b, meta, base);
  if (b.kind === "sketch") {
    const file = sketchFile(drawingSvg(b.drawing), `f-${base}`);
    if (!file) return [];
    files[file.id] = file;
    return [el(base, "image", box, meta, { fileId: file.id, status: "saved", scale: [1, 1], crop: null, strokeColor: "transparent" })];
  }
  const size = Math.round(b.font * HAND_SCALE);
  if (b.kind === "card") {
    return labelled(
      el(base, "rectangle", { x: box.x + 2, y: box.y + 2, w: box.w - 4, h: box.h - 4 }, meta, { strokeColor: INK.faint, strokeStyle: "dashed", roundness: { type: 3 }, strokeWidth: 1.5 }),
      text(`${base}-t`, b.lines, size, { cx: box.x + box.w / 2, cy: box.y + box.h / 2 }, { ...meta, role: "label" }, { originalText: b.lines.join(" ") }),
    );
  }
  // a note: the number of its step in a filled badge (the skill's numbered badges; the voice says
  // the same number), then the text beside it
  const lineH = size * LINE_HEIGHT;
  const badge = { x: box.x, y: box.y + 11 + lineH / 2 - 14, w: 28, h: 28 };
  return [
    ...labelled(
      el(`${base}-dot`, "ellipse", badge, meta, { strokeColor: colour, backgroundColor: colour, roughness: 0 }),
      text(`${base}-dot-t`, [String(b.step + 1)], 15, { cx: badge.x + 14, cy: badge.y + 14 }, meta, { strokeColor: "#ffffff" }),
    ),
    text(`${base}-t`, b.lines, size, { x: box.x + 36, y: box.y + 11 }, meta),
  ];
}

/**
 * The board of `layout` as Excalidraw elements, in the order they are drawn: the board frame and
 * title, then step by step each new box with its label, the arrows of that step, its marks and what is
 * written beside the diagram. Every element carries `customData.wb` (its step and its timing key).
 */
/** The frame and the title of a board: drawn first, before the model has written anything. */
function head(w: number, h: number, title: { text: string; x: number; y: number; font: number }): ExEl[] {
  const size = Math.round(title.font);
  return [
    // An invisible frame the size of the board, so the picture keeps its size while it fills up.
    el("wb-frame", "rectangle", { x: 0, y: 0, w, h }, { step: -1, key: "frame", role: "frame" }, { strokeColor: "transparent", locked: true, roughness: 0 }),
    text("wb-title", [title.text], size, { x: title.x, y: title.y - size }, { step: -1, key: "title", role: "title" }),
    line("wb-rule", [{ x: title.x, y: 60 }, { x: w - title.x, y: 60 }], { step: -1, key: "title", role: "title" }, { strokeColor: INK.faint, strokeWidth: 1.5 }),
  ];
}

/**
 * The board while the model is still thinking: the learner's own question as its title, so the
 * first stroke is on the board at once (the lesson's title replaces it when the outline arrives).
 */
export function pendingScene(question: string, board: { w: number; h: number }): Scene {
  const margin = board.w < 700 ? 14 : 24;
  const font = board.w < 700 ? 22 : 28;
  let words = question.trim();
  while (words.length > 4 && handWidth(words, font) > board.w - margin * 2 - 8) words = `${Array.from(words).slice(0, -2).join("").trimEnd()}${String.fromCharCode(0x2026)}`;
  return { elements: head(board.w, board.h, { text: words, x: margin + 4, y: 46, font }), files: {} };
}

/**
 * The lesson as the board shows it: a step that draws nothing new to read (it only circles a box
 * or adds an arrow) gets its own sentence as a numbered note, so a worked example or a conclusion
 * the voice says ("12 V over 4 ohms gives 3 A") is also on the board, as a teacher would write it.
 * Only the model's own sentence is used, cut at a clause when it is long.
 */
export function boardLesson(lesson: Lesson): Lesson {
  return {
    ...lesson,
    steps: lesson.steps.map((s) => {
      if (s.card) return s;
      const writes = s.items.some((it) => it.kind === "node" || it.kind === "note" || it.kind === "formula" || it.kind === "plot" || it.kind === "cells" || it.kind === "sketch");
      if (writes) return s;
      return { ...s, items: [...s.items, { kind: "note" as const, text: shortSay(s.say) }] };
    }),
  };
}
function shortSay(say: string): string {
  if (Array.from(say).length <= LIMITS.note) return say;
  const cut = say.slice(0, LIMITS.note);
  const at = Math.max(cut.lastIndexOf(", "), cut.lastIndexOf("; "), cut.lastIndexOf(": "));
  return at > 40 ? cut.slice(0, at) : cleanText(say, LIMITS.note);
}

/** Hand-drawn strokes, or exact ones (`plain`: the Lite tier, which draws fast and simply). */
export type SceneOptions = { plain?: boolean };

/**
 * The diagram grown to use its part of the board: layout.ts sizes boxes for a crowded board, and a
 * board with four boxes would otherwise leave most of its room empty. Positions, boxes, arrows,
 * labels and type all scale together about the middle of the room (at most 1.45 times, type at most
 * 28), so nothing that fitted stops fitting and nothing reaches the notes column.
 */
export function fitDiagram(layout: BoardLayout): BoardLayout {
  if (!layout.nodes.length) return layout;
  const things: Box[] = [...layout.nodes.map((n) => n.box), ...layout.edges.flatMap((e) => [{ x: Math.min(e.x1, e.cx, e.x2), y: Math.min(e.y1, e.cy, e.y2), w: Math.abs(Math.max(e.x1, e.cx, e.x2) - Math.min(e.x1, e.cx, e.x2)), h: Math.abs(Math.max(e.y1, e.cy, e.y2) - Math.min(e.y1, e.cy, e.y2)) }, ...(e.label ? [e.label.box] : [])]), ...layout.marks.map((m) => ({ x: m.box.x - 18, y: m.box.y - 16, w: m.box.w + 36, h: m.box.h + 32 }))];
  const x0 = Math.min(...things.map((b) => b.x)), y0 = Math.min(...things.map((b) => b.y));
  const x1 = Math.max(...things.map((b) => b.x + b.w)), y1 = Math.max(...things.map((b) => b.y + b.h));
  const margin = layout.shape === "tall" ? 14 : 24;
  const notesLeft = layout.blocks.length && layout.shape === "wide" ? Math.min(...layout.blocks.map((b) => b.box.x)) - 28 : layout.w - margin;
  const notesTop = layout.blocks.length && layout.shape === "tall" ? Math.min(...layout.blocks.map((b) => b.box.y)) - 24 : layout.h - 20;
  const room = { x: margin, y: 76, w: notesLeft - margin, h: notesTop - 76 };
  const maxFont = Math.max(...layout.nodes.map((n) => n.font));
  const k = Math.min(1.45, room.w / Math.max(1, x1 - x0), room.h / Math.max(1, y1 - y0), 28 / maxFont);
  if (!(k > 1.04)) return layout;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const tx = room.x + room.w / 2, ty = room.y + room.h / 2;
  const px = (x: number) => tx + (x - cx) * k;
  const py = (y: number) => ty + (y - cy) * k;
  const box = (b: Box): Box => ({ x: px(b.x), y: py(b.y), w: b.w * k, h: b.h * k });
  return {
    ...layout,
    nodes: layout.nodes.map((n) => ({ ...n, box: box(n.box), font: n.font * k })),
    edges: layout.edges.map((e) => ({ ...e, x1: px(e.x1), y1: py(e.y1), cx: px(e.cx), cy: py(e.cy), x2: px(e.x2), y2: py(e.y2), label: e.label ? { ...e.label, box: box(e.label.box), font: e.label.font * Math.min(k, 1.25) } : null })),
    marks: layout.marks.map((m) => ({ ...m, box: box(m.box) })),
  };
}

export function sceneFromLayout(source: BoardLayout, opts: SceneOptions = {}): Scene {
  const layout = fitDiagram(source);
  const files: Record<string, BinaryFile> = {};
  const els: ExEl[] = head(layout.w, layout.h, layout.title);

  const shapes = new Map<string, ExEl>();
  const used = new Set<string>();
  const steps = [...new Set([...layout.nodes.map((n) => n.step), ...layout.edges.map((e) => e.step), ...layout.marks.map((m) => m.step), ...layout.blocks.map((b) => b.step)])].sort((a, b) => a - b);
  for (const step of steps) {
    // per node: its shape, its label, then the arrows that become possible (the skill's progressive order)
    const pending = layout.edges.filter((e) => e.step === step);
    const drawn = new Set(layout.nodes.filter((n) => n.step < step).map((n) => n.id));
    const flush = () => {
      for (let i = 0; i < pending.length; ) {
        const e = pending[i];
        if (drawn.has(e.from) && drawn.has(e.to)) {
          els.push(...edgeEls(e, used, shapes));
          pending.splice(i, 1);
        } else i++;
      }
    };
    for (const nd of layout.nodes.filter((n) => n.step === step)) {
      const [shape, label] = nodeEls(nd);
      shapes.set(shape.id, shape);
      els.push(shape, label);
      drawn.add(nd.id);
      flush();
    }
    flush();
    for (const e of pending) els.push(...edgeEls(e, used, shapes));
    for (const m of layout.marks.filter((x) => x.step === step)) els.push(...markEls(m, stepColour(step)));
    for (const b of layout.blocks.filter((x) => x.step === step)) els.push(...blockEls(b, files));
  }
  // older steps' nodes keep their shape objects: arrows bound later are listed on them too
  if (opts.plain) for (const e of els) e.roughness = 0;
  return { elements: els, files };
}

/** The step an element belongs to (-1: the frame and title, drawn with the first step). */
export const stepOf = (e: ExEl) => (typeof e.customData?.wb?.step === "number" ? e.customData.wb.step : 0);
export const keyOf = (e: ExEl) => (typeof e.customData?.wb?.key === "string" ? e.customData.wb.key : e.id);

/** The bounds of a set of elements (arrows and lines by their points). */
export function boundsOf(els: ExEl[]): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of els) {
    if (e.isDeleted) continue;
    const pts = Array.isArray(e.points) && e.points.length ? e.points.map(([px, py]) => [e.x + px, e.y + py]) : [[e.x, e.y], [e.x + e.width, e.y + e.height]];
    for (const [px, py] of pts) {
      x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
    }
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
