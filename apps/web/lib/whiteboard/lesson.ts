// The whiteboard lesson: what the model writes and what Filow accepts (docs/whiteboard/SPEC.md).
// The model names things and how they relate (node, edge, formula, plot, note, mark); it never
// gives coordinates, markup or code. Everything here treats its output as data: unknown kinds are
// dropped, text is cut and cleaned, references are checked, and what cannot be repaired is left out.
import { validateDrawing, type BuddyDrawing } from "@/lib/buddy/visuals";
import { cleanExpr, parseExpr } from "./plot";

export const SCENES = ["flow", "cycle", "stack"] as const;
export type Scene = (typeof SCENES)[number];
export const MARK_STYLES = ["circle", "underline", "highlight"] as const;
export type MarkStyle = (typeof MARK_STYLES)[number];
/** The kinds a local model is asked for. "sketch" (free shapes, lib/buddy/visuals.ts) is cloud only. */
export const ITEM_KINDS = ["node", "edge", "formula", "plot", "note", "mark"] as const;

export type LessonItem =
  | { kind: "node"; id: string; text: string }
  | { kind: "edge"; from: string; to: string; text: string }
  | { kind: "formula"; tex: string }
  | { kind: "plot"; expr: string; xmin: number; xmax: number; text: string }
  | { kind: "note"; text: string }
  | { kind: "mark"; target: string; style: MarkStyle }
  | { kind: "sketch"; drawing: BuddyDrawing };

export type LessonStep = {
  /** The one sentence shown and spoken for this step. */
  say: string;
  items: LessonItem[];
  /** The drawing for this step could not be made: the board shows the sentence as a text card. */
  card: boolean;
};
export type Lesson = { title: string; scene: Scene; steps: LessonStep[] };
export type Outline = { title: string; scene: Scene; says: string[] };

export const LIMITS = {
  steps: 7,
  /** A text-only helper (the Lite setup) gets a shorter lesson. */
  liteSteps: 4,
  itemsPerStep: 6,
  nodes: 10,
  say: 260,
  title: 70,
  nodeText: 36,
  edgeText: 22,
  note: 120,
  tex: 180,
  question: 400,
  /** The lesson sent back with a follow-up question. */
  contextBytes: 4096,
} as const;

// Control characters, zero-width characters and the marks that reorder text on screen.
const invisible = (c: number) => c <= 0x1f || (c >= 0x7f && c <= 0x9f) || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2060 && c <= 0x2069) || c === 0xfeff;
const visible = (s: string) => Array.from(s, (ch) => (invisible(ch.codePointAt(0) ?? 0) ? " " : ch)).join("");
const ELLIPSIS = String.fromCharCode(0x2026);

/** Model text as plain text: no control or direction characters, no tags, one line, cut to `max`. */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== "string" && typeof v !== "number") return "";
  const s = visible(String(v)).replace(/<[^<>]{0,200}>/g, " ").replace(/\s+/g, " ").trim();
  const chars = Array.from(s);
  return chars.length <= max ? s : chars.slice(0, max - 1).join("").trimEnd() + ELLIPSIS;
}

/** An id the model chose, as a short ASCII key ("Light energy" and "light-energy" are the same key). */
export function slug(v: unknown): string {
  if (typeof v !== "string" && typeof v !== "number") return "";
  return String(v).normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24);
}

const TEX_FORBIDDEN = /\\(?:href|url|includegraphics|html(?:Class|Id|Style|Data)|[egx]?def|let|futurelet|(?:re)?newcommand|providecommand|input|catcode|write|csname|expandafter|loop|read|openin|special|char|uppercase|lowercase)(?![a-zA-Z])/;

/** LaTeX for one formula, or "" when it is not usable. `texOk` is the real parser (KaTeX on the server). */
export function cleanTex(v: unknown, texOk?: (tex: string) => boolean): string {
  if (typeof v !== "string") return "";
  let tex = visible(v).trim();
  // The model often wraps the formula as it would in a chat answer.
  tex = tex.replace(/^\$\$?|\$\$?$/g, "").replace(/^\\[([]|\\[)\]]$/g, "").trim();
  if (!tex || tex.length > LIMITS.tex || TEX_FORBIDDEN.test(tex)) return "";
  let depth = 0;
  for (let i = 0; i < tex.length; i++) {
    if (tex[i] === "\\") { i++; continue; }
    if (tex[i] === "{") depth++;
    else if (tex[i] === "}" && --depth < 0) return "";
  }
  // A formula cut off by the token limit: close what was left open.
  if (depth > 3) return "";
  tex += "}".repeat(depth);
  if (texOk && !texOk(tex)) return "";
  return tex;
}

