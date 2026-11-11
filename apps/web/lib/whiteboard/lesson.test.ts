import { describe, expect, it } from "vitest";
import { LIMITS, cleanTex, cleanText, lessonContextText, lessonMarkdown, makeStep, newContext, parseJsonLoose, validateItems, validateLesson, validateOutline } from "./lesson";
import { checkArithmetic, evalExpr, parseExpr, sampleCurve } from "./plot";

describe("whiteboard lesson: what the model writes is data", () => {
  it("keeps the kinds it knows and drops the rest", () => {
    const ctx = newContext();
    const items = validateItems(
      [
        { kind: "node", id: "sun", text: "Light" },
        { kind: "node", id: "leaf", text: "Leaf" },
        { kind: "edge", from: "sun", to: "leaf", text: "energy" },
        { kind: "script", text: "alert(1)" },
        { kind: "html", text: "<b>x</b>" },
        "not an object",
        null,
      ],
      ctx,
    );
    expect(items.map((i) => i.kind)).toEqual(["node", "node", "edge"]);
    expect([...ctx.nodes.keys()]).toEqual(["sun", "leaf"]);
  });

  it("repairs an edge that names nodes by label, or names a node never drawn", () => {
    const ctx = newContext();
    validateItems([{ kind: "node", id: "a", text: "Client" }], ctx);
    const items = validateItems([{ kind: "edge", from: "Client", to: "server_host", text: "SYN" }], ctx);
    expect(items).toEqual([
      { kind: "node", id: "server_host", text: "server host" },
      { kind: "edge", from: "a", to: "server_host", text: "SYN" },
    ]);
  });

  it("drops an edge to itself, a mark on nothing, and a second copy of the same edge", () => {
    const ctx = newContext();
    const items = validateItems(
      [
        { kind: "node", id: "a", text: "A" },
        { kind: "node", id: "b", text: "B" },
        { kind: "edge", from: "a", to: "a" },
        { kind: "edge", from: "a", to: "b", text: "x" },
        { kind: "edge", from: "a", to: "b", text: "x" },
        { kind: "mark", target: "ghost" },
        { kind: "mark", target: "b", style: "explode" },
      ],
      ctx,
    );
    expect(items.filter((i) => i.kind === "edge")).toHaveLength(1);
    expect(items.filter((i) => i.kind === "mark")).toEqual([{ kind: "mark", target: "b", style: "circle" }]);
  });

  it("does not draw again an arrow an earlier step already drew", () => {
    const ctx = newContext();
    validateItems([{ kind: "node", id: "sun", text: "Sun" }, { kind: "node", id: "leaf", text: "Leaf" }, { kind: "edge", from: "sun", to: "leaf" }], ctx);
    const later = validateItems([{ kind: "edge", from: "sun", to: "leaf" }, { kind: "edge", from: "Sun", to: "Leaf", text: "Energy" }, { kind: "edge", from: "sun", to: "leaf", text: "energy" }, { kind: "edge", from: "leaf", to: "sun" }], ctx);
    expect(later).toEqual([{ kind: "edge", from: "sun", to: "leaf", text: "Energy" }, { kind: "edge", from: "leaf", to: "sun", text: "" }]);
  });
  it("circles what a step points at when the model only redrew things already on the board", () => {
    const ctx = newContext();
    validateItems([{ kind: "node", id: "client", text: "Client" }, { kind: "node", id: "server", text: "Server" }, { kind: "edge", from: "client", to: "server" }], ctx);
    expect(validateItems([{ kind: "node", id: "client", text: "Client" }, { kind: "node", id: "server", text: "Server" }, { kind: "edge", from: "client", to: "server" }], ctx)).toEqual([{ kind: "mark", target: "server", style: "circle" }]);
    // a label on an arrow that had none is new
    expect(validateItems([{ kind: "edge", from: "client", to: "server", text: "SYN" }], ctx)).toEqual([{ kind: "edge", from: "client", to: "server", text: "SYN" }]);
    expect(validateItems([{ kind: "nonsense" }], ctx)).toEqual([]);
  });

  it("writes a formula, a plot or a note once, however often the model repeats it", () => {
    const ctx = newContext();
    const items = [{ kind: "formula", tex: "V = I R" }, { kind: "note", text: "R is fixed" }, { kind: "plot", expr: "2x" }];
    expect(validateItems(items, ctx)).toHaveLength(3);
    expect(validateItems([{ kind: "formula", tex: "V=IR" }, { kind: "note", text: "r is FIXED" }, { kind: "plot", expr: "2 x" }, { kind: "formula", tex: "I = V / R" }], ctx)).toEqual([{ kind: "formula", tex: "I = V / R" }]);
  });
  it("keeps an inequality in a sentence and strips only real tags", () => {
    expect(cleanText("If target < mid go left, if target > mid go right", 80)).toBe("If target < mid go left, if target > mid go right");
    expect(cleanText("a <b>bold</b> <!-- x --> move", 80)).toBe("a bold move");
  });

  it("does not repeat a mark, does not label a box from an object, and refuses a plot with no values", () => {
    const ctx = newContext();
    validateItems([{ kind: "node", id: "a", text: "A" }, { kind: "mark", target: "a" }], ctx);
    expect(validateItems([{ kind: "mark", target: "a" }], ctx)).toEqual([]);
    expect(validateItems([{ kind: "node", id: "a", text: "A" }], ctx)).toEqual([]);
    expect(validateItems([{ kind: "edge", from: { a: 1 }, to: "a" }, { kind: "node", id: { x: 1 } }], ctx)).toEqual([]);
    expect(validateItems([{ kind: "plot", expr: "sqrt(0 - x^2 - 1)" }, { kind: "plot", expr: "1/0" }], ctx)).toEqual([]);
  });

  it("keeps an arrow from a box to itself only when it has a label", () => {
    const ctx = newContext();
    expect(validateItems([{ kind: "node", id: "f", text: "Function" }, { kind: "edge", from: "f", to: "f" }, { kind: "edge", from: "f", to: "f", text: "calls itself" }], ctx)).toEqual([{ kind: "node", id: "f", text: "Function" }, { kind: "edge", from: "f", to: "f", text: "calls itself" }]);
  });

  it("treats a formula written with a times sign, spaces or a full stop as the same formula", () => {
    const ctx = newContext();
    expect(validateItems([{ kind: "formula", tex: "A = P(1 + r)^t" }], ctx)).toHaveLength(1);
    expect(validateItems([{ kind: "formula", tex: "A = P \\times (1+r)^t." }, { kind: "formula", tex: "A = P \\cdot \\left(1 + r\\right)^t" }], ctx)).toEqual([]);
  });

  it("gives a follow-up room for three more boxes on a full board, and no more", () => {
    const full = validateLesson({ title: "T", scene: "flow", steps: [{ say: "a", items: Array.from({ length: 5 }, (_, i) => ({ kind: "node", id: `a${i}`, text: `A${i}` })) }, { say: "b", items: Array.from({ length: 5 }, (_, i) => ({ kind: "node", id: `b${i}`, text: `B${i}` })) }] })!;
    const more = validateLesson({ title: "T", scene: "flow", steps: [{ say: "c", items: Array.from({ length: 6 }, (_, i) => ({ kind: "node", id: `c${i}`, text: `C${i}` })) }] }, { continues: full })!;
    expect(more.steps[0].items).toHaveLength(3);
    // a lesson written whole holds fourteen boxes and ten items a step: a box that is cut takes its arrows with it
    const alone = validateLesson({ title: "T", scene: "flow", steps: [{ say: "a", items: Array.from({ length: 12 }, (_, i) => ({ kind: "node", id: `a${i}`, text: `A${i}` })) }, { say: "b", items: Array.from({ length: 6 }, (_, i) => ({ kind: "node", id: `b${i}`, text: `B${i}` })) }] })!;
    expect(alone.steps.map((s) => s.items.length)).toEqual([LIMITS.lessonItemsPerStep, LIMITS.lessonNodes - LIMITS.lessonItemsPerStep]);
    expect([LIMITS.lessonItemsPerStep, LIMITS.lessonNodes]).toEqual([10, 14]);
  });

  it("accepts a row of cells with a pointer, cleans it, and does not repeat the same row", () => {
    const ctx = newContext();
    expect(validateItems([{ kind: "cells", values: [1, 3, "5", "<b>7</b>", "", "3 * Factorial(2) = 3 * 2"], pointer: 2 }], ctx)).toEqual([{ kind: "cells", values: ["1", "3", "5", "7", "3 * Factorial(2) = 3 * 2"], pointer: 2 }]);
    // a line of a worked example is kept whole (it used to be cut at 6 characters: "Facto...", "I = 2...")
    expect(LIMITS.cell).toBeGreaterThanOrEqual(40);
    // a row narrowed to one value (the target of a search) is still a row; no value at all is not
    expect(validateItems([{ kind: "cells", values: ["1", "3"], pointer: 9 }, { kind: "cells", values: ["1"], pointer: 0 }, { kind: "cells", values: "x" }, { kind: "cells", values: [] }], ctx)).toEqual([{ kind: "cells", values: ["1", "3"], pointer: -1 }, { kind: "cells", values: ["1"], pointer: 0 }]);
    expect(validateItems([{ kind: "cells", values: ["1", "3"], pointer: -1 }, { kind: "cells", values: ["1", "3"], pointer: 1 }], ctx)).toEqual([{ kind: "cells", values: ["1", "3"], pointer: 1 }]);
    const md = lessonMarkdown({ title: "T", scene: "flow", steps: [{ say: "s", card: false, items: [{ kind: "cells", values: ["1", "3", "5"], pointer: 1 }] }] });
    expect(md).toContain("- 1 | **3** | 5");
  });

  it("caps the items of a step and the nodes of a lesson", () => {
    const ctx = newContext();
    const many = Array.from({ length: 30 }, (_, i) => ({ kind: "node", id: `n${i}`, text: `Node ${i}` }));
    expect(validateItems(many, ctx)).toHaveLength(LIMITS.itemsPerStep);
    validateItems(many.slice(6), ctx);
    validateItems(many.slice(12), ctx);
    expect(ctx.nodes.size).toBe(LIMITS.nodes);
  });

  it("turns text into plain text: no tags, no control or direction characters, cut to length", () => {
    expect(cleanText('<img src=x onerror="alert(1)">Leaf<script>x</script>', 40)).toBe("Leaf x");
    expect(cleanText("a\u202eb\u0000c\nd", 40)).toBe("a b c d");
    expect(Array.from(cleanText("x".repeat(500), 36))).toHaveLength(36);
    expect(cleanText({ toString: () => "boom" }, 10)).toBe("");
  });

  it("refuses LaTeX that could do more than draw a formula", () => {
    for (const tex of ["\\href{javascript:alert(1)}{x}", "\\url{http://evil}", "\\def\\a{\\a\\a}\\a", "\\htmlClass{x}{y}", "\\includegraphics{file:///c:/x}", "\\newcommand{\\x}{y}", "x}{", ""]) {
      expect(cleanTex(tex), tex).toBe("");
    }
    expect(cleanTex("$$E = mc^2$$")).toBe("E = mc^2");
    expect(cleanTex("\\frac{a}{b")).toBe("\\frac{a}{b}");
    expect(cleanTex("x".repeat(LIMITS.tex + 1))).toBe("");
    expect(cleanTex("a^2 + b^2 = c^2", () => false)).toBe("");
    // a phrase is not a formula
    for (const tex of ["gradient descent", "gradient = gradient descent", "\\text{Supply meets demand}", "photosynthesis", "0", "x", "c^"]) expect(cleanTex(tex), tex).toBe("");
    for (const tex of ["V = I \\times R", "A = P \\times (1 + \\text{rate})^{\\text{time}}", "\\frac{\\partial L}{\\partial w}", "\\log_2 n", "5! = 120", "\\sum_k V_k = 0"]) expect(cleanTex(tex), tex).toBe(tex);
  });

  it("accepts a plot only when its expression parses", () => {
    const ctx = newContext();
    const items = validateItems(
      [
        { kind: "plot", expr: "y = x^2 - 3", xmin: -3, xmax: 3 },
        { kind: "plot", expr: "alert(1)" },
        { kind: "plot", expr: "constructor.constructor('x')()" },
        { kind: "plot", expr: "2x + 1", xmin: 5, xmax: -5 },
      ],
      ctx,
    );
    expect(items).toEqual([
      { kind: "plot", expr: "x^2 - 3", xmin: -3, xmax: 3, text: "" },
      { kind: "plot", expr: "2x + 1", xmin: -5, xmax: 5, text: "" },
    ]);
  });

  it("takes free shapes only on the path that allows them", () => {
    const sketch = { kind: "sketch", title: "Sun", shapes: [{ type: "circle", cx: 200, cy: 150, r: 60 }] };
    expect(validateItems([sketch], newContext())).toEqual([]);
    expect(validateItems([sketch], newContext({ sketch: true }))[0]).toMatchObject({ kind: "sketch", drawing: { title: "Sun" } });
  });

  it("a step with no usable item becomes a text card", () => {
    expect(makeStep("Plants make sugar.", { items: [{ kind: "nonsense" }] }, newContext())).toEqual({ say: "Plants make sugar.", items: [], card: true });
    expect(makeStep("Plants make sugar.", "garbage", newContext()).card).toBe(true);
  });

  it("reads an outline and caps its steps", () => {
    const o = validateOutline({ title: " Photosynthesis ", scene: "timeline", steps: [{ say: "One." }, "Two.", { say: "" }, { say: "Three." }, { say: "Four." }] }, 3);
    expect(o).toEqual({ title: "Photosynthesis", scene: "stack", kind: "process", says: ["One.", "Two.", "Three."] });
    expect(validateOutline({ title: "P", kind: "proof", steps: ["a"] })?.kind).toBe("proof");
    expect(validateOutline({ title: "P", kind: "sermon", steps: ["a"] })?.kind).toBe("process");
    expect(validateOutline({ title: "x", steps: [] })).toBeNull();
    expect(validateOutline("nope")).toBeNull();
  });

  it("validates a whole lesson and keeps node ids across steps", () => {
    const lesson = validateLesson({
      title: "Photosynthesis",
      scene: "flow",
      steps: [
        { say: "A leaf takes in light.", items: [{ kind: "node", id: "sun", text: "Light" }, { kind: "node", id: "leaf", text: "Leaf" }] },
        { say: "It makes sugar.", items: [{ kind: "node", id: "sugar", text: "Glucose" }, { kind: "edge", from: "leaf", to: "sugar" }, { kind: "mark", target: "leaf", style: "underline" }] },
        { say: "", items: [] },
        { say: "", items: [{ kind: "node", id: "ghost", text: "Never said" }] },
        { say: "Only words here.", items: [] },
      ],
    });
    expect(lesson?.steps).toHaveLength(3);
    expect(lesson?.steps[1].items).toHaveLength(3);
    expect(lesson?.steps[2]).toEqual({ say: "Only words here.", items: [], card: true });
    expect(validateLesson({ steps: [] })).toBeNull();
    expect(validateLesson(null)).toBeNull();
  });
});

