// Whiteboard diagrams the way a concept is normally taught: a sequence between two parties, a graph
// with curves, a cycle, an array traced by an algorithm, a circuit, a call stack, a growth chart, a
// right triangle with its squares, a process with its inputs and outputs, the layers of a network.
// The local model only PICKS the template and fills its slots (names, messages, values); this file
// checks the slots, computes the worked example in code (never trusting a small model's
// arithmetic), says what each step shows, and draws it as Excalidraw elements. Pure: no DOM.
import { cleanText } from "./lesson";
import { evalExpr, parseExpr } from "./plot";
import { INK, LINE_HEIGHT, arrow, el, handWidth, head, labelled, line, stepColour, text, wrapHand, type ExEl, type Scene, type WbMeta } from "./scene";
import { chemText, texToText } from "./tex";

export const TEMPLATES = ["sequence", "graph", "cycle", "array", "circuit", "callstack", "growth", "triangle", "process", "layers", "map"] as const;
export type TemplateName = (typeof TEMPLATES)[number];
export const ALGORITHMS = ["binary_search", "linear_search", "bubble_sort"] as const;
export const RECURSIONS = ["factorial", "sum_to", "fibonacci"] as const;

export type Diagram =
  | { template: "sequence"; title: string; actors: [string, string]; messages: Array<{ from: 0 | 1; text: string }>; result: string }
  | { template: "graph"; title: string; curves: Array<{ expr: string; name: string }>; xName: string; yName: string; xmin: number; xmax: number }
  | { template: "cycle"; title: string; items: string[]; byproducts: Array<{ after: number; text: string }>; center: string }
  | { template: "array"; title: string; algorithm: (typeof ALGORITHMS)[number]; values: number[]; target: number }
  | { template: "circuit"; title: string; voltage: number; resistance: number }
  | { template: "callstack"; title: string; fn: (typeof RECURSIONS)[number]; n: number }
  | { template: "growth"; title: string; principal: number; rate: number; years: number }
  | { template: "triangle"; title: string; a: number; b: number }
  | { template: "process"; title: string; process: string; inputs: string[]; outputs: string[]; equation: string }
  | { template: "layers"; title: string; layers: string[]; sizes: number[]; prediction: number; target: number };

/** What the model is asked for: one flat object, held to this schema (Ollama structured output). */
export const TEMPLATE_SCHEMA = {
  type: "object",
  properties: {
    template: { type: "string", enum: [...TEMPLATES] },
    title: { type: "string", maxLength: 60 },
    actors: { type: "array", maxItems: 2, items: { type: "string", maxLength: 24 } },
    messages: { type: "array", maxItems: 6, items: { type: "object", properties: { from: { type: "integer" }, text: { type: "string", maxLength: 28 } }, required: ["from", "text"] } },
    result: { type: "string", maxLength: 40 },
    curves: { type: "array", maxItems: 3, items: { type: "object", properties: { expr: { type: "string" }, name: { type: "string", maxLength: 20 } }, required: ["expr", "name"] } },
    xName: { type: "string", maxLength: 24 },
    yName: { type: "string", maxLength: 24 },
    items: { type: "array", maxItems: 10, items: { type: "string", maxLength: 28 } },
    byproducts: { type: "array", maxItems: 6, items: { type: "object", properties: { after: { type: "integer" }, text: { type: "string", maxLength: 16 } }, required: ["after", "text"] } },
    center: { type: "string", maxLength: 24 },
    algorithm: { type: "string", enum: [...ALGORITHMS] },
    values: { type: "array", maxItems: 10, items: { type: "number" } },
    target: { type: "number" },
    voltage: { type: "number" },
    resistance: { type: "number" },
    fn: { type: "string", enum: [...RECURSIONS] },
    n: { type: "integer" },
    principal: { type: "number" },
    rate: { type: "number" },
    years: { type: "integer" },
    a: { type: "number" },
    b: { type: "number" },
    process: { type: "string", maxLength: 24 },
    inputs: { type: "array", maxItems: 4, items: { type: "string", maxLength: 22 } },
    outputs: { type: "array", maxItems: 4, items: { type: "string", maxLength: 22 } },
    equation: { type: "string", maxLength: 80 },
    layers: { type: "array", maxItems: 4, items: { type: "string", maxLength: 16 } },
    sizes: { type: "array", maxItems: 4, items: { type: "integer" } },
    prediction: { type: "number" },
  },
  required: ["template", "title"],
};

export const TEMPLATE_GUIDE = [
  "Pick the ONE template that is the picture a teacher normally draws for this concept, and fill its fields:",
  '- "sequence": messages between two parties in time order (a network handshake, a request and its answer). actors: the two names; messages: each {from: 0 or 1 (which actor sends), text: the message}; result: the state at the end.',
  '- "graph": quantities as curves on x-y axes (supply and demand, a law with a straight line). curves: {expr in x, e.g. "10 - x", name}; xName, yName with units.',
  '- "cycle": stages that come back to the start (a biochemical cycle, the water cycle). items: the stages in order; byproducts: {after: stage number from 0, text} for what each step gives off; center: the name of the cycle.',
  '- "array": an algorithm on a list. algorithm: binary_search, linear_search or bubble_sort; values: a small example list; target: the value searched for.',
  '- "circuit": an electric circuit (Ohm\'s law). voltage in volts and resistance in ohms of a simple example.',
  '- "callstack": recursion. fn: factorial, sum_to or fibonacci; n: a small example (3 to 5).',
  '- "growth": money or a quantity that grows by a rate (compound interest). principal, rate in percent per year, years (3 to 6).',
  '- "triangle": a right triangle and the squares on its sides (Pythagoras). a and b: the two short sides of an example (3 and 4).',
  '- "process": inputs that go into one process and the outputs that come out (photosynthesis, digestion). process: its name; inputs; outputs; equation: the overall equation if there is one (e.g. "6CO2 + 6H2O -> C6H12O6 + 6O2").',
  '- "layers": a neural network. layers: the layer names (input, hidden, output); sizes: neurons per layer (2 to 4).',
  '- "map": none of these fits; the lesson is drawn as boxes and arrows.',
  "Every name is 1 to 3 words. Numbers are a small, simple example. Leave out the fields of other templates.",
].join("\n");

const num = (v: unknown, d: number, lo: number, hi: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= lo && n <= hi ? n : d;
};
const words = (v: unknown, max: number) => cleanText(v, max);
const list = (v: unknown, max: number, len: number) => (Array.isArray(v) ? v : []).map((x) => words(x, len)).filter(Boolean).slice(0, max);

