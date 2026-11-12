import { describe, expect, it } from "vitest";
import { KREBS, binarySearchTrace, explain, growthValues, meeting, readDiagram, recursionValues, sceneFromDiagram, workedExample, type Diagram } from "./templates";
import { badWording, checkScene, countProblems, fixOps, rawMath } from "./check";
import { applyEdits, applyOps, noEdits } from "./doc";
import { chemText } from "./tex";
import { validateLesson } from "./lesson";
import { layoutBoard } from "./layout";
import { sceneFromLayout } from "./scene";
import { keepsNumbers, tryTemplate, type LessonEvent } from "./generate";

const RAW: Record<string, unknown> = {
  sequence: { template: "sequence", title: "TCP three-way handshake", actors: ["Client", "Server"], messages: [{ from: 0, text: "SYN" }, { from: 1, text: "SYN-ACK" }, { from: 0, text: "ACK" }], result: "Connection established" },
  graph: { template: "graph", title: "Supply and demand", curves: [{ expr: "10 - x", name: "Demand" }, { expr: "2*x", name: "Supply" }], xName: "Quantity", yName: "Price", xmax: 8 },
  cycle: { template: "cycle", title: "The Krebs cycle", items: ["Acetyl-CoA", "Citrate", "Isocitrate", "alpha-Ketoglutarate", "Succinyl-CoA", "Succinate", "Fumarate", "Malate", "Oxaloacetate"], byproducts: [{ after: 2, text: "NADH + CO2" }, { after: 4, text: "GTP" }], center: "Krebs cycle" },
  array: { template: "array", title: "Binary search", algorithm: "binary_search", values: [57, 4, 9, 15, 23, 31, 42], target: 42 },
  circuit: { template: "circuit", title: "Ohm's law", voltage: 9, resistance: 3 },
  callstack: { template: "callstack", title: "Recursion", fn: "factorial", n: 4 },
  growth: { template: "growth", title: "Compound interest", principal: 1000, rate: 10, years: 5 },
  triangle: { template: "triangle", title: "Pythagorean theorem", a: 3, b: 4 },
  process: { template: "process", title: "Photosynthesis", process: "Leaf", inputs: ["Sunlight", "Water", "CO2"], outputs: ["Glucose", "O2"], equation: "6CO2 + 6H2O arrow C6H12O6 + 6O2" },
  layers: { template: "layers", title: "How a neural network learns", layers: ["Input", "Hidden", "Output"], sizes: [2, 3, 1] },
};
const diagrams = Object.fromEntries(Object.entries(RAW).map(([k, r]) => [k, readDiagram(r, k)!])) as Record<string, Diagram>;

describe("readDiagram", () => {
  it("reads every template and refuses what cannot be drawn", () => {
    for (const [k, d] of Object.entries(diagrams)) expect(d?.template, k).toBe(k);
    expect(readDiagram({ template: "map" }, "x")).toBeNull();
    expect(readDiagram({ template: "sequence", actors: ["A"], messages: [] }, "x")).toBeNull();
    expect(readDiagram({ template: "graph", curves: [{ expr: "alert(1)", name: "x" }] }, "x")).toBeNull();
    expect(readDiagram("nonsense", "x")).toBeNull();
  });
  it("gives an empty or wrong slot a sound default and sorts a list for binary search", () => {
    const a = diagrams.array as Extract<Diagram, { template: "array" }>;
    expect(a.values).toEqual([4, 9, 15, 23, 31, 42, 57]);
    const odd = readDiagram({ template: "growth", principal: -5, rate: "lots", years: 99 }, "g") as Extract<Diagram, { template: "growth" }>;
    expect([odd.principal, odd.rate, odd.years]).toEqual([1000, 10, 5]);
    const t = readDiagram({ template: "array", algorithm: "binary_search", values: [1, 2, 3, 4], target: 99 }, "a") as Extract<Diagram, { template: "array" }>;
    expect(t.values).toContain(t.target);
  });
  it("writes chemistry with subscripts and arrows", () => {
    const p = diagrams.process as Extract<Diagram, { template: "process" }>;
    expect(p.equation).toBe("6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂");
    expect(p.inputs).toContain("CO₂");
    expect(chemText("Sunlight")).toBe("Sunlight");
  });
});

