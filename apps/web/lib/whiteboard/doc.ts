// The board as a document: the scene a lesson compiles to (scene.ts), plus what was changed on it
// afterwards, by the user's hand on the Excalidraw canvas or by Filow answering a follow-up
// ("make the arrow red"). Edits are kept by element id, apart from the compiled scene, so a lesson
// that grows by a step or is laid out again keeps them. This file also reads and writes
// .excalidraw files and is the tool surface an agent drives the board with (read_scene,
// add/update/delete by id, snapshot/restore, camera). Pure: no DOM.
import { boundsOf, safeId, stepOf, type BinaryFile, type ExEl, type Scene } from "./scene";
import type { Box } from "./layout";
import { EDIT_COLOURS, type EditChange } from "./edits";

export type SceneEdits = {
  /** Changed properties of compiled elements, by id. */
  patch: Record<string, Partial<ExEl>>;
  /** Elements that are not in the compiled scene (drawn by hand or added by a tool). */
  added: ExEl[];
  /** Compiled elements taken off the board. */
  deleted: string[];
  files: Record<string, BinaryFile>;
};
export const noEdits = (): SceneEdits => ({ patch: {}, added: [], deleted: [], files: {} });
export const hasEdits = (e: SceneEdits) => Object.keys(e.patch).length > 0 || e.added.length > 0 || e.deleted.length > 0;

/** Properties an edit may change; ids, types and Filow's own notes are never rewritten. */
const EDITABLE = ["x", "y", "width", "height", "angle", "strokeColor", "backgroundColor", "fillStyle", "strokeWidth", "strokeStyle", "roughness", "opacity", "roundness", "text", "originalText", "fontSize", "fontFamily", "textAlign", "verticalAlign", "points", "startArrowhead", "endArrowhead", "startBinding", "endBinding", "boundElements", "locked", "groupIds", "lineHeight", "autoResize", "scale", "crop"] as const;
type Editable = (typeof EDITABLE)[number];

/** The scene as it stands: compiled elements with their edits, then the added ones. */
export function applyEdits(base: Scene, edits: SceneEdits): Scene {
  const gone = new Set(edits.deleted);
  const els: ExEl[] = [];
  for (const e of base.elements) {
    if (gone.has(e.id)) continue;
    const p = edits.patch[e.id];
    els.push(p ? { ...e, ...p, version: (e.version ?? 1) + 1 } : e);
  }
  const have = new Set(els.map((e) => e.id));
  for (const a of edits.added) if (!have.has(a.id)) els.push(a);
  return { elements: els, files: { ...base.files, ...edits.files } };
}

/** Equal up to half a pixel: the canvas measures and rounds on its own, which is not a change by the user. */
const rounded = (v: unknown) => JSON.stringify(v, (_k, x: unknown) => (typeof x === "number" ? Math.round(x * 2) / 2 : x));
const same = (a: unknown, b: unknown) => rounded(a) === rounded(b);

/** What the user changed: the canvas's elements compared with the scene as it was before. */
export function diffEdits(base: Scene, before: SceneEdits, now: ExEl[], files: Record<string, BinaryFile> = {}): SceneEdits {
  const out: SceneEdits = { patch: {}, added: [], deleted: [], files: { ...before.files } };
  const compiled = new Map(base.elements.map((e) => [e.id, e]));
  const seen = new Set<string>();
  for (const e of now) {
    if (e.isDeleted) continue;
    seen.add(e.id);
    const c = compiled.get(e.id);
    if (!c) {
      out.added.push(cleanElement(e));
      if (e.fileId && files[e.fileId]) out.files[e.fileId] = files[e.fileId];
      continue;
    }
    const patch: Partial<ExEl> = {};
    for (const k of EDITABLE) if (e[k] !== undefined && !same(e[k], c[k])) (patch as Record<Editable, unknown>)[k] = e[k];
    if (Object.keys(patch).length) out.patch[e.id] = patch;
  }
  for (const id of compiled.keys()) if (!seen.has(id) && id !== "wb-frame") out.deleted.push(id);
  return out;
}

// ---- .excalidraw files ----

