import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Board, BOARD_PALETTES } from "./Board";
import { layoutBoard } from "@/lib/whiteboard/layout";
import { stepSchedule } from "@/lib/whiteboard/pace";
import { validateLesson, type Lesson } from "@/lib/whiteboard/lesson";

const render = (lesson: Lesson, upto: number, extra: Partial<Parameters<typeof Board>[0]> = {}) =>
  renderToStaticMarkup(<Board layout={layoutBoard(lesson, upto, "wide")} current={upto} palette={BOARD_PALETTES.light} sketchy label="Whiteboard: test" {...extra} />);

const lesson = validateLesson({
  title: "Ohm's law",
  scene: "flow",
  steps: [
    { say: "s1", items: [{ kind: "node", id: "v", text: "Voltage" }, { kind: "node", id: "i", text: "Current" }, { kind: "edge", from: "v", to: "i", text: "pushes" }] },
    { say: "s2", items: [{ kind: "formula", tex: "V = I R" }, { kind: "plot", expr: "2x", xmin: 0, xmax: 5 }, { kind: "mark", target: "v", style: "circle" }, { kind: "note", text: "R stays the same" }] },
  ],
})!;

describe("whiteboard board", () => {
  it("draws boxes, an arrow with its label, a plot and a note as SVG", () => {
    const svg = render(lesson, 1);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain(">Voltage</text>");
    expect(svg).toContain(">pushes</text>");
    expect(svg).toContain('data-edge="v&gt;i"');
    expect(svg).toContain(">y = 2x</tspan>");
    expect(svg).toContain(">R stays the same</text>");
    expect(svg).toContain('data-block="plot"');
    expect(svg.match(/data-node=/g)).toHaveLength(2);
  });

  it("puts whatever text it is given into the page as text, never as markup", () => {
    // straight to the renderer, past the validator: the board must be safe on its own
    const hostile: Lesson = {
      title: '<script>alert(1)</script>',
      scene: "flow",
      steps: [{ say: "s", card: false, items: [{ kind: "node", id: "a", text: '<img src=x onerror=alert(1)>' }, { kind: "node", id: "b", text: '" onload="alert(1)' }, { kind: "edge", from: "a", to: "b", text: "</text><script>" }, { kind: "note", text: "<svg onload=alert(1)>" }, { kind: "formula", tex: '"><script>alert(1)</script>' }] }],
    };
    const svg = render(hostile, 0);
    expect(svg).not.toMatch(/<script|<img|<svg onload/i);
    expect(svg).toContain("&lt;img");
    expect(svg).not.toMatch(/\sonload="alert/);
    expect(svg).not.toMatch(/\sonerror=/);
  });

  it("leaves the formula to KaTeX in the browser: no formula text is written as HTML on the server", () => {
    const svg = render(lesson, 1);
    const fo = /<foreignObject[^>]*>(.*?)<\/foreignObject>/.exec(svg)![1];
    expect(fo).toMatch(/^<div[^>]*role="math"[^>]*aria-label="V = I R"[^>]*><\/div>$/);
  });

  it("marks only the items of the current step as new, so only they draw on", () => {
    const svg = render(lesson, 1);
    const nodeClasses = [...svg.matchAll(/<g class="([^"]*)"[^>]*data-node=/g)].map((m) => m[1]);
    expect(nodeClasses.every((c) => !c.includes("wb-new"))).toBe(true);
    expect(svg).toMatch(/class="wb-new" data-block="plot"/);
    const first = render(lesson, 0);
    expect([...first.matchAll(/<g class="([^"]*)"[^>]*data-node=/g)].every((m) => m[1].includes("wb-new"))).toBe(true);
  });

  it("draws the same strokes every time, hand-drawn or plain", () => {
    expect(render(lesson, 1)).toBe(render(lesson, 1));
    const plain = render(lesson, 1, { sketchy: false });
    expect(plain).not.toBe(render(lesson, 1));
    // a plain box is four straight sides: no curve commands in its outline
    const box = /data-node="v".*?<path[^>]*d="([^"]+)"/.exec(plain)![1];
    expect(box).not.toMatch(/[CQ]/i);
  });

  it("makes each box a button with a name only when a click does something", () => {
    const quiet = render(lesson, 0);
    expect(quiet).not.toContain('role="button"');
    const live = render(lesson, 0, { onPick: () => {}, pickLabel: (name) => `Explain ${name} again` });
    expect(live.match(/role="button"/g)).toHaveLength(2);
    expect(live).toContain('aria-label="Explain Voltage again"');
    expect(live).toContain('tabindex="0"');
  });

  it("names a box with exactly the words written in it, however they are broken into lines", () => {
    const long = validateLesson({ title: "T", scene: "flow", steps: [{ say: "s", items: [{ kind: "node", id: "a", text: "Mitochondrial electron transport" }, { kind: "node", id: "b", text: "Carbon dioxide" }, { kind: "node", id: "c", text: "C" }, { kind: "node", id: "d", text: "D" }, { kind: "note", text: "a note makes the boxes narrower" }] }] })!;
    const svg = render(long, 0, { onPick: () => {}, pickLabel: (name) => `Explain ${name} again` });
    for (const id of ["a", "b"]) {
      const m = new RegExp(`<g[^>]*data-node="${id}"[^>]*aria-label="Explain ([^"]+) again"[^>]*>(.*?)</g>`).exec(svg)!;
      const words = [...m[2].matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((x) => x[1]);
      if (id === "a") expect(words.length, id).toBeGreaterThan(1);
      expect(words.join(""), id).toBe(m[1]);
      expect(m[1], id).toBe(id === "a" ? "Mitochondrial electron transport" : "Carbon dioxide");
    }
    expect(svg).toContain('aria-label="Explain Carbon dioxide again"');
  });
  it("shows a free sketch as a picture built from validated shapes", () => {
    const withSketch = validateLesson({ title: "T", scene: "flow", steps: [{ say: "s", items: [{ kind: "sketch", title: "Sun", shapes: [{ type: "circle", cx: 200, cy: 150, r: 60, fill: "#ffcc33" }] }] }] }, { sketch: true })!;
    const svg = render(withSketch, 0);
    expect(svg).toMatch(/<image href="data:image\/svg\+xml;utf8,%3Csvg/);
    expect(svg).not.toContain("<circle");
  });

  it("draws a sketch whose label was cut in the middle of an emoji instead of failing", () => {
    const emoji = String.fromCodePoint(0x1f600);
    const cut = validateLesson({ title: "T", scene: "flow", steps: [{ say: "s", items: [{ kind: "sketch", title: "S", shapes: [{ type: "text", x: 10, y: 10, text: "a".repeat(59) + emoji }] }] }] }, { sketch: true })!;
    expect(() => render(cut, 0)).not.toThrow();
    expect(render(cut, 0)).toContain("<image href=");
  });

  it("writes the names of a plot's axes at the axes", () => {
    const named = validateLesson({ title: "T", scene: "flow", steps: [{ say: "s", items: [{ kind: "plot", expr: "6*x", xmin: 0, xmax: 5, x: "Current (A)", y: "Voltage (V)" }] }] })!;
    const svg = render(named, 0);
    expect(svg).toContain('data-axis="x">Current (A)</text>');
    expect(svg).toContain('data-axis="y">Voltage (V)</text>');
    const bare = render(validateLesson({ title: "T", scene: "flow", steps: [{ say: "s", items: [{ kind: "plot", expr: "6*x", xmin: 0, xmax: 5 }] }] })!, 0);
    expect(bare).toContain('data-axis="x">x</text>');
    expect(bare).not.toContain('data-axis="y"');
  });
  it("marks where two curves cross inside the plot, not where they start from the same point", () => {
    const start = validateLesson({ title: "T", scene: "flow", steps: [{ say: "s", items: [{ kind: "plot", expr: "1000*1.05^x", more: ["1000+50*x"], xmin: 0, xmax: 10 }] }] })!;
    // compound and simple interest are equal at year 0 (the start, not marked) and again at year 1 (a crossing, marked)
    expect(render(start, 0)).not.toContain('data-cross="0,1000"');
    expect(render(start, 0)).toContain('data-cross="1,1050"');
    const inside = validateLesson({ title: "T", scene: "flow", steps: [{ say: "s", items: [{ kind: "plot", expr: "12 - x", more: ["x"], xmin: 0, xmax: 10 }] }] })!;
    expect(render(inside, 0)).toContain('data-cross="6,6"');
  });
  it("labels a plot of money in plain numbers, not powers of ten", () => {
    const money = validateLesson({ title: "T", scene: "flow", steps: [{ say: "s", items: [{ kind: "plot", expr: "1000 * (1 + 0.05 * x)", more: ["1000 * 1.05^x"], xmin: 0, xmax: 30 }] }] })!;
    const svg = render(money, 0);
    expect(svg).not.toMatch(/\de\+\d/);
    expect(svg).toContain("(1, 1050)");
  });
  it("gives each new thing of the step its slot of the sentence's time, and none to what is already on the board", () => {
    const two = validateLesson({ title: "T", scene: "flow", steps: [{ say: "a", items: [{ kind: "node", id: "v", text: "Voltage" }] }, { say: "b", items: [{ kind: "node", id: "i", text: "Current" }, { kind: "edge", from: "v", to: "i", text: "drives" }, { kind: "formula", tex: "V = I R" }] }] })!;
    const board = layoutBoard(two, 1, "wide");
    const timing = stepSchedule(board, 1, 4000);
    const svg = renderToStaticMarkup(<Board layout={board} current={1} palette={BOARD_PALETTES.light} sketchy label="t" timing={timing} />);
    expect(svg).toContain('class="wb-board wb-timed"');
    // the new box starts at once, the arrow after it, the formula last; the box of step 1 has no slot
    const at = (re: RegExp) => Number(re.exec(svg)?.[1] ?? NaN);
    const box = at(/--wb-at:(\d+)ms[^>]*data-node="i"/);
    const arrow = at(/--wb-at:(\d+)ms[^>]*data-edge="v&gt;i"/);
    const formula = at(/--wb-at:(\d+)ms[^>]*data-block="formula"/);
    expect(box).toBe(0);
    expect(arrow).toBeGreaterThan(box);
    expect(formula).toBeGreaterThan(arrow);
    expect(/--wb-at[^>]*data-node="v"/.test(svg)).toBe(false);
    // timed strokes carry no delay of their own: the style sheet times them from the slot
    expect(svg).not.toContain("animation-delay");
    // without a timing the board draws as before
    expect(render(two, 1)).not.toContain("--wb-at");
  });

  it("stands complete when the step is over, and draws chalk on the blackboard", () => {
    const one = validateLesson({ title: "T", scene: "flow", steps: [{ say: "a", items: [{ kind: "node", id: "v", text: "Voltage" }] }] })!;
    expect(render(one, 0, { rest: true })).toContain('class="wb-board wb-rest"');
    const chalk = render(one, 0, { palette: BOARD_PALETTES.dark });
    expect(chalk).toContain('class="wb-board wb-chalk"');
    expect(chalk).toContain(BOARD_PALETTES.dark.board);
    // chalk is a broader, rougher line than the marker's
    const width = (svg: string) => Number(/class="wb-stroke"[^>]*stroke-width="([\d.]+)"/.exec(svg)?.[1]);
    expect(width(chalk)).toBeGreaterThan(width(render(one, 0)));
  });

  it("keeps every ink readable on both boards (WCAG contrast of 4.5 for what is written, 3 for lines)", () => {
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    for (const [name, p] of Object.entries(BOARD_PALETTES)) {
      for (const ink of [p.ink, p.soft, p.accent] as const) expect(contrast(ink, p.board), `${name} ${ink} on the board`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.ink, p.fill), `${name} label in a box`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.ink, p.highlight), `${name} label on a highlight`).toBeGreaterThanOrEqual(4.5);
      for (const line of [p.mark, p.curve] as const) expect(contrast(line, p.board), `${name} line ${line}`).toBeGreaterThanOrEqual(3);
    }
    expect(BOARD_PALETTES.dark.chalk).toBe(true);
    expect(lum(BOARD_PALETTES.dark.board)).toBeLessThan(0.05);
  });
  it("writes the long values of a worked example one under the other, each in full", () => {
    const trace = validateLesson({ title: "T", scene: "flow", steps: [{ say: "s", items: [{ kind: "cells", values: ["Factorial(3)", "3 * Factorial(2)", "3 * (2 * Factorial(1))", "3 * (2 * (1 * Factorial(0)))", "3 * 2", "6"], pointer: 1 }] }] })!;
    const svg = render(trace, 0);
    expect(svg).toContain('data-block="cells" data-column="1" data-pointer="1"');
    expect(svg).toContain(">3 * (2 * Factorial(1))</text>");
    expect(svg).not.toContain(String.fromCharCode(0x2026));
  });
  it("draws a row of cells with the pointer under the value being looked at", () => {
    const cells = validateLesson({ title: "T", scene: "flow", steps: [{ say: "s", items: [{ kind: "cells", values: ["1", "3", "5", "<7>"], pointer: 2 }] }] })!;
    const svg = render(cells, 0);
    expect(svg).toContain('data-block="cells" data-pointer="2"');
    expect([...svg.matchAll(/>(1|3|5|&lt;7&gt;)<\/text>/g)]).toHaveLength(4);
    // one highlighted cell, and none when the pointer is on nothing
    expect(svg.split(BOARD_PALETTES.light.highlight).length - 1).toBe(1);
    const none = validateLesson({ title: "T", scene: "flow", steps: [{ say: "s", items: [{ kind: "cells", values: ["1", "3"], pointer: -1 }] }] })!;
    expect(render(none, 0)).not.toContain(BOARD_PALETTES.light.highlight);
  });

  it("draws several functions on one plot and marks where the first two cross", () => {
    const market = validateLesson({ title: "T", scene: "flow", steps: [{ say: "s", items: [{ kind: "plot", expr: "10 - x", more: ["2*x", "alert(1)", "10 - x"], xmin: 0, xmax: 8 }] }] })!;
    expect(market.steps[0].items[0]).toMatchObject({ kind: "plot", expr: "10 - x", more: ["2*x"] });
    const svg = render(market, 0);
    expect(svg.match(/data-curve="0"/g)).toHaveLength(1);
    expect(svg.match(/data-curve="1"/g)).toHaveLength(1);
    // 10 - x = 2x at x = 10/3
    expect(svg).toContain('data-cross="3.33,6.67"');
    expect(svg).toContain(">y = 10 - x</tspan>");
    // one function: no second curve, no mark
    expect(render(lesson, 1)).not.toContain("data-cross");
  });

  it("uses the palette it is given for both themes", () => {
    expect(render(lesson, 0)).toContain(BOARD_PALETTES.light.board);
    expect(render(lesson, 0, { palette: BOARD_PALETTES.dark })).toContain(BOARD_PALETTES.dark.board);
  });
});
