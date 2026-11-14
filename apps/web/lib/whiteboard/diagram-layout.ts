// Where the boxes, arrows, lifelines and cells of a lesson's structured diagram go (diagram.ts reads
// what the model wrote). Deterministic, no browser: the same lesson always gives the same board.
// - flowchart: layered (Sugiyama: cycles broken, longest-path ranks, barycentre ordering, aligned
//   rows), or a ring when the arrows close a loop, or a tidy tree when every box has one parent;
// - mind map: a tidy tree on both sides of its root (tidy-tree.ts, from Plait/Drawnix, MIT);
// - sequence: participants in a row, lifelines, one row per message;
// - table: a grid of cells, the header shaded.
// The type is set as large as the room allows (22 down to 13) and the drawing is centred in it.
import type { DiagramType, DLink, DNode, DShape } from "./diagram";
import type { Lesson } from "./lesson";
import { textWidth, wrapText, type BoardShape, type Box } from "./layout";
import { tidyTree, TreeNode } from "./tidy-tree";

export type Pt = { x: number; y: number };
export type DiagramIn = {
  type: DiagramType;
  dir: "TD" | "LR";
  nodes: Array<DNode & { step: number }>;
  links: Array<DLink & { step: number }>;
  rows: Array<{ cells: string[]; step: number }>;
};
export type PlacedDNode = { key: string; id: string; step: number; box: Box; lines: string[]; font: number; shape: DShape; fill?: string; level?: number };
export type PlacedDLink = { key: string; step: number; from: string; to: string; pts: Pt[]; label: { lines: string[]; box: Box; font: number } | null; dashed: boolean; head: boolean; bound: boolean };
export type PlacedDLine = { key: string; step: number; pts: Pt[]; dashed: boolean };
export type PlacedDiagram = { type: DiagramType; layout: "layered" | "ring" | "tree" | "mind" | "sequence" | "table"; nodes: PlacedDNode[]; links: PlacedDLink[]; lines: PlacedDLine[]; font: number };

const FONTS = [22, 20, 18, 17, 16, 15, 14, 13];
const LINE = 1.22;

type Sized = { w: number; h: number; lines: string[] };
function sizeNode(text: string, shape: DShape, font: number, maxW: number): Sized {
  const lines = wrapText(text, maxW, font, 3);
  // a tenth more than the estimate: Excalidraw measures the hand font itself and must not wrap a line again
  const tw = Math.max(...lines.map((l) => textWidth(l, font))) * 1.1;
  const th = lines.length * font * LINE;
  if (shape === "diamond") return { lines, w: tw / 0.6 + 24, h: Math.max(th / 0.6 + 16, font * 3.2) };
  if (shape === "circle") return { lines, w: Math.max(tw / 0.66 + 24, th / 0.66 + 20), h: Math.max(th / 0.62 + 20, font * 3.4) };
  return { lines, w: tw + 30, h: th + 22 };
}
function labelOf(text: string, font: number, maxW: number) {
  if (!text) return null;
  const lines = wrapText(text, maxW, font, 2);
  return { lines, w: Math.max(...lines.map((l) => textWidth(l, font))) + 8, h: lines.length * font * LINE + 4 };
}

const center = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const overlaps = (a: Box, b: Box, pad = 0) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

/** Where the line from the centre of a shape toward `toward` leaves the shape (and a small gap beyond). */
export function clipToShape(b: Box, shape: DShape, toward: Pt, gap = 5): Pt {
  const c = center(b);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (!dx && !dy) return c;
  const hw = b.w / 2 + gap;
  const hh = b.h / 2 + gap;
  let s: number;
  if (shape === "diamond") s = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  else if (shape === "circle") s = 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2);
  else s = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