describe("the worked example is computed in code", () => {
  it("gets the numbers right", () => {
    expect(binarySearchTrace([4, 9, 15, 23, 31, 42, 57], 42).map((s) => s.mid)).toEqual([3, 5]);
    expect(Math.round(growthValues(1000, 10, 5)[5] * 100) / 100).toBe(1610.51);
    expect(recursionValues("factorial", 4)).toEqual([24, 6, 2, 1]);
    expect(recursionValues("sum_to", 4)[0]).toBe(10);
    const m = meeting("10 - x", "2*x", 0, 8)!;
    expect(m.x).toBeCloseTo(10 / 3, 4);
    expect(m.y).toBeCloseTo(20 / 3, 4);
    expect(workedExample(diagrams.circuit).result).toBe("I = 3 A");
    expect(workedExample(diagrams.circuit).facts.join(" ")).toContain("doubles to 6 A");
    expect(workedExample(diagrams.growth).result).toBe("1,610.51");
    expect(workedExample(diagrams.growth).facts.join(" ")).toContain("against 1,500 with simple interest");
    expect(workedExample(diagrams.callstack).result).toBe("fact(4) = 24");
    expect(workedExample(diagrams.triangle).facts.join(" ")).toContain("9 + 16 = 25");
    expect(workedExample(diagrams.array).result).toBe("42 found after 2 checks");
    expect(workedExample(diagrams.array).facts.join(" ")).toContain("1,000,000 values at most 20");
    // no fact shows mathematics as code, doubles a word or says a thing is itself; every lesson says why and what follows
    for (const d of Object.values(diagrams)) {
      const e = explain(d);
      for (const f of e.steps.map((s) => s.say)) { expect(rawMath(f), f).toBe(false); expect(badWording(f), f).toBe(false); }
      expect(e.steps.some((s) => s.band === "why"), d.template).toBe(true);
      expect(e.steps.some((s) => s.band === "so"), d.template).toBe(true);
      expect(e.steps.length).toBeLessThanOrEqual(7);
    }
  });
});

describe("sceneFromDiagram", () => {
  it("draws each template cleanly; every step's number is on the board once, the takeaway highlighted", () => {
    for (const [k, d] of Object.entries(diagrams)) {
      const w = workedExample(d);
      const says = w.facts;
      const scene = sceneFromDiagram(d, says, says.length - 1, w.result);
      const ps = checkScene(scene);
      expect(countProblems(ps), `${k}: ${ps.map((p) => p.message).join("; ")}`).toEqual({ overflow: 0, overlap: 0, crossing: 0, offscreen: 0, math: 0, orphan: 0, wording: 0, dangling: 0 });
      says.forEach((_, i) => {
        const n = scene.elements.filter((e) => e.id === `st-${i}-n`);
        expect(n.length, `${k} step ${i + 1}`).toBe(1);
        expect(n[0].text).toBe(String(i + 1));
      });
      const so = explain(d).steps.findIndex((s) => s.band === "so");
      expect(scene.elements.find((e) => e.id === `band-${so}`)?.backgroundColor, k).toBe("#fff3bf");
      // drawn step by step: an earlier step shows less, and never a later step's sentence
      const first = sceneFromDiagram(d, says, 0, w.result);
      expect(first.elements.length).toBeLessThan(scene.elements.length);
      expect(first.elements.some((e) => e.id === "st-1-n")).toBe(false);
      const ids = scene.elements.map((e) => e.id);
      expect(new Set(ids).size, k).toBe(ids.length);
      // nothing is written twice
      const texts = scene.elements.filter((e) => e.type === "text").map((e) => String(e.originalText ?? e.text).trim()).filter((t) => t.length > 12);
      expect(new Set(texts).size, k).toBe(texts.length);
    }
  });
  it("sends the tcp messages down the page in their order", () => {
    const s = sceneFromDiagram(diagrams.sequence, workedExample(diagrams.sequence).facts, 6, "");
    const ys = [0, 1, 2].map((k) => s.elements.find((e) => e.id === `seq-msg${k}`)!.y);
    expect(ys[0]).toBeLessThan(ys[1]);
    expect(ys[1]).toBeLessThan(ys[2]);
  });
  it("draws the Krebs cycle from the reference, whatever list the model gave", () => {
    const k = diagrams.cycle as Extract<Diagram, { template: "cycle" }>;
    expect(k.items).toEqual(KREBS.items);
    expect(k.entry).toBe("Acetyl-CoA");
    // isocitrate -> alpha-ketoglutarate gives NADH and CO2; citrate -> isocitrate gives nothing
    expect(k.byproducts.find((b) => b.after === 1)).toBeUndefined();
    expect(k.byproducts.find((b) => b.after === 2)?.text).toBe("NADH + CO₂");
    const s = sceneFromDiagram(k, workedExample(k).facts, 6, "");
    // the ring closes: malate goes back to oxaloacetate
    const close = s.elements.find((e) => e.id === "cy-a7")!;
    expect([close.startBinding?.elementId, close.endBinding?.elementId]).toEqual(["cy-7", "cy-0"]);
  });
  it("draws photosynthesis in its two stages", () => {
    const p = diagrams.process as Extract<Diagram, { template: "process" }>;
    expect(p.stages?.names).toEqual(["Light reactions", "Calvin cycle"]);
    const s = sceneFromDiagram(p, workedExample(p).facts, 6, "");
    // CO2 goes into the Calvin cycle, oxygen comes out of the light reactions
    const co2 = s.elements.find((e) => e.customData?.wb?.key === "in2" && e.type === "arrow")!;
    expect(co2.endBinding?.elementId).toBe("pr-s1");
    const o2 = s.elements.find((e) => e.customData?.wb?.key === "out0" && e.type === "arrow")!;
    expect(o2.startBinding?.elementId).toBe("pr-s0");
  });
});
describe("raw mathematics", () => {
  it("is counted and written as mathematics", () => {
    for (const s of ["a^2 + b^2", "x_{1}", "\\frac{a}{b}", "Sunlight arrow Glucose", "6CO2 + 6H2O -> C6H12O6", "6CO2 + 6H2O = C6H12O6"]) expect(rawMath(s), s).toBe(true);
    for (const s of ["fact(4) = 24", "I = 9 V / 3 Ω = 3 A", "Client sends SYN-ACK", "CO2", "a² + b² = c²"]) expect(rawMath(s), s).toBe(false);
    const scene = sceneFromDiagram(diagrams.circuit, ["one"], 0, "");
    const t = scene.elements.find((e) => e.type === "text" && !e.containerId && e.id !== "wb-title")!;
    const bad = { ...scene, elements: scene.elements.map((e) => (e.id === t.id ? { ...e, text: "6CO2 + 6H2O -> C6H12O6", originalText: "6CO2 + 6H2O -> C6H12O6" } : e)) };
    const ps = checkScene(bad).filter((p) => p.kind === "math");
    expect(ps.map((p) => p.ids[0])).toEqual([t.id]);
    const fixed = applyEdits(bad, applyOps(bad, noEdits(), fixOps(bad, ps)).edits);
    expect(fixed.elements.find((e) => e.id === t.id)!.text).toBe("6CO₂ + 6H₂O → C₆H₁₂O₆");
  });
});

