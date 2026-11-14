import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
type B = { x: number; y: number; width: number; height: number };
const { movedBounds, clampBounds, localRect, MODEL_LIMITS, EDGE } = require("./okfilow-move.js") as {
  movedBounds: (b: B, d: unknown, areas: B[]) => B | null;
  clampBounds: (b: B, areas: B[]) => B;
  localRect: (b: B | null, o: B) => { left: number; top: number; right: number; bottom: number } | null;
  MODEL_LIMITS: { minW: number; minH: number; maxW: number; maxH: number };
  EDGE: number;
};

const left: B = { x: 0, y: 0, width: 1920, height: 1040 };
const right: B = { x: 1920, y: 0, width: 2560, height: 1400 };
const win: B = { x: 1000, y: 200, width: 560, height: 440 };
const inArea = (b: B, a: B) => b.x >= a.x + EDGE && b.y >= a.y + EDGE && b.x + b.width <= a.x + a.width - EDGE && b.y + b.height <= a.y + a.height - EDGE;

describe("the 3D model window moved and resized from its own handle and grip", () => {
  it("a drag moves it; dragged onto the second screen it stays there, wholly visible", () => {
    expect(movedBounds(win, { dx: 50, dy: -20 }, [left, right])).toEqual({ ...win, x: 1050, y: 180 });
    const over = movedBounds(win, { dx: 1200, dy: 0 }, [left, right])!;
    expect(over.x).toBe(2200);
    expect(inArea(over, right)).toBe(true);
    const off = movedBounds(win, { dx: 9000, dy: 9000 }, [left, right])!;
    expect(inArea(off, right)).toBe(true);
  });
  it("the corner grip resizes it between its smallest and largest size, never past the screen", () => {
    expect(movedBounds(win, { dx: 0, dy: 0, dw: 100, dh: 60 }, [left])).toEqual({ ...win, width: 660, height: 500 });
    const tiny = movedBounds(win, { dx: 0, dy: 0, dw: -900, dh: -900 }, [left])!;
    expect([tiny.width, tiny.height]).toEqual([MODEL_LIMITS.minW, MODEL_LIMITS.minH]);
    const huge = movedBounds(win, { dx: 0, dy: 0, dw: 5000, dh: 5000 }, [left])!;
    expect(inArea(huge, left)).toBe(true);
  });
  it("refuses a bad message; a remembered place is kept on a screen that is still there", () => {
    expect(movedBounds(win, null, [left])).toBeNull();
    expect(movedBounds(win, { dx: 1e9 }, [left])).toBeNull();
    expect(movedBounds(win, { dx: "x", dy: NaN }, [left])).toEqual(win);
    expect(inArea(clampBounds({ x: 3000, y: 100, width: 600, height: 400 }, [left]), left)).toBe(true);
  });
  it("each overlay is told where the window is, in its own coordinates, or that it is not on its screen", () => {
    expect(localRect(win, left)).toEqual({ left: 1000, top: 200, right: 1560, bottom: 640 });
    expect(localRect({ ...win, x: 2000 }, right)).toEqual({ left: 80, top: 200, right: 640, bottom: 640 });
    expect(localRect({ ...win, x: 2000 }, left)).toBeNull();
    expect(localRect(null, left)).toBeNull();
  });
});

describe("wiring", () => {
  const main = fs.readFileSync(path.join(__dirname, "okfilow.js"), "utf8");
  const page = fs.readFileSync(path.join(__dirname, "../web/app/okfilow/model/page.tsx"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../web/app/okfilow/okfilow.css"), "utf8");
  it("main moves the window, remembers where it was put, resets it, and tells the overlays where it is", () => {
    expect(main).toMatch(/"okfilow:model:move"[\s\S]{0,300}movedBounds\(modelWin\.getBounds\(\), d, workAreas\(\)\)[\s\S]{0,120}modelWin\.setBounds\(next\)/);
    expect(main).toMatch(/if \(d && d\.done === true\) modelMemo = next;/);
    expect(main).toMatch(/modelMemo \? clampBounds\(modelMemo, workAreas\(\)\)/);
    expect(main).toMatch(/"okfilow:resetLayout"[\s\S]{0,300}modelMemo = null;[\s\S]{0,400}sendOverlays\("okfilow:resetLayout", null\)/);
  });
  it("the handle drags (no system drag region, which did not work on the click-through window), the grip resizes, arrows move", () => {
    expect(css).toMatch(/\.okf-model-grip \{[^}]*-webkit-app-region: no-drag/);
    expect(page).toContain('onPointerDown={windowDrag("move")}');
    expect(page).toContain('onPointerDown={windowDrag("size")}');
    expect(page).toMatch(/b\.modelMove\(e\.shiftKey \? \{ dx: 0, dy: 0, dw: d\[0\], dh: d\[1\], done: true \} : \{ dx: d\[0\], dy: d\[1\], done: true \}\)/);
    expect(page).toContain('".okf-model-tools, .okf-part, .okf-model-resize"');
  });
});
