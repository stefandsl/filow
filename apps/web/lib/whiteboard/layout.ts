// Where everything goes on the board. The model never gives coordinates: this file places the
// nodes by the lesson's scene (flow, cycle, stack), routes the arrows around them, stacks formulas,
// notes and plots beside the diagram, and reports anything that overlaps or leaves the board.
// Pure and deterministic: the same lesson up to the same step always gives the same board, so
// going back, replaying and exporting all show the same picture.
import type { BuddyDrawing } from "@/lib/buddy/visuals";
import type { Lesson, MarkStyle } from "./lesson";

export type BoardShape = "wide" | "tall";
export const BOARD_SIZE: Record<BoardShape, { w: number; h: number }> = { wide: { w: 1200, h: 720 }, tall: { w: 480, h: 800 } };

export type Box = { x: number; y: number; w: number; h: number };
export type PlacedNode = { id: string; step: number; box: Box; lines: string[]; font: number; text: string };
export type PlacedEdge = {
  key: string;
  step: number;
  from: string;
  to: string;
  /** A quadratic curve from the edge of one node to the edge of the other. */
  x1: number; y1: number; cx: number; cy: number; x2: number; y2: number;
  label: { text: string; box: Box; font: number } | null;
};
export type PlacedMark = { key: string; step: number; style: MarkStyle; target: string; box: Box };
export type PlacedBlock = { key: string; step: number; box: Box } & (
  | { kind: "formula"; tex: string }
  | { kind: "note" | "card"; lines: string[]; font: number }
  | { kind: "plot"; expr: string; xmin: number; xmax: number; text: string }
  | { kind: "sketch"; drawing: BuddyDrawing }
);
export type BoardLayout = {
  shape: BoardShape;
  w: number;
  h: number;
  title: { text: string; x: number; y: number; font: number };
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  marks: PlacedMark[];
  blocks: PlacedBlock[];
  /** Older notes taken off to make room (a teacher wiping part of the board). */
  wiped: number;
};

const ELLIPSIS = String.fromCharCode(0x2026);

// ---- text measuring without a browser: an estimate on the safe (wide) side ----
const isWideChar = (c: number) => (c >= 0x1100 && c <= 0x11ff) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7af) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xffe6) || c >= 0x1f000;
function charWidth(ch: string): number {
  const c = ch.codePointAt(0) ?? 0;
  if (isWideChar(c)) return 1.02;
  if (ch === " ") return 0.3;
  if ("iljtfI.,:;'|!()[]".includes(ch)) return 0.36;
  if ("mwMW@%".includes(ch)) return 0.92;
  if (c >= 0x400 && c <= 0x4ff) return ch === ch.toUpperCase() ? 0.74 : 0.62; // Cyrillic
  if (ch >= "A" && ch <= "Z") return 0.72;
  if (ch >= "0" && ch <= "9") return 0.6;
  return 0.58;
}
export const textWidth = (text: string, font: number) => Array.from(text).reduce((w, ch) => w + charWidth(ch), 0) * font;

/** Breaks a label into lines no wider than `max`; the last line ends with an ellipsis when cut. */
export function wrapText(text: string, max: number, font: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";
  // Words for scripts with spaces; a script without them (Japanese) breaks between any two characters.
  const pieces = text.split(/(\s+)/).flatMap((p) => (Array.from(p).some((ch) => isWideChar(ch.codePointAt(0) ?? 0)) ? Array.from(p) : [p]));
  const push = () => { if (line.trim()) lines.push(line.trim()); line = ""; };
  for (const piece of pieces) {
    if (!piece) continue;
    if (textWidth((line + piece).trim(), font) <= max) { line += piece; continue; }
    push();
    if (textWidth(piece.trim(), font) <= max) { line = piece.trimStart(); continue; }
    // one word longer than the line: break it by characters
    for (const ch of Array.from(piece.trim())) {
      if (textWidth(line + ch, font) > max) push();
      line += ch;
    }
  }
  push();
  if (lines.length <= maxLines) return lines.length ? lines : [""];
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last && textWidth(last + ELLIPSIS, font) > max) last = Array.from(last).slice(0, -1).join("");
  kept[maxLines - 1] = last.trimEnd() + ELLIPSIS;
  return kept;
}

