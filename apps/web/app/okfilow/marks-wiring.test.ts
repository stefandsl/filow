// The overlay's pen marks: the CSS and the page say the same as the pure timing and placement helpers.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MARK_EXIT, MARK_EXIT_MS } from "@/lib/buddy/motion";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const read = (p: string) => fs.readFileSync(path.join(here, p), "utf8").replace(/\r\n/g, "\n");
const css = read("okfilow.css");
const overlay = read("overlay/page.tsx");
const layer = read("../../components/okfilow/marks-layer.tsx");
const rule = (sel: string) => {
  const at = css.indexOf("\n" + sel + " {");
  expect(at, sel).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at));
};
const sec = (n: number) => `${+(n / 1000).toFixed(3)}s`;

describe("the overlay's marks", () => {
  it("keep one drawing layer mounted: never keyed per answer, never only when there are marks", () => {
    expect(overlay).toContain("<MarksLayer sets={markSets} avoid={labelAvoid} />");
    expect(overlay).not.toMatch(/marks\.list\.length > 0 && \(/);
    expect(overlay).not.toContain("key={marks.id}");
    expect(overlay).not.toContain("foreignObject");
    expect(layer).toMatch(/<svg className="okf-draw okf-marks"/);
  });

  it("go away with an exit: the page keeps them for MARK_EXIT_MS, the CSS takes that long", () => {
    expect(overlay).toContain("setTimeout(() => { leaveTimer.current = null; setLeaving(null); }, MARK_EXIT_MS + 60)");
    // Clear and an empty drawing both start the exit
    expect(overlay).toMatch(/b\.onClear\(\(\) => \{\s*setCards\(\[\]\);\s*leave\(\);/);
    expect(overlay).toContain("if (!next.length) leave();");
    // each mark fades as one piece: the group fades, its parts are held whole (no erase, no stub)
    expect(rule(".okf-marks g.okf-mark--leaving, .okf-marks-over .okf-mark--leaving")).toContain(`okf-fade-out ${sec(MARK_EXIT.fadeMs)}`);
    expect(rule(".okf-mark--leaving :is(.okf-mark-ink, .okf-mark-halo, .okf-mark-leader line)")).toContain("animation: none; stroke-dashoffset: 0;");
    expect(rule(".okf-mark--leaving :is(.okf-mark-head, .okf-mark-leader circle, .okf-mark-label)")).toContain("animation: none; opacity: 1;");
    expect(MARK_EXIT_MS).toBe(MARK_EXIT.fadeMs);
  });

  it("draw with one stroke style: a dark under-stroke, no filter", () => {
    expect(rule(".okf-mark .okf-mark-halo")).toContain("stroke: rgba(0, 0, 0, 0.35)");
    expect(rule(".okf-mark .okf-mark-ink")).toContain("stroke-width: 4.5");
    const section = css.slice(css.indexOf("/* One stroke style"), css.indexOf("/* The user's highlighter"));
    expect(section).not.toMatch(/filter:/);
    // the pen's time, start and ease come from the page
    expect(rule(".okf-mark .okf-mark-ink, .okf-mark .okf-mark-halo")).toContain("animation: okf-stroke var(--okf-s, 0.5s) var(--okf-ease, ease-out) var(--okf-d, 0s) forwards");
    expect(layer).toContain('"--okf-ease": PEN_EASE_CSS');
  });

  it("set labels at 15 px semibold, the size the placement measures", () => {
    const label = rule(".okf-mark-label");
    expect(label).toContain("font: 600 15px/20px system-ui, sans-serif");
    expect(label).toContain("height: 30px");
    expect(label).toContain("padding: 5px 11px");
    expect(label).toContain("0 0 0 1px rgba(8, 9, 11, 0.55)");
    expect(layer).toContain('const LABEL_FONT = "600 15px system-ui, sans-serif";');
    expect(layer).toContain("const LABEL_PAD_X = 11;");
    expect(layer).toContain("const LABEL_HEIGHT = 30;");
  });

  it("are shown whole under reduced motion (globals.css stops every animation there)", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce) {\n  /* No pen and no animation"));
    const block = reduced.slice(0, reduced.indexOf("\n}\n"));
    expect(block).toContain(".okf-mark .okf-mark-ink, .okf-mark .okf-mark-halo, .okf-mark .okf-mark-leader line { stroke-dashoffset: 0; }");
    expect(block).toContain(".okf-mark .okf-mark-head, .okf-mark .okf-mark-leader circle, .okf-mark .okf-mark-label { opacity: 1; }");
    expect(block).toContain(".okf-pen, .okf-mark--leaving { display: none; }");
    expect(block).toContain(".okf-cards .okf-card { opacity: 1; }");
  });

  it("hold still while paused, but still go away", () => {
    expect(css).toMatch(/\.okf-paused \.okf-mark path, [^{]*\.okf-paused \.okf-pen, [^{]*\{ animation-play-state: paused; \}/);
    expect(css).toContain(".okf-paused .okf-mark--leaving { animation-play-state: running; }");
  });
});
