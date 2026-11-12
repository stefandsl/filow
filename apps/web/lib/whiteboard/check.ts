// The look in code at a board (the "see" of see-and-fix): text that spills out of its box, things
// that overlap, arrows that run through a box they do not join, anything off the board. Every
// problem names the elements by id, so a fix can be asked for concretely ("move a-sun-leaf-t").
// fixOps turns the problems into edits a layout engine can make without a model: smaller type, a
// bent arrow, a label slid along its arrow, a thing moved back onto the board. Pure: no DOM; in the
// page the text sizes come from Excalidraw's own measuring first, in tests and scripts from estimates.
import { boundsOf, keyOf, type ExEl, type Scene } from "./scene";
import type { Box } from "./layout";
import type { ToolOp } from "./doc";
import { chemText, texToText } from "./tex";

export type ProblemKind = "overflow" | "overlap" | "crossing" | "offscreen" | "math" | "orphan" | "wording" | "dangling";
export type Problem = { kind: ProblemKind; ids: string[]; message: string };
export type CheckCounts = Record<ProblemKind, number>;

const PAD = 3;
const boxOf = (e: ExEl): Box => boundsOf([e]) ?? { x: e.x, y: e.y, w: e.width, h: e.height };
const overlap = (a: Box, b: Box, gap = 0) => a.x < b.x + b.w - gap && b.x < a.x + a.w - gap && a.y < b.y + b.h - gap && b.y < a.y + a.h - gap;
const contains = (outer: Box, inner: Box, slack = 0.5) => inner.x >= outer.x - slack && inner.y >= outer.y - slack && inner.x + inner.w <= outer.x + outer.w + slack && inner.y + inner.h <= outer.y + outer.h + slack;
const shrink = (b: Box, d: number): Box => ({ x: b.x + d, y: b.y + d, w: Math.max(0, b.w - 2 * d), h: Math.max(0, b.h - 2 * d) });
const role = (e: ExEl) => e.customData?.wb?.role;
const isShape = (e: ExEl) => ["rectangle", "ellipse", "diamond", "image"].includes(e.type) && e.id !== "wb-frame" && role(e) !== "mark" && (e.opacity ?? 100) >= 60 && e.width >= 20 && e.height >= 20;

