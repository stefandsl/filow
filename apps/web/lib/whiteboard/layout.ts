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
  label: { lines: string[]; box: Box; font: number } | null;
};
export type PlacedMark = { key: string; step: number; style: MarkStyle; target: string; box: Box };
export type PlacedBlock = { key: string; step: number; box: Box } & (
  | { kind: "formula"; tex: string }
  | { kind: "note" | "card"; lines: string[]; font: number; cut: boolean }
  | { kind: "plot"; expr: string; xmin: number; xmax: number; text: string }
  | { kind: "sketch"; drawing: BuddyDrawing }
  | { kind: "cells"; values: string[]; pointer: number }
);
export type BoardLayout = {
  shape: BoardShape;
  w: number;
  h: number;
  title: { text: string; x: number; y: number; font: number; cut: boolean };
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  marks: PlacedMark[];
  blocks: PlacedBlock[];
  /** Older notes taken off to make room (a teacher wiping part of the board). */
  wiped: number;
};

const ELLIPSIS = String.fromCharCode(0x2026);
const LABEL_FONT = 16;
const LABEL_LINE = LABEL_FONT * 1.2;

// ---- text measuring without a browser: an estimate on the safe (wide) side ----
const isWideChar = (c: number) => (c >= 0x1100 && c <= 0x11ff) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7af) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xffe6) || c >= 0x1f000;
function charWidth(ch: string): number {
  const c = ch.codePointAt(0) ?? 0;
  if (isWideChar(c)) return 1.02;
  if (ch === " ") return 0.3;
  if ("iljtfI.,:;'|!()[]".includes(ch)) return 0.36;
  if ("mwMW@%".includes(ch)) return 0.92;
  // dashes and arrows are as wide as a capital M, and so are the widest Cyrillic capitals
  if ((c >= 0x2012 && c <= 0x2015) || (c >= 0x2190 && c <= 0x21ff) || (c >= 0x27f0 && c <= 0x27ff)) return 1.02;
  if ([0x416, 0x428, 0x429, 0x42e, 0x41c, 0x42b, 0x424].includes(c)) return 0.96;
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
type Curve = Pick<PlacedEdge, "x1" | "y1" | "cx" | "cy" | "x2" | "y2">;
const curveAt = (e: Curve, t: number) => ({
  x: (1 - t) * (1 - t) * e.x1 + 2 * (1 - t) * t * e.cx + t * t * e.x2,
  y: (1 - t) * (1 - t) * e.y1 + 2 * (1 - t) * t * e.cy + t * t * e.y2,
});

type NodeIn = { id: string; text: string; step: number };
type EdgeIn = { from: string; to: string; text: string; step: number };
/**
 * Placed nodes, plus what the arrows need to know: the direction the diagram reads in ("x": arrows
 * leave a box by its side, "y": by its top or bottom, null: straight from centre to centre) and how
 * wide a label may be before it is broken in two lines.
 */
type Arrangement = { nodes: PlacedNode[]; axis: "x" | "y" | null; labelMax: number };

/** One type size for the whole diagram: the largest at which every label fits a box of w x maxH. */
function fitLabels(nodes: NodeIn[], w: number, maxH: number, sizes: number[]) {
  const lines = (f: number) => Math.max(...nodes.map((nd) => wrapText(nd.text, w - 24, f, 99).length));
  const room = (f: number) => Math.max(1, Math.floor((maxH - 20) / (f * 1.22)));
  // no word broken in the middle ("Chlorophyl / l") when a smaller size keeps it whole
  const whole = (f: number) => nodes.every((nd) => nd.text.split(/\s+/).every((word) => Array.from(word).some((ch) => isWideChar(ch.codePointAt(0) ?? 0)) || textWidth(word, f) <= w - 24));
  const pick = sizes.find((f) => lines(f) <= room(f) && whole(f)) ?? sizes.find((f) => lines(f) <= room(f));
  const font = pick ?? sizes[sizes.length - 1];
  const lineCount = pick ? lines(pick) : room(font);
  return { font, lineCount, h: Math.min(maxH, Math.max(52, lineCount * font * 1.22 + 24)) };
}

/** Nodes in a grid whose cells never touch: by rows that snake (flow) or by columns (stack). */
function gridNodes(nodes: NodeIn[], area: Box, scene: "flow" | "stack", shape: BoardShape): Arrangement {
  const n = nodes.length;
  let cols: number;
  let rows: number;
  if (scene === "flow") {
    // A phone-shaped board reads top to bottom: one column while it fits, then two.
    const maxCols = shape === "tall" ? (n <= 6 ? 1 : 2) : area.w >= 900 ? 4 : 3;
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
  const { font, lineCount, h } = fitLabels(nodes, w, cellH - gapY, [24, 22, 20, 18, 16, 15]);
  const x0 = area.x + (area.w - cols * cellW) / 2;
  const y0 = area.y + (area.h - rows * cellH) / 2;
  const placed = nodes.map((nd, i) => {
    let col: number;
    let row: number;
    if (scene === "flow") {
      row = Math.floor(i / cols);
      const k = i % cols;
      // Rows alternate direction, so each node sits next to the one before it.
      col = row % 2 === 0 ? k : cols - 1 - k;
    } else {
      col = Math.floor(i / rows);
      row = i % rows;
    }
    const box = { x: x0 + col * cellW + (cellW - w) / 2, y: y0 + row * cellH + (cellH - h) / 2, w, h };
    return { id: nd.id, step: nd.step, text: nd.text, box, font, lines: wrapText(nd.text, w - 24, font, lineCount) };
  });
  const oneColumn = cols === 1;
  return { nodes: placed, axis: oneColumn || scene === "stack" ? "y" : null, labelMax: oneColumn ? 200 : gapX - 10 };
}

/** Nodes around an ellipse, the first at the top, clockwise. Null when they would touch. */
function cycleNodes(nodes: NodeIn[], area: Box): Arrangement | null {
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
    if (placed.every((a, i) => placed.every((b, j) => j <= i || !overlap(a.box, b.box, 28)))) return { nodes: placed, axis: null, labelMax: Math.min(170, area.w * 0.3) };
  }
  return null;
}

/**
 * The layer of each node when the arrows are followed: sources first, what they feed next. An arrow
 * that closes a loop is left out of the count. Null when the arrows give no order worth showing.
 */
function layering(nodes: NodeIn[], edges: EdgeIn[]): number[] | null {
  const index = new Map(nodes.map((nd, i) => [nd.id, i]));
  const next: number[][] = nodes.map(() => []);
  for (const e of edges) {
    const a = index.get(e.from);
    const b = index.get(e.to);
    if (a !== undefined && b !== undefined && a !== b && !next[a].includes(b)) next[a].push(b);
  }
  const state = nodes.map(() => 0);
  const forward: number[][] = nodes.map(() => []);
  const visit = (u: number) => {
    state[u] = 1;
    for (const v of next[u]) {
      if (state[v] === 1) continue; // closes a loop
      forward[u].push(v);
      if (state[v] === 0) visit(v);
    }
    state[u] = 2;
  };
  nodes.forEach((_, i) => { if (state[i] === 0) visit(i); });
  const layer = nodes.map(() => 0);
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    forward.forEach((targets, u) => targets.forEach((v) => { if (layer[v] < layer[u] + 1) { layer[v] = layer[u] + 1; changed = true; } }));
    if (!changed) break;
  }
  return Math.max(...layer) > 0 ? layer : null;
}