export type LessonContext = {
  /** The nodes on the board so far: id -> label. Updated as items are accepted. */
  nodes: Map<string, string>;
  texOk?: (tex: string) => boolean;
  /** Free shapes are accepted (the cloud path). */
  sketch?: boolean;
};
export const newContext = (opts: Omit<LessonContext, "nodes"> = {}): LessonContext => ({ nodes: new Map(), ...opts });

const finite = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/**
 * The items of one step, from whatever the model wrote. Repairs what has one clear reading (a node
 * without an id, an edge that names a node by its label, an edge to a node that was never drawn)
 * and drops the rest. Accepted nodes are added to `ctx.nodes`.
 */
export function validateItems(raw: unknown, ctx: LessonContext): LessonItem[] {
  const out: LessonItem[] = [];
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : [];
  const full = () => out.length >= LIMITS.itemsPerStep;
  const addNode = (idRaw: unknown, textRaw: unknown): string => {
    const text = cleanText(textRaw, LIMITS.nodeText) || cleanText(String(idRaw ?? "").replace(/[_-]+/g, " "), LIMITS.nodeText);
    if (!text) return "";
    let id = slug(idRaw) || slug(text) || `n${ctx.nodes.size + 1}`;
    if (ctx.nodes.has(id)) {
      // the same thing named twice is one node; a different thing under a used id gets its own
      if (ctx.nodes.get(id)!.toLowerCase() === text.toLowerCase() || slug(idRaw)) return id;
      id = `${id}_${ctx.nodes.size + 1}`.slice(0, 24);
    }
    if (ctx.nodes.size >= LIMITS.nodes || full()) return "";
    ctx.nodes.set(id, text);
    out.push({ kind: "node", id, text });
    return id;
  };
  /** The id of a node on the board that `ref` names, by id or by label. */
  const find = (ref: unknown): string => {
    const key = slug(ref);
    if (key && ctx.nodes.has(key)) return key;
    const label = cleanText(ref, LIMITS.nodeText).toLowerCase();
    if (!label) return "";
    for (const [id, text] of ctx.nodes) if (text.toLowerCase() === label) return id;
    return "";
  };

  for (const item of list.slice(0, 40)) {
    if (full()) break;
    if (!item || typeof item !== "object") continue;
    const q = item as Record<string, unknown>;
    const kind = String(q.kind ?? q.type ?? "").toLowerCase().trim();
    if (kind === "node") {
      addNode(q.id, q.text ?? q.label ?? q.name);
    } else if (kind === "edge" || kind === "arrow") {
      const fromRef = q.from ?? q.source;
      const toRef = q.to ?? q.target;
      const from = find(fromRef) || addNode(fromRef, "");
      const to = find(toRef) || (full() ? "" : addNode(toRef, ""));
      if (!from || !to || from === to || full()) continue;
      const text = cleanText(q.text ?? q.label, LIMITS.edgeText);
      if (out.some((o) => o.kind === "edge" && o.from === from && o.to === to && o.text === text)) continue;
      out.push({ kind: "edge", from, to, text });
    } else if (kind === "formula") {
      const tex = cleanTex(q.tex ?? q.latex ?? q.text, ctx.texOk);
      if (tex) out.push({ kind: "formula", tex });
    } else if (kind === "plot") {
      const expr = cleanExpr(q.expr ?? q.fn ?? q.text).slice(0, 80);
      if (!parseExpr(expr)) continue;
      let xmin = finite(q.xmin) ?? -5;
      let xmax = finite(q.xmax) ?? 5;
      if (!(xmin < xmax) || xmin < -1e4 || xmax > 1e4) { xmin = -5; xmax = 5; }
      out.push({ kind: "plot", expr, xmin, xmax, text: cleanText(q.label ?? (q.expr ? q.text : ""), LIMITS.edgeText) });
    } else if (kind === "note" || kind === "text" || kind === "list") {
      const text = cleanText(q.text ?? (Array.isArray(q.items) ? q.items.join("; ") : ""), LIMITS.note);
      if (text) out.push({ kind: "note", text });
    } else if (kind === "mark") {
      const target = find(q.target ?? q.id);
      if (!target) continue;
      const style = MARK_STYLES.includes(q.style as MarkStyle) ? (q.style as MarkStyle) : "circle";
      out.push({ kind: "mark", target, style });
    } else if (kind === "sketch" && ctx.sketch && !out.some((o) => o.kind === "sketch")) {
      const drawing = validateDrawing(q.drawing ?? q);
      if (drawing) out.push({ kind: "sketch", drawing });
    }
  }
  return out;
}