/** The bounds of a placed diagram (boxes, labels, arrow points and lines). */
export function diagramBounds(d: Pick<PlacedDiagram, "nodes" | "links" | "lines">): Box {
  const xs: number[] = [];
  const ys: number[] = [];
  const add = (b: Box) => { xs.push(b.x, b.x + b.w); ys.push(b.y, b.y + b.h); };
  d.nodes.forEach((n) => add(n.box));
  d.links.forEach((l) => { l.pts.forEach((p) => add({ x: p.x, y: p.y, w: 0, h: 0 })); if (l.label) add(l.label.box); });
  d.lines.forEach((l) => l.pts.forEach((p) => add({ x: p.x, y: p.y, w: 0, h: 0 })));
  if (!xs.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function shift(d: PlacedDiagram, dx: number, dy: number): PlacedDiagram {
  const p = (q: Pt) => ({ x: q.x + dx, y: q.y + dy });
  const b = (q: Box) => ({ ...q, x: q.x + dx, y: q.y + dy });
  return {
    ...d,
    nodes: d.nodes.map((n) => ({ ...n, box: b(n.box) })),
    links: d.links.map((l) => ({ ...l, pts: l.pts.map(p), label: l.label ? { ...l.label, box: b(l.label.box) } : null })),
    lines: d.lines.map((l) => ({ ...l, pts: l.pts.map(p) })),
  };
}

/** Where Excalidraw writes an arrow's label: on its middle point, or the middle of its middle segment. */
export function arrowMiddle(pts: Pt[]): Pt {
  const n = pts.length;
  if (n % 2) return pts[(n - 1) / 2];
  const a = pts[n / 2 - 1], b = pts[n / 2];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
function labelBox(pts: Pt[], s: { lines: string[]; w: number; h: number }, font: number): NonNullable<PlacedDLink["label"]> {
  const m = arrowMiddle(pts);
  return { lines: s.lines, font, box: { x: m.x - (s.w - 8) / 2, y: m.y - (s.h - 4) / 2, w: s.w - 8, h: s.h - 4 } };
}

// ---------------------------------------------------------------- flowchart: layered
type V = { id: string; dummy: boolean; w: number; h: number };
function layered(d: DiagramIn, font: number, dir: "TD" | "LR", foldAt = 0): PlacedDiagram {
  const ids = d.nodes.map((n) => n.id);
  const sized = new Map(d.nodes.map((n) => [n.id, sizeNode(n.text, n.shape, font, font * 9)]));
  const links = d.links.filter((l) => sized.has(l.from) && sized.has(l.to) && l.from !== l.to);
  // 1. cycles broken: an arrow back to a box still being walked is laid out reversed
  const out = new Map(ids.map((id) => [id, links.filter((l) => l.from === id)]));
  const state = new Map<string, number>();
  const reversed = new Set<DLink>();
  const walk = (id: string) => {
    state.set(id, 1);
    for (const l of out.get(id) ?? []) {
      const s = state.get(l.to) ?? 0;
      if (s === 1) reversed.add(l);
      else if (s === 0) walk(l.to);
    }
    state.set(id, 2);
  };
  ids.forEach((id) => { if (!state.get(id)) walk(id); });
  const dag = links.map((l) => (reversed.has(l) ? { from: l.to, to: l.from, link: l } : { from: l.from, to: l.to, link: l }));
  // 2. ranks: longest path from the sources, then boxes pulled down next to what they feed
  const rank = new Map(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length; pass++) for (const e of dag) rank.set(e.to, Math.max(rank.get(e.to)!, rank.get(e.from)! + 1));
  for (let pass = 0; pass < 2; pass++) for (const id of [...ids].reverse()) {
    const succ = dag.filter((e) => e.from === id).map((e) => rank.get(e.to)!);
    const pred = dag.filter((e) => e.to === id);
    if (succ.length && !pred.length) rank.set(id, Math.max(rank.get(id)!, Math.min(...succ) - 1));
  }
  // 3. long arrows pass through invisible points, one per rank they cross
  const across = (s: Sized) => (dir === "TD" ? s.w : s.h);
  const along = (s: Sized) => (dir === "TD" ? s.h : s.w);
  const verts = new Map<string, V>(ids.map((id) => [id, { id, dummy: false, w: across(sized.get(id)!), h: along(sized.get(id)!) }]));
  const chains: Array<{ link: DLink; path: string[]; rev: boolean }> = [];
  const segs: Array<[string, string]> = [];
  const lab = new Map(links.map((l) => [l as DLink, labelOf(l.text, font * 0.9, font * 8)]));
  dag.forEach((e, k) => {
    const path = [e.from];
    const first = rank.get(e.from)! + 1, last = rank.get(e.to)! - 1;
    for (let r = first; r <= last; r++) {
      const id = `~${k}_${r}`;
      // the label of a long arrow is written on its middle point: that point is as wide as the label
      const s = lab.get(e.link);
      const middle = (last - first) % 2 === 0 && r === (first + last) / 2;
      verts.set(id, { id, dummy: true, w: s && middle ? (dir === "TD" ? s.w : s.h) + 8 : 12, h: s && middle ? (dir === "TD" ? s.h : s.w) : 0 });
      rank.set(id, r);
      path.push(id);
    }
    path.push(e.to);
    path.slice(1).forEach((v, i) => segs.push([path[i], v]));
    chains.push({ link: e.link, path, rev: reversed.has(e.link) });
  });
  const ranks = Math.max(0, ...[...rank.values()]) + 1;
  const layers: string[][] = Array.from({ length: ranks }, () => []);
  // first order: as the boxes were written, then the invisible points
  for (const id of [...ids, ...[...verts.keys()].filter((v) => verts.get(v)!.dummy)]) layers[rank.get(id)!].push(id);
  // 4. order in each rank: barycentres, sweeping down and up, the order with the fewest crossings kept
  const pos = () => new Map(layers.flatMap((l) => l.map((id, i) => [id, i] as const)));
  const crossings = () => {
    const p = pos();
    let n = 0;
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
      const [a, b] = segs[i], [c, e] = segs[j];
      if (rank.get(a) !== rank.get(c) || a === c || b === e) continue;
      if ((p.get(a)! - p.get(c)!) * (p.get(b)! - p.get(e)!) < 0) n++;
    }
    return n;
  };
  let best = layers.map((l) => [...l]);
  let bestCross = crossings();
  for (let it = 0; it < 12 && bestCross > 0; it++) {
    const down = it % 2 === 0;
    const p = pos();
    const order = down ? layers.keys() : [...layers.keys()].reverse();
    for (const r of order) {
      const near = (id: string) => segs.filter(([a, b]) => (down ? b === id && rank.get(a) === r - 1 : a === id && rank.get(b) === r + 1)).map(([a, b]) => p.get(down ? a : b)!);
      const bary = new Map(layers[r].map((id, i) => { const n = near(id); return [id, n.length ? n.reduce((s, x) => s + x, 0) / n.length : i] as const; }));
      layers[r].sort((a, b) => bary.get(a)! - bary.get(b)!);
      layers[r].forEach((id, i) => p.set(id, i));
    }
    const c = crossings();
    if (c < bestCross) { bestCross = c; best = layers.map((l) => [...l]); }
  }
  layers.splice(0, layers.length, ...best);
  // 5. positions: ranks one after another, a rank as deep as its deepest box plus room for labels
  const rankDepth = layers.map((l) => Math.max(0, ...l.map((id) => verts.get(id)!.h)));
  const gapAfter = layers.map((_, r) => {
    const here = chains.filter((c) => c.path.some((v, i) => i > 0 && rank.get(c.path[i - 1]) === r && rank.get(v) === r + 1)).map((c) => lab.get(c.link));
    const room = Math.max(0, ...here.map((s) => (s ? (dir === "TD" ? s.h : s.w) : 0)));
    return Math.max(font * 2.4, room + font * 1.6);
  });
  const depthAt: number[] = [];
  let acc = 0;
  for (let r = 0; r < ranks; r++) { depthAt.push(acc + rankDepth[r] / 2); acc += rankDepth[r] + gapAfter[r]; }
  const sep = font * 1.6;
  const at = new Map<string, number>();
  for (const l of layers) {
    let x = 0;
    for (const id of l) { const v = verts.get(id)!; at.set(id, x + v.w / 2); x += v.w + sep; }
  }
  const neighbours = (id: string) => segs.flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : []));
  for (let it = 0; it < 8; it++) {
    for (const l of it % 2 ? [...layers].reverse() : layers) {
      const want = l.map((id) => { const n = neighbours(id); return n.length ? n.reduce((s, v) => s + at.get(v)!, 0) / n.length : at.get(id)!; });
      // keep the order and the spacing, move as close to the wish as that allows
      const xs = [...want];
      for (let i = 1; i < l.length; i++) xs[i] = Math.max(xs[i], xs[i - 1] + (verts.get(l[i - 1])!.w + verts.get(l[i])!.w) / 2 + sep);
      for (let i = l.length - 2; i >= 0; i--) xs[i] = Math.min(xs[i], xs[i + 1] - (verts.get(l[i])!.w + verts.get(l[i + 1])!.w) / 2 - sep);
      // the backward pass can undo the forward one: one more forward pass keeps the spacing
      for (let i = 1; i < l.length; i++) xs[i] = Math.max(xs[i], xs[i - 1] + (verts.get(l[i - 1])!.w + verts.get(l[i])!.w) / 2 + sep);
      const drift = (want.reduce((s, x) => s + x, 0) - xs.reduce((s, x) => s + x, 0)) / Math.max(1, l.length);
      l.forEach((id, i) => at.set(id, xs[i] + drift));
    }
  }
  // 6. A long process folded like lines of text (`foldAt`: the width of a line, ranks across only):
  // the ranks run left to right, then go on in the next line, under the first.
  const lineOf = new Map<number, number>();
  const lineStart: number[] = [];
  const lineTop: number[] = [];
  const lineMin: number[] = [];
  const lineGap = font * 2.6 + Math.max(0, ...[...lab.values()].map((s) => s?.h ?? 0));
  if (foldAt && dir === "LR") {
    let line = 0;
    for (let r = 0; r < ranks; r++) {
      const left = depthAt[r] - rankDepth[r] / 2;
      if (r > 0 && depthAt[r] + rankDepth[r] / 2 - lineStart[line] > foldAt) line++;
      lineStart[line] ??= left;
      lineOf.set(r, line);
    }
    let top = 0;
    for (let k = 0; k <= line; k++) {
      const members = [...verts.keys()].filter((v) => lineOf.get(rank.get(v)!) === k);
      const lo = Math.min(...members.map((v) => at.get(v)! - verts.get(v)!.h / 2));
      const hi = Math.max(...members.map((v) => at.get(v)! + verts.get(v)!.h / 2));
      lineMin[k] = lo;
      lineTop[k] = top;
      top += hi - lo + lineGap;
    }
  }
  const folded = lineOf.size > 0 && Math.max(...lineOf.values()) > 0;
  const pt = (id: string): Pt => {
    const r = rank.get(id)!;
    if (folded) { const k = lineOf.get(r)!; return { x: depthAt[r] - lineStart[k], y: at.get(id)! - lineMin[k] + lineTop[k] }; }
    return dir === "TD" ? { x: at.get(id)!, y: depthAt[r] } : { x: depthAt[r], y: at.get(id)! };
  };
  const nodes: PlacedDNode[] = d.nodes.map((n) => {
    const s = sized.get(n.id)!;
    const c = pt(n.id);
    return { key: `d:${n.id}`, id: n.id, step: n.step, box: { x: c.x - s.w / 2, y: c.y - s.h / 2, w: s.w, h: s.h }, lines: s.lines, font, shape: n.shape };
  });
  const byNode = new Map(nodes.map((n) => [n.id, n.box]));
  const ends = (c: (typeof chains)[number]) => { const p = c.rev ? [...c.path].reverse() : c.path; return [p[0], p[p.length - 1]]; };
  const jumps = chains.filter((c) => { const [s, t] = ends(c); return folded && lineOf.get(rank.get(s)!) !== lineOf.get(rank.get(t)!); });
  const via = (c: (typeof chains)[number]): Pt[] => {
    const path = c.rev ? [...c.path].reverse() : c.path;
    if (!jumps.includes(c)) return path.slice(1, -1).map(pt);
    // to another line: out of the box into the free band between the lines, along it, into the box.
    // Arrows that share a band run at their own height, and leave and reach a box at their own place.
    const [s, t] = ends(c);
    const a = byNode.get(s)!, b = byNode.get(t)!;
    const k = Math.min(lineOf.get(rank.get(s)!)!, lineOf.get(rank.get(t)!)!);
    const band = jumps.filter((o) => { const [os, ot] = ends(o); return Math.min(lineOf.get(rank.get(os)!)!, lineOf.get(rank.get(ot)!)!) === k; });
    const i = band.indexOf(c);
    const bandY = lineTop[k + 1] - lineGap / 2 + (i - (band.length - 1) / 2) * font * 1.1;
    const spread = (box: Box, id: string, end: 0 | 1) => { const same = band.filter((o) => ends(o)[end] === id); return box.x + (box.w * (same.indexOf(c) + 1)) / (same.length + 1); };
    const sx = spread(a, s, 0), tx = spread(b, t, 1);
    const down = b.y > a.y;
    return [{ x: sx, y: down ? a.y + a.h + 6 : a.y - 6 }, { x: sx, y: bandY }, { x: tx, y: bandY }, { x: tx, y: down ? b.y - 6 : b.y + b.h + 6 }];
  };
  return { type: "flowchart", layout: "layered", nodes, links: routes(d, nodes, chains.map((c) => ({ link: c.link, via: via(c) })), lab, true, 0, font * 1.8), lines: [], font };
}