const overlap = (a: Box, b: Box, gap = 0) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
const inside = (b: Box, outer: Box) => b.x >= outer.x - 0.5 && b.y >= outer.y - 0.5 && b.x + b.w <= outer.x + outer.w + 0.5 && b.y + b.h <= outer.y + outer.h + 0.5;
const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** Where the ray from the centre of `b` towards (tx, ty) leaves the box grown by `pad`. */
function exitPoint(b: Box, tx: number, ty: number, pad: number) {
  const c = centre(b);
  const dx = tx - c.x;
  const dy = ty - c.y;
  if (!dx && !dy) return c;
  const sx = dx ? (b.w / 2 + pad) / Math.abs(dx) : Infinity;
  const sy = dy ? (b.h / 2 + pad) / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: c.x + dx * s, y: c.y + dy * s };
}
const curveAt = (e: Pick<PlacedEdge, "x1" | "y1" | "cx" | "cy" | "x2" | "y2">, t: number) => ({
  x: (1 - t) * (1 - t) * e.x1 + 2 * (1 - t) * t * e.cx + t * t * e.x2,
  y: (1 - t) * (1 - t) * e.y1 + 2 * (1 - t) * t * e.cy + t * t * e.y2,
});

type NodeIn = { id: string; text: string; step: number };

/** Nodes in a grid whose cells never touch: by rows that snake (flow) or by columns (stack). */
function gridNodes(nodes: NodeIn[], area: Box, scene: "flow" | "stack", shape: BoardShape): PlacedNode[] {
  const n = nodes.length;
  let cols: number;
  let rows: number;
  if (scene === "flow") {
    // A phone-shaped board reads top to bottom: one column while it fits, then two.
    const maxCols = shape === "tall" ? (n <= 4 ? 1 : 2) : area.w >= 900 ? 4 : 3;
    cols = Math.min(n, maxCols);
    rows = Math.ceil(n / cols);
  } else {
    cols = n > 5 ? 2 : 1;
    rows = Math.ceil(n / cols);
  }
  const cellW = Math.min(area.w / cols, scene === "stack" ? 460 : 330);
  const cellH = Math.min(area.h / rows, scene === "stack" ? 132 : 190);
  const gapX = scene === "stack" ? 96 : Math.min(120, Math.max(72, cellW * 0.34));
  const gapY = Math.max(40, Math.min(64, cellH * 0.38));
  const w = cellW - gapX;
  const maxH = cellH - gapY;
  // One type size for the whole diagram: the largest at which every label fits its box.
  let font = 24;
  let lineCount = 1;
  for (const f of [24, 22, 20, 18, 16, 15]) {
    font = f;
    const fits = Math.max(1, Math.floor((maxH - 20) / (f * 1.22)));
    lineCount = Math.max(...nodes.map((nd) => wrapText(nd.text, w - 24, f, 99).length));
    if (lineCount <= fits) break;
    lineCount = fits;
  }
  const h = Math.min(maxH, Math.max(52, lineCount * font * 1.22 + 24));
  const gridW = cols * cellW;
  const gridH = rows * cellH;
  const x0 = area.x + (area.w - gridW) / 2;
  const y0 = area.y + (area.h - gridH) / 2;
  return nodes.map((nd, i) => {
    let col: number;
    let row: number;
    if (scene === "flow") {
      row = Math.floor(i / cols);
      const k = i % cols;
      // Rows alternate direction, so each node sits next to the one before it. A short last row
      // is pushed to the side its row starts from.
      col = row % 2 === 0 ? k : cols - 1 - k;
    } else {
      col = Math.floor(i / rows);
      row = i % rows;
    }
    const box = { x: x0 + col * cellW + (cellW - w) / 2, y: y0 + row * cellH + (cellH - h) / 2, w, h };
    return { id: nd.id, step: nd.step, text: nd.text, box, font, lines: wrapText(nd.text, w - 24, font, lineCount) };
  });
}

/** Nodes around an ellipse, the first at the top, clockwise. Null when they would touch. */
function cycleNodes(nodes: NodeIn[], area: Box): PlacedNode[] | null {
  const n = nodes.length;
  for (const font of [22, 20, 18, 16, 15]) {
    const w = Math.min(210, area.w * (n > 6 ? 0.2 : 0.26));
    const lineCount = Math.min(3, Math.max(...nodes.map((nd) => wrapText(nd.text, w - 24, font, 99).length)));
    const h = lineCount * font * 1.22 + 24;
    const rx = area.w / 2 - w / 2 - 4;
    const ry = area.h / 2 - h / 2 - 4;
    if (rx < 40 || ry < 40) continue;
    const placed = nodes.map((nd, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
      const c = { x: area.x + area.w / 2 + rx * Math.cos(a), y: area.y + area.h / 2 + ry * Math.sin(a) };
      return { id: nd.id, step: nd.step, text: nd.text, font, box: { x: c.x - w / 2, y: c.y - h / 2, w, h }, lines: wrapText(nd.text, w - 24, font, lineCount) };
    });
    if (placed.every((a, i) => placed.every((b, j) => j <= i || !overlap(a.box, b.box, 28)))) return placed;
  }
  return null;
}

