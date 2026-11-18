// Structured diagrams on the whiteboard (docs/whiteboard/SPEC.md section 2b). The model may write a
// step's drawing as a small Mermaid text (flowchart, mindmap, sequenceDiagram) or a Markdown table.
// Filow reads only a strict subset of that text, as data: shapes, labels, links, participants,
// messages and rows. Everything else (styles, classes, click handlers, HTML, init directives) is
// dropped before it is read, and labels are cleaned like any other model text. No Mermaid code runs.
import { cleanText, LIMITS, slug, type LessonItem } from "./lesson";

export const DIAGRAM_TYPES = ["flowchart", "mindmap", "sequence", "table"] as const;
export type DiagramType = (typeof DIAGRAM_TYPES)[number];
export type DShape = "box" | "round" | "diamond" | "circle";
export type DNode = { id: string; text: string; shape: DShape; parent?: string };
/** A link: an arrow of a flowchart, a branch of a mind map, a message of a sequence (in order). */
export type DLink = { from: string; to: string; text: string; dashed?: boolean };
export type DiagramItem = { kind: "diagram"; type: DiagramType; dir: "TD" | "LR"; nodes: DNode[]; links: DLink[]; rows: string[][] };

export const DIAGRAM_LIMITS = { nodes: 16, links: 22, participants: 6, messages: 14, rows: 8, cols: 4, source: 2400 } as const;

/** What the diagram of a lesson holds so far: later steps add to it. */
export type DiagramState = {
  type: DiagramType | null;
  dir: "TD" | "LR";
  nodes: Map<string, string>;
  /** Mind map: the open branches (indent, id), so that a later step's lines hang where they belong. */
  stack: Array<{ indent: number; id: string }>;
  links: Set<string>;
  messages: number;
  /** The messages so far, in order (a step that writes them all again repeats them). */
  said: string[];
  rows: number;
  /** The rows so far, as text. */
  cells: string[];
  cols: number;
};
export const newDiagramState = (): DiagramState => ({ type: null, dir: "TD", nodes: new Map(), stack: [], links: new Set(), messages: 0, said: [], rows: 0, cells: [], cols: 0 });

