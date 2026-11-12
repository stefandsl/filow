// Whiteboard diagrams the way a concept is normally taught: a sequence between two parties, a graph
// with curves, a cycle, an array traced by an algorithm, a circuit, a call stack, a growth chart, a
// right triangle with its squares, a process with its inputs and outputs, the layers of a network.
// The local model only PICKS the template and fills its slots (names, messages, values); this file
// checks the slots, computes the worked example in code (never trusting a small model's
// arithmetic), says what each step shows, and draws it as Excalidraw elements. Pure: no DOM.
import { cleanText } from "./lesson";
import { evalExpr, parseExpr } from "./plot";
import { INK, LINE_HEIGHT, arrow, boundsOf, el, handWidth, labelled, line, stepColour, text, wrapHand, type ExEl, type Scene, type WbMeta } from "./scene";
import { chemText } from "./tex";

export const TEMPLATES = ["sequence", "graph", "cycle", "array", "circuit", "callstack", "growth", "triangle", "process", "layers", "map"] as const;
export type TemplateName = (typeof TEMPLATES)[number];
export const ALGORITHMS = ["binary_search", "linear_search", "bubble_sort"] as const;
export const RECURSIONS = ["factorial", "sum_to", "fibonacci"] as const;

export type Diagram =
  | { template: "sequence"; title: string; actors: [string, string]; messages: Array<{ from: 0 | 1; text: string }>; result: string }
  | { template: "graph"; title: string; curves: Array<{ expr: string; name: string }>; xName: string; yName: string; xmin: number; xmax: number }
  | { template: "cycle"; title: string; items: string[]; byproducts: Array<{ after: number; text: string }>; center: string; entry?: string }
  | { template: "array"; title: string; algorithm: (typeof ALGORITHMS)[number]; values: number[]; target: number }
  | { template: "circuit"; title: string; voltage: number; resistance: number }
  | { template: "callstack"; title: string; fn: (typeof RECURSIONS)[number]; n: number }
  | { template: "growth"; title: string; principal: number; rate: number; years: number }
  | { template: "triangle"; title: string; a: number; b: number }
  | { template: "process"; title: string; process: string; inputs: string[]; outputs: string[]; equation: string; stages?: { names: [string, string]; between: string; first: { in: string[]; out: string[] }; second: { in: string[]; out: string[] } } }
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
      const d: Diagram = { template, title, items, byproducts, center: words(r.center, 24) || title };
      return referenceCycle(d, `${title} ${d.center} ${items.join(" ")}`) ?? d;
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
      const d: Diagram = { template, title, process: words(r.process, 24) || title, inputs, outputs, equation: chemText(words(r.equation, 80)) };
      return referenceProcess(d, `${title} ${d.process}`) ?? d;
    }
    case "layers": {
      // "Input Layer" is "Input": the board says "layer" once, not "Input Layer layer"
      const layers = list(r.layers, 4, 16).map((n) => n.replace(/\s*\blayers?\b\s*/gi, " ").trim()).filter(Boolean);
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


// ---- reference facts: what a teacher would check before drawing ----

/** The citric acid (Krebs) cycle as textbooks give it: stages in order, what each step gives off. */
export const KREBS = {
  items: ["Oxaloacetate", "Citrate", "Isocitrate", "α-Ketoglutarate", "Succinyl-CoA", "Succinate", "Fumarate", "Malate"],
  // after: the step from items[after] to the next one
  byproducts: [{ after: 2, text: "NADH + CO₂" }, { after: 3, text: "NADH + CO₂" }, { after: 4, text: "GTP" }, { after: 5, text: "FADH₂" }, { after: 7, text: "NADH" }],
  entry: "Acetyl-CoA",
};
const isKrebs = (s: string) => /krebs|citric|tca\b|tricarboxylic|citrate/i.test(s);
/** A cycle the board knows (the Krebs cycle) is drawn from the reference, not from the model's list. */
export function referenceCycle(d: Extract<Diagram, { template: "cycle" }>, words: string): Diagram | null {
  if (!isKrebs(words)) return null;
  return { ...d, items: [...KREBS.items], byproducts: KREBS.byproducts.map((b) => ({ ...b })), entry: KREBS.entry, center: d.center || "Krebs cycle" };
}
const isPhotosynthesis = (s: string) => /photosynth|fotosint|фотосинт|光合成/i.test(s);
/** Photosynthesis is drawn with its two stages and what passes between them. */
export function referenceProcess(d: Extract<Diagram, { template: "process" }>, words: string): Diagram | null {
  if (!isPhotosynthesis(words)) return null;
  return {
    ...d,
    inputs: ["Light", "H₂O", "CO₂"],
    outputs: ["O₂", "Glucose"],
    equation: "6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂",
    stages: { names: ["Light reactions", "Calvin cycle"], between: "ATP + NADPH", first: { in: ["Light", "H₂O"], out: ["O₂"] }, second: { in: ["CO₂"], out: ["Glucose"] } },
  };
}

// ---- what each step says: the worked example with its why ----

/**
 * One step of the lesson: its sentence (plain English, every number computed here), the keys of the
 * diagram parts it draws, or the band cell it fills (the meaning of the terms, the reason, the
 * consequence; "so" is the highlighted takeaway).
 */
export type Step = { say: string; keys: string[]; band?: "means" | "why" | "so" };
export type Explained = { steps: Step[]; result: string };

const SUP_DIGITS: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
const sup = (n: number) => Array.from(String(n)).map((c) => SUP_DIGITS[c] ?? c).join("");
const isTcp = (d: Extract<Diagram, { template: "sequence" }>) => d.messages.some((m) => /\bSYN\b/i.test(m.text)) && d.messages.some((m) => /\bACK\b/i.test(m.text));
const isMarket = (d: Extract<Diagram, { template: "graph" }>) => d.curves.length >= 2 && d.curves.some((c) => /demand|domanda|спрос|cerere|需要/i.test(c.name)) && d.curves.some((c) => /supply|offerta|предлож|ofert|供給/i.test(c.name));

export function explain(d: Diagram): Explained {
  switch (d.template) {
    case "sequence": {
      const msgs = d.messages.slice(0, 4);
      if (isTcp(d)) {
        const say = (m: { text: string }, k: number) => /SYN.?ACK/i.test(m.text) ? `${d.actors[1]} answers SYN-ACK: it confirms x + 1 and sends its own starting number y.` : /SYN/i.test(m.text) ? `${d.actors[0]} sends SYN with its starting number x.` : /ACK/i.test(m.text) ? `${d.actors[0]} sends ACK with y + 1: now each side knows both numbers.` : `${d.actors[msgs[k].from]} sends ${m.text}.`;
        return {
          steps: [
            { say: "SYN means synchronize: 'here is my starting number'. ACK means acknowledge: 'I got yours, I expect the next one'.", keys: ["actors"], band: "means" },
            ...msgs.map((m, k) => ({ say: say(m, k), keys: [`msg${k}`] })),
            { say: "Three messages, because each side must send its own number and hear the other confirm it; the middle message does both at once.", keys: [], band: "why" },
            { say: `After the ACK the connection is open and data can flow both ways. ${d.result || "Connection established"}.`, keys: ["state"], band: "so" },
          ],
          result: d.result || "Connection established",
        };
      }
      return {
        steps: [
          { say: `${d.actors[0]} and ${d.actors[1]} talk in messages; time runs down the page.`, keys: ["actors"], band: "means" },
          ...msgs.map((m, k) => ({ say: `${d.actors[m.from]} sends ${m.text} to ${d.actors[1 - m.from]}.`, keys: [`msg${k}`] })),
          { say: "The order matters, because each message answers the one before it.", keys: [], band: "why" },
          { say: `At the end: ${d.result || msgs[msgs.length - 1].text}.`, keys: ["state"], band: "so" },
        ],
        result: d.result || msgs[msgs.length - 1].text,
      };
    }
    case "graph": {
      const m = d.curves.length > 1 ? meeting(d.curves[0].expr, d.curves[1].expr, d.xmin, d.xmax) : null;
      if (isMarket(d) && m) {
        const dem = d.curves.findIndex((c) => /demand|domanda|спрос|cerere|需要/i.test(c.name));
        const sup2 = 1 - dem;
        return {
          steps: [
            { say: `Demand: how much buyers want at each ${d.yName.toLowerCase()}. Supply: how much sellers offer at each ${d.yName.toLowerCase()}.`, keys: ["axes"], band: "means" },
            { say: "Demand slopes down, because at a higher price fewer people want to buy.", keys: [`curve${dem}`] },
            { say: "Supply slopes up, because a higher price makes it worth selling more.", keys: [`curve${sup2}`] },
            { say: `They cross at ${d.xName.toLowerCase()} ${fmt(m.x)} and ${d.yName.toLowerCase()} ${fmt(m.y)}: there buyers want exactly what sellers offer.`, keys: ["meet"] },
            { say: `Above ${fmt(m.y)} sellers offer more than buyers take: the surplus pushes the price down. Below it buyers want more than there is: the shortage pushes it up.`, keys: ["surplus", "shortage"], band: "why" },
            { say: `So the price settles at ${fmt(m.y)}, where the two curves meet.`, keys: [], band: "so" },
          ],
          result: `${d.yName} ${fmt(m.y)}, ${d.xName} ${fmt(m.x)}`,
        };
      }
      return {
        steps: [
          { say: `Along the bottom: ${d.xName}. Up the side: ${d.yName}.`, keys: ["axes"], band: "means" },
          ...d.curves.map((c, n) => ({ say: `${c.name}: y = ${c.expr}.`, keys: [`curve${n}`] })),
          ...(m ? [{ say: `They meet at ${fmt(m.x)}, ${fmt(m.y)}.`, keys: ["meet"] }] : []),
          { say: "Each point of a line pairs one value with the other, so the shape shows how one changes with the other.", keys: [], band: "why" as const },
          { say: m ? `Both rules hold at ${fmt(m.x)}, ${fmt(m.y)}.` : `y = ${d.curves[0].expr}.`, keys: [], band: "so" as const },
        ],
        result: m ? `${fmt(m.x)}, ${fmt(m.y)}` : `y = ${d.curves[0].expr}`,
      };
    }
    case "cycle": {
      if (d.entry && d.items[0] === KREBS.items[0]) {
        return {
          steps: [
            { say: "A cycle: each molecule is changed into the next, and the last one becomes the first again.", keys: ["center"], band: "means" },
            { say: "Acetyl-CoA (2 carbons) joins oxaloacetate (4 carbons) to make citrate (6 carbons).", keys: ["stage0", "stage1", "entry"] },
            { say: "Isocitrate and α-ketoglutarate each lose one CO₂ and pass energy to one NADH.", keys: ["stage2", "stage3", "stage4"] },
            { say: "Succinyl-CoA gives GTP; succinate gives FADH₂ and becomes fumarate.", keys: ["stage5", "stage6"] },
            { say: "Fumarate takes water to become malate; malate gives one more NADH and becomes oxaloacetate again.", keys: ["stage7", "close"] },
            { say: "It is a cycle because oxaloacetate comes back at the end, ready for the next acetyl-CoA.", keys: [], band: "why" },
            { say: "Per turn: 2 CO₂, 3 NADH, 1 FADH₂ and 1 GTP. The NADH and FADH₂ later power most of the cell's ATP.", keys: [], band: "so" },
          ],
          result: "2 CO₂ + 3 NADH + 1 FADH₂ + 1 GTP per turn",
        };
      }
      const per = Math.ceil(d.items.length / 4);
      const groups: Step[] = [];
      for (let i = 0; i < d.items.length; i += per) {
        const part = d.items.slice(i, i + per);
        const given = d.byproducts.filter((b) => b.after >= i && b.after < i + per).map((b) => b.text);
        groups.push({ say: `${part.join(" becomes ")}${given.length ? `; this gives off ${given.join(" and ")}` : ""}.`, keys: part.map((_, k) => `stage${i + k}`) });
      }
      return {
        steps: [
          { say: `${d.center}: ${d.items.length} stages that end where they began.`, keys: ["center"], band: "means" },
          ...groups.slice(0, 4),
          { say: `It keeps turning because ${d.items[d.items.length - 1]} becomes ${d.items[0]} again.`, keys: ["close"], band: "why" },
          { say: `One full turn: ${d.items[0]} → … → ${d.items[0]}${d.byproducts.length ? `, giving off ${d.byproducts.map((b) => b.text).join(", ")}` : ""}.`, keys: [], band: "so" },
        ],
        result: `${d.items[d.items.length - 1]} → ${d.items[0]}`,
      };
    }
    case "array": {
      const v = d.values;
      if (d.algorithm === "binary_search") {
        const tr = binarySearchTrace(v, d.target);
        const rows: Step[] = tr.map((s, k) => ({
          say: s.cmp === "found" ? `The middle value ${v[s.mid]} equals the target: found at position ${s.mid}.` : `The middle value ${v[s.mid]} is ${s.cmp === "less" ? "smaller" : "bigger"} than ${d.target}, so it and every value to its ${s.cmp === "less" ? "left" : "right"} are dropped.`,
          keys: [`row${k}`],
        }));
        const checks = (n: number) => Math.ceil(Math.log2(n + 1));
        return {
          steps: [
            { say: `Binary search on a sorted list: look at the middle and keep only the half that can still hold the target, ${d.target}.`, keys: ["list"], band: "means" },
            ...rows.slice(0, 4),
            { say: "Each check halves what is left, because in a sorted list one comparison rules out a whole half.", keys: [], band: "why" },
            { say: `So ${v.length} values need at most ${checks(v.length)} checks, and 1,000,000 values at most ${checks(1e6)}; reading one by one could take 1,000,000.`, keys: [], band: "so" },
          ],
          result: `${d.target} found after ${tr.length} checks`,
        };
      }
      const at = v.indexOf(d.target);
      return {
        steps: [
          { say: `Linear search: read the values one by one until the target, ${d.target}.`, keys: ["list"], band: "means" },
          { say: `${v.slice(0, at).join(", ")} are not ${d.target}; position ${at} is.`, keys: ["row0"] },
          { say: "It needs no order, because it simply looks at every value.", keys: [], band: "why" },
          { say: `So it took ${at + 1} checks here; on n values it can take n checks.`, keys: [], band: "so" },
        ],
        result: `${d.target} at position ${at}`,
      };
    }
    case "circuit": {
      const i = d.voltage / d.resistance;
      return {
        steps: [
          { say: "V is voltage, the push (volts). I is current, the flow (amperes). R is resistance, how hard the path resists (ohms).", keys: [], band: "means" },
          { say: `The battery pushes with ${fmt(d.voltage)} V.`, keys: ["battery", "wire"] },
          { say: `The resistor resists with ${fmt(d.resistance)} Ω.`, keys: ["resistor"] },
          { say: `So the current is I = V / R = ${fmt(d.voltage)} / ${fmt(d.resistance)} = ${fmt(i)} A.`, keys: ["current", "law"] },
          { say: "Because a bigger push drives more flow, and more resistance lets less through.", keys: [], band: "why" },
          { say: `Double the voltage to ${fmt(2 * d.voltage)} V and the current doubles to ${fmt(2 * i)} A; double the resistance and it halves to ${fmt(i / 2)} A.`, keys: [], band: "so" },
        ],
        result: `I = ${fmt(i)} A`,
      };
    }
    case "callstack": {
      const vals = recursionValues(d.fn, d.n);
      const name = d.fn === "factorial" ? "fact" : d.fn === "sum_to" ? "sum" : "fib";
      return {
        steps: [
          { say: d.fn === "factorial" ? `${name}(n) = 1 when n ≤ 1, otherwise n × ${name}(n − 1): the function calls itself on a smaller n.` : d.fn === "sum_to" ? `${name}(n) = 1 when n ≤ 1, otherwise n + ${name}(n − 1).` : `${name}(n) = n when n ≤ 1, otherwise ${name}(n − 1) + ${name}(n − 2).`, keys: ["code"], band: "means" },
          { say: `${name}(${d.n}) cannot answer yet: it waits for ${name}(${d.n - 1}), which waits for the next, down the stack.`, keys: vals.slice(0, -1).map((_, i) => `frame${i}`) },
          { say: `${name}(1) is the base case: it returns ${vals[vals.length - 1]} without calling itself, and that stops the calls.`, keys: [`frame${vals.length - 1}`] },
          { say: `The answers come back up: ${vals.slice().reverse().join(", ")}.`, keys: vals.slice(1).map((_, i) => `ret${i}`) },
          { say: "It works because every call is on a smaller n, so the calls must reach the base case.", keys: [], band: "why" },
          { say: `${name}(${d.n}) = ${vals[0]}. Without a base case the calls would never stop.`, keys: [], band: "so" },
        ],
        result: `${name}(${d.n}) = ${vals[0]}`,
      };
    }
    case "growth": {
      const vals = growthValues(d.principal, d.rate, d.years);
      const simple = d.principal * (1 + (d.rate / 100) * d.years);
      return {
        steps: [
          { say: `Principal: the money you start with, ${money(d.principal)}. Interest: ${fmt(d.rate)}% of the balance, added each year.`, keys: ["axes", "year0", "key"], band: "means" },
          { say: `Year 1: ${money(d.principal)} earns ${money(vals[1] - vals[0])}, giving ${money(vals[1])}.`, keys: ["year1"] },
          { say: `Year 2: the interest is paid on ${money(vals[1])}, not only on ${money(d.principal)}: ${money(vals[2])}.`, keys: ["year2"] },
          { say: `A = P(1 + r)ᵗ = ${money(d.principal)} × ${fmt(1 + d.rate / 100)}${sup(d.years)} = ${money(vals[d.years])}.`, keys: vals.slice(3).map((_, i) => `year${i + 3}`).concat(["law"]) },
          { say: "It grows faster each year, because the interest itself starts earning interest.", keys: [], band: "why" },
          { say: `After ${d.years} years: ${money(vals[d.years])}, against ${money(simple)} with simple interest, ${money(vals[d.years] - simple)} more.`, keys: [], band: "so" },
        ],
        result: `${money(vals[d.years])}`,
      };
    }
    case "triangle": {
      const c2 = d.a * d.a + d.b * d.b;
      return {
        steps: [
          { say: "a and b are the two sides at the right angle; c is the long side across from it.", keys: ["tr-tri"], band: "means" },
          { say: `A square on each short side: areas ${fmt(d.a * d.a)} and ${fmt(d.b * d.b)}.`, keys: ["tr-sqa", "tr-sqb"] },
          { say: `The square on the long side has area ${fmt(c2)}.`, keys: ["tr-sqc"] },
          { say: "Why: four copies of the triangle fit in a square of side a + b. Laid one way they leave the square c²; laid another way they leave a² and b². The space left is the same.", keys: [], band: "why" },
          { say: `So a² + b² = c²: ${fmt(d.a * d.a)} + ${fmt(d.b * d.b)} = ${fmt(c2)}, c = ${fmt(Math.sqrt(c2))}, for every right triangle.`, keys: [], band: "so" },
        ],
        result: `c = ${fmt(Math.sqrt(c2))}`,
      };
    }
    case "process": {
      if (d.stages) {
        return {
          steps: [
            { say: "Photosynthesis: a plant uses the energy of light to build sugar from water and carbon dioxide.", keys: [], band: "means" },
            { say: "Light reactions: light splits water, oxygen is released, and the energy is stored as ATP and NADPH.", keys: ["stage0", "in0", "in1", "out0"] },
            { say: "Calvin cycle: ATP and NADPH power the fixing of CO₂ into glucose.", keys: ["stage1", "between", "in2", "out1"] },
            { say: "Light is needed because splitting water and building sugar both take energy, and that energy comes from light.", keys: [], band: "why" },
            { say: `Overall: ${d.equation}.`, keys: [], band: "so" },
          ],
          result: d.equation,
        };
      }
      return {
        steps: [
          { say: `${d.process}: ${d.inputs.join(", ")} go in, ${d.outputs.join(", ")} come out.`, keys: [], band: "means" },
          { say: `${d.inputs.join(", ")} go into ${d.process}.`, keys: d.inputs.map((_, i) => `in${i}`).concat(["stage0"]) },
          { say: `Out come ${d.outputs.join(", ")}.`, keys: d.outputs.map((_, i) => `out${i}`) },
          { say: "The inputs are used up to make the outputs, so without one input the process stops.", keys: [], band: "why" },
          { say: d.equation ? `Overall: ${d.equation}.` : `${d.inputs.join(" + ")} → ${d.outputs.join(" + ")}.`, keys: [], band: "so" },
        ],
        result: d.equation || `${d.inputs.join(" + ")} → ${d.outputs.join(" + ")}`,
      };
    }
    case "layers": {
      const err = d.target - d.prediction;
      return {
        steps: [
          { say: "A neuron adds up its inputs, each multiplied by a weight; the weights are what the network learns.", keys: d.layers.map((_, i) => `layer${i}`), band: "means" },
          { say: `Forward: the inputs flow through the weights to the output, here ${fmt(d.prediction)}.`, keys: ["weights", "forward", "pred"] },
          { say: `The right answer is ${fmt(d.target)}, so the error is ${fmt(d.target)} − ${fmt(d.prediction)} = ${fmt(err)}.`, keys: ["target", "loss"] },
          { say: "Backward: each weight is nudged in the direction that makes the error smaller.", keys: ["backward"] },
          { say: "It learns because each nudge lowers the error a little, and the same weights serve every example.", keys: [], band: "why" },
          { say: "After many examples the error shrinks toward 0 and the predictions become right.", keys: [], band: "so" },
        ],
        result: `error ${fmt(err)}`,
      };
    }
  }
}

/** The lesson's steps as sentences, and the takeaway (kept for the route and the tests). */
export type Worked = { facts: string[]; result: string };
export function workedExample(d: Diagram): Worked {
  const e = explain(d);
  return { facts: e.steps.map((s) => s.say), result: e.result };
}

// ---- drawing ----

const W = 1200, H = 720;
/** The diagram's room: the whole width under the title; the band of meaning, reason and takeaway below it. */
const AREA = { x: 40, y: 88, w: 1120, h: 450 };
const BAND = { x: 40, y: 560, w: 1120, h: 144 };

type Out = { els: ExEl[]; meta: (step: number, key: string) => WbMeta };
const mk = (): Out => ({ els: [], meta: (step, key) => ({ step, key, role: "block" }) });
const box = (o: Out, id: string, b: { x: number; y: number; w: number; h: number }, words: string, key: string, opt: { colour?: string; shape?: "rectangle" | "ellipse"; size?: number; fill?: string; ink?: string } = {}) => {
  const colour = opt.colour ?? INK.soft;
  const shape = el(id, opt.shape ?? "rectangle", b, { step: 0, key, role: "node" }, { strokeColor: colour, backgroundColor: opt.fill ?? "transparent", roundness: opt.shape === "ellipse" ? null : { type: 3 } });
  const size = Math.max(13, Math.min(opt.size ?? 20, Math.floor((b.w - 22) / Math.max(1, ...words.split(/\s+|(?<=-)/).map((w) => handWidth(w, 1))))));
  const lines = wrapHand(words, b.w - 22, size);
  // dark ink on a light fill, never a colour on the same colour
  o.els.push(...labelled(shape, text(`${id}-t`, lines, size, { cx: b.x + b.w / 2, cy: b.y + b.h / 2 }, { step: 0, key, role: "label" }, { originalText: words, strokeColor: opt.ink ?? INK.text })));
  return shape;
};
const bind = (a: ExEl, from: ExEl | null, to: ExEl | null) => {
  if (from) { a.startBinding = { elementId: from.id, focus: 0, gap: 6 }; from.boundElements = [...(from.boundElements ?? []), { id: a.id, type: "arrow" }]; }
  if (to) { a.endBinding = { elementId: to.id, focus: 0, gap: 6 }; to.boundElements = [...(to.boundElements ?? []), { id: a.id, type: "arrow" }]; }
  return a;
};
const note = (o: Out, id: string, words: string, at: { x: number; y: number }, key: string, size = 17, colour: string = INK.text) =>
  o.els.push(text(id, [words], size, { cx: at.x, cy: at.y }, o.meta(0, key), { strokeColor: colour }));
const centre = (s: ExEl) => ({ x: s.x + s.width / 2, y: s.y + s.height / 2 });
/** From the edge of one shape to the edge of another, along the line between their centres. */
const between = (a: ExEl, b: ExEl, gap = 8) => {
  const p = centre(a), q = centre(b);
  const edge = (s: ExEl, from: { x: number; y: number }, to: { x: number; y: number }) => {
    const dx = to.x - from.x, dy = to.y - from.y;
    const k = Math.min((s.width / 2 + gap) / Math.max(1e-6, Math.abs(dx)), (s.height / 2 + gap) / Math.max(1e-6, Math.abs(dy)));
    return { x: from.x + dx * k, y: from.y + dy * k };
  };
  return [edge(a, p, q), edge(b, q, p)];
};

function drawSequence(d: Extract<Diagram, { template: "sequence" }>, o: Out) {
  const xs = [AREA.x + 230, AREA.x + AREA.w - 230];
  d.actors.forEach((a, i) => box(o, `seq-actor${i}`, { x: xs[i] - 120, y: AREA.y, w: 240, h: 56 }, a, "actors", { colour: "#1971c2", fill: "#e7f5ff" }));
  const top = AREA.y + 66, bottom = AREA.y + AREA.h - 10;
  d.actors.forEach((_, i) => o.els.push(line(`seq-life${i}`, [{ x: xs[i], y: top }, { x: xs[i], y: bottom }], o.meta(0, "actors"), { strokeColor: INK.faint, strokeStyle: "dashed", strokeWidth: 1.5, roundness: null })));
  const msgs = d.messages.slice(0, 4);
  const gap = (bottom - top - 60) / Math.max(1, msgs.length);
  msgs.forEach((m, k) => {
    const y = top + 30 + k * gap;
    const from = xs[m.from], to = xs[1 - m.from];
    const colour = INK.curve[k % 3];
    o.els.push(arrow(`seq-msg${k}`, [{ x: from, y }, { x: to + (to > from ? -4 : 4), y: y + 34 }], o.meta(0, `msg${k}`), { strokeColor: colour, strokeWidth: 2.5, roundness: null }));
    // the label above the arrow, clear of it
    note(o, `seq-msg${k}-t`, m.text, { x: (from + to) / 2, y: y - 4 }, `msg${k}`, 22, INK.text);
  });
  if (d.result) note(o, "seq-state", d.result, { x: (xs[0] + xs[1]) / 2, y: bottom - 6 }, "state", 20, "#2f9e44");
}

function drawGraph(d: Extract<Diagram, { template: "graph" }>, o: Out) {
  const inner = { x: AREA.x + 260, y: AREA.y + 36, w: 560, h: AREA.h - 90 };
  const samples = d.curves.map((c) => { const t = parseExpr(c.expr)!; return Array.from({ length: 41 }, (_, k) => { const x = d.xmin + ((d.xmax - d.xmin) * k) / 40; return { x, y: evalExpr(t, x) }; }).filter((p) => Number.isFinite(p.y)); });
  const ys = samples.flat().map((p) => p.y);
  const ymin = Math.min(0, ...ys), ymax = Math.max(...ys, 1);
  const sx = (x: number) => inner.x + ((x - d.xmin) / (d.xmax - d.xmin)) * inner.w;
  const sy = (y: number) => inner.y + inner.h - ((y - ymin) / (ymax - ymin)) * inner.h;
  const y0 = sy(Math.max(ymin, 0));
  o.els.push(arrow("g-ax", [{ x: inner.x, y: y0 }, { x: inner.x + inner.w + 16, y: y0 }], o.meta(0, "axes"), { strokeColor: INK.soft, roundness: null }));
  o.els.push(arrow("g-ay", [{ x: inner.x, y: inner.y + inner.h }, { x: inner.x, y: inner.y - 16 }], o.meta(0, "axes"), { strokeColor: INK.soft, roundness: null }));
  note(o, "g-xn", d.xName, { x: inner.x + inner.w / 2, y: inner.y + inner.h + 40 }, "axes", 19, INK.soft);
  o.els.push(text("g-yn", [d.yName], 19, { x: inner.x - handWidth(d.yName, 19) - 18, y: inner.y - 26 }, o.meta(0, "axes"), { strokeColor: INK.soft }));
  d.curves.forEach((c, n) => {
    const colour = INK.curve[n % 3];
    o.els.push(line(`g-c${n}`, samples[n].map((p) => ({ x: sx(p.x), y: sy(p.y) })), o.meta(0, `curve${n}`), { strokeColor: colour, strokeWidth: 3, roughness: 0, roundness: { type: 2 } }));
    const end = samples[n][samples[n].length - 1];
    o.els.push(text(`g-c${n}-t`, [c.name], 22, { x: sx(end.x) + 14, y: sy(end.y) - 12 }, o.meta(0, `curve${n}`), { strokeColor: colour }));
  });
  const m = d.curves.length > 1 ? meeting(d.curves[0].expr, d.curves[1].expr, d.xmin, d.xmax) : null;
  if (!m) return;
  o.els.push(line("g-mx", [{ x: sx(m.x), y: sy(m.y) }, { x: sx(m.x), y: y0 }], o.meta(0, "meet"), { strokeColor: INK.faint, strokeStyle: "dashed", strokeWidth: 1.5, roundness: null }));
  o.els.push(line("g-my", [{ x: sx(m.x), y: sy(m.y) }, { x: inner.x, y: sy(m.y) }], o.meta(0, "meet"), { strokeColor: INK.faint, strokeStyle: "dashed", strokeWidth: 1.5, roundness: null }));
  o.els.push(el("g-m", "ellipse", { x: sx(m.x) - 8, y: sy(m.y) - 8, w: 16, h: 16 }, o.meta(0, "meet"), { strokeColor: INK.mark, backgroundColor: INK.mark, roughness: 0 }));
  note(o, "g-mxv", fmt(m.x), { x: sx(m.x), y: y0 + 16 }, "meet", 16, INK.mark);
  note(o, "g-myv", fmt(m.y), { x: inner.x - 28, y: sy(m.y) }, "meet", 16, INK.mark);
  if (!isMarket(d)) return;
  // off equilibrium: at a higher price the gap between the curves is a surplus, at a lower one a shortage
  const t0 = parseExpr(d.curves[0].expr)!, t1 = parseExpr(d.curves[1].expr)!;
  const xAt = (t: typeof t0, y: number) => { let best = d.xmin, err = Infinity; for (let k = 0; k <= 400; k++) { const x = d.xmin + ((d.xmax - d.xmin) * k) / 400; const e = Math.abs(evalExpr(t, x) - y); if (e < err) { err = e; best = x; } } return best; };
  for (const [key, y, colour] of [["surplus", m.y + (ymax - m.y) * 0.45, "#e8590c"], ["shortage", m.y - (m.y - Math.max(ymin, 0)) * 0.5, "#1971c2"]] as const) {
    const xa = xAt(t0, y), xb = xAt(t1, y);
    const left = Math.min(xa, xb), right = Math.max(xa, xb);
    o.els.push(line(`g-${key}`, [{ x: sx(left), y: sy(y) }, { x: sx(right), y: sy(y) }], o.meta(0, key), { strokeColor: colour, strokeWidth: 2.5, strokeStyle: "dashed", roundness: null }));
    // its word to the left of the line, never on it
    o.els.push(text(`g-${key}-t`, [key], 19, { x: Math.max(inner.x + 8, sx(left) - handWidth(key, 19) - 14), y: sy(y) - 12 }, o.meta(0, key), { strokeColor: colour }));
  }
}

function drawCycle(d: Extract<Diagram, { template: "cycle" }>, o: Out) {
  const n = d.items.length;
  const c = { x: AREA.x + AREA.w / 2, y: AREA.y + AREA.h / 2 };
  const R = { x: 380, y: 178 };
  const bw = 190, bh = 56;
  const at = (i: number) => ({ x: c.x + R.x * Math.sin((2 * Math.PI * i) / n), y: c.y - R.y * Math.cos((2 * Math.PI * i) / n) });
  o.els.push(text("cy-center", wrapHand(d.center, 220, 26), 26, { cx: c.x, cy: c.y }, o.meta(0, "center"), { textAlign: "center", originalText: d.center }));
  const shapes = d.items.map((it, i) => {
    const p = at(i);
    return box(o, `cy-${i}`, { x: p.x - bw / 2, y: p.y - bh / 2, w: bw, h: bh }, it, `stage${i}`, { size: 20, colour: stepColour(i), fill: "#ffffff" });
  });
  d.items.forEach((_, i) => {
    const j = (i + 1) % n;
    const [a, b] = between(shapes[i], shapes[j], 6);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const out = { x: mid.x + (mid.x - c.x) * 0.12, y: mid.y + (mid.y - c.y) * 0.12 };
    const key = j === 0 ? "close" : `stage${j}`;
    o.els.push(bind(arrow(`cy-a${i}`, [a, out, b], o.meta(0, key), { strokeColor: INK.soft, strokeWidth: 2 }), shapes[i], shapes[j]));
    const given = d.byproducts.filter((x) => x.after === i).map((x) => x.text).join(", ");
    if (given) {
      // what this step gives off, outside the ring beside its own arrow
      const far = { x: out.x + (out.x - c.x) * 0.2, y: out.y + (out.y - c.y) * 0.32 };
      note(o, `cy-bp${i}`, `+ ${given}`, far, key, 19, "#c92a2a");
    }
  });
  if (d.entry) {
    const s = shapes[0];
    const e = box(o, "cy-entry", { x: s.x + s.width + 120, y: AREA.y - 8, w: 190, h: 50 }, d.entry, "entry", { colour: "#2f9e44", fill: "#ebfbee" });
    o.els.push(bind(arrow("cy-entry-a", between(e, s, 6), o.meta(0, "entry"), { strokeColor: "#2f9e44", strokeWidth: 2.5, roundness: null }), e, s));
  }
}

function drawArray(d: Extract<Diagram, { template: "array" }>, o: Out) {
  const v = d.values;
  const cw = Math.min(88, (AREA.w - 520) / v.length), ch = 54;
  const x0 = AREA.x + 150;
  const rows = d.algorithm === "binary_search" ? binarySearchTrace(v, d.target).slice(0, 4) : [{ lo: 0, hi: v.length - 1, mid: v.indexOf(d.target), cmp: "found" as const }];
  const rowH = Math.min(104, (AREA.h - 20) / (rows.length + 1));
  const drawRow = (r: number, y: number, state: { lo: number; hi: number; mid: number; cmp: string } | null, key: string) => {
    v.forEach((val, i) => {
      const out = state && (i < state.lo || i > state.hi);
      const on = state && i === state.mid;
      const fill = on ? (state!.cmp === "found" ? "#b2f2bb" : "#fff3bf") : out ? "#f1f3f5" : "#ffffff";
      box(o, `ar-${r}-${i}`, { x: x0 + i * cw, y, w: cw, h: ch }, String(val), key, { colour: out ? INK.faint : "#1971c2", fill, size: 24, ink: out ? INK.faint : INK.text });
    });
    if (state) {
      const px = x0 + (state.mid + 0.5) * cw;
      o.els.push(arrow(`ar-${r}-p`, [{ x: px, y: y + ch + 26 }, { x: px, y: y + ch + 6 }], o.meta(0, key), { strokeColor: INK.mark, strokeWidth: 2.5, roundness: null }));
      const words = state.cmp === "found" ? `found ${d.target}` : state.cmp === "less" ? `${v[state.mid]} < ${d.target}: keep the right` : `${v[state.mid]} > ${d.target}: keep the left`;
      o.els.push(text(`ar-${r}-m`, [words], 19, { x: x0 + v.length * cw + 24, y: y + ch / 2 - 12 }, o.meta(0, key), { strokeColor: INK.mark }));
    }
  };
  drawRow(0, AREA.y, null, "list");
  v.forEach((_, i) => note(o, `ar-i${i}`, String(i), { x: x0 + (i + 0.5) * cw, y: AREA.y + ch + 14 }, "list", 15, INK.faint));
  o.els.push(text("ar-target", [`target ${d.target}`], 22, { x: AREA.x, y: AREA.y + ch / 2 - 14 }, o.meta(0, "list"), { strokeColor: INK.mark }));
  rows.forEach((s, k) => drawRow(k + 1, AREA.y + (k + 1) * rowH, s, `row${k}`));
}

function drawCircuit(d: Extract<Diagram, { template: "circuit" }>, o: Out) {
  const L = AREA.x + 200, R = AREA.x + 700, T = AREA.y + 70, B = AREA.y + 400;
  const wire = (id: string, pts: Array<{ x: number; y: number }>) => o.els.push(line(id, pts, o.meta(0, "wire"), { strokeColor: INK.text, strokeWidth: 2.5, roughness: 0.6, roundness: null }));
  const by = (T + B) / 2;
  const zx = (L + R) / 2 - 80;
  wire("ci-w1", [{ x: L, y: by - 22 }, { x: L, y: T }, { x: zx, y: T }]);
  wire("ci-w2", [{ x: zx + 160, y: T }, { x: R, y: T }, { x: R, y: B }, { x: L, y: B }, { x: L, y: by + 22 }]);
  o.els.push(line("ci-bat1", [{ x: L - 40, y: by - 22 }, { x: L + 40, y: by - 22 }], o.meta(0, "battery"), { strokeColor: INK.text, strokeWidth: 4, roughness: 0, roundness: null }));
  o.els.push(line("ci-bat2", [{ x: L - 20, y: by + 22 }, { x: L + 20, y: by + 22 }], o.meta(0, "battery"), { strokeColor: INK.text, strokeWidth: 4, roughness: 0, roundness: null }));
  note(o, "ci-bat+", "+", { x: L + 56, y: by - 36 }, "battery", 22);
  o.els.push(text("ci-v", [`V = ${fmt(d.voltage)} V`], 26, { x: L - 190, y: by - 16 }, o.meta(0, "battery"), { strokeColor: "#1971c2" }));
  const zig = Array.from({ length: 9 }, (_, k) => ({ x: zx + (k * 160) / 8, y: T + (k === 0 || k === 8 ? 0 : k % 2 ? -18 : 18) }));
  o.els.push(line("ci-res", zig, o.meta(0, "resistor"), { strokeColor: "#9c36b5", strokeWidth: 3, roughness: 0, roundness: null }));
  note(o, "ci-r", `R = ${fmt(d.resistance)} Ω`, { x: (L + R) / 2, y: T - 46 }, "resistor", 26, "#9c36b5");
  // the current: an arrow beside the right wire, its label further right
  o.els.push(arrow("ci-i", [{ x: R + 30, y: T + 70 }, { x: R + 30, y: B - 70 }], o.meta(0, "current"), { strokeColor: INK.mark, strokeWidth: 3, roundness: null }));
  o.els.push(text("ci-it", [`I = ${fmt(d.voltage / d.resistance)} A`], 26, { x: R + 56, y: (T + B) / 2 - 16 }, o.meta(0, "current"), { strokeColor: INK.mark }));
  box(o, "ci-law", { x: (L + R) / 2 - 130, y: (T + B) / 2 - 40, w: 260, h: 80 }, "I = V / R", "law", { size: 32, colour: INK.soft, fill: "#fff9db" });
}

function drawCallstack(d: Extract<Diagram, { template: "callstack" }>, o: Out) {
  const vals = recursionValues(d.fn, d.n);
  const name = d.fn === "factorial" ? "fact" : d.fn === "sum_to" ? "sum" : "fib";
  const fh = Math.min(76, (AREA.h - 20) / d.n - 22), fw = 380;
  const frames = vals.map((_, i) => {
    const k = d.n - i;
    const body = k <= 1 ? `${name}(${k}) = ${vals[i]}` : d.fn === "factorial" ? `${name}(${k}) = ${k} × ${name}(${k - 1})` : d.fn === "sum_to" ? `${name}(${k}) = ${k} + ${name}(${k - 1})` : `${name}(${k}) = ${name}(${k - 1}) + ${name}(${k - 2})`;
    return box(o, `cs-f${i}`, { x: AREA.x + 20 + i * 30, y: AREA.y + i * (fh + 22), w: fw, h: fh }, body, `frame${i}`, { size: 24, fill: k <= 1 ? "#d3f9d8" : "#ffffff", colour: k <= 1 ? "#2f9e44" : "#1971c2" });
  });
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i], b = frames[i + 1];
    o.els.push(bind(arrow(`cs-call${i}`, [{ x: a.x + 40, y: a.y + a.height + 6 }, { x: b.x + 40, y: b.y - 6 }], o.meta(0, `frame${i + 1}`), { strokeColor: INK.soft, roundness: null }), a, b));
    // the value coming back: from the right side of the callee to the right side of the caller
    const r = arrow(`cs-ret${i}`, [{ x: b.x + fw + 8, y: b.y + fh / 2 }, { x: b.x + fw + 40, y: (a.y + fh / 2 + b.y + fh / 2) / 2 }, { x: a.x + fw + 8, y: a.y + fh / 2 }], o.meta(0, `ret${i}`), { strokeColor: "#2f9e44", strokeWidth: 2.5 });
    o.els.push(bind(r, b, a));
    note(o, `cs-ret${i}-t`, `returns ${vals[i + 1]}`, { x: b.x + fw + 110, y: (a.y + b.y + fh) / 2 }, `ret${i}`, 19, "#2f9e44");
  }
  const code = d.fn === "factorial" ? [`${name}(n):`, "  if n ≤ 1: return 1", `  return n × ${name}(n − 1)`] : d.fn === "sum_to" ? [`${name}(n):`, "  if n ≤ 1: return 1", `  return n + ${name}(n − 1)`] : [`${name}(n):`, "  if n ≤ 1: return n", `  return ${name}(n − 1) + ${name}(n − 2)`];
  const cb = { x: AREA.x + AREA.w - 330, y: AREA.y, w: 330, h: 120 };
  o.els.push(el("cs-code", "rectangle", cb, { step: 0, key: "code", role: "block" }, { strokeColor: INK.soft, backgroundColor: "#f8f9fa", roundness: { type: 3 } }));
  o.els.push(text("cs-code-t", code, 19, { x: cb.x + 16, y: cb.y + 18 }, o.meta(0, "code"), { fontFamily: 3 }));
}