/** The model's pick, checked; a slot it left empty or wrong gets a sound default. Null: draw a map. */
export function readDiagram(raw: unknown, fallbackTitle: string): Diagram | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const template = TEMPLATES.includes(r.template as TemplateName) ? (r.template as TemplateName) : null;
  const title = words(r.title, 60) || fallbackTitle;
  switch (template) {
    case "sequence": {
      const actors = list(r.actors, 2, 24);
      const messages = (Array.isArray(r.messages) ? r.messages : []).slice(0, 6).flatMap((m) => {
        const q = m as { from?: unknown; text?: unknown };
        const t = words(q.text, 28);
        return t ? [{ from: (Number(q.from) === 1 ? 1 : 0) as 0 | 1, text: t }] : [];
      });
      if (actors.length < 2 || messages.length < 2) return null;
      return { template, title, actors: [actors[0], actors[1]], messages, result: words(r.result, 40) };
    }
    case "graph": {
      const curves = (Array.isArray(r.curves) ? r.curves : []).slice(0, 3).flatMap((c) => {
        const q = c as { expr?: unknown; name?: unknown };
        const expr = String(q.expr ?? "").slice(0, 60);
        return parseExpr(expr) ? [{ expr, name: words(q.name, 20) || expr }] : [];
      });
      if (!curves.length) return null;
      return { template, title, curves, xName: words(r.xName, 24) || "x", yName: words(r.yName, 24) || "y", xmin: 0, xmax: num(r.xmax, 10, 1, 1000) };
    }
    case "cycle": {
      const items = list(r.items, 10, 28);
      if (items.length < 3) return null;
      const byproducts = (Array.isArray(r.byproducts) ? r.byproducts : []).slice(0, 6).flatMap((b) => {
        const q = b as { after?: unknown; text?: unknown };
        const after = num(q.after, -1, 0, items.length - 1);
        const t = chemText(words(q.text, 16));
        return after >= 0 && t ? [{ after, text: t }] : [];
      });
      return { template, title, items, byproducts, center: words(r.center, 24) || title };
    }
    case "array": {
      const algorithm = ALGORITHMS.includes(r.algorithm as (typeof ALGORITHMS)[number]) ? (r.algorithm as (typeof ALGORITHMS)[number]) : "binary_search";
      let values = (Array.isArray(r.values) ? r.values : []).map((v) => Number(v)).filter((v) => Number.isFinite(v) && Math.abs(v) < 1e6).slice(0, 9);
      if (values.length < 4) values = [4, 9, 15, 23, 31, 42, 57];
      if (algorithm === "binary_search") values = [...new Set(values)].sort((x, y) => x - y);
      const t = Number(r.target);
      const target = Number.isFinite(t) && values.includes(t) ? t : values[values.length - 2];
      return { template, title, algorithm, values, target };
    }
    case "circuit":
      return { template, title, voltage: num(r.voltage, 9, 0.1, 10000), resistance: num(r.resistance, 3, 0.1, 1e6) };
    case "callstack": {
      const fn = RECURSIONS.includes(r.fn as (typeof RECURSIONS)[number]) ? (r.fn as (typeof RECURSIONS)[number]) : "factorial";
      return { template, title, fn, n: Math.round(num(r.n, 4, 2, 6)) };
    }
    case "growth":
      return { template, title, principal: num(r.principal, 1000, 1, 1e9), rate: num(r.rate, 10, 0.1, 100), years: Math.round(num(r.years, 5, 2, 8)) };
    case "triangle":
      return { template, title, a: num(r.a, 3, 1, 20), b: num(r.b, 4, 1, 20) };
    case "process": {
      const inputs = list(r.inputs, 4, 22).map(chemText), outputs = list(r.outputs, 4, 22).map(chemText);
      if (!inputs.length || !outputs.length) return null;
      return { template, title, process: words(r.process, 24) || title, inputs, outputs, equation: chemText(words(r.equation, 80)) };
    }
    case "layers": {
      const layers = list(r.layers, 4, 16);
      const names = layers.length >= 2 ? layers : ["Input", "Hidden", "Output"];
      const sizes = names.map((_, i) => Math.round(num((r.sizes as unknown[] | undefined)?.[i], i === names.length - 1 ? 1 : 3, 1, 5)));
      return { template, title, layers: names, sizes, prediction: 0.8, target: 1 };
    }
    default:
      return null;
  }
}

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : (Math.round(v * 100) / 100).toFixed(2).replace(/\.?0+$/, ""));
const money = (v: number) => { const r = Math.round(v * 100) / 100; return r.toLocaleString("en-US", { minimumFractionDigits: r % 1 ? 2 : 0, maximumFractionDigits: 2 }); };

/** The worked example, computed here: per step the facts it states (in plain English, numbers exact) and the result. */
export type Worked = { facts: string[]; result: string };

export function binarySearchTrace(values: number[], target: number): Array<{ lo: number; hi: number; mid: number; cmp: "less" | "more" | "found" }> {
  const out: Array<{ lo: number; hi: number; mid: number; cmp: "less" | "more" | "found" }> = [];
  let lo = 0, hi = values.length - 1;
  while (lo <= hi && out.length < 8) {
    const mid = Math.floor((lo + hi) / 2);
    const cmp = values[mid] === target ? "found" : values[mid] < target ? "less" : "more";
    out.push({ lo, hi, mid, cmp });
    if (cmp === "found") break;
    if (cmp === "less") lo = mid + 1;
    else hi = mid - 1;
  }
  return out;
}
export function recursionValues(fn: (typeof RECURSIONS)[number], n: number): number[] {
  // value of fn(k) for k = n down to the base case
  const f = (k: number): number => (fn === "factorial" ? (k <= 1 ? 1 : k * f(k - 1)) : fn === "sum_to" ? (k <= 1 ? 1 : k + f(k - 1)) : k <= 1 ? k : f(k - 1) + f(k - 2));
  return Array.from({ length: n }, (_, i) => f(n - i));
}
export const growthValues = (p: number, ratePct: number, years: number) => Array.from({ length: years + 1 }, (_, t) => p * Math.pow(1 + ratePct / 100, t));

/** Where curves meet (the first two), found by walking x. */
export function meeting(a: string, b: string, xmin: number, xmax: number): { x: number; y: number } | null {
  const ta = parseExpr(a), tb = parseExpr(b);
  if (!ta || !tb) return null;
  let before = NaN;
  for (let k = 0; k <= 400; k++) {
    const x = xmin + ((xmax - xmin) * k) / 400;
    const d = evalExpr(ta, x) - evalExpr(tb, x);
    if (Number.isFinite(d) && Number.isFinite(before) && (d === 0 || d * before < 0)) {
      // bisection for an exact value
      let lo = x - (xmax - xmin) / 400, hi = x;
      for (let i = 0; i < 40; i++) {
        const m = (lo + hi) / 2;
        const dm = evalExpr(ta, m) - evalExpr(tb, m);
        if (Math.sign(dm) === Math.sign(evalExpr(ta, lo) - evalExpr(tb, lo))) lo = m;
        else hi = m;
      }
      const xm = (lo + hi) / 2;
      return { x: xm, y: evalExpr(ta, xm) };
    }
    before = d;
  }
  return null;
}

