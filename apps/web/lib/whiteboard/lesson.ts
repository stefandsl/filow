// The whiteboard lesson: what the model writes and what Filow accepts (docs/whiteboard/SPEC.md).
// The model names things and how they relate (node, edge, formula, plot, note, mark); it never
// gives coordinates, markup or code. Everything here treats its output as data: unknown kinds are
// dropped, text is cut and cleaned, references are checked, and what cannot be repaired is left out.
import { validateDrawing, type BuddyDrawing } from "@/lib/buddy/visuals";
import { cleanExpr, parseExpr, sampleCurve } from "./plot";

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
  /** `more`: further functions drawn on the same axes (the plot marks where the first two meet). */
  | { kind: "plot"; expr: string; xmin: number; xmax: number; text: string; more?: string[]; xName?: string; yName?: string }
  | { kind: "note"; text: string; about?: string }
  /** A row of values with a pointer under one of them (-1: none): the worked example of an algorithm. */
  | { kind: "cells"; values: string[]; pointer: number }
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
export const KINDS = ["process", "proof", "comparison", "algorithm", "law"] as const;
/** The kind of explanation the outline chose; each has its own recipe (generate.ts). */
export type ExplanationKind = (typeof KINDS)[number];
export type Outline = { title: string; scene: Scene; kind: ExplanationKind; says: string[] };