function drawGrowth(d: Extract<Diagram, { template: "growth" }>, o: Out) {
  const vals = growthValues(d.principal, d.rate, d.years);
  const n = vals.length, max = vals[n - 1];
  const inner = { x: AREA.x + 80, y: AREA.y + 30, w: 760, h: AREA.h - 90 };
  const bw = Math.min(84, inner.w / n - 20);
  o.els.push(arrow("gr-ax", [{ x: inner.x - 10, y: inner.y + inner.h }, { x: inner.x + inner.w, y: inner.y + inner.h }], o.meta(0, "axes"), { strokeColor: INK.soft, roundness: null }));
  note(o, "gr-xn", "years", { x: inner.x + inner.w + 36, y: inner.y + inner.h }, "axes", 18, INK.soft);
  const part = (id: string, x: number, from: number, to: number, key: string, stroke: string, fill: string) => {
    if (to - from <= 0.5) return;
    const y1 = inner.y + inner.h - (to / max) * inner.h, y0 = inner.y + inner.h - (from / max) * inner.h;
    o.els.push(el(id, "rectangle", { x, y: y1, w: bw, h: y0 - y1 }, o.meta(0, key), { strokeColor: stroke, backgroundColor: fill, fillStyle: "solid", roughness: 0.5 }));
  };
  vals.forEach((v, t) => {
    const x = inner.x + 10 + t * (inner.w / n);
    const simple = d.principal * (1 + (d.rate / 100) * t);
    part(`gr-p${t}`, x, 0, d.principal, `year${t}`, "#1971c2", "#d0ebff");
    part(`gr-s${t}`, x, d.principal, simple, `year${t}`, "#2f9e44", "#d3f9d8");
    part(`gr-c${t}`, x, simple, v, `year${t}`, "#e8590c", "#ffd8a8");
    note(o, `gr-v${t}`, money(v), { x: x + bw / 2, y: inner.y + inner.h - (v / max) * inner.h - 16 }, `year${t}`, 17, INK.text);
    note(o, `gr-t${t}`, String(t), { x: x + bw / 2, y: inner.y + inner.h + 16 }, `year${t}`, 17, INK.faint);
  });
  // the key: a small square of each colour and what it means
  const keys: Array<[string, string, string]> = [["principal", "#1971c2", "#d0ebff"], ["simple interest", "#2f9e44", "#d3f9d8"], ["interest on interest", "#e8590c", "#ffd8a8"]];
  keys.forEach(([label, stroke, fill], i) => {
    const y = inner.y + 20 + i * 44;
    o.els.push(el(`gr-k${i}`, "rectangle", { x: inner.x + inner.w + 90, y, w: 26, h: 26 }, o.meta(0, "key"), { strokeColor: stroke, backgroundColor: fill, roughness: 0 }));
    o.els.push(text(`gr-k${i}-t`, [label], 19, { x: inner.x + inner.w + 126, y: y + 2 }, o.meta(0, "key"), { strokeColor: INK.text }));
  });
  o.els.push(text("gr-law", [`A = P(1 + r)ᵗ`], 26, { x: inner.x + inner.w + 90, y: inner.y + 170 }, o.meta(0, "law"), { strokeColor: INK.text }));
}