export const MAX_FILE_ELEMENTS = 3000;
const TYPES = new Set(["rectangle", "ellipse", "diamond", "text", "arrow", "line", "freedraw", "image", "frame"]);
const IMAGE_TYPES = /^data:image\/(?:png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
const COLOUR = /^(?:#[0-9a-fA-F]{3,8}|transparent|[a-z]{3,20})$/;
const finite = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? Math.max(-1e6, Math.min(1e6, v)) : d);

/** An element read from a file, kept to what Excalidraw draws: no links (a link can be a script), sane numbers and colours. */
export function cleanElement(raw: ExEl): ExEl {
  const e: ExEl = { ...raw, id: safeId(String(raw.id ?? "")) || `e${Math.random().toString(36).slice(2, 10)}` };
  e.x = finite(raw.x); e.y = finite(raw.y); e.width = finite(raw.width); e.height = finite(raw.height);
  e.link = null;
  for (const k of ["strokeColor", "backgroundColor"] as const) if (typeof e[k] !== "string" || !COLOUR.test(e[k] as string)) e[k] = k === "strokeColor" ? "#1e1e1e" : "transparent";
  if (e.type === "text") {
    e.text = String(raw.text ?? "").slice(0, 2000);
    e.originalText = String(raw.originalText ?? e.text).slice(0, 2000);
    e.fontSize = Math.max(4, Math.min(200, finite(raw.fontSize, 20)));
  }
  if (Array.isArray(raw.points)) e.points = raw.points.slice(0, 2000).map((p) => [finite(p?.[0]), finite(p?.[1])] as [number, number]);
  return e;
}

/** A board read from a .excalidraw file (or the clipboard JSON Excalidraw writes). Null when it is not one. */
export function parseExcalidrawFile(text: string): Scene | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { type?: unknown; elements?: unknown; files?: unknown };
  if ((r.type !== "excalidraw" && r.type !== "excalidraw/clipboard") || !Array.isArray(r.elements)) return null;
  const elements = r.elements.slice(0, MAX_FILE_ELEMENTS).filter((x): x is ExEl => Boolean(x) && typeof x === "object" && TYPES.has(String((x as ExEl).type)) && !(x as ExEl).isDeleted).map(cleanElement);
  const files: Record<string, BinaryFile> = {};
  if (r.files && typeof r.files === "object") {
    for (const [id, f] of Object.entries(r.files as Record<string, BinaryFile>).slice(0, 200)) {
      if (f && typeof f.dataURL === "string" && f.dataURL.length < 8_000_000 && IMAGE_TYPES.test(f.dataURL)) files[safeId(id)] = { id: safeId(id), mimeType: String(f.mimeType || "image/png"), dataURL: f.dataURL, created: finite(f.created, 1) };
    }
  }
  return { elements, files };
}

/** The board as a .excalidraw file: Excalidraw opens it as it is, Filow's step notes ride along in customData. */
export function excalidrawFile(scene: Scene, dark = false): string {
  const used = new Set(scene.elements.map((e) => e.fileId).filter(Boolean));
  const files = Object.fromEntries(Object.entries(scene.files).filter(([id]) => used.has(id)));
  return JSON.stringify({ type: "excalidraw", version: 2, source: "filow", elements: scene.elements.filter((e) => e.id !== "wb-frame"), appState: { viewBackgroundColor: "#ffffff", gridSize: null, theme: dark ? "dark" : "light" }, files }, null, 1);
}

// ---- the tool surface ----

export type ElementSummary = { id: string; type: string; step: number; text?: string; x: number; y: number; w: number; h: number; stroke?: string; fill?: string; from?: string; to?: string };

/** read_scene: the board in a few words per element, for a model or an agent (no coordinates are asked back). */
export function readScene(scene: Scene): ElementSummary[] {
  const byId = new Map(scene.elements.map((e) => [e.id, e]));
  const labelOf = (e: ExEl) => {
    const b = e.boundElements?.find((x) => x.type === "text");
    const t = b ? byId.get(b.id) : undefined;
    return t?.originalText ?? t?.text;
  };
  return scene.elements.filter((e) => e.id !== "wb-frame" && !e.isDeleted && !(e.type === "text" && e.containerId)).map((e) => ({
    id: e.id, type: e.type, step: stepOf(e), x: Math.round(e.x), y: Math.round(e.y), w: Math.round(e.width), h: Math.round(e.height),
    ...(e.type === "text" ? { text: e.originalText ?? e.text } : labelOf(e) ? { text: labelOf(e) } : {}),
    ...(e.strokeColor && e.strokeColor !== "transparent" ? { stroke: e.strokeColor } : {}),
    ...(e.backgroundColor && e.backgroundColor !== "transparent" ? { fill: e.backgroundColor } : {}),
    ...(e.startBinding ? { from: e.startBinding.elementId } : {}),
    ...(e.endBinding ? { to: e.endBinding.elementId } : {}),
  }));
}