function placeEdges(edges: Array<{ from: string; to: string; text: string; step: number }>, nodes: PlacedNode[], board: Box): PlacedEdge[] {
  const byId = new Map(nodes.map((nd) => [nd.id, nd]));
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const perPair = new Map<string, number>();
  for (const e of edges) perPair.set(pairKey(e.from, e.to), (perPair.get(pairKey(e.from, e.to)) ?? 0) + 1);
  const seen = new Map<string, number>();
  const labels: Box[] = [];
  const out: PlacedEdge[] = [];
  edges.forEach((e, index) => {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) return;
    const key = pairKey(e.from, e.to);
    const k = seen.get(key) ?? 0;
    seen.set(key, k + 1);
    const m = perPair.get(key) ?? 1;
    // The pair's own direction, so two arrows that go opposite ways bend to opposite sides.
    const [p, q] = e.from < e.to ? [centre(a.box), centre(b.box)] : [centre(b.box), centre(a.box)];
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const nx = -(q.y - p.y) / len;
    const ny = (q.x - p.x) / len;
    const spread = (k - (m - 1) / 2) * 62;
    const others = nodes.filter((nd) => nd.id !== e.from && nd.id !== e.to);
    const build = (bend: number) => {
      const mid = { x: (p.x + q.x) / 2 + nx * (spread + bend), y: (p.y + q.y) / 2 + ny * (spread + bend) };
      const s = exitPoint(a.box, mid.x, mid.y, 4);
      const t = exitPoint(b.box, mid.x, mid.y, 12);
      // The control point that makes the curve pass through `mid` at its half.
      return { x1: s.x, y1: s.y, x2: t.x, y2: t.y, cx: 2 * mid.x - (s.x + t.x) / 2, cy: 2 * mid.y - (s.y + t.y) / 2 };
    };
    const crosses = (c: ReturnType<typeof build>) => {
      for (let i = 1; i < 16; i++) {
        const pt = curveAt(c, i / 16);
        if (pt.x < board.x || pt.y < board.y || pt.x > board.x + board.w || pt.y > board.y + board.h) return true;
        if (others.some((nd) => overlap(nd.box, { x: pt.x, y: pt.y, w: 0, h: 0 }, 8))) return true;
      }
      return false;
    };
    // Try the straight arrow first, then arcs to either side: the first one that passes through no
    // other node and has a free place for its label wins (a label wider than the gap between two
    // neighbours rides an arc into the space between the rows).
    // How far a node reaches across the arrow's path: an arc must clear that much.
    const reach = (Math.abs(nx) * Math.max(a.box.w, b.box.w)) / 2 + (Math.abs(ny) * Math.max(a.box.h, b.box.h)) / 2;
    const font = 17;
    const lw = textWidth(e.text, font) + 12;
    const lh = font + 10;
    let best: { curve: ReturnType<typeof build>; box: Box | null; cost: number } | null = null;
    for (const bend of [0, reach + 22, -(reach + 22), reach + 38, -(reach + 38), reach * 2.4 + 40, -(reach * 2.4 + 40)]) {
      const curve = build(bend);
      let cost = crosses(curve) ? 10 : 0;
      let box: Box | null = null;
      if (e.text) {
        let hits = Infinity;
        for (const t of [0.5, 0.38, 0.62, 0.28, 0.72, 0.18, 0.82, 0.11, 0.89]) {
          const pt = curveAt(curve, t);
          // kept on the board: a label near the border slides inwards instead of being cut
          const candidate = { x: Math.min(Math.max(pt.x - lw / 2, board.x), Math.max(board.x, board.x + board.w - lw)), y: Math.min(Math.max(pt.y - lh / 2, board.y), board.y + board.h - lh), w: Math.min(lw, board.w), h: lh };
          const n =nodes.filter((nd) => overlap(nd.box, candidate, 1)).length + labels.filter((l) => overlap(l, candidate, 1)).length;
          if (n < hits) { hits = n; box = candidate; }
          if (!n) break;
        }
        cost += hits;
      }
      if (!best || cost < best.cost) best = { curve, box, cost };
      if (!cost) break;
    }
    if (!best) return;
    if (best.box) labels.push(best.box);
    out.push({ key: `e${index}`, step: e.step, from: e.from, to: e.to, ...best.curve, label: best.box ? { text: e.text, box: best.box, font } : null });
  });
  return out;
}