export const LIMITS = {
  steps: 7,
  /** A text-only helper (the Lite setup) gets a shorter lesson. */
  liteSteps: 4,
  itemsPerStep: 6,
  /** A lesson written whole (the online path): the prompt asks for 2 to 6 items a step and at most 8 boxes, and a model that writes a few more keeps them. In real lessons the seventh item of a step was the arrow from CO2 to the plant, and the eleventh box took its arrow with it. A board that is full continues on a fresh one. */
  lessonItemsPerStep: 10,
  lessonNodes: 14,
  nodes: 10,
  say: 260,
  title: 70,
  nodeText: 36,
  edgeText: 30,
  note: 120,
  /** One value of a row of cells: long enough for a line of a worked example ("3 * Factorial(2)", "I = 2 A"). */
  cell: 40,
  /** The name of an axis of a plot. */
  axis: 28,
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
  const s = visible(String(v)).replace(/<\/?[a-zA-Z!][^<>]{0,200}>/g, " ").replace(/\s+/g, " ").trim();
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
/** The letter a JSON escape stood for, when a LaTeX command was read as that escape ("\t" + "imes"). */
const TEX_ESCAPED: Record<string, string> = { "\t": "t", "\f": "f", "\b": "b", "\n": "n", "\r": "r", "\v": "v" };
export function cleanTex(v: unknown, texOk?: (tex: string) => boolean): string {
  if (typeof v !== "string") return "";
  // A model that writes "\times" or "\frac" inside JSON without doubling the backslash has it read as
  // a tab or a form feed followed by "imes" or "rac": the command is put back before anything else looks at it.
  let tex = visible(v.replace(/[\t\f\b\n\r\v](?=[a-zA-Z])/g, (c) => `\\${TEX_ESCAPED[c]}`)).trim();
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
  // A formula is mathematics: a relation or an operation, not a phrase set in italics ("gradient descent").
  const bare = tex.replace(/\\text\w*\{[^{}]*\}/g, " ").replace(/\\[a-zA-Z]+/g, " ");
  if (!/[=<>+\-*/^_\d]|\\(?:frac|sum|int|sqrt|times|cdot|le|ge|ne|approx|to|rightarrow|propto|partial)\b/.test(tex) || (bare.match(/[A-Za-z]{4,}/g) ?? []).length >= 2) return "";
  // one symbol or one number alone ("0", "x") states nothing
  if (tex.replace(/\s+/g, "").length < 3) return "";
  if (texOk && !texOk(tex)) return "";
  return tex;
}

/** A formula without what only changes its look (a times sign, spacing, a final full stop): the same formula written twice is one. */
export const texKey = (tex: string) => tex.replace(/\\(?:times|cdot|left|right|[,;!: ])/g, "").replace(/[\s.,;*]+/g, "");

export type LessonContext = {
  /** The nodes on the board so far: id -> label. Updated as items are accepted. */
  nodes: Map<string, string>;
  /** The arrows on the board so far ("from>to>label"): a model often draws the same arrow again in a later step. */
  edges: Set<string>;
  /** How many boxes the board may hold (a follow-up gets room for a few more than the lesson it continues). */
  nodeCap?: number;
  /** The step being validated, in a lesson written whole (validateLesson): a formula or a row of cells shown again in a later step is kept. */
  stepNo?: number;
  /** How many items one step may hold (default LIMITS.itemsPerStep). */
  itemCap?: number;
  /** Formulas, plots and notes already written, so a later step does not write them again. */
  seen: Set<string>;
  texOk?: (tex: string) => boolean;
  /** The sentence of the step being validated: a box is circled as "what the step talks about" only when the sentence names it. */
  hint?: string;
  /** Free shapes are accepted (the cloud path). */
  sketch?: boolean;
};
export const newContext = (opts: Omit<LessonContext, "nodes" | "edges" | "seen"> = {}): LessonContext => ({ nodes: new Map(), edges: new Set(), seen: new Set(), ...opts });

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
  const full = () => out.length >= (ctx.itemCap ?? LIMITS.itemsPerStep);
  // In a lesson written whole, a formula or a row of cells counts as a repeat only inside its own step.
  const again = ctx.stepNo === undefined ? "" : `@${ctx.stepNo}`;
  /** Nodes the model drew again although they are on the board: what the step is talking about. */
  const touched: string[] = [];
  const once = (key: string) => (ctx.seen.has(key) ? false : Boolean(ctx.seen.add(key)));
  const addNode = (idRaw: unknown, textRaw: unknown): string => {
    const named = typeof idRaw === "string" || typeof idRaw === "number" ? String(idRaw) : "";
    const text = cleanText(textRaw, LIMITS.nodeText) || cleanText(named.replace(/[_-]+/g, " "), LIMITS.nodeText);
    if (!text) return "";
    let id = slug(idRaw) || slug(text) || `n${ctx.nodes.size + 1}`;
    if (ctx.nodes.has(id)) {
      // the same thing named twice is one node, and so is anything the model puts under an id it already used;
      // only an id derived from a label can collide by accident, and then the new thing gets its own
      if (ctx.nodes.get(id)!.toLowerCase() === text.toLowerCase() || slug(idRaw)) {
        touched.push(id);
        return id;
      }
      id = `${id}_${ctx.nodes.size + 1}`.slice(0, 24);
    }
    if (ctx.nodes.size >= (ctx.nodeCap ?? LIMITS.nodes) || full()) return "";
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
      // an arrow may be written as a sentence: who, does, to (the one that acts comes first by construction)
      const fromRef = q.who ?? q.from ?? q.source;
      const toRef = q.to ?? q.target;
      const from = find(fromRef) || addNode(fromRef, "");
      const to = find(toRef) || (full() ? "" : addNode(toRef, ""));
      if (!from || !to || full()) continue;
      const text = cleanText(q.does ?? q.text ?? q.label, LIMITS.edgeText);
      // an arrow from a box to itself ("calls itself") says something only with its label
      if (from === to && !text) continue;
      const edgeKey = `${from}>${to}>${text.toLowerCase()}`;
      // The same arrow again, or a bare arrow where one already runs: not drawn twice. A label on
      // an arrow that had none is new (the board then shows the labelled one).
      if (ctx.edges.has(edgeKey) || (!text && [...ctx.edges].some((k) => k.startsWith(`${from}>${to}>`)))) {
        touched.push(to);
        continue;
      }
      ctx.edges.add(edgeKey);
      out.push({ kind: "edge", from, to, text });
    } else if (kind === "formula") {
      const tex = cleanTex(q.tex ?? q.latex ?? q.text, ctx.texOk);
      // The same formula twice in one step is one. In a later step it is what the step shows (a proof
      // ends on the formula it set out to prove): kept, and the board draws it anew where it stands.
      if (tex && once(`f:${texKey(tex)}${again}`)) out.push({ kind: "formula", tex });
    } else if (kind === "plot") {
      const expr = cleanExpr(q.expr ?? q.fn ?? q.text).slice(0, 80);
      const tree = parseExpr(expr);
      let xmin = finite(q.xmin) ?? -5;
      let xmax = finite(q.xmax) ?? 5;
      if (!(xmin < xmax) || xmin < -1e4 || xmax > 1e4) { xmin = -5; xmax = 5; }
      // a function with no value anywhere in the range would draw an empty frame
      if (!tree || !sampleCurve(tree, xmin, xmax)) continue;
      const more = (Array.isArray(q.more) ? q.more : []).map((m) => cleanExpr(m).slice(0, 80)).filter((m) => m !== expr && parseExpr(m)).slice(0, 2);
      // The same curve again is not drawn twice, but the same curve with another one beside it is a new
      // picture (demand alone, then demand and supply): dropping it would lose the second curve.
      if (!once(`p:${[expr, ...more].join("|").replace(/\s+/g, "")}`)) continue;
      // what the two axes measure ("Current (A)", "Voltage (V)"): written at the axes
      const xName = cleanText(q.x ?? q.xName ?? q.xlabel, LIMITS.axis);
      const yName = cleanText(q.y ?? q.yName ?? q.ylabel, LIMITS.axis);
      out.push({ kind: "plot", expr, xmin, xmax, text: cleanText(q.label ?? (q.expr ? q.text : ""), LIMITS.edgeText), ...(more.length ? { more } : {}), ...(xName ? { xName } : {}), ...(yName ? { yName } : {}) });
    } else if (kind === "note" || kind === "text" || kind === "list") {
      const text = cleanText(q.text ?? (Array.isArray(q.items) ? q.items.join("; ") : ""), LIMITS.note);
      const about = slug(q.about ?? q.target);
      if (text && once(`n:${text.toLowerCase()}`)) out.push({ kind: "note", text, ...(about ? { about } : {}) });
    } else if (kind === "cells" || kind === "array") {
      const values = (Array.isArray(q.values) ? q.values : []).slice(0, 10).map((v) => cleanText(v, LIMITS.cell)).filter(Boolean);
      const at = finite(q.pointer);
      const pointer = at !== null && Number.isInteger(at) && at >= 0 && at < values.length ? at : -1;
      // a search narrowed to one value is still a row; the same row with the same pointer is not drawn twice in one step
      if (values.length >= 1 && once(`c:${values.join("|")}:${pointer}${again}`)) out.push({ kind: "cells", values, pointer });
    } else if (kind === "mark") {
      const target = find(q.target ?? q.id);
      if (!target) continue;
      const style = MARK_STYLES.includes(q.style as MarkStyle) ? (q.style as MarkStyle) : "circle";
      // the board shows a mark once: said again, it would be a step that draws nothing
      if (once(`m:${target}:${style}`)) out.push({ kind: "mark", target, style });
    } else if (kind === "sketch" && ctx.sketch && !out.some((o) => o.kind === "sketch")) {
      const drawing = validateDrawing(q.drawing ?? q);
      if (drawing) out.push({ kind: "sketch", drawing });
    }
  }
  // Nothing new, but the model pointed at something on the board: circle it, as the step prompt asks.
  const said = ctx.hint?.toLowerCase();
  const pointed = [...touched].reverse().find((id) => said === undefined || said.includes((ctx.nodes.get(id) ?? "\n").toLowerCase()));
  if (!out.length && pointed && once(`m:${pointed}:circle`)) out.push({ kind: "mark", target: pointed, style: "circle" });
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
  const kind = (KINDS as readonly string[]).includes(String((r as { kind?: unknown }).kind)) ? ((r as { kind: ExplanationKind }).kind) : "process";
  return { title: cleanText(r.title, LIMITS.title) || says[0].slice(0, LIMITS.title), scene: sceneOf(r.scene), kind, says };
}