export function workedExample(d: Diagram): Worked {
  switch (d.template) {
    case "sequence":
      return { facts: [`${d.actors[0]} and ${d.actors[1]} start.`, ...d.messages.map((m) => `${d.actors[m.from]} sends ${m.text} to ${d.actors[1 - m.from]}.`)], result: d.result || d.messages[d.messages.length - 1].text };
    case "graph": {
      const m = d.curves.length > 1 ? meeting(d.curves[0].expr, d.curves[1].expr, d.xmin, d.xmax) : null;
      const facts = [`The x axis is ${d.xName}, the y axis is ${d.yName}.`, ...d.curves.map((c) => `${c.name}: y = ${c.expr}.`)];
      if (m) facts.push(`They meet at ${d.xName} = ${fmt(m.x)}, ${d.yName} = ${fmt(m.y)}.`);
      return { facts, result: m ? `${d.xName} = ${fmt(m.x)}, ${d.yName} = ${fmt(m.y)}` : `y = ${d.curves[0].expr}` };
    }
    case "cycle": {
      const per = Math.ceil(d.items.length / 4);
      const facts = [`${d.center} is a cycle of ${d.items.length} stages that ends where it began.`];
      for (let i = 0; i < d.items.length; i += per) {
        const part = d.items.slice(i, i + per);
        const given = d.byproducts.filter((b) => b.after >= i && b.after < i + per).map((b) => b.text);
        facts.push(`${part.join(", then ")}${given.length ? `, giving off ${given.join(" and ")}` : ""}.`);
      }
      facts.push(`From ${d.items[d.items.length - 1]} the cycle returns to ${d.items[0]}.`);
      return { facts, result: `${d.items[d.items.length - 1]} → ${d.items[0]}` };
    }
    case "array": {
      const v = d.values;
      if (d.algorithm === "binary_search") {
        const tr = binarySearchTrace(v, d.target);
        const facts = [`Look for ${d.target} in the sorted list ${v.join(", ")}.`, ...tr.map((s) => (s.cmp === "found" ? `The middle value ${v[s.mid]} is ${d.target}: found at position ${s.mid}.` : `The middle value is ${v[s.mid]}, ${s.cmp === "less" ? `smaller than ${d.target}, so drop the left half` : `bigger than ${d.target}, so drop the right half`}.`))];
        return { facts, result: `${d.target} found at position ${tr[tr.length - 1].mid} after ${tr.length} checks` };
      }
      const at = v.indexOf(d.target);
      return { facts: [`Look for ${d.target} in ${v.join(", ")}.`, `Check each value from the left: ${v.slice(0, at + 1).join(", ")}.`, `${d.target} is at position ${at}.`], result: `${d.target} found at position ${at} after ${at + 1} checks` };
    }
    case "circuit": {
      const i = d.voltage / d.resistance;
      return { facts: [`A battery of ${fmt(d.voltage)} V drives current round the circuit.`, `The resistor of ${fmt(d.resistance)} ohms limits the current.`, `Ohm's law: I = V / R.`, `I = ${fmt(d.voltage)} V / ${fmt(d.resistance)} ohms = ${fmt(i)} A.`], result: `I = ${fmt(d.voltage)} V / ${fmt(d.resistance)} Ω = ${fmt(i)} A` };
    }
    case "callstack": {
      const vals = recursionValues(d.fn, d.n);
      const name = d.fn === "factorial" ? "fact" : d.fn === "sum_to" ? "sum" : "fib";
      const facts = [`${name}(${d.n}) calls ${name}(${d.n - 1}), and so on down to the base case.`, `The base case ${name}(1) = ${d.fn === "fibonacci" ? 1 : 1} returns without calling itself.`, `Each call returns its value to the one that called it: ${vals.slice().reverse().join(", ")}.`, `${name}(${d.n}) = ${vals[0]}.`];
      return { facts, result: `${name}(${d.n}) = ${vals[0]}` };
    }
    case "growth": {
      const vals = growthValues(d.principal, d.rate, d.years);
      return { facts: [`Start with ${money(d.principal)} at ${fmt(d.rate)}% a year.`, `After year 1: ${money(vals[1])}; the interest is ${money(vals[1] - vals[0])}.`, `Each year earns interest on the interest too: year 2 gives ${money(vals[2])}.`, `A = P(1 + r)ᵗ, with r = ${fmt(d.rate / 100)} and t in years.`, `After ${d.years} years: ${money(vals[d.years])}.`], result: `${money(d.principal)} → ${money(vals[d.years])} in ${d.years} years` };
    }
    case "triangle": {
      const c2 = d.a * d.a + d.b * d.b;
      const c = Math.sqrt(c2);
      return { facts: [`A right triangle with sides a = ${fmt(d.a)} and b = ${fmt(d.b)}.`, `Draw a square on each side: areas ${fmt(d.a * d.a)} and ${fmt(d.b * d.b)}.`, `The square on the long side c has area ${fmt(c2)}.`, `${fmt(d.a * d.a)} + ${fmt(d.b * d.b)} = ${fmt(c2)}, so a² + b² = c² and c = ${fmt(c)}.`], result: `${fmt(d.a * d.a)} + ${fmt(d.b * d.b)} = ${fmt(c2)}: a² + b² = c²` };
    }
    case "process":
      return { facts: [`${d.process} takes in ${d.inputs.join(", ")}.`, `Inside ${d.process} they are changed.`, `Out come ${d.outputs.join(", ")}.`, ...(d.equation ? [`In one line: ${d.equation}.`] : [])], result: d.equation || `${d.inputs.join(" + ")} → ${d.outputs.join(" + ")}` };
    case "layers": {
      const err = d.target - d.prediction;
      return { facts: [`Inputs enter the ${d.layers[0]} layer.`, `Each connection has a weight; the signal flows forward to the ${d.layers[d.layers.length - 1]}.`, `The network predicts ${fmt(d.prediction)}; the right answer is ${fmt(d.target)}, so the error is ${fmt(err)}.`, `The error flows backward and every weight is nudged to make it smaller.`, `Repeat over many examples: the error shrinks.`], result: `error = ${fmt(d.target)} - ${fmt(d.prediction)} = ${fmt(err)}` };
    }
  }
}