/** Arrows along their routes, clipped at the shapes; two arrows between the same boxes bend apart; labels where nothing else is. */
function routes(d: DiagramIn, nodes: PlacedDNode[], paths: Array<{ link: DLink & { step?: number }; via: Pt[] }>, lab: Map<DLink, { lines: string[]; w: number; h: number } | null>, head: boolean, bend = 0, twinOff = 22): PlacedDLink[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const placed: PlacedDLink[] = [];
  paths.forEach(({ link, via }, k) => {
    const a = byId.get(link.from)!;
    const b = byId.get(link.to)!;
    const twin = paths.some((o) => o !== paths[k] && o.link.from === link.to && o.link.to === link.from);
    let mid = via;
    if (!via.length && (twin || bend)) {
      // a pair of opposite arrows, or an arc of a ring: one control point off the straight line
      const ca = center(a.box), cb = center(b.box);
      const len = Math.hypot(cb.x - ca.x, cb.y - ca.y) || 1;
      const off = twin ? twinOff : bend * len;
      mid = [{ x: (ca.x + cb.x) / 2 + ((cb.y - ca.y) / len) * off, y: (ca.y + cb.y) / 2 - ((cb.x - ca.x) / len) * off }];
    }
    const first = clipToShape(a.box, a.shape, mid[0] ?? center(b.box));
    const last = clipToShape(b.box, b.shape, mid[mid.length - 1] ?? center(a.box));
    const pts = [first, ...mid, last];
    const s = lab.get(link) ?? null;
    const label = s ? labelBox(pts, s, (nodes[0]?.font ?? 16) * 0.9) : null;
    const step = Math.max((link as { step?: number }).step ?? 0, a.step, b.step);
    placed.push({ key: `d:${link.from}>${link.to}:${k}`, step, from: link.from, to: link.to, pts, label, dashed: Boolean(link.dashed), head, bound: true });
  });
  return placed;
}

// ---------------------------------------------------------------- flowchart: ring (a loop)
/** The boxes of the loop in order, when the arrows close one loop through at least 3 boxes. */
export function loopOrder(d: Pick<DiagramIn, "nodes" | "links">): string[] | null {
  const next = (id: string, seen: Set<string>) => d.links.find((l) => l.from === id && !seen.has(l.to))?.to;
  for (const start of d.nodes.map((n) => n.id)) {
    const order = [start];
    const seen = new Set(order);
    for (let cur = start; ;) {
      const back = d.links.some((l) => l.from === cur && l.to === start) && order.length >= 3;
      const nx = next(cur, seen);
      if (!nx) { if (back) return order; break; }
      order.push(nx);
      seen.add(nx);
      cur = nx;
    }
    // the longest loop through the first box that has one
    for (let k = order.length - 1; k >= 2; k--) if (d.links.some((l) => l.from === order[k] && l.to === start)) return order.slice(0, k + 1);
  }
  return null;
}

