// The Excalidraw elements of a placed structured diagram (diagram-layout.ts), one step at a time:
// only Filow's own element types (rectangle, diamond, ellipse, text, arrow, line), no HTML, no images.
import type { PlacedDiagram } from "./diagram-layout";
import { arrow, el, HAND_SCALE, INK, labelled, line, safeId, stepColour, text, type ExEl, type WbMeta } from "./scene";

const TYPE = { box: "rectangle", round: "rectangle", diamond: "diamond", circle: "ellipse" } as const;
export const diagramNodeId = (id: string) => `d-${safeId(id)}`;

/** What step `step` adds to the diagram: its boxes with their words, then the arrows that join drawn boxes, then lifelines. */
export function diagramEls(d: PlacedDiagram, step: number, shapes: Map<string, ExEl>): ExEl[] {
  const out: ExEl[] = [];
  const table = d.type === "table";
  for (const n of d.nodes) {
    if (n.step !== step) continue;
    const meta: WbMeta = { step, key: n.key, role: "node" };
    const id = diagramNodeId(n.id);
    const shape = el(id, TYPE[n.shape], n.box, meta, {
      strokeColor: table ? INK.soft : stepColour(n.step),
      strokeWidth: table ? 1.5 : 2,
      roundness: n.shape === "round" || (n.shape === "box" && !table) ? { type: 3 } : null,
      ...(n.fill ? { backgroundColor: n.fill, fillStyle: "solid" } : {}),
    });
    const words = n.lines.join(" ");
    shapes.set(n.id, shape);
    // an empty cell of a table is a shape alone (Excalidraw drops an empty text when a file is opened)
    if (!words.trim()) { shape.customData = { wb: { ...meta, role: "block" } }; out.push(shape); continue; }
    // the layout sized the box for these lines at this size: written as planned (fitLabel would round small type up)
    const label = text(`${id}-t`, n.lines, Math.round(n.font * HAND_SCALE * 10) / 10, { cx: n.box.x + n.box.w / 2, cy: n.box.y + n.box.h / 2 }, { ...meta, role: "label" }, { originalText: words });
    out.push(...labelled(shape, label));
  }
  let edgeOrder = 0;
  d.links.forEach((l) => {
    if (l.step !== step) return;
    const fromShape = shapes.get(l.from);
    const toShape = shapes.get(l.to);
    const directed = l.head && fromShape && toShape;
    const meta: WbMeta = { step, key: l.key, role: "edge", ...(directed ? { from: fromShape.id, to: toShape.id, order: edgeOrder++ } : {}) };
    const id = `da-${safeId(l.key.slice(2))}`;
    const from = l.bound ? fromShape : undefined;
    const to = l.bound ? toShape : undefined;
    const a = arrow(id, l.pts, meta, {
      strokeStyle: l.dashed ? "dashed" : "solid",
      endArrowhead: l.head ? "arrow" : null,
      // square bends stay square (a tree's branches, a message); other routes are drawn as curves through their points
      roundness: l.pts.length > 2 && !l.pts.slice(1).every((p, i) => Math.abs(p.x - l.pts[i].x) < 0.5 || Math.abs(p.y - l.pts[i].y) < 0.5) ? { type: 2 } : null,
      startBinding: from && to ? { elementId: from.id, focus: 0, gap: 5 } : null,
      endBinding: from && to ? { elementId: to.id, focus: 0, gap: 5 } : null,
    });
    if (from && to) {
      from.boundElements = [...(from.boundElements ?? []), { id, type: "arrow" }];
      if (to !== from) to.boundElements = [...(to.boundElements ?? []), { id, type: "arrow" }];
    }
    if (!l.label) { out.push(a); return; }
    const lb = l.label.box;
    const words = l.label.lines.join(" ");
    out.push(...labelled(a, text(`${id}-t`, l.label.lines, Math.round(l.label.font * 0.95), { cx: lb.x + lb.w / 2, cy: lb.y + lb.h / 2 }, { step, key: l.key, role: "label" }, { strokeColor: INK.soft, originalText: words })));
  });
  for (const ln of d.lines) if (ln.step === step) out.push(line(`dl-${safeId(ln.key.slice(2))}`, ln.pts, { step, key: ln.key, role: "block" }, { strokeColor: INK.faint, strokeStyle: "dashed", strokeWidth: 1.5 }));
  return out;
}