const TALL_FORMULA = /\\(?:d?frac|sum|int|prod|sqrt|binom|begin|lim)/;

/**
 * The board for the first `upto + 1` steps of the lesson. Each call lays out only what is shown,
 * so a step that arrives later never has to be known in advance.
 */
export function layoutBoard(lesson: Lesson, upto: number, shape: BoardShape): BoardLayout {
  const { w, h } = BOARD_SIZE[shape];
  const titleFont = shape === "tall" ? 24 : 30;
  const margin = shape === "tall" ? 14 : 24;
  const title = { text: wrapText(lesson.title, w - margin * 2 - 8, titleFont, 1)[0], x: margin + 4, y: 46, font: titleFont };
  const content: Box = { x: margin, y: 72, w: w - margin * 2, h: h - 72 - 20 };

  const nodesIn: NodeIn[] = [];
  const edgesIn: Array<{ from: string; to: string; text: string; step: number }> = [];
  const marksIn: Array<{ target: string; style: MarkStyle; step: number }> = [];
  type BlockIn = { key: string; step: number } & ({ kind: "formula"; tex: string } | { kind: "note" | "card"; text: string } | { kind: "plot"; expr: string; xmin: number; xmax: number; text: string } | { kind: "sketch"; drawing: BuddyDrawing });
  const blocksIn: BlockIn[] = [];
  lesson.steps.slice(0, upto + 1).forEach((s, step) => {
    if (s.card) blocksIn.push({ key: `c${step}`, step, kind: "card", text: s.say });
    s.items.forEach((it, i) => {
      const key = `b${step}_${i}`;
      if (it.kind === "node") { if (!nodesIn.some((nd) => nd.id === it.id)) nodesIn.push({ id: it.id, text: it.text, step }); }
      else if (it.kind === "edge") edgesIn.push({ from: it.from, to: it.to, text: it.text, step });
      else if (it.kind === "mark") marksIn.push({ target: it.target, style: it.style, step });
      else if (it.kind === "formula") blocksIn.push({ key, step, kind: "formula", tex: it.tex });
      else if (it.kind === "note") blocksIn.push({ key, step, kind: "note", text: it.text });
      else if (it.kind === "plot") blocksIn.push({ key, step, kind: "plot", expr: it.expr, xmin: it.xmin, xmax: it.xmax, text: it.text });
      else if (it.kind === "sketch") blocksIn.push({ key, step, kind: "sketch", drawing: it.drawing });
    });
  });

  // The diagram and the notes share the board; whichever is absent gives its room to the other.
  let diagram: Box = content;
  let notes: Box = content;
  if (nodesIn.length && blocksIn.length) {
    if (shape === "wide") {
      const nw = Math.round(content.w * 0.36);
      diagram = { ...content, w: content.w - nw - 24 };
      notes = { x: content.x + content.w - nw, y: content.y, w: nw, h: content.h };
    } else {
      const nh = Math.round(content.h * 0.4);
      diagram = { ...content, h: content.h - nh - 20 };
      notes = { x: content.x, y: content.y + content.h - nh, w: content.w, h: nh };
    }
  } else if (blocksIn.length) {
    const nw = Math.min(content.w, 780);
    notes = { x: content.x + (content.w - nw) / 2, y: content.y, w: nw, h: content.h };
  }

  let nodes: PlacedNode[] = [];
  if (nodesIn.length) {
    const scene = lesson.scene === "cycle" && nodesIn.length < 3 ? "flow" : lesson.scene;
    nodes = (scene === "cycle" ? cycleNodes(nodesIn, diagram) : null) ?? gridNodes(nodesIn, diagram, scene === "stack" ? "stack" : "flow", shape);
  }
  const edges = placeEdges(edgesIn, nodes, content);
  const marks: PlacedMark[] = [];
  marksIn.forEach((mk, i) => {
    const nd = nodes.find((x) => x.id === mk.target);
    // one mark per node and style: saying it twice does not draw it twice
    if (nd && !marks.some((x) => x.target === mk.target && x.style === mk.style)) marks.push({ key: `m${i}`, step: mk.step, style: mk.style, target: mk.target, box: nd.box });
  });

  // Notes stack from the top; when they no longer fit, the oldest are wiped.
  const gap = 14;
  const sized = blocksIn.map((b): PlacedBlock => {
    const base = { key: b.key, step: b.step };
    if (b.kind === "formula") return { ...base, kind: "formula", tex: b.tex, box: { x: notes.x, y: 0, w: notes.w, h: TALL_FORMULA.test(b.tex) ? 92 : 62 } };
    if (b.kind === "plot") {
      const pw = Math.min(notes.w, 400);
      return { ...base, kind: "plot", expr: b.expr, xmin: b.xmin, xmax: b.xmax, text: b.text, box: { x: notes.x + (notes.w - pw) / 2, y: 0, w: pw, h: Math.min(250, Math.max(170, notes.h * 0.42)) } };
    }
    if (b.kind === "sketch") {
      const sw = Math.min(notes.w, 380, (notes.h * 0.6 * 4) / 3);
      return { ...base, kind: "sketch", drawing: b.drawing, box: { x: notes.x + (notes.w - sw) / 2, y: 0, w: sw, h: sw * 0.75 } };
    }
    const font = 21;
    const lines = wrapText(b.text, notes.w - 36, font, b.kind === "card" ? 6 : 4);
    return { ...base, kind: b.kind, lines, font, box: { x: notes.x, y: 0, w: notes.w, h: lines.length * font * 1.3 + 22 } };
  });
  let wiped = 0;
  const total = () => sized.slice(wiped).reduce((sum, b) => sum + b.box.h, 0) + gap * Math.max(0, sized.length - wiped - 1);
  while (sized.length - wiped > 1 && total() > notes.h) wiped++;
  const blocks = sized.slice(wiped);
  // A single block taller than the room it has is cut to it (a long card on a small board).
  let y = notes.y + (nodesIn.length ? 0 : Math.max(0, (notes.h - total()) / 3));
  for (const b of blocks) {
    b.box.h = Math.min(b.box.h, notes.y + notes.h - y);
    b.box.y = y;
    y += b.box.h + gap;
  }

  return { shape, w, h, title, nodes, edges, marks, blocks, wiped };
}