// ---- drawing ----

const W = 1200, H = 720;
/** The diagram's room; the numbered steps stand in a column on the right. */
const AREA = { x: 28, y: 84, w: 760, h: 600 };
const COL = { x: 812, y: 84, w: 366 };

type Out = { els: ExEl[]; meta: (step: number, key: string) => WbMeta };
const mk = (): Out => ({ els: [], meta: (step, key) => ({ step, key, role: "block" }) });
const box = (o: Out, id: string, b: { x: number; y: number; w: number; h: number }, words: string, step: number, key: string, opt: { colour?: string; shape?: "rectangle" | "ellipse"; size?: number; fill?: string } = {}) => {
  const colour = opt.colour ?? stepColour(step);
  const shape = el(id, opt.shape ?? "rectangle", b, { step, key, role: "node" }, { strokeColor: colour, backgroundColor: opt.fill ?? "transparent", roundness: opt.shape === "ellipse" ? null : { type: 3 } });
  const size = Math.max(13, Math.min(opt.size ?? 20, Math.floor((b.w - 22) / Math.max(1, ...words.split(/\s+|(?<=-)/).map((w) => handWidth(w, 1))))));
  const lines = wrapHand(words, b.w - 22, size);
  o.els.push(...labelled(shape, text(`${id}-t`, lines, size, { cx: b.x + b.w / 2, cy: b.y + b.h / 2 }, { step, key, role: "label" }, { originalText: words })));
  return shape;
};
const bind = (a: ExEl, from: ExEl | null, to: ExEl | null) => {
  if (from) { a.startBinding = { elementId: from.id, focus: 0, gap: 6 }; from.boundElements = [...(from.boundElements ?? []), { id: a.id, type: "arrow" }]; }
  if (to) { a.endBinding = { elementId: to.id, focus: 0, gap: 6 }; to.boundElements = [...(to.boundElements ?? []), { id: a.id, type: "arrow" }]; }
  return a;
};
/** A label beside a line, never on it: `side` pixels off the line's middle, perpendicular to it. */
const note = (o: Out, id: string, words: string, at: { x: number; y: number }, step: number, key: string, size = 17, colour: string = INK.text) =>
  o.els.push(text(id, [words], size, { cx: at.x, cy: at.y }, o.meta(step, key), { strokeColor: colour }));

/** The step a part belongs to when `parts` parts are spread over `steps` steps. */
const spread = (i: number, parts: number, steps: number) => Math.min(steps - 1, Math.floor((i * steps) / Math.max(1, parts)));

function drawSequence(d: Extract<Diagram, { template: "sequence" }>, o: Out) {
  const xs = [AREA.x + 150, AREA.x + AREA.w - 150];
  const actors = d.actors.map((a, i) => box(o, `seq-actor${i}`, { x: xs[i] - 110, y: AREA.y, w: 220, h: 56 }, a, 0, "actors"));
  const top = AREA.y + 70, bottom = AREA.y + AREA.h - 70;
  d.actors.forEach((_, i) => o.els.push(line(`seq-life${i}`, [{ x: xs[i], y: top }, { x: xs[i], y: bottom }], o.meta(0, "actors"), { strokeColor: INK.faint, strokeStyle: "dashed", strokeWidth: 1.5 })));
  // time runs down the page
  o.els.push(arrow("seq-time", [{ x: AREA.x + 6, y: top + 10 }, { x: AREA.x + 6, y: bottom }], o.meta(0, "actors"), { strokeColor: INK.faint, strokeWidth: 1.5 }));
  note(o, "seq-time-t", "time", { x: AREA.x + 24, y: bottom + 16 }, 0, "actors", 15, INK.faint);
  const gap = Math.min(130, (bottom - top - 60) / d.messages.length);
  d.messages.forEach((m, k) => {
    const step = Math.min(6, k + 1);
    const y = top + 40 + k * gap;
    const from = xs[m.from], to = xs[1 - m.from];
    const a = arrow(`seq-msg${k}`, [{ x: from, y }, { x: to + (to > from ? -4 : 4), y: y + 22 }], o.meta(step, `msg${k}`), { strokeColor: stepColour(step), strokeWidth: 2.5 });
    o.els.push(a);
    note(o, `seq-msg${k}-t`, `${k + 1}. ${m.text}`, { x: (from + to) / 2, y: y - 6 }, step, `msg${k}`, 19, INK.text);
    void actors;
  });
}

function drawGraph(d: Extract<Diagram, { template: "graph" }>, o: Out, steps: number) {
  const pad = { l: 70, r: 30, t: 20, b: 60 };
  const inner = { x: AREA.x + pad.l, y: AREA.y + pad.t, w: AREA.w - pad.l - pad.r, h: AREA.h - pad.t - pad.b - 20 };
  const samples = d.curves.map((c) => { const t = parseExpr(c.expr)!; return Array.from({ length: 41 }, (_, k) => { const x = d.xmin + ((d.xmax - d.xmin) * k) / 40; return { x, y: evalExpr(t, x) }; }).filter((p) => Number.isFinite(p.y)); });
  const ys = samples.flat().map((p) => p.y);
  const ymin = Math.min(0, ...ys), ymax = Math.max(...ys, 1);
  const sx = (x: number) => inner.x + ((x - d.xmin) / (d.xmax - d.xmin)) * inner.w;
  const sy = (y: number) => inner.y + inner.h - ((y - ymin) / (ymax - ymin)) * inner.h;
  o.els.push(arrow("g-ax", [{ x: inner.x, y: sy(Math.max(ymin, 0)) }, { x: inner.x + inner.w + 10, y: sy(Math.max(ymin, 0)) }], o.meta(0, "axes"), { strokeColor: INK.soft }));
  o.els.push(arrow("g-ay", [{ x: inner.x, y: inner.y + inner.h }, { x: inner.x, y: inner.y - 10 }], o.meta(0, "axes"), { strokeColor: INK.soft }));
  note(o, "g-xn", d.xName, { x: inner.x + inner.w / 2, y: inner.y + inner.h + 42 }, 0, "axes", 18, INK.soft);
  o.els.push(text("g-yn", [d.yName], 17, { x: inner.x + 10, y: inner.y - 14 }, o.meta(0, "axes"), { strokeColor: INK.soft }));
  note(o, "g-x0", fmt(d.xmin), { x: inner.x, y: inner.y + inner.h + 16 }, 0, "axes", 14, INK.faint);
  note(o, "g-x1", fmt(d.xmax), { x: inner.x + inner.w, y: inner.y + inner.h + 16 }, 0, "axes", 14, INK.faint);
  note(o, "g-y1", fmt(ymax), { x: inner.x - 26, y: inner.y }, 0, "axes", 14, INK.faint);
  d.curves.forEach((c, n) => {
    const step = Math.min(steps - 1, n + 1);
    const colour = INK.curve[n % 3];
    o.els.push(line(`g-c${n}`, samples[n].map((p) => ({ x: sx(p.x), y: sy(p.y) })), o.meta(step, `curve${n}`), { strokeColor: colour, strokeWidth: 3, roughness: 0, roundness: { type: 2 } }));
    const end = samples[n][samples[n].length - 1];
    o.els.push(text(`g-c${n}-t`, [c.name], 19, { x: Math.min(sx(end.x) - handWidth(c.name, 19) - 6, inner.x + inner.w - handWidth(c.name, 19)), y: sy(end.y) + (n ? -30 : 8) }, o.meta(step, `curve${n}`), { strokeColor: colour }));
  });
  const m = d.curves.length > 1 ? meeting(d.curves[0].expr, d.curves[1].expr, d.xmin, d.xmax) : null;
  if (m) {
    const step = steps - 1;
    o.els.push(line("g-mx", [{ x: sx(m.x), y: sy(m.y) }, { x: sx(m.x), y: sy(Math.max(ymin, 0)) }], o.meta(step, "meet"), { strokeColor: INK.faint, strokeStyle: "dashed", strokeWidth: 1.5 }));
    o.els.push(line("g-my", [{ x: sx(m.x), y: sy(m.y) }, { x: inner.x, y: sy(m.y) }], o.meta(step, "meet"), { strokeColor: INK.faint, strokeStyle: "dashed", strokeWidth: 1.5 }));
    o.els.push(el("g-m", "ellipse", { x: sx(m.x) - 8, y: sy(m.y) - 8, w: 16, h: 16 }, o.meta(step, "meet"), { strokeColor: INK.mark, backgroundColor: INK.mark, roughness: 0 }));
    note(o, "g-mxv", fmt(m.x), { x: sx(m.x), y: inner.y + inner.h + 16 }, step, "meet", 15, INK.mark);
    note(o, "g-myv", fmt(m.y), { x: inner.x - 26, y: sy(m.y) }, step, "meet", 15, INK.mark);
  }
}