function drawTriangle(d: Extract<Diagram, { template: "triangle" }>, o: Out) {
  const c = Math.sqrt(d.a * d.a + d.b * d.b);
  type Pt = { x: number; y: number };
  const P0 = { x: 0, y: 0 }, A0 = { x: 0, y: -d.a }, B0 = { x: d.b, y: 0 };
  const sqA0 = [P0, A0, { x: -d.a, y: -d.a }, { x: -d.a, y: 0 }];
  const sqB0 = [P0, B0, { x: d.b, y: d.b }, { x: 0, y: d.b }];
  const nx = -(B0.y - A0.y), ny = B0.x - A0.x, len = Math.hypot(nx, ny);
  const sgn = (nx * (P0.x - A0.x) + ny * (P0.y - A0.y)) > 0 ? -1 : 1;
  const ux = (sgn * nx / len) * c, uy = (sgn * ny / len) * c;
  const sqC0 = [A0, B0, { x: B0.x + ux, y: B0.y + uy }, { x: A0.x + ux, y: A0.y + uy }];
  const all = [...sqA0, ...sqB0, ...sqC0];
  const minX = Math.min(...all.map((p) => p.x)), maxX = Math.max(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y)), maxY = Math.max(...all.map((p) => p.y));
  const s = Math.min((AREA.w * 0.9) / (maxX - minX), (AREA.h * 0.94) / (maxY - minY));
  const at = (p: Pt): Pt => ({ x: AREA.x + AREA.w / 2 + (p.x - (minX + maxX) / 2) * s, y: AREA.y + AREA.h / 2 + (p.y - (minY + maxY) / 2) * s });
  const poly = (id: string, pts: Pt[], colour: string, fill: string) =>
    o.els.push(line(id, [...pts, pts[0]].map(at), o.meta(0, id), { strokeColor: colour, backgroundColor: fill, fillStyle: "solid", strokeWidth: 2.5, roughness: 0.4, roundness: null, polygon: true } as Partial<ExEl>));
  poly("tr-sqa", sqA0, "#1971c2", "#d0ebff");
  poly("tr-sqb", sqB0, "#2f9e44", "#d3f9d8");
  poly("tr-sqc", sqC0, "#9c36b5", "#f3d9fa");
  poly("tr-tri", [P0, A0, B0], INK.text, "#fff9db");
  const P = at(P0), k = 16;
  o.els.push(line("tr-right", [{ x: P.x, y: P.y - k }, { x: P.x + k, y: P.y - k }, { x: P.x + k, y: P.y }], o.meta(0, "tr-tri"), { strokeColor: INK.text, strokeWidth: 1.5, roughness: 0, roundness: null }));
  const mid = (q: Pt[]) => at({ x: q.reduce((t, p) => t + p.x, 0) / q.length, y: q.reduce((t, p) => t + p.y, 0) / q.length });
  const size = Math.max(17, Math.min(26, s * 0.5));
  const two = (id: string, l1: string, l2: string, p: Pt, key: string) => o.els.push(text(id, [l1, l2], size, { cx: p.x, cy: p.y }, o.meta(0, key), { strokeColor: INK.text, textAlign: "center" }));
  two("tr-sqa-t", `a = ${fmt(d.a)}`, `a² = ${fmt(d.a * d.a)}`, mid(sqA0), "tr-sqa");
  two("tr-sqb-t", `b = ${fmt(d.b)}`, `b² = ${fmt(d.b * d.b)}`, mid(sqB0), "tr-sqb");
  two("tr-sqc-t", `c = ${fmt(c)}`, `c² = ${fmt(d.a * d.a + d.b * d.b)}`, mid(sqC0), "tr-sqc");
}