function ring(d: DiagramIn, font: number, loop: string[], aspect: number, wide = false): PlacedDiagram {
  const sized = new Map(d.nodes.map((n) => [n.id, sizeNode(n.text, n.shape, font, font * 6.5)]));
  const n = loop.length;
  const diag = loop.map((id) => { const s = sized.get(id)!; return Math.hypot(s.w, s.h); });
  const labelW = Math.max(0, ...d.links.map((l) => labelOf(l.text, font * 0.9, font * 7)?.w ?? 0));
  // each arc as long as its two boxes and the label written on it need: neighbours never touch
  const arcLabel = loop.map((id, i) => labelOf(d.links.find((l) => l.from === id && l.to === loop[(i + 1) % n])?.text ?? "", font * 0.9, font * 7)?.w ?? 0);
  const arcs = loop.map((_, i) => diag[i] / 2 + diag[(i + 1) % n] / 2 + font * 2.2 + arcLabel[i]);
  const around = arcs.reduce((s, a) => s + a, 0);
  const r = Math.max(around / (2 * Math.PI), font * 6);
  // an ellipse shaped like the room: wider than tall on a wide board, taller on a phone
  const rx = r * Math.sqrt(aspect), ry = r / Math.sqrt(aspect);
  const at = new Map<string, Pt>();
  let walked = 0;
  loop.forEach((id, i) => {
    const t = -Math.PI / 2 + (2 * Math.PI * walked) / around;
    walked += arcs[i];
    at.set(id, { x: rx * Math.cos(t), y: ry * Math.sin(t) });
  });
  // boxes off the loop: outside, beyond the loop box they are joined to (or in the middle, for the first one with none)
  let middle = false;
  for (const nd of d.nodes) {
    if (at.has(nd.id)) continue;
    const joined = d.links.find((l) => (l.from === nd.id && at.has(l.to)) || (l.to === nd.id && at.has(l.from)));
    const anchor = joined ? at.get(joined.from === nd.id ? joined.to : joined.from)! : null;
    if (!anchor && !middle) { at.set(nd.id, { x: 0, y: 0 }); middle = true; continue; }
    const base = anchor ?? { x: rx, y: 0 };
    const len = Math.hypot(base.x, base.y) || 1;
    const s = sized.get(nd.id)!;
    let k = len + Math.hypot(s.w, s.h) / 2 + Math.max(...diag) / 2 + font * 2.4 + labelW / 2;
    let p = { x: (base.x / len) * k, y: (base.y / len) * k };
    for (let tries = 0; tries < 8 && [...at.values()].some((q) => Math.abs(q.x - p.x) < s.w && Math.abs(q.y - p.y) < s.h + font); tries++) { k += font * 3; p = { x: (base.x / len) * k, y: (base.y / len) * k }; }
    at.set(nd.id, p);
  }
  const nodes: PlacedDNode[] = d.nodes.map((nd) => {
    const s = sized.get(nd.id)!;
    const c = at.get(nd.id)!;
    return { key: `d:${nd.id}`, id: nd.id, step: nd.step, box: { x: c.x - s.w / 2, y: c.y - s.h / 2, w: s.w, h: s.h }, lines: s.lines, font, shape: nd.shape };
  });
  const lab = new Map(d.links.map((l) => [l as DLink, labelOf(l.text, font * 0.9, font * 7)]));
  const onLoop = (l: DLink) => loop.includes(l.from) && loop.includes(l.to) && (loop.indexOf(l.to) - loop.indexOf(l.from) + n) % n === 1;
  const links = [
    ...routes(d, nodes, d.links.filter(onLoop).map((link) => ({ link, via: [] })), lab, true, wide ? 0.3 : 0.16, wide ? font * 3.2 : 22),
    ...routes(d, nodes, d.links.filter((l) => !onLoop(l) && at.has(l.from) && at.has(l.to) && l.from !== l.to).map((link) => ({ link, via: [] })), lab, true),
  ];
  return { type: "flowchart", layout: "ring", nodes, links, lines: [], font };
}

// ---------------------------------------------------------------- trees and mind maps (tidy tree)
/** Each box's parent, when the arrows form one tree (one root, every other box has exactly one parent). */
export function treeParents(d: Pick<DiagramIn, "nodes" | "links">): Map<string, string> | null {
  const parent = new Map<string, string>();
  for (const l of d.links) {
    if (parent.has(l.to) || l.from === l.to) return null;
    parent.set(l.to, l.from);
  }
  const roots = d.nodes.filter((n) => !parent.has(n.id));
  if (roots.length !== 1 || parent.size !== d.nodes.length - 1) return null;
  // no loop: every box reaches the root
  for (const n of d.nodes) {
    let cur: string | undefined = n.id;
    for (let i = 0; cur && cur !== roots[0].id; i++) { if (i > d.nodes.length) return null; cur = parent.get(cur); }
  }
  return parent;
}

type Laid = { box: Box; level: number };
/**
 * A tree laid out by the tidy tree: `horizontal` grows to the right (a side of a mind map), otherwise
 * downwards. Returns each box relative to the root's centre at (0, 0).
 */
function tidy(rootId: string, kids: Map<string, string[]>, size: (id: string, level: number) => { w: number; h: number }, horizontal: boolean, gapAcross: number, gapAlong: (level: number) => number): Map<string, Laid> {
  const order: Array<{ id: string; level: number }> = [];
  // one band per level, as deep as its deepest box: arrows between two levels cross no box
  const bands: number[] = [];
  const measure = (id: string, level: number) => {
    const s = size(id, level);
    bands[level] = Math.max(bands[level] ?? 0, horizontal ? s.w : s.h);
    (kids.get(id) ?? []).forEach((c) => measure(c, level + 1));
  };
  measure(rootId, 0);
  const start = bands.map((_, l) => bands.slice(0, l).reduce((s, b, k) => s + b + gapAlong(k), 0));
  const build = (id: string, level: number): TreeNode => {
    const s = size(id, level);
    const breadth = (horizontal ? s.h : s.w) + gapAcross;
    const index = order.length;
    order.push({ id, level });
    const children = (kids.get(id) ?? []).map((c) => build(c, level + 1));
    return new TreeNode(breadth, bands[level], start[level], children, index);
  };
  const root = build(rootId, 0);
  tidyTree(root);
  const out = new Map<string, Laid>();
  const visit = (t: TreeNode) => {
    const { id, level } = order[t.index];
    const s = size(id, level);
    const across = t.x + gapAcross / 2;
    // in its band, a box stands at the start (a mind map's side) or in the middle (a tree)
    const along = horizontal ? t.y : t.y + (bands[level] - s.h) / 2;
    out.set(id, { level, box: horizontal ? { x: along, y: across, w: s.w, h: s.h } : { x: across, y: along, w: s.w, h: s.h } });
    t.children.forEach(visit);
  };
  visit(root);
  const r = out.get(rootId)!.box;
  const c = center(r);
  for (const [id, l] of out) out.set(id, { ...l, box: { ...l.box, x: l.box.x - c.x, y: l.box.y - c.y } });
  return out;
}

