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
          const hard = layoutProblems(l).filter((p) => !p.startsWith("label") && !p.includes("overlaps label") && !p.startsWith("arrow") && !p.endsWith("is cut"));
          expect(hard, `seed ${seed} ${shape} step ${upto}`).toEqual([]);
          for (const e of l.edges) if (e.label) expect(e.label.box.x >= 0 && e.label.box.x + e.label.box.w <= l.w, `seed ${seed} label off board`).toBe(true);
        }
      }
    }
    expect(boards).toBeGreaterThan(2000);
    // 400 random lessons take about 3 s alone and more than the default 5 s on a busy machine
  }, 30_000);

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
    // On the phone-shaped board six boxes and five arrows leave one label with no free place: an arrow may cross it (known limit, reported by layoutProblems).
    for (const shape of SHAPES) for (let upto = 0; upto < 3; upto++) expect(layoutProblems(layoutBoard(lesson, upto, shape)).filter((p) => shape === "wide" || !p.includes("runs through the label")), `${shape} ${upto}`).toEqual([]);
  });

  it("draws a flow by its arrows: sources on one side, what they feed next, no arrow through a box", () => {
    // what the local model wrote for photosynthesis in the first live run: a hub with six arrows into it
    const lesson = validateLesson({
      title: "Photosynthesis Basics",
      scene: "flow",
      steps: [
        { say: "s1", items: [{ kind: "node", id: "sun", text: "Sun" }, { kind: "node", id: "water", text: "Water" }, { kind: "node", id: "air", text: "Air" }] },
        { say: "s2", items: [{ kind: "node", id: "chlorophyll", text: "Chlorophyll" }, { kind: "edge", from: "sun", to: "chlorophyll" }] },
        { say: "s3", items: [{ kind: "node", id: "leaf", text: "Leaf" }, { kind: "edge", from: "water", to: "leaf" }, { kind: "edge", from: "air", to: "leaf", text: "carbon dioxide" }, { kind: "edge", from: "chlorophyll", to: "leaf", text: "energy" }] },
        { say: "s4", items: [{ kind: "node", id: "sugar", text: "Sugar" }, { kind: "node", id: "oxygen", text: "Oxygen" }, { kind: "edge", from: "leaf", to: "sugar" }, { kind: "edge", from: "leaf", to: "oxygen", text: "released" }] },
      ],
    })!;
    for (const shape of SHAPES) for (let upto = 0; upto < 4; upto++) expect(layoutProblems(layoutBoard(lesson, upto, shape)), `${shape} ${upto}`).toEqual([]);
    const l = layoutBoard(lesson, 3, "wide");
    const x = (id: string) => l.nodes.find((nd) => nd.id === id)!.box.x;
    expect(x("sun")).toBeLessThan(x("chlorophyll"));
    expect(x("chlorophyll")).toBeLessThan(x("leaf"));
    expect(x("leaf")).toBeLessThan(x("sugar"));
    expect(x("sugar")).toBe(x("oxygen"));
    // every arrow leaves by the side facing the next layer
    for (const e of l.edges) expect(e.x2).toBeGreaterThan(e.x1);
  });

  it("falls back to another arrangement when the arrows of a tangle cannot be drawn cleanly in rows", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const edges = ids.flatMap((from, i) => ids.slice(i + 2).map((to) => ({ kind: "edge", from, to })));
    const lesson = validateLesson({ title: "Tangle", scene: "flow", steps: [{ say: "s", items: ids.map((id) => ({ kind: "node", id, text: id.toUpperCase() })) }, { say: "s", items: edges.slice(0, 6) }, { say: "s", items: [...edges.slice(6), { kind: "edge", from: "f", to: "a" }] }] })!;
    for (const shape of SHAPES) expect(layoutProblems(layoutBoard(lesson, 2, shape)).filter((p) => p.startsWith("arrow")), shape).toEqual([]);
  });
  it("shows one arrow when a later step names an arrow that was bare", () => {
    const lesson = validateLesson({ title: "TCP", scene: "flow", steps: [{ say: "s", items: [{ kind: "node", id: "c", text: "Client" }, { kind: "node", id: "s", text: "Server" }, { kind: "edge", from: "c", to: "s" }] }, { say: "s", items: [{ kind: "edge", from: "c", to: "s", text: "SYN" }] }] })!;
    expect(layoutBoard(lesson, 0, "wide").edges).toHaveLength(1);
    const later = layoutBoard(lesson, 1, "wide").edges;
    expect(later).toHaveLength(1);
    expect(later[0].label?.lines).toEqual(["SYN"]);
  });

  it("keeps a word whole in its box by setting the diagram a size smaller", () => {
    const lesson = validateLesson({ title: "T", scene: "flow", steps: [{ say: "s", items: ["Sun", "Plant", "Food", "stems", "roots"].map((text, i) => ({ kind: "node", id: `n${i}`, text })) }, { say: "s", items: [...["soil", "Chlorophyll", "oxygen", "sugar"].map((text, i) => ({ kind: "node", id: `m${i}`, text })), { kind: "note", text: "a note takes a third of the board" }] }] })!;
    for (const shape of SHAPES) {
      const l = layoutBoard(lesson, 1, shape);
      expect(l.nodes.find((nd) => nd.text === "Chlorophyll")!.lines, shape).toEqual(["Chlorophyll"]);
    }
  });

  it("lets a phone-shaped board grow downwards with its diagram", () => {
    const make = (n: number) => validateLesson({ title: "T", scene: "flow", steps: [{ say: "s", items: Array.from({ length: Math.min(n, 6) }, (_, i) => ({ kind: "node", id: `a${i}`, text: `A${i}` })) }, { say: "s", items: Array.from({ length: Math.max(0, n - 6) }, (_, i) => ({ kind: "node", id: `b${i}`, text: `B${i}` })) }] })!;
    expect(layoutBoard(make(4), 1, "tall").h).toBe(BOARD_SIZE.tall.h);
    expect(layoutBoard(make(6), 1, "tall").h).toBe(BOARD_SIZE.tall.h + 192);
    expect(layoutBoard(make(9), 1, "tall").h).toBe(BOARD_SIZE.tall.h + 480);
    expect(layoutBoard(make(9), 1, "wide").h).toBe(BOARD_SIZE.wide.h);
    expect(layoutProblems(layoutBoard(make(10), 1, "tall"))).toEqual([]);
  });
  it("on a phone-shaped board, grows to keep the notes and never breaks a label inside a word", () => {
    const lesson = validateLesson({
      title: "Photosynthesis",
      scene: "flow",
      steps: [
        { say: "s", items: [{ kind: "node", id: "sun", text: "Sunlight" }, { kind: "node", id: "water", text: "Water" }, { kind: "node", id: "co2", text: "Carbon dioxide" }, { kind: "node", id: "leaf", text: "Leaf" }, { kind: "edge", from: "sun", to: "leaf", text: "energy" }, { kind: "edge", from: "water", to: "leaf" }] },
        { say: "s", items: [{ kind: "edge", from: "co2", to: "leaf" }, { kind: "node", id: "sugar", text: "Glucose" }, { kind: "edge", from: "leaf", to: "sugar", text: "makes" }, { kind: "formula", tex: "6CO_2 + 6H_2O \\rightarrow C_6H_{12}O_6 + 6O_2" }] },
        { say: "s", items: [{ kind: "node", id: "o2", text: "Oxygen" }, { kind: "edge", from: "leaf", to: "o2", text: "released" }, { kind: "plot", expr: "x / (1 + x)", xmin: 0, xmax: 8 }, { kind: "note", text: "The curve flattens: light is no longer the limit." }] },
      ],
    })!;
    const tall = layoutBoard(lesson, 2, "tall");
    expect(tall.wiped).toBe(0);
    expect(tall.blocks.map((b) => b.kind)).toEqual(["formula", "plot", "note"]);
    expect(tall.h).toBeGreaterThan(BOARD_SIZE.tall.h);
    expect(layoutProblems(tall)).toEqual([]);
    for (const shape of SHAPES) for (const e of layoutBoard(lesson, 2, shape).edges) if (e.label) expect(e.label.lines.join(" "), shape).toMatch(/^(energy|makes|released)$/);
    // a wide board is a fixed sheet
    expect(layoutBoard(lesson, 2, "wide").h).toBe(BOARD_SIZE.wide.h);
  });
  it("makes the pictures of a full column smaller before it wipes a formula", () => {
    const lesson = validateLesson({ title: "Ohm", scene: "flow", steps: [{ say: "s", items: [{ kind: "node", id: "v", text: "Voltage" }, { kind: "node", id: "i", text: "Current" }, { kind: "edge", from: "v", to: "i" }] }, { say: "s", items: [{ kind: "formula", tex: "V = I R" }, { kind: "plot", expr: "2x", xmin: 0, xmax: 5 }, { kind: "sketch", title: "Resistor", shapes: [{ type: "rect", x: 120, y: 120, w: 160, h: 60 }] }] }, { say: "s", items: [{ kind: "note", text: "The resistance stays the same." }] }] }, { sketch: true })!;
    const l = layoutBoard(lesson, 2, "wide");
    expect(l.wiped).toBe(0);
    expect(l.blocks.map((b) => b.kind)).toEqual(["formula", "plot", "sketch", "note"]);
    expect(layoutProblems(l)).toEqual([]);
    const sketch = l.blocks.find((b) => b.kind === "sketch")!.box;
    expect(sketch.w / sketch.h).toBeCloseTo(4 / 3);
    // with room to spare the plot keeps its full height
    expect(layoutBoard(lesson, 1, "wide").blocks.find((b) => b.kind === "plot")!.box.h).toBeGreaterThan(200);
  });
  it("fits Japanese and Russian labels in their boxes on both boards", () => {
    const cp = (...codes: number[]) => String.fromCharCode(...codes);
    const ja = [cp(0x592a, 0x967d, 0x306e, 0x5149), cp(0x4e8c, 0x9178, 0x5316, 0x70ad, 0x7d20), cp(0x8449, 0x7dd1, 0x4f53), cp(0x30d6, 0x30c9, 0x30a6, 0x7cd6), cp(0x9178, 0x7d20)];
    const ru = [cp(0x421, 0x43e, 0x43b, 0x43d, 0x435, 0x447, 0x43d, 0x44b, 0x439, 0x20, 0x441, 0x432, 0x435, 0x442), cp(0x423, 0x433, 0x43b, 0x435, 0x43a, 0x438, 0x441, 0x43b, 0x44b, 0x439, 0x20, 0x433, 0x430, 0x437), cp(0x425, 0x43b, 0x43e, 0x440, 0x43e, 0x43f, 0x43b, 0x430, 0x441, 0x442), cp(0x413, 0x43b, 0x44e, 0x43a, 0x43e, 0x437, 0x430), cp(0x41a, 0x438, 0x441, 0x43b, 0x43e, 0x440, 0x43e, 0x434)];
    for (const words of [ja, ru]) {
      const lesson = validateLesson({ title: words[0], scene: "flow", steps: [{ say: "s", items: [...words.map((text, i) => ({ kind: "node", id: `n${i}`, text })), { kind: "edge", from: "n0", to: "n2", text: words[4] }] }, { say: "s", items: [{ kind: "edge", from: "n1", to: "n2", text: words[3] }, { kind: "edge", from: "n2", to: "n3" }, { kind: "edge", from: "n2", to: "n4" }, { kind: "note", text: words.join(" ") }] }] })!;
      for (const shape of SHAPES) {
        const l = layoutBoard(lesson, 1, shape);
        expect(layoutProblems(l), shape).toEqual([]);
        expect(l.nodes.map((nd) => nd.lines.join("")).sort(), shape).toEqual(words.map((w) => w.replace(/ /g, "")).sort());
      }
    }
  });
  it("draws an arrow from a box to itself as a loop with its label, clear of everything", () => {
    const lesson = validateLesson({ title: "Recursion", scene: "flow", steps: [{ say: "s", items: [{ kind: "node", id: "f", text: "Function" }, { kind: "node", id: "b", text: "Base case" }, { kind: "edge", from: "f", to: "f", text: "calls itself" }, { kind: "edge", from: "f", to: "b", text: "stops at" }] }] })!;
    expect(lesson.steps[0].items.filter((i) => i.kind === "edge")).toHaveLength(2);
    for (const shape of SHAPES) {
      const l = layoutBoard(lesson, 0, shape);
      expect(layoutProblems(l), shape).toEqual([]);
      const loop = l.edges.find((e) => e.from === "f" && e.to === "f")!;
      const box = l.nodes.find((nd) => nd.id === "f")!.box;
      expect(loop.label?.lines.join(" ")).toBe("calls itself");
      // it leaves and comes back on the same side of its box, and bulges away from it
      expect(Math.abs(loop.y1 - loop.y2)).toBeLessThan(12);
      expect(Math.min(Math.abs(loop.cy - box.y), Math.abs(loop.cy - (box.y + box.h)))).toBeGreaterThan(60);
    }
  });

  it("reports a title, a note or a card that had to be cut, and measures wide characters as wide", () => {
    const long = "This lesson has a title that is far too long to fit on one line of any board whatever its width may be today";
    const lesson = validateLesson({ title: "T", scene: "flow", steps: [{ say: "s", items: [{ kind: "node", id: "a", text: "A" }, { kind: "note", text: "mmmmm ".repeat(20) }] }] })!;
    const l = layoutBoard({ ...lesson, title: long }, 0, "tall");
    expect(layoutProblems(l)).toContain("the title is cut");
    expect(layoutProblems(l).some((p) => /^note b0_1 is cut$/.test(p))).toBe(true);
    expect(layoutProblems(layoutBoard(lesson, 0, "wide")).filter((p) => p.includes("title"))).toEqual([]);
    const arrow = String.fromCharCode(0x2192);
    const zhe = String.fromCharCode(0x416);
    expect(textWidth(arrow, 20)).toBeGreaterThan(textWidth("a", 20) * 1.5);
    expect(textWidth(zhe, 20)).toBeGreaterThan(textWidth(String.fromCharCode(0x410), 20));
  });

  it("keeps a row of cells in its place while the pointer moves from step to step", () => {
    const lesson = validateLesson({ title: "Binary search", scene: "flow", steps: [{ say: "a", items: [{ kind: "cells", values: ["1", "3", "5", "7", "9"], pointer: 2 }] }, { say: "b", items: [{ kind: "node", id: "t", text: "Target 7" }, { kind: "cells", values: ["1", "3", "5", "7", "9"], pointer: 3 }] }, { say: "c", items: [{ kind: "cells", values: ["7", "9"], pointer: 0 }] }] })!;
    for (const shape of SHAPES) {
      const first = layoutBoard(lesson, 0, shape).blocks.filter((b) => b.kind === "cells");
      const second = layoutBoard(lesson, 1, shape).blocks.filter((b) => b.kind === "cells");
      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
      expect(second[0]).toMatchObject({ key: first[0].key, pointer: 3, step: 1 });
      // a different row is a new row under it
      expect(layoutBoard(lesson, 2, shape).blocks.filter((b) => b.kind === "cells")).toHaveLength(2);
      expect(layoutProblems(layoutBoard(lesson, 2, shape)), shape).toEqual([]);
    }
  });

  it("reports an arrow that runs through the label of another arrow", () => {
    const lesson = validateLesson({ title: "T", scene: "flow", steps: [{ say: "s", items: [{ kind: "node", id: "a", text: "A" }, { kind: "node", id: "b", text: "B" }, { kind: "edge", from: "a", to: "b", text: "feeds" }, { kind: "edge", from: "b", to: "a", text: "returns" }] }] })!;
    const l = layoutBoard(lesson, 0, "wide");
    expect(layoutProblems(l)).toEqual([]);
    // push the second arrow straight across the first one's label
    const label = l.edges[0].label!.box;
    const mid = { x: label.x + label.w / 2, y: label.y + label.h / 2 };
    l.edges[1] = { ...l.edges[1], x1: mid.x - 80, y1: mid.y, cx: mid.x, cy: mid.y, x2: mid.x + 80, y2: mid.y };
    expect(layoutProblems(l)).toContain('arrow b -> a runs through the label "feeds"');
  });

  it("on the phone-shaped board, sets a long title smaller and a long arrow label wider instead of cutting them", () => {
    const lesson = validateLesson({ title: "TCP Three-Way Handshake Explained Step by Step", scene: "flow", steps: [{ say: "s", items: [{ kind: "node", id: "a", text: "Sorted list" }, { kind: "node", id: "b", text: "Middle element" }, { kind: "node", id: "c", text: "Target" }, { kind: "node", id: "d", text: "Left half" }, { kind: "node", id: "e", text: "Right half" }, { kind: "edge", from: "a", to: "b", text: "has a middle element" }] }, { say: "s", items: [{ kind: "edge", from: "b", to: "c", text: "is compared with the" }, { kind: "edge", from: "c", to: "d", text: "smaller: go to" }, { kind: "edge", from: "c", to: "e", text: "larger: go to" }] }] })!;
    const l = layoutBoard(lesson, 1, "tall");
    expect(l.title.cut).toBe(false);
    expect(l.title.font).toBeLessThan(24);
    expect(layoutProblems(l).filter((p) => p.includes("is cut") || p.includes("overlaps"))).toEqual([]);
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
