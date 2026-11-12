import { describe, expect, it } from "vitest";
import { binarySearchTrace, growthValues, meeting, readDiagram, recursionValues, sceneFromDiagram, workedExample, type Diagram } from "./templates";
import { checkScene, countProblems, fixOps, rawMath } from "./check";
import { applyEdits, applyOps, noEdits } from "./doc";
import { chemText } from "./tex";
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
    expect(workedExample(diagrams.circuit).result).toBe("I = 9 V / 3 Ω = 3 A");
    expect(workedExample(diagrams.growth).result).toBe("1,000 → 1,610.51 in 5 years");
    expect(workedExample(diagrams.callstack).result).toBe("fact(4) = 24");
    expect(workedExample(diagrams.triangle).result).toContain("9 + 16 = 25");
    expect(workedExample(diagrams.array).result).toBe("42 found at position 5 after 2 checks");
    // no fact shows mathematics as code
    for (const d of Object.values(diagrams)) for (const f of workedExample(d).facts) expect(rawMath(f), f).toBe(false);
  });
});

describe("sceneFromDiagram", () => {
  it("draws each template cleanly, with every step numbered in one column and the result last", () => {
    for (const [k, d] of Object.entries(diagrams)) {
      const w = workedExample(d);
      const says = w.facts.slice(0, 7);
      const scene = sceneFromDiagram(d, says, says.length - 1, w.result);
      const counts = countProblems(checkScene(scene));
      expect(counts, `${k}: ${checkScene(scene).map((p) => p.message).join("; ")}`).toEqual({ overflow: 0, overlap: 0, crossing: 0, offscreen: 0, math: 0, orphan: 0 });
      const badges = says.map((_, i) => scene.elements.find((e) => e.id === `st-${i}`)!);
      badges.forEach((b, i) => { expect(b, `${k} step ${i}`).toBeTruthy(); if (i) expect(b.y).toBeGreaterThan(badges[i - 1].y); });
      expect(scene.elements.find((e) => e.id === "result")?.customData?.wb?.step).toBe(says.length - 1);
      // drawn step by step: an earlier step shows less, and never a later step's sentence
      const first = sceneFromDiagram(d, says, 0, w.result);
      expect(first.elements.length).toBeLessThan(scene.elements.length);
      expect(first.elements.some((e) => e.id === "st-1")).toBe(false);
      const ids = scene.elements.map((e) => e.id);
      expect(new Set(ids).size, k).toBe(ids.length);
    }
  });
  it("sends the tcp messages down the page in their order", () => {
    const s = sceneFromDiagram(diagrams.sequence, workedExample(diagrams.sequence).facts, 6, "");
    const ys = [0, 1, 2].map((k) => s.elements.find((e) => e.id === `seq-msg${k}`)!.y);
    expect(ys[0]).toBeLessThan(ys[1]);
    expect(ys[1]).toBeLessThan(ys[2]);
  });
});

describe("raw mathematics", () => {
  it("is counted and written as mathematics", () => {
    for (const s of ["a^2 + b^2", "x_{1}", "\\frac{a}{b}", "Sunlight arrow Glucose", "6CO2 + 6H2O -> C6H12O6"]) expect(rawMath(s), s).toBe(true);
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
    expect(events.map((e) => e.type)).toEqual(["diagram", "outline", "step", "step", "step", "step", "done"]);
    expect((events[1] as Extract<LessonEvent, { type: "outline" }>).says[3]).toContain("= 3 A");
  });
  it("keeps a translated sentence only when it keeps every number", async () => {
    const lines = ["Una batteria da 9 V spinge la corrente.", "Il resistore da 3 ohm la limita.", "La legge: I = V / R.", "I = 9 V / 3 ohm = 4 A.", "I = 9 V / 3 Ω = 3 A"];
    const { events } = await run("it", [JSON.stringify(RAW.circuit), JSON.stringify({ lines })]);
    const says = (events[1] as Extract<LessonEvent, { type: "outline" }>).says;
    expect(says[0]).toBe(lines[0]);
    // "4 A" lost the right number: the computed fact stays
    expect(says[3]).toBe("I = 9 V / 3 ohms = 3 A.");
    expect((events[0] as Extract<LessonEvent, { type: "diagram" }>).result).toBe(lines[4]);
    expect(keepsNumbers("1000 at 10%", "1,000 al 10%")).toBe(true);
  });
  it("leaves the lesson to the plan path when no template fits", async () => {
    const { ok, events } = await run("en", [JSON.stringify({ template: "map", title: "x" })]);
    expect(ok).toBe(false);
    expect(events).toEqual([]);
  });
});