function drawCycle(d: Extract<Diagram, { template: "cycle" }>, o: Out, steps: number) {
  const n = d.items.length;
  const c = { x: AREA.x + AREA.w / 2, y: AREA.y + AREA.h / 2 - 20 };
  const R = { x: 275, y: 225 };
  const bw = Math.min(176, 900 / n + 56), bh = 62;
  const at = (i: number) => ({ x: c.x + R.x * Math.sin((2 * Math.PI * i) / n), y: c.y - R.y * Math.cos((2 * Math.PI * i) / n) });
  o.els.push(text("cy-center", wrapHand(d.center, 200, 24), 24, { cx: c.x, cy: c.y }, o.meta(0, "center"), { textAlign: "center", originalText: d.center }));
  const shapes = d.items.map((it, i) => {
    const p = at(i);
    return box(o, `cy-${i}`, { x: p.x - bw / 2, y: p.y - bh / 2, w: bw, h: bh }, it, spread(i, n, steps - 1) + 1, `stage${i}`, { size: 18 });
  });
  d.items.forEach((_, i) => {
    const j = (i + 1) % n;
    const a = at(i), b = at(j);
    // from the edge of one box to the edge of the next, bowing outwards
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const out = { x: mid.x + (mid.x - c.x) * 0.18, y: mid.y + (mid.y - c.y) * 0.18 };
    const shrink = (p: { x: number; y: number }, q: { x: number; y: number }) => {
      const dx = q.x - p.x, dy = q.y - p.y, s = Math.min((bw / 2 + 8) / Math.max(1e-6, Math.abs(dx)), (bh / 2 + 8) / Math.max(1e-6, Math.abs(dy)));
      return { x: p.x + dx * s, y: p.y + dy * s };
    };
    const step = j === 0 ? steps - 1 : spread(j, n, steps - 1) + 1;
    o.els.push(bind(arrow(`cy-a${i}`, [shrink(a, out), out, shrink(b, out)], o.meta(step, j === 0 ? "close" : `stage${j}`), { strokeColor: INK.soft }), shapes[i], shapes[j]));
    for (const bp of d.byproducts.filter((x) => x.after === i)) {
      const k = d.byproducts.indexOf(bp);
      const far = { x: mid.x + (mid.x - c.x) * 0.36, y: mid.y + (mid.y - c.y) * 0.36 };
      note(o, `cy-bp${k}`, `+ ${bp.text}`, far, step, j === 0 ? "close" : `stage${j}`, 17, INK.mark);
    }
  });
}

function drawArray(d: Extract<Diagram, { template: "array" }>, o: Out) {
  const v = d.values;
  const cw = Math.min(96, (AREA.w - 160) / v.length), ch = 58;
  const x0 = AREA.x + 120;
  const rows = d.algorithm === "binary_search" ? binarySearchTrace(v, d.target) : [{ lo: 0, hi: v.length - 1, mid: v.indexOf(d.target), cmp: "found" as const }];
  const rowH = Math.min(150, (AREA.h - 40) / (rows.length + 1));
  // the list, with its positions
  const drawRow = (r: number, y: number, state: { lo: number; hi: number; mid: number; cmp: string } | null, step: number, key: string) => {
    v.forEach((val, i) => {
      const out = state && (i < state.lo || i > state.hi);
      const on = state && i === state.mid;
      const fill = on ? (state!.cmp === "found" ? "#b2f2bb" : INK.highlight) : out ? "#e9ecef" : "transparent";
      box(o, `ar-${r}-${i}`, { x: x0 + i * cw, y, w: cw, h: ch }, String(val), step, key, { colour: out ? INK.faint : stepColour(step), fill, size: 23 });
    });
    if (state) {
      const px = x0 + (state.mid + 0.5) * cw;
      o.els.push(arrow(`ar-${r}-p`, [{ x: px, y: y + ch + 30 }, { x: px, y: y + ch + 6 }], o.meta(step, key), { strokeColor: INK.mark, strokeWidth: 2.5 }));
      note(o, `ar-${r}-m`, state.cmp === "found" ? `= ${d.target}` : state.cmp === "less" ? `${v[state.mid]} < ${d.target}` : `${v[state.mid]} > ${d.target}`, { x: px + 70, y: y + ch + 20 }, step, key, 17, INK.mark);
    }
  };
  drawRow(0, AREA.y + 10, null, 0, "list");
  v.forEach((_, i) => note(o, `ar-i${i}`, String(i), { x: x0 + (i + 0.5) * cw, y: AREA.y + 10 + ch + 14 }, 0, "list", 14, INK.faint));
  note(o, "ar-target", `target: ${d.target}`, { x: AREA.x + 56, y: AREA.y + 10 + ch / 2 }, 0, "list", 18, INK.mark);
  rows.forEach((s, k) => {
    const step = Math.min(6, k + 1);
    note(o, `ar-step${k}`, `${k + 1}.`, { x: x0 - 30, y: AREA.y + 10 + (k + 1) * rowH + ch / 2 }, step, `row${k}`, 18, stepColour(step));
    drawRow(k + 1, AREA.y + 10 + (k + 1) * rowH, s, step, `row${k}`);
  });
}