/**
 * A flow drawn by its arrows: layers left to right on a wide board, top to bottom on a tall one,
 * so an arrow between neighbouring layers crosses only the empty band between them. Null when the
 * lesson does not fit that shape (too many layers, or too many nodes in one).
 */
function layeredNodes(nodes: NodeIn[], edges: EdgeIn[], area: Box, shape: BoardShape): Arrangement | null {
  const layer = layering(nodes, edges);
  if (!layer) return null;
  const count = Math.max(...layer) + 1;
  const groups: number[][] = Array.from({ length: count }, () => []);
  layer.forEach((l, i) => groups[l].push(i));
  const widest = Math.max(...groups.map((g) => g.length));
  const wide = shape === "wide";
  if (wide ? count > (area.w >= 900 ? 5 : 4) || widest > 5 : count > Math.floor(area.h / 96) || widest > 2) return null;
  // Order each layer by where its nodes' sources sit in the layer before, so arrows cross less.
  const slot = nodes.map(() => 0);
  const index = new Map(nodes.map((nd, i) => [nd.id, i]));
  groups.forEach((g, l) => {
    if (l > 0) {
      const weight = (i: number) => {
        const from = edges.flatMap((e) => (index.get(e.to) === i && layer[index.get(e.from) ?? -1] === l - 1 ? [slot[index.get(e.from)!]] : []));
        return from.length ? from.reduce((a, b) => a + b, 0) / from.length : g.indexOf(i);
      };
      const weights = new Map(g.map((i) => [i, weight(i)]));
      g.sort((a, b) => weights.get(a)! - weights.get(b)! || a - b);
    }
    g.forEach((i, k) => { slot[i] = k - (g.length - 1) / 2; });
  });
  // along: the direction the layers follow; across: the direction nodes of one layer are spread in
  const alongSize = wide ? area.w : area.h;
  const acrossSize = wide ? area.h : area.w;
  const pitchAlong = Math.min(alongSize / count, wide ? 340 : 150);
  const pitchAcross = Math.min(acrossSize / widest, wide ? 150 : 230);
  const gapAlong = wide ? Math.max(104, pitchAlong * 0.4) : Math.max(48, pitchAlong * 0.4);
  const gapAcross = wide ? Math.max(36, pitchAcross * 0.3) : 44;
  const w = wide ? pitchAlong - gapAlong : pitchAcross - gapAcross;
  const maxH = wide ? pitchAcross - gapAcross : pitchAlong - gapAlong;
  const { font, lineCount, h } = fitLabels(nodes, w, maxH, [24, 22, 20, 18, 16, 15]);
  const mid = centre(area);
  const placed = nodes.map((nd, i) => {
    const along = (layer[i] - (count - 1) / 2) * pitchAlong;
    const across = slot[i] * pitchAcross;
    const c = wide ? { x: mid.x + along, y: mid.y + across } : { x: mid.x + across, y: mid.y + along };
    return { id: nd.id, step: nd.step, text: nd.text, font, box: { x: c.x - w / 2, y: c.y - h / 2, w, h }, lines: wrapText(nd.text, w - 24, font, lineCount) };
  });
  return { nodes: placed, axis: wide ? "x" : "y", labelMax: wide ? gapAlong - 12 : 180 };
}