describe("whiteboard lesson: broken JSON from a model", () => {
  it("reads JSON inside a fence or between words", () => {
    expect(parseJsonLoose('Sure!\n```json\n{"items":[{"kind":"note","text":"hi"}]}\n```\nDone.')).toEqual({ items: [{ kind: "note", text: "hi" }] });
    expect(parseJsonLoose('{"a":[1,2,],}')).toEqual({ a: [1, 2] });
    // words before the JSON with a brace of their own
    expect(parseJsonLoose('For the set {a, b} the plan is {"items":[{"kind":"note","text":"hi"}]}')).toEqual({ items: [{ kind: "note", text: "hi" }] });
  });
  it("closes an answer that was cut off, keeping the complete items", () => {
    // half a label is not what the model meant: with nothing complete before it, there is no answer
    expect(parseJsonLoose('{"items":[{"kind":"node","id":"a","text":"Li')).toBeUndefined();
    expect(parseJsonLoose('{"items":[{"kind":"node","id":"a","text":"Leaf"},{"kind":"formula","tex":"a^2 + b^2 = ')).toEqual({ items: [{ kind: "node", id: "a", text: "Leaf" }] });
    expect(parseJsonLoose('{"items":[{"kind":"node","id":"a"},{"kind":"edge","fr')).toEqual({ items: [{ kind: "node", id: "a" }] });
    expect(parseJsonLoose('{"items":[{"kind":"node","id":"a"},')).toEqual({ items: [{ kind: "node", id: "a" }] });
  });
  it("gives up on text that is not JSON", () => {
    expect(parseJsonLoose("I cannot help with that.")).toBeUndefined();
    expect(parseJsonLoose('{"a":]')).toBeUndefined();
    expect(parseJsonLoose(42)).toBeUndefined();
    expect(parseJsonLoose('{"a":"}')).toBeUndefined();
  });
});

