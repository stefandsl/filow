// The 3D model window's close button "sometimes does not work" (owner, 14/11, 0.9.39): the window
// took the mouse from the page's pointer events, and some orders of those events left it click-through
// while the cursor was on the button. These tests drive those orders against the old rule (the last
// event wins) to show the bug, then against the main-process rule (the real cursor over a reported
// rectangle) to show it cannot happen.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { cleanRects, insideAny, localPoint, createHitTarget, MAX_RECTS } = require("./okfilow-hit.js") as {
  cleanRects: (l: unknown) => Array<{ left: number; top: number; right: number; bottom: number }>;
  insideAny: (p: { x: number; y: number } | null, r: Array<{ left: number; top: number; right: number; bottom: number }>) => boolean;
  localPoint: (c: { x: number; y: number } | null, b: { x: number; y: number; width: number; height: number }) => { x: number; y: number } | null;
  createHitTarget: (o: { setIgnore: (v: boolean) => void }) => { rects(l: unknown): boolean; hold(on: boolean): boolean; at(p: { x: number; y: number } | null): boolean; takes(): boolean };
  MAX_RECTS: number;
};

// The model window, 600 x 500: the tools strip (drag handle, then the X) top right, one label at the left.
const TOOLS = { left: 520, top: 8, right: 592, bottom: 40 };
const GRIP = { x: 540, y: 24 };
const X = { x: 578, y: 24 };
const LABEL = { left: 20, top: 200, right: 160, bottom: 228 };
const CANVAS = { x: 300, y: 260 };

/** The old rule: each pointer event sends hover true/false and the last one to arrive decides. */
function oldWindow() {
  let ignore = true;
  return { send: (active: boolean) => { ignore = !active; }, takesClick: () => !ignore };
}

describe("model window close button: event orders", () => {
  it("the old rule loses the click: canvas -> drag handle -> X (the handle swallows the tools' enter, the canvas leave arrives last)", () => {
    const w = oldWindow();
    w.send(true); // pointer on a mesh
    // into the drag handle: app-region drag eats pointerenter of the tools; the canvas pointerleave says false
    w.send(false);
    // on to the X: no new enter is fired (the pointer never left the tools strip)
    expect(w.takesClick()).toBe(false);
  });

  it("the new rule takes the click: canvas -> drag handle -> X, whatever the page's events say", () => {
    const calls: boolean[] = [];
    const t = createHitTarget({ setIgnore: (v) => calls.push(v) });
    t.rects([TOOLS, LABEL]);
    t.at(CANVAS);
    t.hold(true); // on a mesh
    t.at(GRIP);
    t.hold(false); // the canvas leave arrives late
    expect(t.takes()).toBe(true);
    t.at(X);
    expect(t.takes()).toBe(true);
    expect(calls.at(-1)).toBe(false); // not click-through
  });

  it("label -> X: the label's leave after the tools' enter cannot make the window click-through", () => {
    const old = oldWindow();
    old.send(true); // tools enter
    old.send(false); // label leave, delivered after
    expect(old.takesClick()).toBe(false);
    const t = createHitTarget({ setIgnore: () => {} });
    t.rects([TOOLS, LABEL]);
    t.at({ x: 100, y: 214 });
    expect(t.takes()).toBe(true);
    t.hold(false);
    t.at(X);
    expect(t.takes()).toBe(true);
  });

  it("a fast enter and click: the window takes the mouse as soon as the cursor is over the X (no wait for a page event)", () => {
    const t = createHitTarget({ setIgnore: () => {} });
    t.rects([TOOLS]);
    t.at(null);
    expect(t.takes()).toBe(false);
    // the cursor jumps straight onto the X between two cursor checks: the next check (30 ms) takes the mouse
    t.at(X);
    expect(t.takes()).toBe(true);
  });

  it("outside every rectangle and off the model, clicks go through; a drag keeps the mouse", () => {
    const t = createHitTarget({ setIgnore: () => {} });
    t.rects([TOOLS, LABEL]);
    t.at(CANVAS);
    expect(t.takes()).toBe(false);
    t.hold(true);
    t.at({ x: 5, y: 490 });
    expect(t.takes()).toBe(true);
    t.hold(false);
    expect(t.takes()).toBe(false);
  });

  it("tells the window only when its state changes", () => {
    const calls: boolean[] = [];
    const t = createHitTarget({ setIgnore: (v) => calls.push(v) });
    t.rects([TOOLS]);
    t.at(X);
    t.at({ x: X.x + 1, y: X.y });
    t.at(CANVAS);
    t.at({ x: 10, y: 10 });
    expect(calls).toEqual([true, false, true]);
  });
});

describe("rectangles and points", () => {
  it("keeps only finite rectangles with a size, at most MAX_RECTS", () => {
    expect(cleanRects([TOOLS, { left: 1, top: 1, right: 1, bottom: 9 }, { left: NaN, top: 0, right: 3, bottom: 3 }, null, "x"])).toEqual([TOOLS]);
    expect(cleanRects(Array.from({ length: 100 }, () => TOOLS))).toHaveLength(MAX_RECTS);
    expect(cleanRects("nope")).toEqual([]);
  });
  it("the left and top edges are inside, the right and bottom ones outside (as the page hit-tests)", () => {
    expect(insideAny({ x: TOOLS.left, y: TOOLS.top }, [TOOLS])).toBe(true);
    expect(insideAny({ x: TOOLS.right - 0.5, y: TOOLS.bottom - 0.5 }, [TOOLS])).toBe(true);
    expect(insideAny({ x: TOOLS.right, y: TOOLS.top + 1 }, [TOOLS])).toBe(false);
    expect(insideAny({ x: TOOLS.left + 1, y: TOOLS.bottom }, [TOOLS])).toBe(false);
    expect(insideAny(null, [TOOLS])).toBe(false);
  });
  it("the cursor in window coordinates, null outside the window", () => {
    const b = { x: 100, y: 50, width: 600, height: 500 };
    expect(localPoint({ x: 678, y: 74 }, b)).toEqual(X);
    expect(localPoint({ x: 99, y: 74 }, b)).toBeNull();
    expect(localPoint({ x: 701, y: 74 }, b)).toBeNull();
  });
});

describe("wiring", () => {
  const main = fs.readFileSync(path.join(__dirname, "okfilow.js"), "utf8");
  const page = fs.readFileSync(path.join(__dirname, "../web/app/okfilow/model/page.tsx"), "utf8");
  it("main decides the model window's mouse from the real cursor, not from the page's hover events", () => {
    expect(main).toMatch(/modelHit\?\.at\(localPoint\(screen\.getCursorScreenPoint\(\), modelWin\.getBounds\(\)\)\)/);
    expect(main).toMatch(/"okfilow:model:hover"[\s\S]{0,200}modelHit\?\.hold\(active === true\)/);
    expect(main).not.toMatch(/"okfilow:model:hover"[\s\S]{0,160}setIgnoreMouseEvents/);
  });
  it("the page reports its tools and labels and no longer flips the mouse on enter or leave of the tools", () => {
    expect(page).toMatch(/querySelectorAll\("\.okf-model-tools, \.okf-part"\)/);
    expect(page).not.toMatch(/okf-model-tools"[^>]*onPointer(Enter|Leave)/);
    expect(page).toMatch(/e\.key === "Escape"\) b\.closeModel\(\)/);
  });
});