function drawCircuit(d: Extract<Diagram, { template: "circuit" }>, o: Out) {
  const L = AREA.x + 90, R = AREA.x + AREA.w - 150, T = AREA.y + 70, B = AREA.y + 380;
  const wire = (id: string, pts: Array<{ x: number; y: number }>, step: number) => o.els.push(line(id, pts, o.meta(step, "wire"), { strokeColor: INK.text, strokeWidth: 2.5, roughness: 0.6, roundness: null }));
  const by = (T + B) / 2;
  // battery on the left side: long and short plate
  wire("ci-w1", [{ x: L, y: by - 20 }, { x: L, y: T }, { x: (L + R) / 2 - 70, y: T }], 0);
  wire("ci-w2", [{ x: (L + R) / 2 + 70, y: T }, { x: R, y: T }, { x: R, y: B }, { x: L, y: B }, { x: L, y: by + 20 }], 0);
  o.els.push(line("ci-bat1", [{ x: L - 34, y: by - 20 }, { x: L + 34, y: by - 20 }], o.meta(0, "battery"), { strokeColor: INK.text, strokeWidth: 4, roughness: 0 }));
  o.els.push(line("ci-bat2", [{ x: L - 18, y: by + 20 }, { x: L + 18, y: by + 20 }], o.meta(0, "battery"), { strokeColor: INK.text, strokeWidth: 4, roughness: 0 }));
  note(o, "ci-bat+", "+", { x: L + 48, y: by - 30 }, 0, "battery", 20);
  note(o, "ci-v", `${fmt(d.voltage)} V`, { x: L - 70, y: by }, 0, "battery", 24, stepColour(0));
  // resistor on the top wire: a zigzag
  const zx = (L + R) / 2 - 70;
  const zig = Array.from({ length: 9 }, (_, k) => ({ x: zx + (k * 140) / 8, y: T + (k === 0 || k === 8 ? 0 : k % 2 ? -16 : 16) }));
  o.els.push(line("ci-res", zig, o.meta(1, "resistor"), { strokeColor: stepColour(1), strokeWidth: 3, roughness: 0, roundness: null }));
  note(o, "ci-r", `${fmt(d.resistance)} Ω`, { x: (L + R) / 2, y: T - 42 }, 1, "resistor", 24, stepColour(1));
  // the current, along the right wire
  o.els.push(arrow("ci-i", [{ x: R + 30, y: T + 60 }, { x: R + 30, y: B - 60 }], o.meta(3, "current"), { strokeColor: INK.mark, strokeWidth: 3 }));
  note(o, "ci-it", `I = ${fmt(d.voltage / d.resistance)} A`, { x: R + 30 + 58, y: (T + B) / 2 }, 3, "current", 22, INK.mark);
  // the law, in a box under the circuit
  box(o, "ci-law", { x: AREA.x + 180, y: B + 50, w: 400, h: 70 }, "I = V / R", 2, "law", { size: 30 });
}

function drawCallstack(d: Extract<Diagram, { template: "callstack" }>, o: Out) {
  const vals = recursionValues(d.fn, d.n);
  const name = d.fn === "factorial" ? "fact" : d.fn === "sum_to" ? "sum" : "fib";
  const fh = Math.min(92, (AREA.h - 60) / d.n - 24), fw = 360;
  const frames = vals.map((_, i) => {
    const k = d.n - i;
    const y = AREA.y + 10 + i * (fh + 24);
    const step = i === vals.length - 1 ? 1 : 0;
    const body = k <= 1 ? `${name}(${k}) = ${vals[i]}  (base case)` : d.fn === "factorial" ? `${name}(${k}) = ${k} × ${name}(${k - 1})` : d.fn === "sum_to" ? `${name}(${k}) = ${k} + ${name}(${k - 1})` : `${name}(${k}) = ${name}(${k - 1}) + ${name}(${k - 2})`;
    return box(o, `cs-f${i}`, { x: AREA.x + 20 + i * 30, y, w: fw, h: fh }, body, step, `frame${i}`, { size: 24, fill: k <= 1 ? "#b2f2bb" : "transparent", colour: k <= 1 ? "#2f9e44" : stepColour(0) });
  });
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i], b = frames[i + 1];
    o.els.push(bind(arrow(`cs-call${i}`, [{ x: a.x + 30, y: a.y + a.height + 2 }, { x: b.x + 30, y: b.y - 2 }], o.meta(0, `frame${i + 1}`), { strokeColor: INK.soft }), a, b));
    // the value coming back, on the right, upwards
    const r = arrow(`cs-ret${i}`, [{ x: b.x + fw + 20, y: b.y + fh / 2 }, { x: a.x + fw + 20, y: a.y + fh / 2 }], o.meta(2, `ret${i}`), { strokeColor: "#2f9e44", strokeWidth: 2.5, roundness: null });
    o.els.push(r);
    note(o, `cs-ret${i}-t`, `returns ${vals[i + 1]}`, { x: Math.max(a.x, b.x) + fw + 90, y: (a.y + b.y + fh) / 2 }, 2, `ret${i}`, 18, "#2f9e44");
  }
}