/** One step from its sentence and its items; no usable item makes it a text card. */
export function makeStep(say: string, rawItems: unknown, ctx: LessonContext): LessonStep {
  const items = validateItems(rawItems, ctx);
  return { say, items, card: items.length === 0 };
}

/** A whole lesson in one object (the cloud path, and anything read back). Null when nothing is usable. */
export function validateLesson(raw: unknown, opts: { maxSteps?: number; texOk?: (tex: string) => boolean; sketch?: boolean; continues?: Lesson } = {}): Lesson | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { title?: unknown; scene?: unknown; steps?: unknown };
  const ctx = newContext({ texOk: opts.texOk, sketch: opts.sketch });
  ctx.itemCap = LIMITS.lessonItemsPerStep;
  ctx.nodeCap = LIMITS.lessonNodes;
  // steps that continue a lesson may point at the nodes it already has
  if (opts.continues) {
    const before = contextOf(opts.continues);
    ctx.nodes = before.nodes;
    ctx.edges = before.edges;
    ctx.seen = before.seen;
    ctx.nodeCap = before.nodeCap;
  }
  const steps: LessonStep[] = [];
  for (const s of Array.isArray(r.steps) ? r.steps : []) {
    if (steps.length >= (opts.maxSteps ?? LIMITS.steps)) break;
    if (!s || typeof s !== "object") continue;
    const q = s as { say?: unknown; items?: unknown };
    const say = cleanText(q.say, LIMITS.say);
    // a step is what is said while it is drawn: without a sentence there is no step
    if (!say) continue;
    ctx.stepNo = steps.length;
    const step = makeStep(say, q.items, ctx);
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
  // Words before the JSON may hold a brace of their own ("the set {a, b} ..."): try the next ones too.
  let start = text.indexOf("{");
  for (let tries = 0; start >= 0 && tries < 6; tries++, start = text.indexOf("{", start + 1)) {
    const got = parseFrom(text, start);
    if (got !== undefined) return got;
  }
  return undefined;
}