const MIND_FILL = ["#fff3bf", "#e7f5ff", "#ebfbee", "#f3f0ff", "#fff4e6", "#e3fafc", "#fff0f6"];

function tree(d: DiagramIn, font: number, parents: Map<string, string>, mind: boolean, shape: BoardShape, dir: "TD" | "LR" = "TD"): PlacedDiagram {
  const kids = new Map<string, string[]>();
  for (const n of d.nodes) { const p = parents.get(n.id); if (p) kids.set(p, [...(kids.get(p) ?? []), n.id]); }
  const rootId = d.nodes.find((n) => !parents.has(n.id))!.id;
  const fontAt = (level: number) => (mind ? (level === 0 ? font * 1.15 : level === 1 ? font : Math.max(13, font * 0.92)) : font);
  // a mind map's branches are its parents; a flowchart tree keeps its arrows and their labels
  const treeLinks: Array<DLink & { step: number }> = mind ? d.nodes.flatMap((n) => (parents.has(n.id) ? [{ from: parents.get(n.id)!, to: n.id, text: "", step: n.step }] : [])) : d.links;
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const sizes = new Map<string, Sized>();
  const size = (id: string, level: number) => {
    if (!sizes.has(id)) sizes.set(id, sizeNode(byId.get(id)!.text, mind && level === 0 ? "circle" : byId.get(id)!.shape, fontAt(level), fontAt(level) * (mind ? 8 : 7.5)));
    return sizes.get(id)!;
  };
  const lab = new Map(treeLinks.map((l) => [l as DLink, mind ? null : labelOf(l.text, font * 0.9, font * 7)]));
  const labelDepth = Math.max(0, ...[...lab.values()].map((s) => (s ? s.h : 0)));
  let laid: Map<string, Laid>;
  const twoSided = mind && shape === "wide" && (kids.get(rootId)?.length ?? 0) >= 2;
  if (!mind || !twoSided) {
    const horizontal = mind && shape === "wide";
    const sideways = horizontal || (!mind && dir === "LR");
    const labelWidth = Math.max(0, ...[...lab.values()].map((s) => (s ? s.w : 0)));
    laid = tidy(rootId, kids, size, sideways, mind ? font * 0.7 : font * 1.4, () => (horizontal ? font * 3.4 : sideways ? font * 2.4 + labelWidth : font * 2.6 + labelDepth));
  } else {
    // a mind map grows on both sides of its root, the branches shared out by size (right first)
    const weight = (id: string): number => 1 + (kids.get(id) ?? []).reduce((s, c) => s + weight(c), 0);
    const top = kids.get(rootId)!;
    const total = top.reduce((s, c) => s + weight(c), 0);
    const right: string[] = [];
    let w = 0;
    for (const c of top) { if (w + weight(c) / 2 <= total / 2 || !right.length) { right.push(c); w += weight(c); } }
    const left = top.filter((c) => !right.includes(c));
    const side = (branch: string[]) => tidy(rootId, new Map([...kids, [rootId, branch]]), size, true, font * 0.7, () => font * 3.4);
    const r = side(right);
    const l = side(left);
    laid = new Map(r);
    // the left side is the same layout mirrored about the root
    for (const [id, v] of l) if (id !== rootId) laid.set(id, { ...v, box: { ...v.box, x: -v.box.x - v.box.w } });
  }
  const nodes: PlacedDNode[] = d.nodes.map((n) => {
    const l = laid.get(n.id)!;
    const s = sizes.get(n.id)!;
    const branch = (() => { let cur = n.id; while (parents.get(cur) && parents.get(cur) !== rootId) cur = parents.get(cur)!; return (kids.get(rootId) ?? []).indexOf(cur); })();
    return { key: `d:${n.id}`, id: n.id, step: n.step, box: l.box, lines: s.lines, font: fontAt(l.level), shape: mind && l.level === 0 ? "circle" : mind ? "round" : n.shape, level: l.level, ...(mind ? { fill: l.level === 0 ? MIND_FILL[0] : MIND_FILL[1 + (Math.max(0, branch) % (MIND_FILL.length - 1))] } : {}) };
  });
  const byNode = new Map(nodes.map((n) => [n.id, n]));
  // the bend of a branch lies in the free band between the two levels, never across a box
  const levelEnd = (level: number, vertical: boolean) => Math.max(...nodes.filter((n) => n.level === level).map((n) => (vertical ? n.box.y + n.box.h : n.box.x + n.box.w)));
  const levelStart = (level: number, vertical: boolean) => Math.min(...nodes.filter((n) => n.level === level).map((n) => (vertical ? n.box.y : n.box.x)));
  // branches leave the side of the parent that faces the child and bend into the child's near side
  const links: PlacedDLink[] = treeLinks.map((link, k) => {
    const pa = byNode.get(link.from)!, ch = byNode.get(link.to)!;
    const a = pa.box, b = ch.box;
    const vertical = !(mind && shape === "wide") && !(dir === "LR" && !mind);
    let pts: Pt[];
    if (vertical) {
      const p0 = { x: a.x + a.w / 2, y: a.y + a.h + 4 }, p1 = { x: b.x + b.w / 2, y: b.y - 5 };
      const my = (levelEnd(pa.level ?? 0, true) + levelStart(ch.level ?? 1, true)) / 2;
      pts = Math.abs(p0.x - p1.x) < 2 ? [p0, p1] : [p0, { x: p0.x, y: my }, { x: p1.x, y: my }, p1];
    } else {
      const toRight = b.x + b.w / 2 >= a.x + a.w / 2;
      const p0 = { x: toRight ? a.x + a.w + 4 : a.x - 4, y: a.y + a.h / 2 }, p1 = { x: toRight ? b.x - 5 : b.x + b.w + 5, y: b.y + b.h / 2 };
      // a mind map's two sides: the band of this side only
      const side = nodes.filter((n) => n.level === (ch.level ?? 1) && (n.box.x >= a.x) === toRight);
      const mx = mind ? (toRight ? (p0.x + Math.min(...side.map((n) => n.box.x))) / 2 : (p0.x + Math.max(...side.map((n) => n.box.x + n.box.w))) / 2) : (levelEnd(pa.level ?? 0, false) + levelStart(ch.level ?? 1, false)) / 2;
      pts = Math.abs(p0.y - p1.y) < 2 ? [p0, p1] : [p0, { x: mx, y: p0.y }, { x: mx, y: p1.y }, p1];
    }
    const s = lab.get(link) ?? null;
    const label = s ? labelBox(pts, s, font * 0.9) : null;
    return { key: `d:${link.from}>${link.to}:${k}`, step: Math.max(link.step, byNode.get(link.from)!.step, byNode.get(link.to)!.step), from: link.from, to: link.to, pts, label, dashed: Boolean(link.dashed), head: !mind, bound: true };
  });
  return { type: d.type, layout: mind ? "mind" : "tree", nodes, links, lines: [], font };
}