function drawGrowth(d: Extract<Diagram, { template: "growth" }>, o: Out) {
  const vals = growthValues(d.principal, d.rate, d.years);
  const n = vals.length, max = vals[n - 1];
  const inner = { x: AREA.x + 60, y: AREA.y + 30, w: AREA.w - 90, h: AREA.h - 230 };
  const bw = Math.min(80, inner.w / n - 18);
  o.els.push(arrow("gr-ax", [{ x: inner.x - 10, y: inner.y + inner.h }, { x: inner.x + inner.w, y: inner.y + inner.h }], o.meta(0, "axes"), { strokeColor: INK.soft }));
  note(o, "gr-xn", "years", { x: inner.x + inner.w - 30, y: inner.y + inner.h + 38 }, 0, "axes", 16, INK.soft);
  vals.forEach((v, t) => {
    const step = t === 0 ? 0 : t === 1 ? 1 : t === 2 ? 2 : t < n - 1 ? 3 : 4;
    const x = inner.x + 10 + t * (inner.w / n);
    const hp = (d.principal / max) * inner.h, hv = (v / max) * inner.h;
    o.els.push(el(`gr-p${t}`, "rectangle", { x, y: inner.y + inner.h - hp, w: bw, h: hp }, o.meta(step, `year${t}`), { strokeColor: "#1971c2", backgroundColor: "#a5d8ff", fillStyle: "solid", roughness: 0.6 }));
    if (t) o.els.push(el(`gr-i${t}`, "rectangle", { x, y: inner.y + inner.h - hv, w: bw, h: hv - hp }, o.meta(step, `year${t}`), { strokeColor: "#e8590c", backgroundColor: "#ffc078", fillStyle: "solid", roughness: 0.6 }));
    note(o, `gr-v${t}`, money(v), { x: x + bw / 2, y: inner.y + inner.h - hv - 16 }, step, `year${t}`, 16, INK.text);
    note(o, `gr-t${t}`, String(t), { x: x + bw / 2, y: inner.y + inner.h + 16 }, step, `year${t}`, 16, INK.faint);
  });
  box(o, "gr-key-p", { x: inner.x, y: inner.y + inner.h + 56, w: 200, h: 40 }, "principal", 1, "key", { colour: "#1971c2", fill: "#a5d8ff", size: 17 });
  box(o, "gr-key-i", { x: inner.x + 220, y: inner.y + inner.h + 56, w: 250, h: 40 }, "interest on interest", 2, "key", { colour: "#e8590c", fill: "#ffc078", size: 17 });
  box(o, "gr-law", { x: inner.x + 490, y: inner.y + inner.h + 52, w: 210, h: 48 }, texToText("A = P(1 + r)^{t}"), 3, "law", { size: 22 });
}

function drawTriangle(d: Extract<Diagram, { template: "triangle" }>, o: Out) {
  const c = Math.sqrt(d.a * d.a + d.b * d.b);
  // the figure at unit scale: right angle at P, a up, b right, a square outwards on each side
  type Pt = { x: number; y: number };
  const P0 = { x: 0, y: 0 }, A0 = { x: 0, y: -d.a }, B0 = { x: d.b, y: 0 };
  const sqA0 = [P0, A0, { x: -d.a, y: -d.a }, { x: -d.a, y: 0 }];
  const sqB0 = [P0, B0, { x: d.b, y: d.b }, { x: 0, y: d.b }];
  // outward from the hypotenuse: away from P
  const nx = -(B0.y - A0.y), ny = B0.x - A0.x, len = Math.hypot(nx, ny);
  const sgn = (nx * (P0.x - A0.x) + ny * (P0.y - A0.y)) > 0 ? -1 : 1;
  const ux = (sgn * nx / len) * c, uy = (sgn * ny / len) * c;
  const sqC0 = [A0, B0, { x: B0.x + ux, y: B0.y + uy }, { x: A0.x + ux, y: A0.y + uy }];
  const all = [...sqA0, ...sqB0, ...sqC0];
  const minX = Math.min(...all.map((p) => p.x)), maxX = Math.max(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y)), maxY = Math.max(...all.map((p) => p.y));
  const s = Math.min((AREA.w * 0.86) / (maxX - minX), (AREA.h * 0.86) / (maxY - minY));
  const at = (p: Pt): Pt => ({ x: AREA.x + AREA.w / 2 + (p.x - (minX + maxX) / 2) * s, y: AREA.y + AREA.h / 2 + (p.y - (minY + maxY) / 2) * s });
  const poly = (id: string, pts: Pt[], step: number, colour: string, fill: string) =>
    o.els.push(line(id, [...pts, pts[0]].map(at), o.meta(step, id), { strokeColor: colour, backgroundColor: fill, fillStyle: "solid", strokeWidth: 2.5, roughness: 0.4, roundness: null, polygon: true } as Partial<ExEl>));
  poly("tr-sqa", sqA0, 1, "#1971c2", "#d0ebff");
  poly("tr-sqb", sqB0, 1, "#2f9e44", "#d3f9d8");
  poly("tr-sqc", sqC0, 2, "#9c36b5", "#eebefa");
  poly("tr-tri", [P0, A0, B0], 0, INK.text, "#fff9db");
  const P = at(P0), k = 16;
  o.els.push(line("tr-right", [{ x: P.x, y: P.y - k }, { x: P.x + k, y: P.y - k }, { x: P.x + k, y: P.y }], o.meta(0, "tr-tri"), { strokeColor: INK.text, strokeWidth: 1.5, roughness: 0, roundness: null }));
  const centre = (q: Pt[]) => at({ x: q.reduce((t, p) => t + p.x, 0) / q.length, y: q.reduce((t, p) => t + p.y, 0) / q.length });
  const size = Math.max(16, Math.min(24, s * 0.55));
  const two = (id: string, l1: string, l2: string, p: Pt, step: number, key: string, colour: string) => o.els.push(text(id, [l1, l2], size, { cx: p.x, cy: p.y }, o.meta(step, key), { strokeColor: colour, textAlign: "center" }));
  two("tr-sqa-t", `a = ${fmt(d.a)}`, `a² = ${fmt(d.a * d.a)}`, centre(sqA0), 1, "tr-sqa", "#1971c2");
  two("tr-sqb-t", `b = ${fmt(d.b)}`, `b² = ${fmt(d.b * d.b)}`, centre(sqB0), 1, "tr-sqb", "#2f9e44");
  two("tr-sqc-t", `c = ${fmt(c)}`, `c² = ${fmt(d.a * d.a + d.b * d.b)}`, centre(sqC0), 2, "tr-sqc", "#9c36b5");
}
function drawProcess(d: Extract<Diagram, { template: "process" }>, o: Out) {
  const mid = { x: AREA.x + AREA.w / 2, y: AREA.y + AREA.h / 2 - 20 };
  const core = box(o, "pr-core", { x: mid.x - 130, y: mid.y - 75, w: 260, h: 150 }, d.process, 1, "core", { size: 30 });
  const place = (items: string[], side: -1 | 1, step: number, key: string) => items.map((it, i) => {
    const y = mid.y + (i - (items.length - 1) / 2) * 112;
    const b = box(o, `pr-${key}${i}`, { x: side < 0 ? AREA.x + 4 : AREA.x + AREA.w - 200, y: y - 36, w: 196, h: 72 }, chemText(it), step, `${key}${i}`, { size: 24 });
    const from = side < 0 ? { x: b.x + b.width + 6, y } : { x: core.x + core.width + 6, y: mid.y + (i - (items.length - 1) / 2) * 24 };
    const to = side < 0 ? { x: core.x - 6, y: mid.y + (i - (items.length - 1) / 2) * 24 } : { x: b.x - 6, y };
    o.els.push(bind(arrow(`pr-${key}${i}-a`, [from, to], o.meta(step, `${key}${i}`), { strokeColor: side < 0 ? "#1971c2" : "#2f9e44", strokeWidth: 2.5 }), side < 0 ? b : core, side < 0 ? core : b));
    return b;
  });
  place(d.inputs, -1, 0, "in");
  place(d.outputs, 1, 2, "out");
  
}