export type ToolOp =
  | { op: "update"; id: string; props: Partial<ExEl> }
  | { op: "delete"; id: string }
  | { op: "add"; element: ExEl };

/** The elements that go with `id` when it is deleted or recoloured: its label, and for a box the arrows bound to it. */
export function companions(scene: Scene, id: string): string[] {
  const e = scene.elements.find((x) => x.id === id);
  if (!e) return [];
  const out = (e.boundElements ?? []).filter((b) => b.type === "text").map((b) => b.id);
  return out;
}

/** Applies tool operations to the edits; unknown ids are skipped and reported. */
export function applyOps(base: Scene, edits: SceneEdits, ops: ToolOp[]): { edits: SceneEdits; skipped: string[] } {
  const next: SceneEdits = { patch: { ...edits.patch }, added: [...edits.added], deleted: [...edits.deleted], files: { ...edits.files } };
  const skipped: string[] = [];
  const current = () => applyEdits(base, next);
  for (const o of ops) {
    const scene = current();
    const byId = new Map(scene.elements.map((e) => [e.id, e]));
    if (o.op === "add") {
      const e = cleanElement(o.element);
      if (byId.has(e.id)) { skipped.push(e.id); continue; }
      next.added.push(e);
      continue;
    }
    const target = byId.get(o.id);
    if (!target || o.id === "wb-frame") { skipped.push(o.id); continue; }
    const isAdded = next.added.findIndex((a) => a.id === o.id);
    if (o.op === "delete") {
      // a box goes with its label and with the arrows that point at it; an arrow with its label
      const arrows = target.type === "arrow" ? [] : scene.elements.filter((x) => x.startBinding?.elementId === o.id || x.endBinding?.elementId === o.id).map((x) => x.id);
      const all = new Set([o.id, ...companions(scene, o.id), ...arrows, ...arrows.flatMap((a) => companions(scene, a))]);
      for (const id of all) {
        const k = next.added.findIndex((a) => a.id === id);
        if (k >= 0) next.added.splice(k, 1);
        else if (!next.deleted.includes(id)) next.deleted.push(id);
      }
      continue;
    }
    const props: Partial<ExEl> = {};
    for (const k of EDITABLE) if (o.props[k] !== undefined) (props as Record<Editable, unknown>)[k] = o.props[k];
    for (const k of ["strokeColor", "backgroundColor"] as const) if (props[k] !== undefined && !(typeof props[k] === "string" && COLOUR.test(props[k] as string))) delete props[k];
    if (isAdded >= 0) next.added[isAdded] = { ...next.added[isAdded], ...props };
    else next.patch[o.id] = { ...next.patch[o.id], ...props };
    // a recoloured box or arrow takes its label along when the label had the default ink
    if (props.strokeColor) {
      for (const lid of companions(scene, o.id)) {
        const l = byId.get(lid);
        if (l && target.type === "arrow") next.patch[lid] = { ...next.patch[lid], strokeColor: props.strokeColor };
      }
    }
  }
  return { edits: next, skipped };
}