/** A tree as an indented outline (Plait's "indent" layout): one box per row, children under and right of their parent. */
function indented(d: DiagramIn, font: number, parents: Map<string, string>, mind: boolean): PlacedDiagram {
  const kids = new Map<string, string[]>();
  for (const n of d.nodes) { const p = parents.get(n.id); if (p) kids.set(p, [...(kids.get(p) ?? []), n.id]); }
  const rootId = d.nodes.find((n) => !parents.has(n.id))!.id;
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const links: Array<DLink & { step: number }> = mind ? d.nodes.flatMap((n) => (parents.has(n.id) ? [{ from: parents.get(n.id)!, to: n.id, text: "", step: n.step }] : [])) : d.links;
  const lab = new Map(links.map((l) => [l as DLink, mind ? null : labelOf(l.text, font * 0.9, font * 7)]));
  const labelW = Math.max(0, ...[...lab.values()].map((s) => (s ? s.w : 0)));
  const indent = Math.max(font * 1.8, font * 0.8 + labelW / 2 + 12);
  const nodes: PlacedDNode[] = [];
  let y = 0;
  const visit = (id: string, level: number) => {
    const n = byId.get(id)!;
    const s = sizeNode(n.text, n.shape === "diamond" || n.shape === "circle" ? "round" : n.shape, font, font * 12);
    nodes.push({ key: `d:${id}`, id, step: n.step, box: { x: level * indent, y, w: s.w, h: s.h }, lines: s.lines, font, shape: n.shape === "diamond" || n.shape === "circle" ? "round" : n.shape, level });
    y += s.h + font * 0.7;
    (kids.get(id) ?? []).forEach((c) => visit(c, level + 1));
  };
  visit(rootId, 0);
  const at = new Map(nodes.map((n) => [n.id, n]));
  const placed: PlacedDLink[] = links.map((l, k) => {
    const a = at.get(l.from)!.box, b = at.get(l.to)!.box;
    const x = a.x + font * 0.8;
    const pts = [{ x, y: a.y + a.h + 4 }, { x, y: b.y + b.h / 2 }, { x: b.x - 5, y: b.y + b.h / 2 }];
    const s = lab.get(l) ?? null;
    return { key: `d:${l.from}>${l.to}:${k}`, step: Math.max(l.step, at.get(l.from)!.step, at.get(l.to)!.step), from: l.from, to: l.to, pts, label: s ? labelBox(pts, s, font * 0.9) : null, dashed: Boolean(l.dashed), head: !mind, bound: true };
  });
  return { type: d.type, layout: "tree", nodes, links: placed, lines: [], font };
}

// ---------------------------------------------------------------- sequence
function sequence(d: DiagramIn, font: number): PlacedDiagram {
  const parts = d.nodes;
  const sized = parts.map((p) => sizeNode(p.text, "box", font, font * 5.5));
  const col = new Map(parts.map((p, i) => [p.id, i]));
  const lf = font * 0.88;
  const msgs = d.links.filter((l) => col.has(l.from) && col.has(l.to)).map((l) => ({ l, s: labelOf(l.text, lf, font * 8) }));
  // the gap after each column: the boxes, and every label between two neighbouring lifelines
  const gaps = parts.slice(1).map((_, i) => (sized[i].w + sized[i + 1].w) / 2 + font);
  // a message's label is written in one gap between two lifelines (the widest it crosses), never on a lifeline
  const loopW = (s: { w: number } | null) => Math.max(font * 2.4, (s?.w ?? 0) / 2 + 12);
  const gapOf = msgs.map((m) => {
    const a = col.get(m.l.from)!, b = col.get(m.l.to)!;
    const need = (m.s?.w ?? 0) + font * 2;
    if (a === b) { if (a < gaps.length) gaps[a] = Math.max(gaps[a], loopW(m.s) + (m.s?.w ?? 0) / 2 + font * 1.2); return a; }
    const [lo, hi] = a < b ? [a, b] : [b, a];
    let g = lo;
    for (let i = lo; i < hi; i++) if (gaps[i] > gaps[g] + 0.5 || (Math.abs(gaps[i] - gaps[g]) <= 0.5 && Math.abs(i - (lo + hi - 1) / 2) < Math.abs(g - (lo + hi - 1) / 2))) g = i;
    gaps[g] = Math.max(gaps[g], need);
    return g;
  });
  const xs = [0];
  gaps.forEach((g) => xs.push(xs[xs.length - 1] + g));
  const headH = Math.max(...sized.map((s) => s.h));
  const nodes: PlacedDNode[] = parts.map((p, i) => ({ key: `d:${p.id}`, id: p.id, step: p.step, box: { x: xs[i] - sized[i].w / 2, y: 0, w: sized[i].w, h: headH }, lines: sized[i].lines, font, shape: "box" }));
  let y = headH + font * 1.2;
  const links: PlacedDLink[] = msgs.map(({ l, s }, k) => {
    const a = xs[col.get(l.from)!], b = xs[col.get(l.to)!];
    const lh = s ? s.h : 0;
    y += lh + font * 0.9;
    const self = a === b;
    const g = gapOf[k];
    const lw = loopW(s);
    const pts = self ? [{ x: a + 4, y: y - font * 0.6 }, { x: a + lw, y: y - font * 0.6 }, { x: a + lw, y: y + font * 0.6 }, { x: a + 6, y: y + font * 0.6 }] : [{ x: a + (b > a ? 4 : -4), y }, { x: (xs[g] + xs[g + 1]) / 2, y }, { x: b + (b > a ? -6 : 6), y }];
    const label = s ? labelBox(pts, s, lf) : null;
    if (self) y += font * 0.8;
    const step = Math.max(l.step, nodes[col.get(l.from)!].step, nodes[col.get(l.to)!].step);
    return { key: `d:m${k}`, step, from: l.from, to: l.to, pts, label, dashed: Boolean(l.dashed), head: true, bound: false };
  });
  const end = y + font * 1.2;
  const lines: PlacedDLine[] = nodes.map((n) => ({ key: `d:life:${n.id}`, step: n.step, pts: [{ x: n.box.x + n.box.w / 2, y: n.box.y + n.box.h + 4 }, { x: n.box.x + n.box.w / 2, y: end }], dashed: true }));
  return { type: "sequence", layout: "sequence", nodes, links, lines, font };
}