function drawLayers(d: Extract<Diagram, { template: "layers" }>, o: Out) {
  const n = d.layers.length;
  const xs = d.layers.map((_, i) => AREA.x + 70 + (i * (AREA.w - 330)) / (n - 1));
  const r = 26;
  const pos = d.sizes.map((k, i) => Array.from({ length: k }, (_, j) => ({ x: xs[i], y: AREA.y + 230 + (j - (k - 1) / 2) * 90 })));
  pos.forEach((col, i) => col.forEach((p, j) => o.els.push(el(`ly-${i}-${j}`, "ellipse", { x: p.x - r, y: p.y - r, w: r * 2, h: r * 2 }, { step: 0, key: `layer${i}`, role: "node" }, { strokeColor: stepColour(i), backgroundColor: "transparent" }))));
  d.layers.forEach((name, i) => note(o, `ly-n${i}`, name, { x: xs[i], y: AREA.y + 16 }, 0, `layer${i}`, 19, stepColour(i)));
  for (let i = 0; i < n - 1; i++) for (const p of pos[i]) for (const q of pos[i + 1]) o.els.push(line(`ly-w${i}-${pos[i].indexOf(p)}-${pos[i + 1].indexOf(q)}`, [{ x: p.x + r, y: p.y }, { x: q.x - r, y: q.y }], o.meta(1, "weights"), { strokeColor: INK.faint, strokeWidth: 1, roughness: 0.3 }));
  const outP = pos[n - 1][0];
  box(o, "ly-pred", { x: outP.x + 60, y: outP.y - 30, w: 150, h: 60 }, `${fmt(d.prediction)}`, 2, "pred", { size: 24 });
  box(o, "ly-target", { x: outP.x + 60, y: outP.y + 70, w: 150, h: 54 }, `target ${fmt(d.target)}`, 2, "pred", { size: 19, colour: "#2f9e44" });
  const top = AREA.y + 470, bot = AREA.y + 540;
  o.els.push(arrow("ly-fwd", [{ x: xs[0], y: top }, { x: xs[n - 1], y: top }], o.meta(1, "forward"), { strokeColor: "#1971c2", strokeWidth: 3 }));
  note(o, "ly-fwd-t", "forward: prediction", { x: (xs[0] + xs[n - 1]) / 2, y: top - 22 }, 1, "forward", 18, "#1971c2");
  o.els.push(arrow("ly-back", [{ x: xs[n - 1], y: bot }, { x: xs[0], y: bot }], o.meta(3, "backward"), { strokeColor: INK.mark, strokeWidth: 3 }));
  note(o, "ly-back-t", `backward: error ${fmt(d.target - d.prediction)}, adjust weights`, { x: (xs[0] + xs[n - 1]) / 2, y: bot + 24 }, 3, "backward", 18, INK.mark);
}

/**
 * The board of a template lesson up to step `upto`: the diagram, the numbered steps in one column
 * on the right (every step said so far, in order), and the worked example's result in a highlighted
 * box once the last step is reached.
 */
export function sceneFromDiagram(d: Diagram, says: string[], upto: number, result: string): Scene {
  const o = mk();
  const steps = Math.max(1, says.length);
  const titleFont = [30, 24, 20].find((f) => handWidth(d.title, f) <= W - 60) ?? 18;
  const els: ExEl[] = head(W, H, { text: d.title, x: 28, y: 46, font: titleFont });
  if (d.template === "sequence") drawSequence(d, o);
  else if (d.template === "graph") drawGraph(d, o, steps);
  else if (d.template === "cycle") drawCycle(d, o, steps);
  else if (d.template === "array") drawArray(d, o);
  else if (d.template === "circuit") drawCircuit(d, o);
  else if (d.template === "callstack") drawCallstack(d, o);
  else if (d.template === "growth") drawGrowth(d, o);
  else if (d.template === "triangle") drawTriangle(d, o);
  else if (d.template === "process") drawProcess(d, o);
  else if (d.template === "layers") drawLayers(d, o);
  // parts drawn for a later step than the lesson has fall back to its last step
  for (const e of o.els) if (e.customData?.wb && e.customData.wb.step > steps - 1) e.customData.wb.step = steps - 1;
  // the numbered steps, one under the other
  let y = COL.y;
  says.forEach((say, k) => {
    const size = 17;
    const lines = wrapHand(say, COL.w - 44, size).slice(0, 4);
    const meta: WbMeta = { step: k, key: `say${k}`, role: "block" };
    const badge = { x: COL.x, y, w: 28, h: 28 };
    els.push(...labelled(el(`st-${k}`, "ellipse", badge, meta, { strokeColor: stepColour(k), backgroundColor: stepColour(k), roughness: 0 }), text(`st-${k}-n`, [String(k + 1)], 15, { cx: badge.x + 14, cy: badge.y + 14 }, meta, { strokeColor: "#ffffff" })));
    els.push(text(`st-${k}-t`, lines, size, { x: COL.x + 38, y: y + 2 }, meta, { originalText: say }));
    y += Math.max(34, lines.length * size * LINE_HEIGHT + 12);
  });
  // the result of the worked example, highlighted, with the last step
  if (result) {
    const last = steps - 1;
    const size = 21;
    const lines = wrapHand(result, COL.w - 30, size).slice(0, 3);
    const h = lines.length * size * LINE_HEIGHT + 26;
    const yb = Math.min(H - 20 - h, Math.max(y + 10, H - 20 - h - 10));
    els.push(...labelled(el("result", "rectangle", { x: COL.x, y: yb, w: COL.w, h }, { step: last, key: "result", role: "block" }, { strokeColor: "#e8590c", backgroundColor: "#fff3bf", strokeWidth: 2.5, roundness: { type: 3 } }), text("result-t", lines, size, { cx: COL.x + COL.w / 2, cy: yb + h / 2 }, { step: last, key: "result", role: "label" }, { originalText: result })));
  }
  const all = [...els, ...o.els.sort((a, b) => (a.customData!.wb!.step - b.customData!.wb!.step))];
  return { elements: all.filter((e) => (e.customData?.wb?.step ?? 0) <= upto), files: {} };
}