function placeEdges(edges: EdgeIn[], arr: Arrangement, board: Box): PlacedEdge[] {
  const { nodes, axis } = arr;
  const byId = new Map(nodes.map((nd) => [nd.id, nd]));
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const perPair = new Map<string, number>();
  for (const e of edges) perPair.set(pairKey(e.from, e.to), (perPair.get(pairKey(e.from, e.to)) ?? 0) + 1);
  const seen = new Map<string, number>();
  const labels: Box[] = [];
  const out: PlacedEdge[] = [];
  /** How many arrows already drawn pass through `box`: a label is not put on top of a line. */
  const linesThrough = (box: Box) => out.filter((o) => Array.from({ length: 19 }, (_, i) => curveAt(o, (i + 1) / 20)).some((pt) => overlap(box, { x: pt.x, y: pt.y, w: 0, h: 0 }, 2))).length;
  edges.forEach((e, index) => {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) return;
    if (a === b) {
      // An arrow from a box to itself ("calls itself"): a small loop over the box (under it when there is no room above).
      const c = centre(a.box);
      const up = a.box.y - 70 >= board.y;
      const edgeY = up ? a.box.y : a.box.y + a.box.h;
      const dir = up ? -1 : 1;
      const lines = wrapText(e.text, Math.max(arr.labelMax, 120), LABEL_FONT, 2);
      const lw = Math.max(0, ...lines.map((ln) => textWidth(ln, LABEL_FONT))) + 12;
      const lh = lines.length * LABEL_LINE + 8;
      const box = { x: Math.min(Math.max(c.x - lw / 2, board.x), Math.max(board.x, board.x + board.w - lw)), y: up ? edgeY - 44 - lh : edgeY + 44, w: Math.min(lw, board.w), h: lh };
      labels.push(box);
      out.push({ key: `e${index}`, step: e.step, from: e.from, to: e.to, x1: c.x + a.box.w * 0.22, y1: edgeY + dir * 4, cx: c.x, cy: edgeY + dir * 78, x2: c.x - a.box.w * 0.22, y2: edgeY + dir * 12, label: { lines, box, font: LABEL_FONT } });
      return;
    }
    const key = pairKey(e.from, e.to);
    const k = seen.get(key) ?? 0;
    seen.set(key, k + 1);
    const m = perPair.get(key) ?? 1;
    const ca = centre(a.box);
    const cb = centre(b.box);
    // The pair's own direction, so two arrows that go opposite ways bend to opposite sides.
    const [p, q] = e.from < e.to ? [ca, cb] : [cb, ca];
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const nx = -(q.y - p.y) / len;
    const ny = (q.x - p.x) / len;
    const spread = (k - (m - 1) / 2) * 62;
    const others = nodes.filter((nd) => nd.id !== e.from && nd.id !== e.to);
    // Side ports when the two boxes are apart along the diagram's reading direction.
    const sideways = axis === "x" && (a.box.x + a.box.w < b.box.x || b.box.x + b.box.w < a.box.x);
    const upright = axis === "y" && (a.box.y + a.box.h < b.box.y || b.box.y + b.box.h < a.box.y);
    const build = (bend: number): Curve => {
      const mid = { x: (p.x + q.x) / 2 + nx * (spread + bend), y: (p.y + q.y) / 2 + ny * (spread + bend) };
      let s: { x: number; y: number };
      let t: { x: number; y: number };
      if (sideways) {
        const right = cb.x > ca.x;
        const slide = (box: Box) => Math.max(-box.h / 2 + 8, Math.min(box.h / 2 - 8, (mid.y - (ca.y + cb.y) / 2) * 0.5));
        s = { x: right ? a.box.x + a.box.w + 4 : a.box.x - 4, y: ca.y + slide(a.box) };
        t = { x: right ? b.box.x - 12 : b.box.x + b.box.w + 12, y: cb.y + slide(b.box) };
      } else if (upright) {
        const down = cb.y > ca.y;
        const slide = (box: Box) => Math.max(-box.w / 2 + 10, Math.min(box.w / 2 - 10, (mid.x - (ca.x + cb.x) / 2) * 0.5));
        s = { x: ca.x + slide(a.box), y: down ? a.box.y + a.box.h + 4 : a.box.y - 4 };
        t = { x: cb.x + slide(b.box), y: down ? b.box.y - 12 : b.box.y + b.box.h + 12 };
      } else {
        s = exitPoint(a.box, mid.x, mid.y, 4);
        t = exitPoint(b.box, mid.x, mid.y, 12);
      }
      // The control point that makes the curve pass through `mid` at its half.
      return { x1: s.x, y1: s.y, x2: t.x, y2: t.y, cx: 2 * mid.x - (s.x + t.x) / 2, cy: 2 * mid.y - (s.y + t.y) / 2 };
    };
    const crosses = (c: Curve) => {
      for (let i = 1; i < 20; i++) {
        const pt = curveAt(c, i / 20);
        if (pt.x < board.x || pt.y < board.y || pt.x > board.x + board.w || pt.y > board.y + board.h) return true;
        if (others.some((nd) => overlap(nd.box, { x: pt.x, y: pt.y, w: 0, h: 0 }, 8))) return true;
        // nor through the label of an arrow already drawn: a line across a word makes it unreadable
        if (labels.some((l) => overlap(l, { x: pt.x, y: pt.y, w: 0, h: 0 }, 2))) return true;
      }
      return false;
    };
    // Try the straight arrow first, then arcs to either side: the first one that passes through no
    // other node and has a free place for its label wins (a label wider than the gap between two
    // neighbours rides an arc into the space between the rows).
    // How far a node reaches across the arrow's path: an arc must clear that much.
    const reach = (Math.abs(nx) * Math.max(a.box.w, b.box.w)) / 2 + (Math.abs(ny) * Math.max(a.box.h, b.box.h)) / 2;
    // A label breaks between words only: one long word makes the label wider, never "release / d".
    const longest = Math.max(0, ...e.text.split(/\s+/).map((word) => (Array.from(word).some((ch) => isWideChar(ch.codePointAt(0) ?? 0)) ? 0 : textWidth(word, LABEL_FONT))));
    let lines = e.text ? wrapText(e.text, Math.max(arr.labelMax, longest + 1), LABEL_FONT, 2) : [];
    // a label that does not fit two lines of the narrow gap is set wider (it then rides an arc) rather than cut
    if (lines.length && lines[lines.length - 1].endsWith(ELLIPSIS) && !e.text.endsWith(ELLIPSIS)) lines = wrapText(e.text, Math.max(arr.labelMax, longest + 1, 230), LABEL_FONT, 2);
    const lw = Math.max(0, ...lines.map((ln) => textWidth(ln, LABEL_FONT))) + 12;
    const lh = lines.length * LABEL_LINE + 8;
    let best: { curve: Curve; box: Box | null; cost: number } | null = null;
    for (const bend of [0, reach + 22, -(reach + 22), reach + 40, -(reach + 40), reach * 2.2 + 40, -(reach * 2.2 + 40), reach * 3.4 + 60, -(reach * 3.4 + 60)]) {
      const curve = build(bend);
      let cost = crosses(curve) ? 10 : 0;
      let box: Box | null = null;
      if (lines.length) {
        let hits = Infinity;
        for (const t of [0.5, 0.38, 0.62, 0.28, 0.72, 0.18, 0.82, 0.11, 0.89]) {
          const pt = curveAt(curve, t);
          // kept on the board: a label near the border slides inwards instead of being cut
          const candidate = { x: Math.min(Math.max(pt.x - lw / 2, board.x), Math.max(board.x, board.x + board.w - lw)), y: Math.min(Math.max(pt.y - lh / 2, board.y), board.y + board.h - lh), w: Math.min(lw, board.w), h: lh };
          const n = nodes.filter((nd) => overlap(nd.box, candidate, 1)).length + labels.filter((l) => overlap(l, candidate, 1)).length + linesThrough(candidate);
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
    out.push({ key: `e${index}`, step: e.step, from: e.from, to: e.to, ...best.curve, label: best.box ? { lines, box: best.box, font: LABEL_FONT } : null });
  });
  return out;
}

const TALL_FORMULA = /\\(?:d?frac|sum|int|prod|sqrt|binom|begin|lim)/;

/** How well an arrangement shows its arrows: arrows through a box count most, then crowded labels. */
function arrangementCost(edges: PlacedEdge[], nodes: PlacedNode[]): number {
  let cost = 0;
  for (const e of edges) {
    for (let i = 1; i < 20; i++) {
      const pt = curveAt(e, i / 20);
      if (nodes.some((nd) => nd.id !== e.from && nd.id !== e.to && overlap(nd.box, { x: pt.x, y: pt.y, w: 0, h: 0 }))) { cost += 10; break; }
    }
    if (e.label && nodes.some((nd) => overlap(nd.box, e.label!.box))) cost += 3;
    // an arrow across another arrow's label makes the label unreadable
    for (const o of edges) if (o !== e && o.label && Array.from({ length: 19 }, (_, i) => curveAt(e, (i + 1) / 20)).some((pt) => overlap(o.label!.box, { x: pt.x, y: pt.y, w: 0, h: 0 }))) cost += 3;
  }
  const labelBoxes = edges.flatMap((e) => (e.label ? [e.label.box] : []));
  labelBoxes.forEach((a, i) => labelBoxes.forEach((b, j) => { if (j > i && overlap(a, b)) cost += 3; }));
  for (const nd of nodes) if (nd.lines.join(" ").endsWith(ELLIPSIS) && !nd.text.endsWith(ELLIPSIS)) cost += 2;
  return cost;
}

/**
 * The board for the first `upto + 1` steps of the lesson. Each call lays out only what is shown,
 * so a step that arrives later never has to be known in advance.
 */
export function layoutBoard(lesson: Lesson, upto: number, shape: BoardShape): BoardLayout {
  const first = boardAt(lesson, upto, shape, 0);
  // A phone-shaped board also grows to hold its notes before any is wiped (up to a limit).
  return shape === "tall" && first.short > 0 ? boardAt(lesson, upto, shape, Math.min(640, Math.ceil(first.short))).layout : first.layout;
}

/** The board with `extra` height for the notes; `short` is how much room the notes still lack. */
function boardAt(lesson: Lesson, upto: number, shape: BoardShape, extra: number): { layout: BoardLayout; short: number } {
  const { w } = BOARD_SIZE[shape];
  // A phone-shaped board grows downwards with the diagram (the page scrolls); a wide one is fixed.
  const shown = new Set(lesson.steps.slice(0, upto + 1).flatMap((s) => s.items.flatMap((it) => (it.kind === "node" ? [it.id] : []))));
  const h = BOARD_SIZE[shape].h + (shape === "tall" ? Math.min(6, Math.max(0, shown.size - 4)) * 96 : 0) + extra;
  // a long title is set smaller before it is ever cut
  const titleFont = [shape === "tall" ? 24 : 30, 21, 18, 16].find((f) => textWidth(lesson.title, f) <= w - (shape === "tall" ? 14 : 24) * 2 - 8) ?? 16;
  const margin = shape === "tall" ? 14 : 24;
  const titleText = wrapText(lesson.title, w - margin * 2 - 8, titleFont, 1)[0];
  const title = { text: titleText, x: margin + 4, y: 46, font: titleFont, cut: titleText.endsWith(ELLIPSIS) && !lesson.title.endsWith(ELLIPSIS) };
  const content: Box = { x: margin, y: 72, w: w - margin * 2, h: h - 72 - 20 };

  const nodesIn: NodeIn[] = [];
  const edgesIn: EdgeIn[] = [];
  const marksIn: Array<{ target: string; style: MarkStyle; step: number }> = [];
  type BlockIn = { key: string; step: number } & ({ kind: "formula"; tex: string } | { kind: "note" | "card"; text: string } | { kind: "plot"; expr: string; xmin: number; xmax: number; text: string } | { kind: "sketch"; drawing: BuddyDrawing } | { kind: "cells"; values: string[]; pointer: number });
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
      else if (it.kind === "cells") {
        // The same row again is the same row with its pointer moved: it stays where it is on the board.
        const same = blocksIn.findIndex((b) => b.kind === "cells" && b.values.join("|") === it.values.join("|"));
        if (same >= 0) blocksIn[same] = { key: blocksIn[same].key, step, kind: "cells", values: it.values, pointer: it.pointer };
        else blocksIn.push({ key, step, kind: "cells", values: it.values, pointer: it.pointer });
      }
    });
  });

  // The diagram and the notes share the board; whichever is absent gives its room to the other.
  let diagram: Box = content;
  let notes: Box = content;
  if (nodesIn.length && blocksIn.length) {
    if (shape === "wide") {
      const nw = Math.round(content.w * 0.34);
      diagram = { ...content, w: content.w - nw - 24 };
      notes = { x: content.x + content.w - nw, y: content.y, w: nw, h: content.h };
    } else {
      const nh = Math.round((content.h - extra) * 0.38) + extra;
      diagram = { ...content, h: content.h - nh - 20 };
      notes = { x: content.x, y: content.y + content.h - nh, w: content.w, h: nh };
    }
  } else if (blocksIn.length) {
    const nw = Math.min(content.w, 780);
    notes = { x: content.x + (content.w - nw) / 2, y: content.y, w: nw, h: content.h };
  }

  let nodes: PlacedNode[] = [];
  let edges: PlacedEdge[] = [];
  if (nodesIn.length) {
    // The arrows only reach the boxes that are on the board.
    const ids = new Set(nodesIn.map((nd) => nd.id));
    // A bare arrow gives way to a labelled one between the same two boxes (a later step named it).
    const live = edgesIn.filter((e) => ids.has(e.from) && ids.has(e.to) && (e.text || !edgesIn.some((o) => o !== e && o.text && o.from === e.from && o.to === e.to)));
    const grid = (scene: "flow" | "stack") => gridNodes(nodesIn, diagram, scene, shape);
    const ring = nodesIn.length >= 3 ? cycleNodes(nodesIn, diagram) : null;
    const layered = layeredNodes(nodesIn, live, diagram, shape);
    // The scene's own arrangement first; the others are the way out when its arrows tangle.
    const own = lesson.scene === "cycle" ? [ring, grid("flow")] : lesson.scene === "stack" ? [grid("stack")] : [layered, grid("flow")];
    const options = [...own, layered, ring, grid("flow"), grid("stack")].filter((o): o is Arrangement => o !== null);
    // The scene's own arrangement is kept unless its arrows cannot be drawn cleanly and another can.
    let bestCost = Infinity;
    for (const option of options) {
      const placedEdges = placeEdges(live, option, diagram);
      const cost = arrangementCost(placedEdges, option.nodes);
      if (cost < bestCost) { bestCost = cost; nodes = option.nodes; edges = placedEdges; }
      if (!cost) break;
    }
  }
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
    if (b.kind === "cells") {
      const cw = Math.min(64, (notes.w - 8) / b.values.length);
      return { ...base, kind: "cells", values: b.values, pointer: b.pointer, box: { x: notes.x + (notes.w - cw * b.values.length) / 2, y: 0, w: cw * b.values.length, h: 78 } };
    }
    if (b.kind === "sketch") {
      const sw = Math.min(notes.w, 380, (notes.h * 0.6 * 4) / 3);
      return { ...base, kind: "sketch", drawing: b.drawing, box: { x: notes.x + (notes.w - sw) / 2, y: 0, w: sw, h: sw * 0.75 } };
    }
    const font = 21;
    const lines = wrapText(b.text, notes.w - 36, font, b.kind === "card" ? 6 : 4);
    const cut = lines[lines.length - 1].endsWith(ELLIPSIS) && !b.text.endsWith(ELLIPSIS);
    return { ...base, kind: b.kind, lines, font, cut, box: { x: notes.x, y: 0, w: notes.w, h: lines.length * font * 1.3 + 22 } };
  });
  let wiped = 0;
  const total = () => sized.slice(wiped).reduce((sum, b) => sum + b.box.h, 0) + gap * Math.max(0, sized.length - wiped - 1);
  // A full column first makes its pictures smaller; only then is anything wiped.
  if (total() > notes.h) {
    for (const b of sized) {
      if (b.kind === "plot") b.box.h = Math.min(b.box.h, 170);
      else if (b.kind === "sketch") {
        const sh = Math.min(b.box.h, 168);
        b.box = { x: notes.x + (notes.w - (sh * 4) / 3) / 2, y: 0, w: (sh * 4) / 3, h: sh };
      }
    }
  }
  const short = Math.max(0, total() - notes.h);
  while (sized.length - wiped > 1 && total() > notes.h) wiped++;
  const blocks = sized.slice(wiped);
  // A single block taller than the room it has is cut to it (a long card on a small board).
  let y = notes.y + (nodesIn.length ? 0 : Math.max(0, (notes.h - total()) / 3));
  for (const b of blocks) {
    b.box.h = Math.min(b.box.h, notes.y + notes.h - y);
    b.box.y = y;
    y += b.box.h + gap;
  }

  return { layout: { shape, w, h, title, nodes, edges, marks, blocks, wiped }, short };
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
    ...l.edges.flatMap((e) => (e.label ? [{ name: `label "${e.label.lines.join(" ")}"`, box: e.label.box }] : [])),
    ...l.blocks.map((b) => ({ name: `${b.kind} ${b.key}`, box: b.box })),
  ];
  for (const t of things) {
    if (!inside(t.box, board)) problems.push(`${t.name} is off the board`);
    if (t.box.w < 8 || t.box.h < 8) problems.push(`${t.name} has no room`);
  }
  for (let i = 0; i < things.length; i++) for (let j = i + 1; j < things.length; j++) if (overlap(things[i].box, things[j].box)) problems.push(`${things[i].name} overlaps ${things[j].name}`);
  if (l.title.cut) problems.push("the title is cut");
  for (const b of l.blocks) if ((b.kind === "note" || b.kind === "card") && b.cut) problems.push(`${b.kind} ${b.key} is cut`);
  for (const nd of l.nodes) {
    if (nd.font < 15) problems.push(`node ${nd.id} is set too small to read`);
    if (nd.lines.some((ln) => textWidth(ln, nd.font) > nd.box.w - 8)) problems.push(`node ${nd.id} text is wider than its box`);
    if (nd.lines.length * nd.font * 1.22 > nd.box.h) problems.push(`node ${nd.id} text is taller than its box`);
    if (nd.lines.join(" ").endsWith(ELLIPSIS) && !nd.text.endsWith(ELLIPSIS)) problems.push(`node ${nd.id} label is cut`);
  }
  for (const e of l.edges) {
    for (let i = 1; i < 20; i++) {
      const pt = curveAt(e, i / 20);
      const hit = l.nodes.find((nd) => nd.id !== e.from && nd.id !== e.to && overlap(nd.box, { x: pt.x, y: pt.y, w: 0, h: 0 }));
      if (hit) { problems.push(`arrow ${e.from} -> ${e.to} runs through node ${hit.id}`); break; }
    }
    if (e.label && e.label.lines.join(" ").endsWith(ELLIPSIS)) problems.push(`label on ${e.from} -> ${e.to} is cut`);
    for (const o of l.edges) {
      if (o === e || !o.label) continue;
      let through = false;
      for (let i = 1; i < 20 && !through; i++) {
        const pt = curveAt(e, i / 20);
        through = overlap(o.label.box, { x: pt.x, y: pt.y, w: 0, h: 0 });
      }
      if (through) problems.push(`arrow ${e.from} -> ${e.to} runs through the label "${o.label.lines.join(" ")}"`);
    }
  }
  return problems;
}

/** The point and direction of an arrow's head, for the renderer. */
export function arrowHead(e: PlacedEdge): { x: number; y: number; angle: number } {
  return { x: e.x2, y: e.y2, angle: Math.atan2(e.y2 - e.cy, e.x2 - e.cx) };
}
