// The board as a document: the scene a lesson compiles to (scene.ts), plus what was changed on it
// afterwards, by the user's hand on the Excalidraw canvas or by Filow answering a follow-up
// ("make the arrow red"). Edits are kept by element id, apart from the compiled scene, so a lesson
// that grows by a step or is laid out again keeps them. This file also reads and writes
// .excalidraw files and is the tool surface an agent drives the board with (read_scene,
// add/update/delete by id, snapshot/restore, camera). Pure: no DOM.
import { boundsOf, safeId, stepOf, type BinaryFile, type ExEl, type Scene } from "./scene";
import type { Box } from "./layout";

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

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

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

/** set_camera: the part of the board to look at (a step, some elements, or everything), with room around it, 4:3 or wider. */
export function cameraFor(scene: Scene, target: { step?: number; ids?: string[] } | null, board: { w: number; h: number }): Box | null {
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
  const x = Math.max(0, Math.min(board.w - w, b.x + b.w / 2 - w / 2));
  const y = Math.max(0, Math.min(board.h - h, b.y + b.h / 2 - h / 2));
  return { x, y, w, h };
}

// ---- keeping the last board ----

export const BOARD_KEY = "filow.whiteboard.board";
/** Larger boards are not kept (localStorage holds a few megabytes for the whole app). */
export const MAX_SAVED_BYTES = 1_500_000;