describe("orphan boxes", () => {
  it("counts a box of a concept map that no arrow joins", () => {
    const l = validateLesson({ title: "T", scene: "flow", steps: [{ say: "A feeds B; C stands alone.", items: [{ kind: "node", id: "a", text: "A" }, { kind: "node", id: "b", text: "B" }, { kind: "edge", from: "a", to: "b", text: "feeds" }, { kind: "node", id: "c", text: "C" }] }] })!;
    const ps = checkScene(sceneFromLayout(layoutBoard(l, 0, "wide"))).filter((p) => p.kind === "orphan");
    expect(ps.map((p) => p.ids[0])).toEqual(["n-c"]);
  });
});

describe("tryTemplate", () => {
  const run = async (lang: "en" | "it", answers: string[]) => {
    const events: LessonEvent[] = [];
    const asked: string[] = [];
    const ask = async (c: { system: string }) => { asked.push(c.system); return answers.shift() ?? "{}"; };
    const ok = await tryTemplate(ask, { question: "Ohm's law", lang, maxSteps: 7, templates: true }, (e) => events.push(e));
    return { ok, events, asked };
  };
  it("emits the picture, then the computed steps, in English without a second call", async () => {
    const { ok, events, asked } = await run("en", [JSON.stringify(RAW.circuit)]);
    expect(ok).toBe(true);
    expect(asked).toHaveLength(1);
    expect(events.map((e) => e.type)).toEqual(["diagram", "outline", "step", "step", "step", "step", "step", "step", "done"]);
    expect((events[1] as Extract<LessonEvent, { type: "outline" }>).says[3]).toContain("= 3 A");
  });
  it("keeps a translated sentence only when it keeps every number", async () => {
    const facts = workedExample(diagrams.circuit).facts;
    const lines = [...facts.map((f) => `IT ${f}`), "I = 3 A"];
    lines[3] = "Quindi la corrente è I = 9 / 3 = 4 A.";
    const { events } = await run("it", [JSON.stringify(RAW.circuit), JSON.stringify({ lines })]);
    const says = (events[1] as Extract<LessonEvent, { type: "outline" }>).says;
    expect(says[0]).toBe(lines[0]);
    // "4 A" is not the computed number: the computed fact stays
    expect(says[3]).toBe(facts[3]);
    expect((events[0] as Extract<LessonEvent, { type: "diagram" }>).result).toBe("I = 3 A");
    expect(keepsNumbers("1000 at 10%", "1,000 al 10%")).toBe(true);
  });  it("leaves the lesson to the plan path when no template fits", async () => {
    const { ok, events } = await run("en", [JSON.stringify({ template: "map", title: "x" })]);
    expect(ok).toBe(false);
    expect(events).toEqual([]);
  });
});