/** Points along an arrow or line as Excalidraw draws it (a smooth curve through its points when it is rounded). */
export function pathPoints(e: ExEl, per = 16): Array<{ x: number; y: number }> {
  const p = (e.points ?? []).map(([x, y]) => ({ x: e.x + x, y: e.y + y }));
  if (p.length < 2) return p;
  if (!e.roundness || p.length === 2) {
    const out: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < p.length - 1; i++) for (let k = 0; k < per; k++) out.push({ x: p[i].x + ((p[i + 1].x - p[i].x) * k) / per, y: p[i].y + ((p[i + 1].y - p[i].y) * k) / per });
    out.push(p[p.length - 1]);
    return out;
  }
  // Catmull-Rom through the points (the curve Excalidraw's rounded arrows follow)
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[Math.max(0, i - 1)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(p.length - 1, i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  out.push(p[p.length - 1]);
  return out;
}

/** Shapes an arrow runs through without joining them (its own ends and its label do not count). */
function crossed(a: ExEl, shapes: ExEl[], byId: Map<string, ExEl>): ExEl[] {
  const ends = new Set([a.startBinding?.elementId, a.endBinding?.elementId].filter(Boolean) as string[]);
  const pts = pathPoints(a);
  // the first and last bit of an arrow sits at the edge of the boxes it joins
  const inner = pts.slice(Math.ceil(pts.length * 0.08), Math.floor(pts.length * 0.92));
  const hits: ExEl[] = [];
  for (const s of shapes) {
    if (ends.has(s.id) || keyOf(s) === keyOf(a)) continue;
    // a shape that holds one of the arrow's ends (a cell row, a group) is not crossed either
    if ([...ends].some((id) => { const end = byId.get(id); return end && contains(boxOf(s), boxOf(end)); })) continue;
    const b = shrink(boxOf(s), 4);
    if (inner.some((pt) => pt.x > b.x && pt.x < b.x + b.w && pt.y > b.y && pt.y < b.y + b.h)) hits.push(s);
  }
  return hits;
}

/** A word of the label that the wrapped text breaks over two lines ("Sunlig / ht"). Scripts without spaces are broken anywhere by design. */
export function brokenWord(t: ExEl): boolean {
  const original = String(t.originalText ?? "");
  if (!original.trim() || /[⺀-￿]/.test(original)) return false;
  // a compound broken after its hyphen ("alpha-" / "Ketoglutarate") is broken where it may be
  const lines = String(t.text ?? "").replace(/-\n/g, "-").split("\n");
  return original.split(/\s+/).filter(Boolean).some((w) => !lines.some((ln) => ln.split(/\s+/).includes(w)));
}

/** Text that is mathematics left as code or words: a caret or an underscore power, a LaTeX command, the word "arrow" between terms, or a chemical formula whose counts are not subscripts. */
export function rawMath(s: string): boolean {
  if (/\w\^\{?\w|\w_\{|\\[a-zA-Z]{2,}|\s(?:arrow|->)\s/.test(s)) return true;
  // an equation ("+", "=", an arrow) with a formula whose counts are plain digits: "6CO2 + 6H2O"
  return /[+=→]/.test(s) && /(?:^|[\s(])\d*(?:[A-Z][a-z]?\d*)*[A-Z][a-z]?\d+(?=[\s)+=→,.]|$)/.test(s);
}
/** A doubled word ("layer layer") or a tautology ("23 is 23", "the middle value 23 is 23"). */
export function badWording(s: string): boolean {
  return /\b(\p{L}{2,})\s+\1\b/iu.test(s) || /(?:^|[\s(])([\p{L}\d][\p{L}\d.,-]*) (?:is|equals) \1(?=[\s.,;:)]|$)/iu.test(s);
}

export function checkScene(scene: Scene): Problem[] {
  const els = scene.elements.filter((e) => !e.isDeleted && (e.opacity ?? 100) > 5);
  const byId = new Map(els.map((e) => [e.id, e]));
  const frame = byId.get("wb-frame");
  const problems: Problem[] = [];
  // 1. text larger than the box it is written in
  for (const t of els) {
    if (t.type !== "text" || !t.containerId) continue;
    const c = byId.get(t.containerId);
    if (!c || c.type === "arrow" || c.type === "line") continue;
    const room = c.type === "rectangle" ? shrink(boxOf(c), PAD) : { x: c.x + c.width * 0.15, y: c.y + c.height * 0.15, w: c.width * 0.7, h: c.height * 0.7 };
    if (!contains(room, boxOf(t), 1)) problems.push({ kind: "overflow", ids: [t.id, c.id], message: `text ${t.id} does not fit in ${c.id}` });
    else if (brokenWord(t)) problems.push({ kind: "overflow", ids: [t.id, c.id], message: `text ${t.id} has a word broken in two (it is too wide for ${c.id})` });
  }
  // 2. things that overlap: shapes, free text and arrow labels; one thing's parts (same key) may touch
  const solid = els.filter((e) => isShape(e) || (e.type === "text" && (!e.containerId || byId.get(e.containerId)?.type === "arrow")));
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i], b = solid[j];
      if (keyOf(a) === keyOf(b) || a.containerId === b.id || b.containerId === a.id) continue;
      const A = boxOf(a), B = boxOf(b);
      // a box drawn inside another on purpose (a zone, a group) is not an overlap
      if ((isShape(a) && isShape(b)) && (contains(A, B) || contains(B, A))) continue;
      if (overlap(A, B, 1)) problems.push({ kind: "overlap", ids: [a.id, b.id], message: `${a.id} overlaps ${b.id}` });
    }
  }
  // 3. arrows through boxes they do not join
  const shapes = els.filter(isShape);
  for (const a of els) {
    // Filow's arrows between boxes; in a board from elsewhere, any arrow bound to a shape
    if (a.type !== "arrow" || !(role(a) === "edge" || (!role(a) && (a.startBinding || a.endBinding)))) continue;
    for (const s of crossed(a, shapes, byId)) problems.push({ kind: "crossing", ids: [a.id, s.id], message: `arrow ${a.id} runs through ${s.id}` });
  }
  // 5. mathematics left as code or words ("a^2", "\frac", "x_1", "Sunlight arrow", "CO2" in an equation)
  for (const t of els) if (t.type === "text" && rawMath(String(t.originalText ?? t.text ?? ""))) problems.push({ kind: "math", ids: [t.id], message: `${t.id} shows mathematics as code or words` });
  // 6. a box of a concept map that no arrow joins to the rest
  for (const s of els) {
    if (s.customData?.wb?.role !== "node" || !keyOf(s).startsWith("n:")) continue;
    if (!els.some((a) => a.type === "arrow" && (a.startBinding?.elementId === s.id || a.endBinding?.elementId === s.id))) problems.push({ kind: "orphan", ids: [s.id], message: `${s.id} is joined to nothing` });
  }
  // 7. words a board must not show: a word doubled ("Input Layer layer"), a sentence that says a thing is itself
  for (const t of els) if (t.type === "text" && badWording(String(t.originalText ?? t.text ?? ""))) problems.push({ kind: "wording", ids: [t.id], message: `${t.id} doubles a word or says nothing` });
  // 8. an arrow that leaves one shape and ends on nothing (or starts on nothing and ends on a shape)
  for (const a of els) if (a.type === "arrow" && Boolean(a.startBinding) !== Boolean(a.endBinding) && a.customData?.wb?.role !== "pointer") problems.push({ kind: "dangling", ids: [a.id], message: `arrow ${a.id} is joined at one end only` });
  // 4. off the board
  if (frame) {
    const board = boxOf(frame);
    for (const e of els) if (e !== frame && !contains(board, boxOf(e), 2)) problems.push({ kind: "offscreen", ids: [e.id], message: `${e.id} is off the board` });
  }
  return problems;
}

