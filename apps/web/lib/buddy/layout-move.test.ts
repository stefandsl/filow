import { describe, expect, it } from "vitest";
import { areaFor, bubbleClear, clampBox, dragBox, EDGE, keyBox, LIMITS, readLayout, rememberBox, resetLayout, resizeBox, type Box } from "./layout-move";
import { tilesIn } from "./media";

const area = { x: 0, y: 0, width: 1920, height: 1080 };
const lim = LIMITS.slide;
const start: Box = { x: 400, y: 300, w: 560, h: 380 };
const inside = (b: Box, a = area) => b.x >= a.x + EDGE && b.y >= a.y + EDGE && b.x + b.w <= a.x + a.width - EDGE && b.y + b.h <= a.y + a.height - EDGE;

describe("dragging and resizing", () => {
  it("a drag moves the box by the pointer's way, and never past the visible area", () => {
    expect(dragBox(start, 120, -40, area, lim)).toEqual({ ...start, x: 520, y: 260 });
    const far = dragBox(start, 5000, 5000, area, lim);
    expect(inside(far)).toBe(true);
    expect(far).toEqual({ ...start, x: 1920 - EDGE - 560, y: 1080 - EDGE - 380 });
    expect(inside(dragBox(start, -5000, -5000, area, lim))).toBe(true);
  });
  it("the corner grip resizes from the top-left corner, between the smallest and the largest size and inside the area", () => {
    expect(resizeBox(start, "se", 100, 50, area, lim)).toEqual({ ...start, w: 660, h: 430 });
    expect(resizeBox(start, "se", -1000, -1000, area, lim)).toEqual({ ...start, w: lim.minW, h: lim.minH });
    const big = resizeBox(start, "se", 5000, 5000, area, lim);
    expect(big.x).toBe(400);
    expect(big.w).toBeLessThanOrEqual(lim.maxW);
    expect(inside(big)).toBe(true);
    expect(resizeBox(start, "e", 40, 90, area, lim)).toEqual({ ...start, w: 600 });
  });
  it("arrow keys move a focused item, Shift+arrows resize it; other keys do nothing", () => {
    expect(keyBox(start, "ArrowRight", false, area, lim)).toEqual({ ...start, x: 416 });
    expect(keyBox(start, "ArrowDown", true, area, lim)).toEqual({ ...start, h: 396 });
    expect(keyBox(start, "a", false, area, lim)).toBeNull();
  });
  it("a box larger than a small screen shrinks to fit it", () => {
    const small = { x: 0, y: 0, width: 360, height: 640 };
    expect(inside(clampBox({ x: 0, y: 0, w: 900, h: 900 }, small, lim), small)).toBe(true);
  });
  it("the area of a box is the screen holding its centre (dragged onto the second screen, it stays there)", () => {
    const right = { x: 1920, y: 0, width: 2560, height: 1440 };
    expect(areaFor({ x: 1800, y: 100, w: 400, h: 300 }, [area, right])).toBe(right);
    expect(areaFor({ x: 100, y: 100, w: 400, h: 300 }, [area, right])).toBe(area);
    expect(areaFor({ x: 100, y: 3000, w: 10, h: 10 }, [area, right])).toBe(area);
  });
});

describe("remembered for the session, until reset", () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
  it("per kind; a reset forgets every kind; a broken store is ignored", () => {
    const s = mem();
    rememberBox(s, "slide", start);
    rememberBox(s, "cards", { x: 1, y: 2, w: 300, h: 100 });
    expect(readLayout(s)).toEqual({ slide: start, cards: { x: 1, y: 2, w: 300, h: 100 } });
    resetLayout(s);
    expect(readLayout(s)).toEqual({});
    s.setItem("filow.okf.layout", '{"slide":{"x":"no"},"gallery":"x"}');
    expect(readLayout(s)).toEqual({});
    expect(readLayout(null)).toEqual({});
  });
});

describe("the bubble never covers what it belongs to", () => {
  const view = { width: 1920, height: 1080 };
  const model = { left: 800, top: 300, right: 1300, bottom: 700 };
  const area2 = (a: { x: number; y: number }, s: { width: number; height: number }, b: typeof model) => Math.max(0, Math.min(a.x + s.width, b.right) - Math.max(a.x, b.left)) * Math.max(0, Math.min(a.y + s.height, b.bottom) - Math.max(a.y, b.top));
  it("a bubble placed on the 3D model goes beside it, on screen, the nearest way", () => {
    const size = { width: 360, height: 90 };
    const at = bubbleClear({ x: 900, y: 400 }, size, view, [model]);
    expect(area2(at, size, model)).toBe(0);
    expect(at.x >= 0 && at.y >= 0 && at.x + size.width <= 1920 && at.y + size.height <= 1080).toBe(true);
    expect(at).toEqual({ x: 900, y: 198 }); // above it: nearer than below (712)
  });
  it("a bubble already clear stays where it is; with nothing to keep off, too", () => {
    expect(bubbleClear({ x: 100, y: 100 }, { width: 300, height: 80 }, view, [model])).toEqual({ x: 100, y: 100 });
    expect(bubbleClear({ x: 900, y: 400 }, { width: 300, height: 80 }, view, [])).toEqual({ x: 900, y: 400 });
  });
  it("it keeps off every box at once (pictures beside the model)", () => {
    const tiles = { left: 800, top: 712, right: 1300, bottom: 1000 };
    const size = { width: 360, height: 90 };
    const at = bubbleClear({ x: 900, y: 400 }, size, view, [model, tiles]);
    expect(area2(at, size, model) + area2(at, size, tiles)).toBe(0);
  });
});

describe("a moved or resized gallery", () => {
  it("keeps its columns, its tiles fill the box's width, nothing overlaps", () => {
    const t = tilesIn(4, { x: 100, y: 50, w: 800 });
    expect(t).toHaveLength(4);
    expect(t[0].left).toBe(100);
    expect(t[1].right).toBeLessThanOrEqual(900);
    expect(t[1].right).toBeGreaterThanOrEqual(898);
    expect(t[2].top).toBeGreaterThan(t[0].bottom);
  });
});