describe("whiteboard lesson: export and follow-up context", () => {
  const lesson = validateLesson({
    title: "Ohm's law",
    scene: "flow",
    steps: [
      { say: "Voltage pushes current through a resistance.", items: [{ kind: "node", id: "v", text: "Voltage" }, { kind: "node", id: "i", text: "Current" }, { kind: "edge", from: "v", to: "i", text: "pushes" }] },
      { say: "The three are tied by one formula.", items: [{ kind: "formula", tex: "V = I R" }, { kind: "plot", expr: "2x", xmin: 0, xmax: 5 }, { kind: "note", text: "R is *constant* here" }] },
    ],
  })!;
  it("writes the steps as Markdown with node names, not ids", () => {
    const md = lessonMarkdown(lesson);
    expect(md).toContain("# Ohm's law");
    expect(md).toContain("## Step 2");
    expect(md).toContain("- Voltage -> Current: pushes");
    expect(md).toContain("- `V = I R`");
    expect(md).toContain("- y = `2x` (x 0 .. 5)");
    expect(md).toContain("R is \\*constant\\* here");
  });
  it("writes nothing that a Markdown viewer would turn into a link, an image or HTML", () => {
    const hostile = validateLesson({ title: "See [here](https://evil.example)", scene: "flow", steps: [{ say: "Visit https://evil.example now ![x](http://e/x.png)", items: [{ kind: "formula", tex: "x = \\text{[click](https://evil.example)}" }, { kind: "note", text: "a < b and [link](javascript:alert(1))" }] }] })!;
    const md = lessonMarkdown(hostile);
    // a formula sits in a code span, where it is only text; everything outside one is escaped
    expect(md).toContain("- `x = \\text{[click](https://evil.example)}`");
    const outside = md.replace(/`[^`]*`/g, "");
    expect(outside).not.toMatch(/(^|[^\\])\]\(/);
    expect(outside).not.toMatch(/https?:\/\//);
    expect(outside).not.toMatch(/(^|[^\\])!\[/);
    expect(outside).not.toMatch(/(^|[^\\])</);
  });

  it("keeps the follow-up context under its size limit", () => {
    const long = { ...lesson, steps: Array.from({ length: 40 }, () => ({ say: "x".repeat(250), items: [], card: true })) };
    expect(new TextEncoder().encode(lessonContextText(long)).length).toBeLessThanOrEqual(LIMITS.contextBytes);
    expect(lessonContextText(lesson)).toContain("v = Voltage; i = Current");
  });
});

describe("whiteboard plot: an expression is parsed, never run", () => {
  const at = (src: string, x: number) => evalExpr(parseExpr(src)!, x);
  it("computes the usual forms", () => {
    expect(at("x^2 - 3", 2)).toBe(1);
    expect(at("-x^2", 3)).toBe(-9);
    expect(at("2x + 1", 4)).toBe(9);
    expect(at("3(x + 1)", 1)).toBe(6);
    expect(at("2^-1", 0)).toBe(0.5);
    expect(at("f(x) = 1000 * (1 + 0.05)^x", 2)).toBeCloseTo(1102.5);
    expect(at("sin(pi / 2) + sqrt(16) + abs(-2) + ln(e)", 0)).toBeCloseTo(8);
    expect(at("y = 2\u00b7x \u2212 1", 3)).toBe(5);
  });
  it("refuses everything else", () => {
    for (const src of ["", "alert(1)", "x.constructor", "window", "x; x", "x = 2", "(x", "x)", "sin x", "2 +", "x".repeat(90), "this", "[1]", "`x`", "x => x", "eval(x)", "1e9999x"]) {
      expect(parseExpr(src), src).toBeNull();
    }
  });
  it("finds the sums in a sentence that do not come out, by computing them", () => {
    expect(checkArithmetic("The middle is (0+1)/2 = 0, so we look at index 0.")).toEqual(["(0+1)/2 = 0"]);
    expect(checkArithmetic("fact(2) returns 2*3 = 5 and 3 + 4 = 7.")).toEqual(["2*3 = 5"]);
    expect(checkArithmetic("Row 12 = 3 values, and 7 = 7.")).toEqual([]);
    for (const fine of ["100 * 1.05^2 = 110.25", "10 / 3 = 3.33", "2 " + String.fromCharCode(0xd7) + " 3 = 6", "(0+4)/2 = 2", "x = 5", "V = I R", "In 2024 = the year", "a^2 + b^2 = c^2"]) expect(checkArithmetic(fine), fine).toEqual([]);
  });

  it("samples a curve and lifts the pen at a pole", () => {
    const parabola = sampleCurve(parseExpr("x^2")!, -2, 2)!;
    expect(parabola.runs).toHaveLength(1);
    expect(parabola.ymin).toBeLessThan(0.01);
    expect(parabola.ymax).toBeGreaterThan(3.9);
    const pole = sampleCurve(parseExpr("1/x")!, -2, 2)!;
    expect(pole.runs.length).toBeGreaterThanOrEqual(2);
    expect(sampleCurve(parseExpr("sqrt(-1 - x^2)")!, -2, 2)).toBeNull();
    expect(sampleCurve(parseExpr("3")!, 0, 1)!.ymax).toBeGreaterThan(3);
  });
});