/** A board from a file gets the invisible frame Filow's boards have (its bounds and some room), so it keeps its size while edited. */
export function withFrame(scene: Scene): Scene {
  if (scene.elements.some((e) => e.id === "wb-frame")) return scene;
  const b = boundsOf(scene.elements) ?? { x: 0, y: 0, w: 1200, h: 720 };
  const pad = 40;
  const frame: ExEl = { id: "wb-frame", type: "rectangle", x: b.x - pad, y: b.y - pad, width: b.w + pad * 2, height: b.h + pad * 2, angle: 0, strokeColor: "transparent", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid", roughness: 0, opacity: 100, roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, groupIds: [], frameId: null, boundElements: null, updated: 1, link: null, locked: true, customData: { wb: { step: -1, key: "frame", role: "frame" } } };
  return { elements: [frame, ...scene.elements], files: scene.files };
}

/** The board's own size: its frame, or for a file without one the bounds of what is on it. */
export function frameBox(scene: Scene): { w: number; h: number; x: number; y: number } {
  const f = scene.elements.find((e) => e.id === "wb-frame");
  if (f) return { x: f.x, y: f.y, w: f.width, h: f.height };
  const b = boundsOf(scene.elements) ?? { x: 0, y: 0, w: 1200, h: 720 };
  return b;
}

/** set_camera: the part of the board to look at (a step, some elements, or everything), with room around it, 4:3 or wider. */
export function cameraFor(scene: Scene, target: { step?: number; ids?: string[] } | null, board: { w: number; h: number; x?: number; y?: number }): Box | null {
  if (!target) return null;
  const els = scene.elements.filter((e) => e.id !== "wb-frame" && e.id !== "wb-title" && e.id !== "wb-rule" && (target.step !== undefined ? stepOf(e) === target.step : target.ids?.includes(e.id)));
  const b = boundsOf(els);
  if (!b) return null;
  const pad = 40;
  let w = Math.max(b.w + pad * 2, 320);
  let h = Math.max(b.h + pad * 2, 240);
  // the board's own shape, so the zoomed picture fills the frame
  const ratio = board.w / board.h;
  if (w / h > ratio) h = w / ratio;
  else w = h * ratio;
  w = Math.min(w, board.w);
  h = Math.min(h, board.h);
  const bx = board.x ?? 0, by = board.y ?? 0;
  const x = Math.max(bx, Math.min(bx + board.w - w, b.x + b.w / 2 - w / 2));
  const y = Math.max(by, Math.min(by + board.h - h, b.y + b.h / 2 - h / 2));
  return { x, y, w, h };
}

/**
 * A follow-up's changes (lib/whiteboard/local.ts, checked against the board's ids) as tool
 * operations and a camera: a box recoloured keeps its label's ink, renamed changes its label,
 * bigger and smaller scale the box and its words around their centre.
 */
export function changesToOps(scene: Scene, changes: EditChange[]): { ops: ToolOp[]; camera: { step?: number; ids?: string[]; all?: boolean } | undefined } {
  const byId = new Map(scene.elements.map((e) => [e.id, e]));
  const labelOf = (id: string) => scene.elements.find((e) => e.containerId === id);
  const ops: ToolOp[] = [];
  let camera: { step?: number; ids?: string[]; all?: boolean } | undefined;
  for (const c of changes) {
    const e = byId.get(c.target);
    if (c.action === "show_all") { camera = { all: true }; continue; }
    if (c.action === "zoom") { camera = c.step ? { step: c.step } : { ids: [c.target] }; continue; }
    if (!e) continue;
    if (c.action === "delete") ops.push({ op: "delete", id: e.id });
    else if (c.action === "recolor" && c.color) {
      const colour = EDIT_COLOURS[c.color];
      ops.push({ op: "update", id: e.id, props: { strokeColor: colour } });
    } else if (c.action === "rename" && c.text) {
      const t = e.type === "text" ? e : labelOf(e.id);
      if (t) ops.push({ op: "update", id: t.id, props: { text: c.text, originalText: c.text } });
    } else if (c.action === "bigger" || c.action === "smaller") {
      const k = c.action === "bigger" ? 1.25 : 0.8;
      if (e.type !== "text" && e.type !== "arrow" && e.type !== "line") {
        const w = e.width * k, h = e.height * k;
        ops.push({ op: "update", id: e.id, props: { x: e.x - (w - e.width) / 2, y: e.y - (h - e.height) / 2, width: w, height: h } });
      }
      const t = e.type === "text" ? e : labelOf(e.id);
      if (t) ops.push({ op: "update", id: t.id, props: { fontSize: Math.max(12, Math.round((t.fontSize ?? 20) * k)) } });
      if (e.type === "arrow" || e.type === "line") ops.push({ op: "update", id: e.id, props: { strokeWidth: Math.max(1, Math.min(6, (e.strokeWidth ?? 2) * k)) } });
    }
  }
  return { ops, camera };
}

// ---- keeping the last board ----

export const BOARD_KEY = "filow.whiteboard.board";
/** Larger boards are not kept (localStorage holds a few megabytes for the whole app). */
export const MAX_SAVED_BYTES = 1_500_000;