function drawProcess(d: Extract<Diagram, { template: "process" }>, o: Out) {
  const midY = AREA.y + AREA.h / 2;
  const stage = (id: string, name: string, x: number, key: string) => box(o, id, { x, y: midY - 70, w: 250, h: 140 }, name, key, { size: 28, colour: "#2f9e44", fill: "#ebfbee" });
  const term = (id: string, name: string, x: number, y: number, key: string, colour: string, fill: string) => box(o, id, { x, y: y - 32, w: 160, h: 64 }, name, key, { size: 24, colour, fill });
  const join = (id: string, a: ExEl, b: ExEl, key: string, colour: string) => o.els.push(bind(arrow(id, between(a, b, 8), o.meta(0, key), { strokeColor: colour, strokeWidth: 2.5, roundness: null }), a, b));
  if (d.stages) {
    const s = d.stages;
    const one = stage("pr-s0", s.names[0], AREA.x + 230, "stage0");
    const two = stage("pr-s1", s.names[1], AREA.x + 640, "stage1");
    join("pr-between", one, two, "between", "#e8590c");
    note(o, "pr-between-t", s.between, { x: (one.x + one.width + two.x) / 2, y: midY - 30 }, "between", 20, "#e8590c");
    const ins = [...s.first.in.map((n) => ({ n, to: one })), ...s.second.in.map((n) => ({ n, to: two }))];
    ins.forEach((it, i) => {
      const x = it.to === one ? AREA.x : AREA.x + 660 + (i - s.first.in.length) * 0;
      const y = it.to === one ? AREA.y + 60 + i * 120 : AREA.y + 6;
      const t = term(`pr-in${i}`, it.n, it.to === one ? x : two.x + 45, it.to === one ? y : y + 32, `in${i}`, "#1971c2", "#e7f5ff");
      join(`pr-in${i}-a`, t, it.to, `in${i}`, "#1971c2");
    });
    const outs = [...s.first.out.map((n) => ({ n, from: one })), ...s.second.out.map((n) => ({ n, from: two }))];
    outs.forEach((it, i) => {
      const t = it.from === one ? term(`pr-out${i}`, it.n, one.x + 45, AREA.y + AREA.h - 32, `out${i}`, "#9c36b5", "#f8f0fc") : term(`pr-out${i}`, it.n, AREA.x + AREA.w - 160, midY, `out${i}`, "#9c36b5", "#f8f0fc");
      join(`pr-out${i}-a`, it.from, t, `out${i}`, "#9c36b5");
    });
    return;
  }
  const core = stage("pr-core", d.process, AREA.x + AREA.w / 2 - 125, "stage0");
  d.inputs.forEach((it, i) => { const t = term(`pr-in${i}`, it, AREA.x + 60, midY + (i - (d.inputs.length - 1) / 2) * 100, `in${i}`, "#1971c2", "#e7f5ff"); join(`pr-in${i}-a`, t, core, `in${i}`, "#1971c2"); });
  d.outputs.forEach((it, i) => { const t = term(`pr-out${i}`, it, AREA.x + AREA.w - 220, midY + (i - (d.outputs.length - 1) / 2) * 100, `out${i}`, "#9c36b5", "#f8f0fc"); join(`pr-out${i}-a`, core, t, `out${i}`, "#9c36b5"); });
}