// ---------------------------------------------------------------- table
function table(d: DiagramIn, font: number, maxW: number): PlacedDiagram {
  const rows = d.rows;
  const cols = Math.max(1, ...rows.map((r) => r.cells.length));
  const gap = 4;
  const natural = Array.from({ length: cols }, (_, j) => Math.max(font * 4, ...rows.map((r) => textWidth(r.cells[j] ?? "", font) + 26)));
  const room = maxW - gap * (cols - 1);
  const sum = natural.reduce((s, w) => s + w, 0);
  const widths = sum <= room ? natural : natural.map((w) => Math.max(font * 4, (w / sum) * room));
  const nodes: PlacedDNode[] = [];
  let y = 0;
  rows.forEach((r, i) => {
    const cells = widths.map((w, j) => wrapText(r.cells[j] ?? "", w - 22, font, 3));
    const h = Math.max(...cells.map((c) => c.length)) * font * LINE + 18;
    let x = 0;
    cells.forEach((lines, j) => {
      nodes.push({ key: `d:r${i}`, id: `r${i}c${j}`, step: r.step, box: { x, y, w: widths[j], h }, lines, font, shape: "box", ...(i === 0 ? { fill: "#e7f5ff" } : j === 0 ? { fill: "#f8f9fa" } : {}) });
      x += widths[j] + gap;
    });
    y += h + gap;
  });
  return { type: "table", layout: "table", nodes, links: [], lines: [], font };
}

/**
 * The lesson's one diagram, from all its steps (so that what is placed stays where it is as steps
 * are added), each part with the step that draws it. In a lesson with a flowchart or a mind map,
 * plain boxes and arrows join the diagram; in one with a sequence or a table they are not drawn.
 */
export function collectDiagram(lesson: Lesson): DiagramIn | null {
  let d: DiagramIn | null = null;
  lesson.steps.forEach((s, step) => {
    for (const it of s.items) {
      if (it.kind !== "diagram") continue;
      d ??= { type: it.type, dir: it.dir, nodes: [], links: [], rows: [] };
      if (it.type !== d.type) continue;
      for (const n of it.nodes) if (!d.nodes.some((x) => x.id === n.id)) d.nodes.push({ ...n, step });
      for (const l of it.links) d.links.push({ ...l, step });
      for (const r of it.rows) d.rows.push({ cells: r, step });
    }
  });
  const found = d as DiagramIn | null;
  if (!found) return null;
  if (found.type !== "flowchart" && found.type !== "mindmap") return revealWithSentences(found, lesson);
  lesson.steps.forEach((s, step) => {
    for (const it of s.items) {
      if (it.kind === "node" && !found.nodes.some((x) => x.id === it.id)) found.nodes.push({ id: it.id, text: it.text, shape: "box", step });
      else if (it.kind === "edge" && it.from !== it.to && !found.links.some((l) => l.from === it.from && l.to === it.to)) {
        const to = found.nodes.find((x) => x.id === it.to);
        if (found.type === "mindmap" && to && to.parent === undefined && to !== found.nodes[0]) to.parent = it.from;
        found.links.push({ from: it.from, to: it.to, text: it.text, step });
      }
    }
  });
  const ids = new Set(found.nodes.map((n) => n.id));
  found.links = found.links.filter((l) => ids.has(l.from) && ids.has(l.to));
  return revealWithSentences(found, lesson);
}

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** The sentence names the thing: most of its words (by their first five letters) are in the sentence. */
export function mentions(say: string, text: string): boolean {
  const words = plain(say).split(" ");
  const want = plain(text).split(" ").filter((w) => w.length >= 3);
  if (!want.length) return false;
  const found = want.filter((w) => words.some((s) => s.startsWith(w.slice(0, Math.min(5, w.length))) && s.length >= Math.min(w.length, 3)));
  return found.length >= Math.ceil(want.length * 0.6);
}

/**
 * A diagram written whole in one step is shown part by part, each box (message, row) with the first
 * sentence that names it, so the board follows the voice. A diagram the model already spread over
 * its steps keeps the model's order. What no later sentence names stays in the step that wrote it.
 */
function revealWithSentences(d: DiagramIn, lesson: Lesson): DiagramIn {
  const written = new Set([...d.nodes.map((n) => n.step), ...d.rows.map((r) => r.step)]);
  if (written.size !== 1 || lesson.steps.length < 2) return d;
  const at = [...written][0];
  const says = lesson.steps.map((s) => s.say);
  const when = (text: string) => {
    if (mentions(says[at], text)) return at;
    const k = says.findIndex((s, i) => i > at && mentions(s, text));
    return k > at ? k : at;
  };
  if (d.type === "table") {
    let last = at;
    // the header comes with the first sentence; each row with the sentence that names it, in order
    const rows = d.rows.map((r, i) => { last = i === 0 ? at : Math.max(last, when(r.cells.find((c) => c) ?? "")); return { ...r, step: last }; });
    return { ...d, rows };
  }
  if (d.type === "sequence") {
    let last = at;
    const links = d.links.map((l) => { last = Math.max(last, when(l.text)); return { ...l, step: last }; });
    const nodes = d.nodes.map((n) => ({ ...n, step: Math.min(...links.filter((l) => l.from === n.id || l.to === n.id).map((l) => l.step), when(n.text)) }));
    return { ...d, nodes, links };
  }
  const nodes = d.nodes.map((n) => ({ ...n, step: when(n.text) }));
  // the step that wrote the diagram always draws something of it: its first box
  if (!nodes.some((n) => n.step === at)) nodes[0] = { ...nodes[0], step: at };
  // a box of a tree or a mind map never appears before the box it hangs from
  if (d.type === "mindmap") for (const n of nodes) { const p = nodes.find((x) => x.id === n.parent); if (p && p.step > n.step) n.step = p.step; }
  return { ...d, nodes };
}