/** A label as plain text: Mermaid's quotes, line breaks and markdown marks taken off, then cleaned like any model text. */
function label(raw: string, max: number): string {
  const s = raw.trim().replace(/^"(.*)"$/s, "$1").replace(/<br\s*\/?>/gi, " ").replace(/\\n/g, " ").replace(/[*_`]{1,3}([^*_`]+)[*_`]{1,3}/g, "$1").replace(/#quot;/g, '"');
  return cleanText(s, max);
}

const SHAPES: Array<{ open: string; close: string; shape: DShape }> = [
  { open: "((", close: "))", shape: "circle" },
  { open: "([", close: "])", shape: "round" },
  { open: "[[", close: "]]", shape: "box" },
  { open: "[(", close: ")]", shape: "box" },
  { open: "{{", close: "}}", shape: "diamond" },
  { open: "))", close: "((", shape: "circle" },
  { open: "[", close: "]", shape: "box" },
  { open: "(", close: ")", shape: "round" },
  { open: "{", close: "}", shape: "diamond" },
  { open: ">", close: "]", shape: "box" },
  { open: ")", close: "(", shape: "round" },
];
const ID = /^[\p{L}\p{N}_][\p{L}\p{N}_-]*/u;

/** A node reference at the start of `s`: its id, its label and shape when it has one, and what follows. */
function readNode(s: string): { id: string; text?: string; shape?: DShape; rest: string } | null {
  const t = s.trimStart();
  const m = ID.exec(t);
  if (!m) return null;
  let id = m[0];
  let rest = t.slice(id.length);
  // "A---B" and "A-.->B" are two nodes and a link, not one id with dashes in it
  const cut = id.search(/-[-.=>]|-$/);
  if (cut > 0) { rest = id.slice(cut) + rest; id = id.slice(0, cut); }
  for (const sh of SHAPES) {
    if (!rest.startsWith(sh.open)) continue;
    const end = rest.indexOf(sh.close, sh.open.length);
    if (end < 0) continue;
    return { id, text: rest.slice(sh.open.length, end), shape: sh.shape, rest: rest.slice(end + sh.close.length) };
  }
  return { id, rest };
}

/** A link at the start of `s`: its label and style, and what follows. */
function readLink(s: string): { text: string; dashed: boolean; arrow: boolean; rest: string } | null {
  const t = s.trimStart();
  // labelled in the middle: A -- text --> B, A -. text .-> B, A == text ==> B
  const mid = /^(--|-\.|==)\s*([^-.=>|][^>|]*?)\s*(-->|\.->|==>|---|-\.-|===)/.exec(t);
  if (mid) return { text: mid[2], dashed: mid[1] === "-.", arrow: mid[3].endsWith(">"), rest: t.slice(mid[0].length) };
  const op = /^(<?(?:-{2,}>|-\.+->|={2,}>|-{3,}|-\.+-|={3,}|--[ox]))/.exec(t);
  if (!op) return null;
  let rest = t.slice(op[0].length);
  let text = "";
  const piped = /^\s*\|([^|]*)\|/.exec(rest);
  if (piped) { text = piped[1]; rest = rest.slice(piped[0].length); }
  return { text, dashed: op[0].includes("."), arrow: op[0].endsWith(">"), rest };
}

const IGNORED = /^(subgraph|end\b|classDef|class\s|style\s|linkStyle|click\s|direction\s|accTitle|accDescr|title\b)/i;

/**
 * A box's id from its name. slug keeps only a-z and digits, so a name in Russian or Japanese would
 * have no id ("Свет") or share one with another ("Шаг 1" and "Этап 1" are both "1"): such a name
 * gets an id made from the whole name, so the same name is always the same box. Spaces, "_" and
 * "-" count as one separator, as they do for slug ("Банк клиента" is "Банк_клиента").
 */
function nodeId(raw: string): string {
  const name = raw.trim().normalize("NFKC").toLowerCase().replace(/[\s_-]+/g, "_");
  if (!/(?![a-z])\p{L}/u.test(name.normalize("NFKD"))) return slug(raw);
  let h = 0x811c9dc5;
  for (const ch of name) h = Math.imul(h ^ ch.codePointAt(0)!, 0x01000193) >>> 0;
  return `n${h.toString(36)}`;
}

function nodeIn(st: DiagramState, out: DNode[], ref: { id: string; text?: string; shape?: DShape }): string {
  const id = nodeId(ref.id) || nodeId(ref.text ?? "");
  if (!id) return "";
  if (st.nodes.has(id)) {
    // a label given later for a node first named bare is its label
    const known = out.find((n) => n.id === id);
    if (known && ref.text !== undefined && known.text === labelOfId(ref.id)) known.text = label(ref.text, LIMITS.nodeText) || known.text;
    return id;
  }
  if (st.nodes.size >= DIAGRAM_LIMITS.nodes) return "";
  const text = (ref.text !== undefined ? label(ref.text, LIMITS.nodeText) : "") || labelOfId(ref.id);
  if (!text) return "";
  st.nodes.set(id, text);
  out.push({ id, text, shape: ref.shape ?? "box" });
  return id;
}
const labelOfId = (id: string) => cleanText(id.replace(/[_-]+/g, " "), LIMITS.nodeText);

function flowLine(line: string, st: DiagramState, nodes: DNode[], links: DLink[]): void {
  // A & B --> C & D: every node of one group joins every node of the next
  let groups: string[][] = [];
  let rest = line;
  let pending: { text: string; dashed: boolean } | null = null;
  for (let guard = 0; guard < 24 && rest.trim(); guard++) {
    const group: string[] = [];
    for (;;) {
      const n = readNode(rest);
      if (!n) return;
      const id = nodeIn(st, nodes, n);
      if (id) group.push(id);
      rest = n.rest.replace(/^:::[\w-]+/, "");
      const amp = /^\s*&/.exec(rest);
      if (!amp) break;
      rest = rest.slice(amp[0].length);
    }
    if (pending && groups.length) {
      for (const from of groups[groups.length - 1]) for (const to of group) {
        const key = `${from}>${to}`;
        if (from === to || st.links.has(key) || st.links.size >= DIAGRAM_LIMITS.links) continue;
        st.links.add(key);
        links.push({ from, to, text: label(pending.text, LIMITS.edgeText), ...(pending.dashed ? { dashed: true } : {}) });
      }
    }
    groups = [...groups, group];
    const l = readLink(rest);
    if (!l) return;
    pending = { text: l.text, dashed: l.dashed };
    rest = l.rest;
  }
}

function mindLine(raw: string, st: DiagramState, nodes: DNode[], links: DLink[]): void {
  const indent = raw.length - raw.trimStart().length;
  const line = raw.trim();
  if (/^(::icon|:::)/.test(line)) return;
  const n = readNode(line);
  const ref = n && n.text !== undefined && !n.rest.trim() ? n : { id: line, text: line, shape: undefined };
  const text = label(ref.text ?? ref.id, LIMITS.nodeText);
  if (!text) return;
  // a branch named again (by its label) is where the following lines hang, not a new node
  const known = [...st.nodes].find(([, t]) => t.toLowerCase() === text.toLowerCase())?.[0];
  while (st.stack.length && st.stack[st.stack.length - 1].indent >= indent) st.stack.pop();
  if (known) { st.stack.push({ indent, id: known }); return; }
  const parent = st.stack[st.stack.length - 1]?.id;
  // one root: a second line at the root's depth hangs under the root
  const under = parent ?? (st.nodes.size ? [...st.nodes.keys()][0] : undefined);
  const id = nodeIn(st, nodes, { id: n && n.text !== undefined ? n.id : text, text, shape: ref.shape ?? (under ? "round" : "circle") });
  if (!id) return;
  const made = nodes.find((x) => x.id === id);
  if (made && under && made.parent === undefined && id !== under) {
    made.parent = under;
    st.links.add(`${under}>${id}`);
    links.push({ from: under, to: id, text: "" });
  }
  st.stack.push({ indent, id });
}

function sequenceLine(line: string, st: DiagramState, nodes: DNode[], links: DLink[]): void {
  // a name may have spaces ("Banca negozio"), as in Mermaid; with "as" the id is one word
  // Mermaid 11 metadata after a name (participant API@{ "type": "database" }) is not part of it
  const part = /^(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/i.exec(line.replace(/\s*@\{.*\}\s*$/, ""));
  if (part) {
    if (st.nodes.size < DIAGRAM_LIMITS.participants || st.nodes.has(nodeId(part[2]))) nodeIn(st, nodes, { id: part[2], text: part[3] ?? part[2], shape: "box" });
    return;
  }
  // A hyphen belongs to the participant unless it forms a complete arrow.
  const msg = /^([^+<>:,;]+?)\s*(--?(?:>>?|x|\)))\s*[+-]?\s*([^+<>:,;]+?)\s*(?::\s*(.*))?$/.exec(line);
  if (!msg || st.messages >= DIAGRAM_LIMITS.messages) return;
  const at = (ref: string) => (st.nodes.has(nodeId(ref)) ? nodeId(ref) :st.nodes.size < DIAGRAM_LIMITS.participants ? nodeIn(st, nodes, { id: ref, shape: "box" }) : "");
  const from = at(msg[1]);
  const to = at(msg[3]);
  if (!from || !to) return;
  st.messages++;
  links.push({ from, to, text: label(msg[4] ?? "", LIMITS.edgeText), ...(msg[2].startsWith("--") ? { dashed: true } : {}) });
}

function tableLine(line: string, st: DiagramState, rows: string[][]): void {
  if (!line.startsWith("|")) return;
  const cells = line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  // the line under the header (|---|:---:|)
  if (cells.every((c) => /^:?-{2,}:?$/.test(c))) return;
  if (st.rows >= DIAGRAM_LIMITS.rows) return;
  if (!st.cols) st.cols = Math.min(DIAGRAM_LIMITS.cols, cells.length);
  const row = Array.from({ length: st.cols }, (_, k) => label(cells[k] ?? "", LIMITS.cell));
  if (row.every((c) => !c)) return;
  st.rows++;
  rows.push(row);
}

/**
 * The part of the lesson's diagram that one step adds, read from the model's text. The first
 * diagram of a lesson names its type (a Mermaid header, or a table); later steps add lines to it.
 * Null when the text adds nothing usable or is of another type than the lesson's diagram.
 */
export function readDiagram(source: unknown, st: DiagramState): Omit<DiagramItem, "kind"> | null {
  if (typeof source !== "string") return null;
  const text = source.slice(0, DIAGRAM_LIMITS.source).replace(/%%\{[\s\S]*?\}%%/g, "").replace(/\r/g, "");
  const lines = text.split("\n").flatMap((l) => (l.trimStart().startsWith("|") ? [l] : l.split(";"))).map((l) => l.replace(/%%.*$/, "")).filter((l) => l.trim());
  if (!lines.length) return null;
  const head = lines[0].trim();
  let type: DiagramType | null = null;
  let dir: "TD" | "LR" = st.dir;
  const fh = /^(?:flowchart|graph)\b\s*(TD|TB|BT|LR|RL)?/i.exec(head);
  if (fh) { type = "flowchart"; dir = /LR|RL/i.test(fh[1] ?? "") ? "LR" : "TD"; }
  else if (/^mindmap\b/i.test(head)) type = "mindmap";
  else if (/^sequenceDiagram\b/i.test(head)) type = "sequence";
  else if (head.startsWith("|")) type = "table";
  const body = type && type !== "table" ? lines.slice(1) : lines;
  if (st.type && type && type !== st.type) return null;
  if (!st.type) {
    if (!type) return null;
    st.type = type;
    st.dir = dir;
  }
  const nodes: DNode[] = [];
  const links: DLink[] = [];
  const rows: string[][] = [];
  for (const raw of body) {
    const line = raw.trim();
    if (IGNORED.test(line) || /^(autonumber|loop|alt|else|opt|par|and|critical|break|rect|activate|deactivate|note|box)\b/i.test(line)) continue;
    if (st.type === "flowchart") flowLine(line, st, nodes, links);
    else if (st.type === "mindmap") mindLine(raw, st, nodes, links);
    else if (st.type === "sequence") sequenceLine(line, st, nodes, links);
    else tableLine(line, st, rows);
  }
  // A model often writes the whole sequence (or table) again in each step: what repeats the start or
  // the end of what is already drawn is that, not a new message or row.
  if (st.type === "sequence" && links.length) {
    const key = (l: DLink) => `${l.from}>${l.to}:${l.text.toLowerCase()}`;
    const keys = links.map(key);
    const skip = Math.max(overlap(keys, st.said, "start"), overlap(keys, st.said, "end"));
    links.splice(0, skip);
    st.messages -= skip;
    st.said.push(...keys.slice(skip));
  }
  if (st.type === "table") {
    const before = rows.length;
    const kept = rows.filter((r) => !st.cells.includes(r.join("|")));
    st.rows -= before - kept.length;
    rows.splice(0, rows.length, ...kept);
    st.cells.push(...kept.map((r) => r.join("|")));
  }
  if (!nodes.length && !links.length && !rows.length) return null;
  return { type: st.type, dir: st.dir, nodes, links, rows };
}

/** How many of `keys` (from their start) repeat `said`: its start ("start"), or its last ones ("end"). */
function overlap(keys: string[], said: string[], at: "start" | "end"): number {
  if (at === "start") { let k = 0; while (k < keys.length && k < said.length && keys[k] === said[k]) k++; return k; }
  for (let j = Math.min(keys.length, said.length); j > 0; j--) if (keys.slice(0, j).every((k, i) => k === said[said.length - j + i])) return j;
  return 0;
}

/**
 * A step of the local path drawn as part of a structured diagram: its checked boxes and arrows become
 * the diagram's boxes and links (a mind map's branch, a sequence's message), nothing is added or lost.
 */
export function itemsAsDiagram(items: LessonItem[], type: "flowchart" | "mindmap" | "sequence", st: DiagramState): LessonItem[] {
  if (st.type && st.type !== type) return items;
  const nodes: DNode[] = [];
  const links: DLink[] = [];
  for (const it of items) {
    if (it.kind === "node" && !st.nodes.has(it.id)) { st.nodes.set(it.id, it.text); nodes.push({ id: it.id, text: it.text, shape: "box" }); }
  }
  for (const it of items) {
    if (it.kind !== "edge") continue;
    for (const id of [it.from, it.to]) if (!st.nodes.has(id)) { st.nodes.set(id, id); nodes.push({ id, text: labelOfId(id), shape: "box" }); }
    const child = nodes.find((n) => n.id === it.to);
    if (type === "mindmap" && child && child.parent === undefined) child.parent = it.from;
    links.push({ from: it.from, to: it.to, text: it.text });
  }
  if (!nodes.length && !links.length) return items;
  st.type = type;
  return [{ kind: "diagram", type, dir: "TD", nodes, links, rows: [] }, ...items.filter((it) => it.kind !== "node" && it.kind !== "edge")];
}

/**
 * A diagram item read back in its own form (a lesson validated again: a follow-up, a saved board, a
 * guard that rewrote the lesson): every field is checked again as model output is.
 */
export function acceptDiagram(raw: unknown, st: DiagramState): Omit<DiagramItem, "kind"> | null {
  if (!raw || typeof raw !== "object") return null;
  const q = raw as { type?: unknown; dir?: unknown; nodes?: unknown; links?: unknown; rows?: unknown };
  const type = (DIAGRAM_TYPES as readonly string[]).includes(String(q.type)) ? (q.type as DiagramType) : null;
  if (!type || (st.type && st.type !== type)) return null;
  st.type = type;
  if (q.dir === "LR" || q.dir === "TD") st.dir = q.dir;
  const list = (v: unknown) => (Array.isArray(v) ? v.slice(0, 40).filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object") : []);
  const shapes: readonly DShape[] = ["box", "round", "diamond", "circle"];
  const nodes: DNode[] = [];
  for (const n of list(q.nodes)) {
    const id = slug(n.id);
    const text = label(String(n.text ?? ""), LIMITS.nodeText);
    if (!id || !text || st.nodes.has(id) || st.nodes.size >= DIAGRAM_LIMITS.nodes) continue;
    const parent = slug(n.parent);
    st.nodes.set(id, text);
    nodes.push({ id, text, shape: shapes.includes(n.shape as DShape) ? (n.shape as DShape) : "box", ...(parent && st.nodes.has(parent) && parent !== id ? { parent } : {}) });
  }
  const links: DLink[] = [];
  for (const l of list(q.links)) {
    const from = slug(l.from), to = slug(l.to);
    if (!st.nodes.has(from) || !st.nodes.has(to)) continue;
    if (type === "sequence") { if (st.messages >= DIAGRAM_LIMITS.messages) continue; st.messages++; st.said.push(`${from}>${to}:${label(String(l.text ?? ""), LIMITS.edgeText).toLowerCase()}`); }
    else if (from === to || st.links.has(`${from}>${to}`) || st.links.size >= DIAGRAM_LIMITS.links) continue;
    st.links.add(`${from}>${to}`);
    links.push({ from, to, text: label(String(l.text ?? ""), LIMITS.edgeText), ...(l.dashed === true ? { dashed: true } : {}) });
  }
  const rows: string[][] = [];
  for (const r of Array.isArray(q.rows) ? q.rows.slice(0, DIAGRAM_LIMITS.rows) : []) {
    if (!Array.isArray(r) || st.rows >= DIAGRAM_LIMITS.rows) continue;
    if (!st.cols) st.cols = Math.min(DIAGRAM_LIMITS.cols, r.length);
    const row = Array.from({ length: st.cols }, (_, k) => label(String(r[k] ?? ""), LIMITS.cell));
    if (row.every((c) => !c)) continue;
    st.rows++;
    st.cells.push(row.join("|"));
    rows.push(row);
  }
  if (!nodes.length && !links.length && !rows.length) return null;
  return { type, dir: st.dir, nodes, links, rows };
}

/** The diagram as Mermaid again (Markdown export and the follow-up context): only what Filow accepted. */
export function diagramText(items: DiagramItem[]): string {
  if (!items.length) return "";
  const type = items[0].type;
  const q = (s: string) => `"${s.replace(/"/g, "'")}"`;
  if (type === "table") return items.flatMap((d) => d.rows).map((r) => `| ${r.join(" | ")} |`).join("\n");
  if (type === "sequence") {
    const names = new Map(items.flatMap((d) => d.nodes.map((n) => [n.id, n.text] as const)));
    return ["sequenceDiagram", ...[...names].map(([id, t]) => `  participant ${id} as ${t}`), ...items.flatMap((d) => d.links).map((l) => `  ${l.from}${l.dashed ? "-->>" : "->>"}${l.to}: ${l.text}`)].join("\n");
  }
  if (type === "mindmap") {
    const all = items.flatMap((d) => d.nodes);
    const depth = (n: DNode): number => (n.parent ? 1 + depth(all.find((p) => p.id === n.parent) ?? { id: "", text: "", shape: "box" }) : 0);
    return ["mindmap", ...all.map((n) => `${"  ".repeat(depth(n) + 1)}${n.id}[${q(n.text)}]`)].join("\n");
  }
  const open: Record<DShape, [string, string]> = { box: ["[", "]"], round: ["(", ")"], diamond: ["{", "}"], circle: ["((", "))"] };
  return [`flowchart ${items[0].dir}`, ...items.flatMap((d) => d.nodes).map((n) => `  ${n.id}${open[n.shape][0]}${q(n.text)}${open[n.shape][1]}`), ...items.flatMap((d) => d.links).map((l) => `  ${l.from} ${l.dashed ? "-.->" : "-->"}${l.text ? `|${l.text}|` : ""} ${l.to}`)].join("\n");
}