function drawLayers(d: Extract<Diagram, { template: "layers" }>, o: Out) {
  const n = d.layers.length;
  const xs = d.layers.map((_, i) => AREA.x + 120 + (i * 460) / (n - 1));
  const r = 26;
  const nodes = d.sizes.map((k, i) => Array.from({ length: k }, (_, j) => {
    const p = { x: xs[i], y: AREA.y + 190 + (j - (k - 1) / 2) * 92 };
    const e = el(`ly-${i}-${j}`, "ellipse", { x: p.x - r, y: p.y - r, w: r * 2, h: r * 2 }, { step: 0, key: `layer${i}`, role: "node" }, { strokeColor: stepColour(i), backgroundColor: "#ffffff" });
    o.els.push(e);
    return e;
  }));
  d.layers.forEach((name, i) => note(o, `ly-n${i}`, name, { x: xs[i], y: AREA.y + 14 }, `layer${i}`, 21, stepColour(i)));
  for (let i = 0; i < n - 1; i++) for (const p of nodes[i]) for (const q of nodes[i + 1]) o.els.push(line(`ly-w-${p.id}-${q.id}`, between(p, q, 2), o.meta(0, "weights"), { strokeColor: INK.faint, strokeWidth: 1, roughness: 0.3, roundness: null }));
  const out = nodes[n - 1][0];
  const pred = box(o, "ly-pred", { x: out.x + 120, y: out.y - 30 + r, w: 170, h: 60 }, `prediction ${fmt(d.prediction)}`, "pred", { size: 21, colour: "#1971c2", fill: "#e7f5ff" });
  o.els.push(bind(arrow("ly-pred-a", between(out, pred, 6), o.meta(0, "pred"), { strokeColor: "#1971c2", strokeWidth: 2, roundness: null }), out, pred));
  const target = box(o, "ly-target", { x: pred.x, y: pred.y - 110, w: 170, h: 56 }, `answer ${fmt(d.target)}`, "target", { size: 21, colour: "#2f9e44", fill: "#ebfbee" });
  const loss = box(o, "ly-loss", { x: pred.x + 230, y: pred.y - 55, w: 170, h: 60 }, `error ${fmt(d.target - d.prediction)}`, "loss", { size: 22, colour: INK.mark, fill: "#fff5f5" });
  o.els.push(bind(arrow("ly-t-a", between(target, loss, 6), o.meta(0, "loss"), { strokeColor: INK.soft, strokeWidth: 2, roundness: null }), target, loss));
  o.els.push(bind(arrow("ly-p-a", between(pred, loss, 6), o.meta(0, "loss"), { strokeColor: INK.soft, strokeWidth: 2, roundness: null }), pred, loss));
  const fy = AREA.y + AREA.h - 70, by2 = AREA.y + AREA.h - 14;
  o.els.push(arrow("ly-fwd", [{ x: xs[0], y: fy }, { x: xs[n - 1], y: fy }], o.meta(0, "forward"), { strokeColor: "#1971c2", strokeWidth: 3, roundness: null }));
  o.els.push(text("ly-fwd-t", ["forward"], 20, { x: xs[n - 1] + 16, y: fy - 13 }, o.meta(0, "forward"), { strokeColor: "#1971c2" }));
  // the error goes back from the error box to the weights
  const first = nodes[0][nodes[0].length - 1];
  const back = arrow("ly-back", [{ x: loss.x + loss.width / 2, y: loss.y + loss.height + 6 }, { x: loss.x + loss.width / 2, y: by2 }, { x: xs[0], y: by2 }, { x: xs[0], y: first.y + first.height + 6 }], o.meta(0, "backward"), { strokeColor: INK.mark, strokeWidth: 3, roundness: null });
  o.els.push(bind(back, loss, first));
  o.els.push(text("ly-back-t", ["backward: adjust the weights"], 20, { x: xs[0] + 20, y: by2 - 32 }, o.meta(0, "backward"), { strokeColor: INK.mark }));
}

