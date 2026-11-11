import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Board, BOARD_PALETTES } from "./Board";
import { layoutBoard } from "@/lib/whiteboard/layout";
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
    expect(svg).toContain(">y = 2x</text>");
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

  it("uses the palette it is given for both themes", () => {
    expect(render(lesson, 0)).toContain(BOARD_PALETTES.light.board);
    expect(render(lesson, 0, { palette: BOARD_PALETTES.dark })).toContain(BOARD_PALETTES.dark.board);
  });
});