/**
 * What is wrong with a board, in words: boxes that overlap, anything off the board, labels cut.
 * An empty list is the "nothing overlapping or off the board, labels readable" of the lesson score.
 */
export function layoutProblems(l: BoardLayout): string[] {
  const problems: string[] = [];
  const board: Box = { x: 0, y: 0, w: l.w, h: l.h };
  const things: Array<{ name: string; box: Box }> = [
    ...l.nodes.map((nd) => ({ name: `node ${nd.id}`, box: nd.box })),
    ...l.edges.flatMap((e) => (e.label ? [{ name: `label "${e.label.text}"`, box: e.label.box }] : [])),
    ...l.blocks.map((b) => ({ name: `${b.kind} ${b.key}`, box: b.box })),
  ];
  for (const t of things) {
    if (!inside(t.box, board)) problems.push(`${t.name} is off the board`);
    if (t.box.w < 8 || t.box.h < 8) problems.push(`${t.name} has no room`);
  }
  for (let i = 0; i < things.length; i++) for (let j = i + 1; j < things.length; j++) if (overlap(things[i].box, things[j].box)) problems.push(`${things[i].name} overlaps ${things[j].name}`);
  for (const nd of l.nodes) {
    if (nd.font < 15) problems.push(`node ${nd.id} is set too small to read`);
    if (nd.lines.some((ln) => textWidth(ln, nd.font) > nd.box.w - 8)) problems.push(`node ${nd.id} text is wider than its box`);
    if (nd.lines.length * nd.font * 1.22 > nd.box.h) problems.push(`node ${nd.id} text is taller than its box`);
    if (nd.lines.join(" ").endsWith(ELLIPSIS) && !nd.text.endsWith(ELLIPSIS)) problems.push(`node ${nd.id} label is cut`);
  }
  for (const e of l.edges) {
    for (let i = 1; i < 16; i++) {
      const pt = curveAt(e, i / 16);
      const hit = l.nodes.find((nd) => nd.id !== e.from && nd.id !== e.to && overlap(nd.box, { x: pt.x, y: pt.y, w: 0, h: 0 }));
      if (hit) { problems.push(`arrow ${e.from} -> ${e.to} runs through node ${hit.id}`); break; }
    }
  }
  return problems;
}

/** The point and direction of an arrow's head, for the renderer. */
export function arrowHead(e: PlacedEdge): { x: number; y: number; angle: number } {
  return { x: e.x2, y: e.y2, angle: Math.atan2(e.y2 - e.cy, e.x2 - e.cx) };
}