/**
 * The board of a template lesson up to step `upto`: a centred title, the diagram across the whole
 * width with each step's number beside the part it draws, and a band below with the meaning of the
 * terms, the reason and the takeaway (highlighted), each numbered as the voice says it. Nothing is
 * written twice: a takeaway already on the board is not drawn again.
 */
export function sceneFromDiagram(d: Diagram, says: string[], upto: number, _result: string): Scene {
  const o = mk();
  const ex = explain(d);
  const steps = ex.steps.map((s, i) => ({ ...s, say: says[i] ?? s.say })).slice(0, Math.max(1, says.length));
  const titleFont = [32, 26, 22].find((f) => handWidth(d.title, f) <= W - 80) ?? 20;
  const els: ExEl[] = [
    el("wb-frame", "rectangle", { x: 0, y: 0, w: W, h: H }, { step: -1, key: "frame", role: "frame" }, { strokeColor: "transparent", locked: true, roughness: 0 }),
    text("wb-title", [d.title], titleFont, { cx: W / 2, cy: 38 }, { step: -1, key: "title", role: "title" }, { textAlign: "center" }),
  ];
  if (d.template === "sequence") drawSequence(d, o);
  else if (d.template === "graph") drawGraph(d, o);
  else if (d.template === "cycle") drawCycle(d, o);
  else if (d.template === "array") drawArray(d, o);
  else if (d.template === "circuit") drawCircuit(d, o);
  else if (d.template === "callstack") drawCallstack(d, o);
  else if (d.template === "growth") drawGrowth(d, o);
  else if (d.template === "triangle") drawTriangle(d, o);
  else if (d.template === "process") drawProcess(d, o);
  else if (d.template === "layers") drawLayers(d, o);
  // each part belongs to the step that says it; a part no step names comes with the first
  const stepOfKey = new Map<string, number>();
  steps.forEach((s, i) => s.keys.forEach((k) => { if (!stepOfKey.has(k)) stepOfKey.set(k, i); }));
  for (const e of o.els) if (e.customData?.wb) e.customData.wb.step = stepOfKey.get(e.customData.wb.key) ?? 0;
  // the number of each diagram step, beside the first part it draws (the voice says the same number)
  const badges: ExEl[] = [];
  steps.forEach((s, i) => {
    if (s.band) return;
    const mine = o.els.filter((e) => e.customData?.wb?.step === i && e.type !== "text");
    if (!mine.length) return;
    const x = Math.min(...mine.map((e) => e.x)), y = Math.min(...mine.map((e) => e.y));
    const x1 = Math.max(...mine.map((e) => e.x + e.width)), y1 = Math.max(...mine.map((e) => e.y + e.height));
    // the first free place beside the part: left, above, right, below
    const taken = [...o.els, ...badges].filter((e) => e.id !== "wb-frame").map((e) => boundsOf([e])!).filter(Boolean);
    const free = (q: { x: number; y: number; w: number; h: number }) => q.x >= 4 && q.y >= AREA.y - 30 && q.x + q.w <= W - 4 && q.y + q.h <= BAND.y - 4 && !taken.some((t) => q.x < t.x + t.w + 4 && t.x < q.x + q.w + 4 && q.y < t.y + t.h + 4 && t.y < q.y + q.h + 4);
    const tries = [{ x: x - 40, y: y - 4 }, { x: x - 40, y: (y + y1) / 2 - 14 }, { x, y: y - 36 }, { x: x1 + 10, y: y - 4 }, { x: x1 + 10, y: (y + y1) / 2 - 14 }, { x, y: y1 + 8 }, { x: x - 40, y: y1 - 28 }];
    const spot = tries.map((p) => ({ ...p, w: 28, h: 28 })).find(free) ?? { x: Math.max(4, x - 40), y: Math.max(AREA.y - 6, y - 4), w: 28, h: 28 };
    const b = spot;
    const meta: WbMeta = { step: i, key: `badge${i}`, role: "pointer" };
    badges.push(...labelled(el(`st-${i}`, "ellipse", b, meta, { strokeColor: "#343a40", backgroundColor: "#343a40", roughness: 0 }), text(`st-${i}-n`, [String(i + 1)], 15, { cx: b.x + 14, cy: b.y + 14 }, meta, { strokeColor: "#ffffff" })));
  });
  // the band: the meaning, the reason, the takeaway, side by side
  const onCanvas = new Set(o.els.filter((e) => e.type === "text").map((e) => String(e.originalText ?? e.text).replace(/\s+/g, " ").trim().toLowerCase()));
  const cells = steps.map((s, i) => ({ s, i })).filter(({ s }) => s.band && !onCanvas.has(s.say.replace(/\s+/g, " ").trim().toLowerCase()));
  const gap = 16, cw = (BAND.w - gap * (cells.length - 1)) / Math.max(1, cells.length);
  cells.forEach(({ s, i }, k) => {
    const x = BAND.x + k * (cw + gap);
    const so = s.band === "so";
    const meta: WbMeta = { step: i, key: `band${i}`, role: "block" };
    els.push(el(`band-${i}`, "rectangle", { x, y: BAND.y, w: cw, h: BAND.h }, meta, { strokeColor: so ? "#e8590c" : "#ced4da", backgroundColor: so ? "#fff3bf" : "#f8f9fa", strokeWidth: so ? 2.5 : 1.5, roundness: { type: 3 } }));
    const b = { x: x + 12, y: BAND.y + 12, w: 28, h: 28 };
    els.push(...labelled(el(`st-${i}`, "ellipse", b, meta, { strokeColor: "#343a40", backgroundColor: "#343a40", roughness: 0 }), text(`st-${i}-n`, [String(i + 1)], 15, { cx: b.x + 14, cy: b.y + 14 }, meta, { strokeColor: "#ffffff" })));
    let size = 18;
    let lines = wrapHand(s.say, cw - 70, size);
    while (lines.length * size * LINE_HEIGHT > BAND.h - 24 && size > 13) { size--; lines = wrapHand(s.say, cw - 70, size); }
    els.push(text(`band-${i}-t`, lines, size, { x: x + 52, y: BAND.y + 14 }, meta, { originalText: s.say }));
  });
  const all = [...els, ...o.els, ...badges].sort((a, b) => (a.customData?.wb?.step ?? 0) - (b.customData?.wb?.step ?? 0));
  return { elements: all.filter((e) => (e.customData?.wb?.step ?? 0) <= upto), files: {} };
}
