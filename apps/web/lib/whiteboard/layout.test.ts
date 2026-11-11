import { describe, expect, it } from "vitest";
import { validateLesson, type Lesson } from "./lesson";
import { BOARD_SIZE, layoutBoard, layoutProblems, textWidth, wrapText, type BoardShape } from "./layout";

const SHAPES: BoardShape[] = ["wide", "tall"];

/** A small seeded generator, so a failing board can be rebuilt from its seed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const WORDS = ["Light", "Carbon dioxide", "Chloroplast", "Glucose", "Mitochondrion", "SYN-ACK", "Фотосинтез", "Митохондрия клетки", "光合成", "二酸化炭素と水", "Acetyl-CoA", "Supply", "Equilibrium price", "Base case", "Call stack frame", "ATP"];

function randomLesson(seed: number): Lesson {
  const r = rng(seed);
  const pick = <T>(a: readonly T[]) => a[Math.floor(r() * a.length)];
  const steps = Array.from({ length: 3 + Math.floor(r() * 5) }, (_, s) => {
    const items: unknown[] = [];
    const count = 1 + Math.floor(r() * 6);
    for (let i = 0; i < count; i++) {
      const roll = r();
      if (roll < 0.45) items.push({ kind: "node", id: `n${s}_${i}`, text: pick(WORDS) + (r() < 0.3 ? " " + pick(WORDS) : "") });
      else if (roll < 0.7) items.push({ kind: "edge", from: `n${Math.floor(r() * (s + 1))}_${Math.floor(r() * 3)}`, to: `n${Math.floor(r() * (s + 1))}_${Math.floor(r() * 3)}`, text: r() < 0.6 ? pick(WORDS).slice(0, 14) : "" });
      else if (roll < 0.8) items.push({ kind: "formula", tex: r() < 0.5 ? "a^2 + b^2 = c^2" : "A = P\\left(1 + \\frac{r}{n}\\right)^{nt}" });
      else if (roll < 0.88) items.push({ kind: "note", text: Array.from({ length: 2 + Math.floor(r() * 14) }, () => pick(WORDS)).join(" ") });
      else if (roll < 0.94) items.push({ kind: "plot", expr: "x^2", xmin: -2, xmax: 2 });
      else items.push({ kind: "mark", target: `n0_0`, style: pick(["circle", "underline", "highlight"]) });
    }
    return { say: "A sentence for this step.", items };
  });
  return validateLesson({ title: pick(WORDS) + " explained step by step", scene: pick(["flow", "cycle", "stack"]), steps })!;
}

describe("whiteboard layout", () => {
  it("never lets nodes or notes overlap or leave the board, at any step, on either board shape", () => {
    let boards = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const lesson = randomLesson(seed);
      for (const shape of SHAPES) {
        for (let upto = 0; upto < lesson.steps.length; upto++) {
          const l = layoutBoard(lesson, upto, shape);
          boards++;
          const hard = layoutProblems(l).filter((p) => !p.startsWith("label") && !p.includes("overlaps label") && !p.startsWith("arrow") && !p.endsWith("label is cut"));
          expect(hard, `seed ${seed} ${shape} step ${upto}`).toEqual([]);
          for (const e of l.edges) if (e.label) expect(e.label.box.x >= 0 && e.label.box.x + e.label.box.w <= l.w, `seed ${seed} label off board`).toBe(true);
        }
      }
    }
    expect(boards).toBeGreaterThan(2000);
  });

  it("is deterministic: the same lesson and step give the same board", () => {
    const lesson = randomLesson(7);
    expect(layoutBoard(lesson, 2, "wide")).toEqual(layoutBoard(lesson, 2, "wide"));
  });

  it("lays out a flow with no problem at all, arrows and labels included", () => {
    const lesson = validateLesson({
      title: "Photosynthesis",
      scene: "flow",
      steps: [
        { say: "s1", items: [{ kind: "node", id: "sun", text: "Sunlight" }, { kind: "node", id: "leaf", text: "Leaf" }, { kind: "edge", from: "sun", to: "leaf", text: "energy" }] },
        { say: "s2", items: [{ kind: "node", id: "water", text: "Water" }, { kind: "node", id: "co2", text: "Carbon dioxide" }, { kind: "edge", from: "water", to: "leaf", text: "roots" }, { kind: "edge", from: "co2", to: "leaf", text: "stomata" }] },
        { say: "s3", items: [{ kind: "node", id: "sugar", text: "Glucose" }, { kind: "node", id: "o2", text: "Oxygen" }, { kind: "edge", from: "leaf", to: "sugar" }, { kind: "edge", from: "leaf", to: "o2", text: "released" }, { kind: "formula", tex: "6CO_2 + 6H_2O \\rightarrow C_6H_{12}O_6 + 6O_2" }] },
      ],
    })!;
    for (const shape of SHAPES) for (let upto = 0; upto < 3; upto++) expect(layoutProblems(layoutBoard(lesson, upto, shape)), `${shape} ${upto}`).toEqual([]);
  });

  it("spreads several arrows between the same two nodes so their labels stay apart", () => {
    const lesson = validateLesson({
      title: "TCP handshake",
      scene: "flow",
      steps: [{ say: "s", items: [{ kind: "node", id: "c", text: "Client" }, { kind: "node", id: "s", text: "Server" }, { kind: "edge", from: "c", to: "s", text: "SYN" }, { kind: "edge", from: "s", to: "c", text: "SYN-ACK" }, { kind: "edge", from: "c", to: "s", text: "ACK" }] }],
    })!;
    for (const shape of SHAPES) {
      const l = layoutBoard(lesson, 0, shape);
      expect(l.edges).toHaveLength(3);
      expect(layoutProblems(l), shape).toEqual([]);
      const places = l.edges.map((e) => `${Math.round(e.label!.box.x)},${Math.round(e.label!.box.y)}`);
      expect(new Set(places).size).toBe(3);
    }
  });

  it("bends an arrow around a node that stands in its way", () => {
    const lesson = validateLesson({
      title: "Skip",
      scene: "flow",
      steps: [{ say: "s", items: [{ kind: "node", id: "a", text: "A" }, { kind: "node", id: "b", text: "B" }, { kind: "node", id: "c", text: "C" }, { kind: "edge", from: "a", to: "c", text: "skips B" }] }],
    })!;
    const l = layoutBoard(lesson, 0, "wide");
    expect(layoutProblems(l)).toEqual([]);
    const e = l.edges[0];
    expect(Math.abs(e.cy - e.y1)).toBeGreaterThan(20);
  });

  it("puts a cycle around a centre and falls back to a row for two nodes", () => {
    const make = (n: number) => validateLesson({ title: "Krebs cycle", scene: "cycle", steps: [{ say: "s", items: Array.from({ length: n }, (_, i) => ({ kind: "node", id: `k${i}`, text: `Stage ${i + 1}` })) }] })!;
    const five = layoutBoard(make(5), 0, "wide");
    expect(layoutProblems(five)).toEqual([]);
    const top = five.nodes[0].box;
    expect(Math.abs(top.x + top.w / 2 - BOARD_SIZE.wide.w / 2)).toBeLessThan(1);
    expect(five.nodes.every((nd) => nd.box.y >= top.y - 0.5)).toBe(true);
    const two = layoutBoard(make(2), 0, "wide");
    expect(Math.round(two.nodes[0].box.y)).toBe(Math.round(two.nodes[1].box.y));
  });

  it("wipes the oldest notes when the column is full, and says how many", () => {
    const lesson = validateLesson({ title: "Derivation", scene: "stack", steps: Array.from({ length: 7 }, (_, s) => ({ say: "s", items: Array.from({ length: 4 }, (_, i) => ({ kind: "formula", tex: `x_{${s}${i}} = \\frac{a}{b}` })) })) })!;
    const l = layoutBoard(lesson, 6, "tall");
    expect(l.wiped).toBeGreaterThan(0);
    expect(l.blocks.length + l.wiped).toBe(28);
    expect(layoutProblems(l)).toEqual([]);
    expect(l.blocks[l.blocks.length - 1].key).toBe("b6_3");
  });

  it("shows a failed step as a text card", () => {
    const lesson: Lesson = { title: "Recursion", scene: "stack", steps: [{ say: "A function that calls itself needs a way to stop.", items: [], card: true }] };
    const l = layoutBoard(lesson, 0, "wide");
    expect(l.blocks).toHaveLength(1);
    expect(l.blocks[0]).toMatchObject({ kind: "card", step: 0 });
    expect(layoutProblems(l)).toEqual([]);
  });

  it("reports what is wrong when a board is broken on purpose", () => {
    const lesson = validateLesson({ title: "T", scene: "flow", steps: [{ say: "s", items: [{ kind: "node", id: "a", text: "A" }, { kind: "node", id: "b", text: "B" }] }] })!;
    const l = layoutBoard(lesson, 0, "wide");
    l.nodes[1].box = { ...l.nodes[0].box };
    expect(layoutProblems(l)).toContain("node a overlaps node b");
    l.nodes[1].box = { x: l.w - 10, y: 100, w: 80, h: 50 };
    expect(layoutProblems(l)).toContain("node b is off the board");
  });

  it("wraps text within the width, breaks Japanese between characters and marks a cut", () => {
    const lines = wrapText("Mitochondrial electron transport chain complex", 150, 20, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
    for (const ln of lines) expect(textWidth(ln, 20)).toBeLessThanOrEqual(150);
    const ja = wrapText("二酸化炭素と水から糖を作る", 120, 20, 5);
    expect(ja.length).toBeGreaterThan(1);
    for (const ln of ja) expect(textWidth(ln, 20)).toBeLessThanOrEqual(120);
    expect(wrapText("Supercalifragilisticexpialidocious", 100, 20, 9).join("")).toBe("Supercalifragilisticexpialidocious");
  });
});