const sceneOf = (v: unknown): Scene => {
  const s = String(v ?? "").toLowerCase().trim();
  if ((SCENES as readonly string[]).includes(s)) return s as Scene;
  // the names of the research draft and what models say instead
  if (s === "timeline" || s === "sequence" || s === "derivation" || s === "list") return "stack";
  if (s === "loop" || s === "circle") return "cycle";
  return "flow";
};

/** The outline call: a title, a layout and one sentence per step. Null when there is no step. */
export function validateOutline(raw: unknown, maxSteps: number = LIMITS.steps): Outline | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { title?: unknown; scene?: unknown; steps?: unknown };
  const says: string[] = [];
  for (const s of Array.isArray(r.steps) ? r.steps : []) {
    const say = cleanText(typeof s === "string" ? s : (s as { say?: unknown } | null)?.say, LIMITS.say);
    if (say && says.length < maxSteps) says.push(say);
  }
  if (!says.length) return null;
  return { title: cleanText(r.title, LIMITS.title) || says[0].slice(0, LIMITS.title), scene: sceneOf(r.scene), says };
}

/** One step from its sentence and its items; no usable item makes it a text card. */
export function makeStep(say: string, rawItems: unknown, ctx: LessonContext): LessonStep {
  const items = validateItems(rawItems, ctx);
  return { say, items, card: items.length === 0 };
}

/** A whole lesson in one object (the cloud path, and anything read back). Null when nothing is usable. */
export function validateLesson(raw: unknown, opts: { maxSteps?: number; texOk?: (tex: string) => boolean; sketch?: boolean; nodes?: Map<string, string> } = {}): Lesson | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { title?: unknown; scene?: unknown; steps?: unknown };
  const ctx = newContext({ texOk: opts.texOk, sketch: opts.sketch });
  // steps that continue a lesson may point at the nodes it already has
  if (opts.nodes) ctx.nodes = new Map(opts.nodes);
  const steps: LessonStep[] = [];
  for (const s of Array.isArray(r.steps) ? r.steps : []) {
    if (steps.length >= (opts.maxSteps ?? LIMITS.steps)) break;
    if (!s || typeof s !== "object") continue;
    const q = s as { say?: unknown; items?: unknown };
    const say = cleanText(q.say, LIMITS.say);
    const step = makeStep(say, q.items, ctx);
    if (!say && step.card) continue;
    steps.push(step);
  }
  if (!steps.length) return null;
  return { title: cleanText(r.title, LIMITS.title) || "Whiteboard", scene: sceneOf(r.scene), steps };
}

/**
 * Reads the JSON a model wrote, forgiving what models get wrong: a code fence around it, words
 * before or after it, a trailing comma, and an answer cut off in the middle (the open strings,
 * lists and objects are closed, dropping the unfinished last element when needed).
 * `undefined` when no JSON object can be read.
 */
export function parseJsonLoose(text: unknown): unknown {
  if (typeof text !== "string") return undefined;
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  const body = text.slice(start, start + 60_000);
  const tryParse = (s: string): unknown => {
    try { return JSON.parse(s); } catch { return undefined; }
  };
  // Walk the text once: where the first object ends, or what is still open where the text stops.
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let end = -1;
  /** Places where the text could be cut and still close cleanly (after a complete value). */
  const cuts: Array<{ at: number; open: string }> = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{" || c === "[") stack.push(c === "{" ? "}" : "]");
    else if (c === "}" || c === "]") {
      if (stack.pop() !== c) return undefined;
      if (!stack.length) { end = i; break; }
      cuts.push({ at: i + 1, open: stack.slice().reverse().join("") });
    }
  }
  if (end >= 0) {
    const whole = body.slice(0, end + 1);
    return tryParse(whole) ?? tryParse(whole.replace(/,\s*([}\]])/g, "$1"));
  }
  // Cut off: try closing right where it stops, then at each earlier complete value.
  const tail = (inString ? '"' : "") + stack.slice().reverse().join("");
  const direct = tryParse(body.replace(/[,:\s]+$/, "") + tail);
  if (direct !== undefined) return direct;
  for (let k = cuts.length - 1; k >= 0 && k >= cuts.length - 40; k--) {
    const got = tryParse(body.slice(0, cuts[k].at) + cuts[k].open);
    if (got !== undefined) return got;
  }
  return undefined;
}