function parseFrom(text: string, start: number): unknown {
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
  // Cut off: the unfinished last element is dropped (half a label or half a formula is not what
  // the model meant), and the text is closed after the last complete value.
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

/** What a lesson already has on its board, for steps that continue it. */
export function contextOf(lesson: Lesson, opts: Omit<LessonContext, "nodes" | "edges" | "seen"> = {}): LessonContext {
  const ctx = newContext(opts);
  for (const s of lesson.steps) {
    for (const it of s.items) {
      if (it.kind === "node") ctx.nodes.set(it.id, it.text);
      else if (it.kind === "edge") ctx.edges.add(`${it.from}>${it.to}>${it.text.toLowerCase()}`);
      else if (it.kind === "formula") ctx.seen.add(`f:${texKey(it.tex)}`);
      else if (it.kind === "plot") ctx.seen.add(`p:${[it.expr, ...(it.more ?? [])].join("|").replace(/\s+/g, "")}`);
      else if (it.kind === "note") ctx.seen.add(`n:${it.text.toLowerCase()}`);
      else if (it.kind === "mark") ctx.seen.add(`m:${it.target}:${it.style}`);
      else if (it.kind === "cells") ctx.seen.add(`c:${it.values.join("|")}:${it.pointer}`);
    }
  }
  // a follow-up gets room for three more boxes than the board it continues
  ctx.nodeCap = Math.max(LIMITS.nodes, ctx.nodes.size) + 3;
  return ctx;
}

/** The nodes of a lesson (id -> label). */
export function lessonNodes(lesson: Lesson): Map<string, string> {
  const ids = new Map<string, string>();
  for (const s of lesson.steps) for (const it of s.items) if (it.kind === "node") ids.set(it.id, it.text);
  return ids;
}

/** The steps as Markdown: the export the user keeps next to the picture. */
export function lessonMarkdown(lesson: Lesson, words: { step: string; drawing: string } = { step: "Step", drawing: "On the board" }): string {
  const names = lessonNodes(lesson);
  // escaped so nothing the model wrote becomes a link, an image or HTML in a Markdown viewer
  const md = (t: string) => t.replace(/([\\`*_[\]<>|#()!])/g, "\\$1").replace(/:\/\//g, ":\\/\\/");
  const out: string[] = [`# ${md(lesson.title)}`, ""];
  lesson.steps.forEach((s, i) => {
    out.push(`## ${words.step} ${i + 1}`, "", md(s.say), "");
    const lines: string[] = [];
    for (const it of s.items) {
      if (it.kind === "node") lines.push(`- ${md(it.text)}`);
      else if (it.kind === "edge") lines.push(`- ${md(names.get(it.from) ?? it.from)} -> ${md(names.get(it.to) ?? it.to)}${it.text ? `: ${md(it.text)}` : ""}`);
      else if (it.kind === "formula") lines.push(`- \`${it.tex.replace(/`/g, "")}\``);
      else if (it.kind === "plot") lines.push(`- ${[it.expr, ...(it.more ?? [])].map((e) => `y = \`${e.replace(/`/g, "")}\``).join(", ")} (x ${it.xmin} .. ${it.xmax})`);
      else if (it.kind === "note") lines.push(`- ${md(it.text)}`);
      else if (it.kind === "cells") lines.push(`- ${it.values.map((v, k) => (k === it.pointer ? `**${md(v)}**` : md(v))).join(" | ")}`);
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
      title: { type: "string", maxLength: 60 },
      scene: { type: "string", enum: [...SCENES] },
      kind: { type: "string", enum: [...KINDS] },
      steps: { type: "array", minItems: Math.min(3, maxSteps), maxItems: maxSteps, items: { type: "object", properties: { say: { type: "string", maxLength: 220 } }, required: ["say"] } },
    },
    required: ["title", "scene", "kind", "steps"],
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
          id: { type: "string", maxLength: 24 },
          text: { type: "string", maxLength: 110 },
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