/** The diagram placed in `area`: the largest type at which it fits, centred. */
export function layoutDiagram(d: DiagramIn, area: Box, shape: BoardShape): PlacedDiagram {
  const loop = d.type === "flowchart" ? loopOrder(d) : null;
  const useRing = loop && loop.length >= 3 && loop.length * 2 >= d.nodes.length;
  const parents = d.type === "mindmap" ? mindParents(d) : d.type === "flowchart" && !useRing && d.nodes.length >= 4 ? treeParents(d) : null;
  const other = d.dir === "TD" ? "LR" : "TD";
  const aspect = Math.min(1.4, Math.max(0.7, area.w / Math.max(1, area.h)));
  // the arrangement that suits the diagram first; the others when it does not fit the room
  const attempts = (font: number): Array<() => PlacedDiagram> => {
    if (d.type === "sequence") return [() => sequence(d, font)];
    if (d.type === "table") return [() => table(d, font, area.w)];
    if (parents && d.type === "mindmap") return [() => tree(d, font, parents, true, shape), () => tree(d, font, parents, true, "tall")];
    // a long process that fits neither way is folded into lines, as text is
    const fold = () => layered(d, font, "LR", area.w);
    if (parents) return [() => tree(d, font, parents, false, shape, d.dir), () => tree(d, font, parents, false, shape, other), () => layered(d, font, d.dir), () => layered(d, font, other), fold];
    if (useRing) return [() => ring(d, font, loop!, aspect), () => ring(d, font, loop!, aspect, true), () => layered(d, font, d.dir), () => layered(d, font, other), fold];
    return [() => layered(d, font, d.dir), () => layered(d, font, other), fold];
  };
  const fits = (p: PlacedDiagram) => { const b = diagramBounds(p); return b.w <= area.w && b.h <= area.h && clean(p); };
  // The arrangement that suits the diagram, as large as it fits (down to 15); then the next one;
  // an indented outline for a tree that is too wide; only then type below 15.
  let pick: PlacedDiagram | null = null;
  // Arrangements of the same kind (a tree down or across, layers down or across) compete on size:
  // the one whose type can be larger wins, the diagram's own direction on a tie.
  const groups = parents && d.type !== "mindmap" ? [[0, 1], [2, 3], [4]] : useRing && d.type === "flowchart" ? [[0, 1], [2, 3], [4]] : d.type === "flowchart" ? [[0, 1], [2]] : parents ? [[0, 1]] : [[0]];
  const tries = (fonts: number[]) => {
    for (const group of groups) {
      let best: { font: number; p: PlacedDiagram } | null = null;
      for (const a of group) for (const font of fonts) {
        if (best && font <= best.font) break;
        const p = attempts(font)[a]();
        if (fits(p)) { best = { font, p }; break; }
      }
      if (best) { pick = best.p; return; }
    }
    if (parents) for (const font of fonts) { const p = indented(d, font, parents, d.type === "mindmap"); if (fits(p)) { pick = p; break; } }
  };
  tries(FONTS.filter((f) => f >= 15));
  if (!pick) tries(FONTS.filter((f) => f < 15));
  let placed: PlacedDiagram;
  if (pick) placed = pick;
  else {
    // still too big at the smallest type: the whole drawing is made smaller, so nothing leaves the board
    const smallest = FONTS[FONTS.length - 1];
    const all = [...attempts(smallest).map((make) => make()), ...(parents ? [indented(d, smallest, parents, d.type === "mindmap")] : [])];
    // the tidiest first (fewest things touching, fewest arrows through boxes), then the largest
    const best = all.sort((p, q) => mess(p) - mess(q) || fitScale(q, area) - fitScale(p, area))[0];
    placed = scaled(best, fitScale(best, area));
  }
  const b = diagramBounds(placed);
  return shift(placed, area.x + (area.w - b.w) / 2 - b.x, area.y + (area.h - b.h) / 2 - b.y);
}

/** How untidy a placed diagram is: boxes and labels that touch, and arrows through boxes they do not join. */
function mess(p: PlacedDiagram, stopAt = Infinity): number {
  let n = 0;
  const things = [...p.nodes.map((nd) => nd.box), ...p.links.flatMap((l) => (l.label ? [l.label.box] : []))];
  for (let i = 0; i < things.length && n < stopAt; i++) for (let j = i + 1; j < things.length; j++) if (overlaps(things[i], things[j], 1)) n++;
  if (p.type === "sequence") return n;
  for (const l of p.links) {
    if (n >= stopAt) break;
    const others = p.nodes.filter((nd) => nd.id !== l.from && nd.id !== l.to).map((nd) => ({ x: nd.box.x + 2, y: nd.box.y + 2, w: nd.box.w - 4, h: nd.box.h - 4 }));
    let through = false;
    for (let s = 1; s < l.pts.length && !through; s++) for (let k = 0; k <= 10 && !through; k++) {
      const q = { x: l.pts[s - 1].x + ((l.pts[s].x - l.pts[s - 1].x) * k) / 10, y: l.pts[s - 1].y + ((l.pts[s].y - l.pts[s - 1].y) * k) / 10, w: 0, h: 0 };
      through = others.some((b) => overlaps(b, q));
    }
    if (through) n++;
  }
  return n;
}
/** No two boxes and labels touch (cells of a table are boxes too), and no arrow runs through a box it does not join. */
const clean = (p: PlacedDiagram) => mess(p, 1) === 0;
const fitScale = (p: PlacedDiagram, area: Box) => { const b = diagramBounds(p); return Math.min(1, area.w / Math.max(1, b.w), area.h / Math.max(1, b.h)) * 0.999; };
function scaled(d: PlacedDiagram, k: number): PlacedDiagram {
  const p = (q: Pt) => ({ x: q.x * k, y: q.y * k });
  const b = (q: Box) => ({ x: q.x * k, y: q.y * k, w: q.w * k, h: q.h * k });
  return {
    ...d,
    font: d.font * k,
    nodes: d.nodes.map((n) => ({ ...n, box: b(n.box), font: n.font * k })),
    links: d.links.map((l) => ({ ...l, pts: l.pts.map(p), label: l.label ? { ...l.label, box: b(l.label.box), font: l.label.font * k } : null })),
    lines: d.lines.map((l) => ({ ...l, pts: l.pts.map(p) })),
  };
}

/** A mind map's parents, from its branches; a box with none hangs under the first box (its root). */
function mindParents(d: DiagramIn): Map<string, string> | null {
  if (!d.nodes.length) return null;
  const root = d.nodes[0].id;
  const parents = new Map<string, string>();
  for (const n of d.nodes.slice(1)) parents.set(n.id, n.parent && d.nodes.some((x) => x.id === n.parent) ? n.parent : root);
  return parents;
}