export const countProblems = (ps: Problem[]): CheckCounts => ({
  overflow: ps.filter((p) => p.kind === "overflow").length,
  overlap: ps.filter((p) => p.kind === "overlap").length,
  crossing: ps.filter((p) => p.kind === "crossing").length,
  offscreen: ps.filter((p) => p.kind === "offscreen").length,
  math: ps.filter((p) => p.kind === "math").length,
  orphan: ps.filter((p) => p.kind === "orphan").length,
  wording: ps.filter((p) => p.kind === "wording").length,
  dangling: ps.filter((p) => p.kind === "dangling").length,
});

/** A label's box when its centre is at `pt`. */
const centredAt = (t: ExEl, pt: { x: number; y: number }): Box => ({ x: pt.x - t.width / 2, y: pt.y - t.height / 2, w: t.width, h: t.height });

/**
 * Edits that fix what the check found, without a model: a text that spills is set smaller (down to a
 * readable 13) or its box grows; an arrow through a box is bent round it; an arrow label on something
 * slides along its arrow to a free place; a thing off the board comes back on. What cannot be fixed
 * this way is left for the next look (and reported).
 */
export function fixOps(scene: Scene, problems: Problem[]): ToolOp[] {
  const els = scene.elements.filter((e) => !e.isDeleted);
  const byId = new Map(els.map((e) => [e.id, e]));
  const frame = byId.get("wb-frame");
  const board = frame ? boxOf(frame) : boundsOf(els) ?? { x: 0, y: 0, w: 1200, h: 720 };
  const ops: ToolOp[] = [];
  const done = new Set<string>();
  const shapes = els.filter(isShape);
  const solid = els.filter((e) => isShape(e) || (e.type === "text" && !e.containerId));
  const free = (b: Box, skip: Set<string>) => contains(board, b) && !solid.some((s) => !skip.has(s.id) && overlap(boxOf(s), b, -2));
  for (const p of problems) {
    if (p.kind === "overflow") {
      const [tid, cid] = p.ids;
      const t = byId.get(tid), c = byId.get(cid);
      // only text in a shape: an arrow's label is moved, never its arrow
      if (!t || !c || done.has(tid) || c.type === "arrow" || c.type === "line") continue;
      done.add(tid);
      const size = t.fontSize ?? 20;
      const fit = Math.min((c.width - 2 * PAD - 4) / Math.max(1, t.width), (c.height - 2 * PAD - 2) / Math.max(1, t.height));
      const next = Math.max(13, Math.floor(size * Math.min(0.92, fit)));
      if (next < size) ops.push({ op: "update", id: tid, props: { fontSize: next, width: (t.width * next) / size, height: (t.height * next) / size, x: c.x + c.width / 2 - (t.width * next) / size / 2, y: c.y + c.height / 2 - (t.height * next) / size / 2 } });
      else {
        // already as small as it reads: the box grows instead, around its centre
        const w = Math.max(c.width, t.width + 2 * PAD + 12), h = Math.max(c.height, t.height + 2 * PAD + 8);
        ops.push({ op: "update", id: cid, props: { x: c.x - (w - c.width) / 2, y: c.y - (h - c.height) / 2, width: w, height: h } });
      }
    } else if (p.kind === "crossing") {
      const a = byId.get(p.ids[0]);
      if (!a || done.has(a.id) || !a.points || a.points.length < 2) continue;
      done.add(a.id);
      const start = { x: a.x + a.points[0][0], y: a.y + a.points[0][1] };
      const end = { x: a.x + a.points[a.points.length - 1][0], y: a.y + a.points[a.points.length - 1][1] };
      const m = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      const len = Math.hypot(end.x - start.x, end.y - start.y) || 1;
      const nx = -(end.y - start.y) / len, ny = (end.x - start.x) / len;
      // a smooth bend to one side, further and further; else round the box it crossed, over or under
      const tries: Array<Array<{ x: number; y: number }>> = [50, -50, 90, -90, 140, -140, 200, -200, 280, -280].map((off) => [start, { x: m.x + nx * off, y: m.y + ny * off }, end]);
      const hit = byId.get(p.ids[1]);
      if (hit) {
        const hb = boxOf(hit);
        const l = Math.min(start.x, end.x) < hb.x ? hb.x - 24 : hb.x + hb.w + 24;
        const r = l === hb.x - 24 ? hb.x + hb.w + 24 : hb.x - 24;
        for (const y of [hb.y - 28, hb.y + hb.h + 28]) tries.push([start, { x: l, y }, { x: r, y }, end]);
      }
      for (const route of tries) {
        const pts = route.map((pt) => [pt.x - start.x, pt.y - start.y] as [number, number]);
        const trial: ExEl = { ...a, x: start.x, y: start.y, points: pts, roundness: { type: 2 } };
        if (!crossed(trial, shapes, byId).length && contains(board, boxOf(trial), 2)) {
          ops.push({ op: "update", id: a.id, props: { x: start.x, y: start.y, points: pts, roundness: { type: 2 } } });
          const lid = a.boundElements?.find((b) => b.type === "text")?.id;
          const lab = lid ? byId.get(lid) : undefined;
          // its label goes to the middle of the new path
          const mid = pathPoints(trial, 12);
          const at = mid[Math.floor(mid.length / 2)];
          if (lab && at) ops.push({ op: "update", id: lab.id, props: { x: at.x - lab.width / 2, y: at.y - lab.height / 2 } });
          break;
        }
      }
    } else if (p.kind === "overlap") {
      // an arrow label slides along its arrow; a free text moves to the nearest free place below or beside
      for (const id of p.ids) {
        const t = byId.get(id);
        if (!t || t.type !== "text" || done.has(id)) continue;
        const host = t.containerId ? byId.get(t.containerId) : undefined;
        if (t.containerId && host?.type !== "arrow") continue;
        done.add(id);
        const skip = new Set([id, ...(host ? [host.id] : [])]);
        let spot: Box | null;
        if (host) {
          const pts = pathPoints(host, 24);
          const order = pts.map((pt, k) => ({ pt, k })).sort((u, v) => Math.abs(u.k - pts.length / 2) - Math.abs(v.k - pts.length / 2));
          spot = order.map(({ pt }) => centredAt(t, pt)).find((b) => free(b, skip)) ?? null;
        } else {
          const tries = [0, 1, 2, 3, 4, 5, 6].flatMap((k) => [{ x: t.x, y: t.y + 18 * k }, { x: t.x + 24 * k, y: t.y }, { x: t.x, y: t.y - 18 * k }]);
          spot = tries.map((pt) => ({ x: pt.x, y: pt.y, w: t.width, h: t.height })).find((b) => free(b, skip)) ?? null;
        }
        if (spot) ops.push({ op: "update", id, props: { x: spot.x, y: spot.y } });
        break;
      }
    } else if (p.kind === "math") {
      // mathematics written as code or words is written as mathematics
      const t = byId.get(p.ids[0]);
      if (!t || done.has(t.id)) continue;
      done.add(t.id);
      const fix = (s: string) => chemText(/[\\^_]/.test(s) ? texToText(s) : s);
      const was = String(t.text ?? "");
      const now = was.split("\n").map(fix).join("\n");
      if (now !== was) ops.push({ op: "update", id: t.id, props: { text: now, originalText: fix(String(t.originalText ?? was)) } });
    } else if (p.kind === "offscreen") {
      const e = byId.get(p.ids[0]);
      if (!e || done.has(e.id) || e.containerId) continue;
      done.add(e.id);
      const b = boxOf(e);
      const dx = b.x < board.x ? board.x - b.x + 4 : b.x + b.w > board.x + board.w ? board.x + board.w - (b.x + b.w) - 4 : 0;
      const dy = b.y < board.y ? board.y - b.y + 4 : b.y + b.h > board.y + board.h ? board.y + board.h - (b.y + b.h) - 4 : 0;
      if (dx || dy) {
        ops.push({ op: "update", id: e.id, props: { x: e.x + dx, y: e.y + dy } });
        for (const bt of e.boundElements ?? []) {
          const l = byId.get(bt.id);
          if (bt.type === "text" && l) ops.push({ op: "update", id: l.id, props: { x: l.x + dx, y: l.y + dy } });
        }
      }
    }
  }
  return ops;
}