/** The lesson so far, small enough to send back with a follow-up (at most LIMITS.contextBytes). */
export function lessonContextText(lesson: Lesson): string {
  const ids = new Map<string, string>();
  for (const s of lesson.steps) for (const it of s.items) if (it.kind === "node") ids.set(it.id, it.text);
  const lines = [`Title: ${lesson.title}`, ...lesson.steps.map((s, i) => `${i + 1}. ${s.say}`), `On the board: ${[...ids].map(([id, text]) => `${id} = ${text}`).join("; ") || "nothing yet"}`];
  let text = lines.join("\n");
  while (new TextEncoder().encode(text).length > LIMITS.contextBytes && lines.length > 2) {
    lines.splice(1, 1);
    text = lines.join("\n");
  }
  return text.slice(0, LIMITS.contextBytes);
}

/** The nodes of a lesson (id -> label), for a context that continues it. */
export function lessonNodes(lesson: Lesson): Map<string, string> {
  const ids = new Map<string, string>();
  for (const s of lesson.steps) for (const it of s.items) if (it.kind === "node") ids.set(it.id, it.text);
  return ids;
}

/** The steps as Markdown: the export the user keeps next to the picture. */
export function lessonMarkdown(lesson: Lesson, words: { step: string; drawing: string } = { step: "Step", drawing: "On the board" }): string {
  const names = lessonNodes(lesson);
  const md = (t: string) => t.replace(/([\\`*_[\]<>|#])/g, "\\$1");
  const out: string[] = [`# ${md(lesson.title)}`, ""];
  lesson.steps.forEach((s, i) => {
    out.push(`## ${words.step} ${i + 1}`, "", md(s.say), "");
    const lines: string[] = [];
    for (const it of s.items) {
      if (it.kind === "node") lines.push(`- ${md(it.text)}`);
      else if (it.kind === "edge") lines.push(`- ${md(names.get(it.from) ?? it.from)} -> ${md(names.get(it.to) ?? it.to)}${it.text ? `: ${md(it.text)}` : ""}`);
      else if (it.kind === "formula") lines.push(`- $${it.tex.replace(/\$/g, "\\$")}$`);
      else if (it.kind === "plot") lines.push(`- y = \`${it.expr.replace(/`/g, "")}\` (x ${it.xmin} .. ${it.xmax})`);
      else if (it.kind === "note") lines.push(`- ${md(it.text)}`);
      else if (it.kind === "sketch") lines.push(`- ${md(it.drawing.title)}`);
    }
    if (lines.length) out.push(`${words.drawing}:`, "", ...lines, "");
  });
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** JSON schemas for Ollama's `format` (structured output): flat objects, enums, no unions. */
export function outlineSchema(maxSteps: number) {
  return {
    type: "object",
    properties: {
      title: { type: "string" },
      scene: { type: "string", enum: [...SCENES] },
      steps: { type: "array", minItems: Math.min(3, maxSteps), maxItems: maxSteps, items: { type: "object", properties: { say: { type: "string" } }, required: ["say"] } },
    },
    required: ["title", "scene", "steps"],
  };
}
export const STEP_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      minItems: 1,
      maxItems: LIMITS.itemsPerStep,
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...ITEM_KINDS] },
          id: { type: "string" },
          text: { type: "string" },
          from: { type: "string" },
          to: { type: "string" },
          tex: { type: "string" },
          expr: { type: "string" },
          xmin: { type: "number" },
          xmax: { type: "number" },
          target: { type: "string" },
          style: { type: "string", enum: [...MARK_STYLES] },
        },
        required: ["kind"],
      },
    },
  },
  required: ["items"],
};
