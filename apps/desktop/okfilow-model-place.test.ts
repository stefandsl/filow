import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { modelBounds, MODEL_VIEW, POINTER_CLEAR, BUBBLE } = require("./okfilow-model-place.js");

type R = { x: number; y: number; width: number; height: number };
const work = { x: 0, y: 0, width: 1920, height: 1040 };
const hits = (a: R, b: R) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const pointer = (c: { x: number; y: number }) => ({ x: c.x - POINTER_CLEAR, y: c.y - POINTER_CLEAR, width: 2 * POINTER_CLEAR, height: 2 * POINTER_CLEAR });
const bubble = (c: { x: number; y: number }) => ({ x: c.x + BUBBLE.dx, y: c.y + BUBBLE.dy, width: BUBBLE.width, height: BUBBLE.height });

describe("the 3D view's place", () => {
  it("is left of the pointer when there is room, at its full size", () => {
    const c = { x: 1000, y: 500 };
    const b: R = modelBounds(c, work);
    expect(b.width).toBe(MODEL_VIEW.width);
    expect(b.height).toBe(MODEL_VIEW.height);
    expect(b.x + b.width).toBeLessThan(c.x);
  });

  it("never covers the pointer or the answer bubble, wherever the pointer is", () => {
    for (const c of [{ x: 1000, y: 330 }, { x: 60, y: 500 }, { x: 1880, y: 1000 }, { x: 960, y: 30 }, { x: 300, y: 1020 }, { x: 1900, y: 20 }]) {
      const b: R = modelBounds(c, work);
      expect(hits(b, pointer(c)), JSON.stringify(c)).toBe(false);
      expect(hits(b, bubble(c)), JSON.stringify(c)).toBe(false);
    }
  });

  it("stays inside the work area of a second display", () => {
    const w2 = { x: 1920, y: -200, width: 1280, height: 1000 };
    const b: R = modelBounds({ x: 1950, y: -150 }, w2);
    expect(b.x).toBeGreaterThanOrEqual(w2.x + 8);
    expect(b.y).toBeGreaterThanOrEqual(w2.y + 8);
    expect(b.x + b.width).toBeLessThanOrEqual(w2.x + w2.width - 8);
    expect(b.y + b.height).toBeLessThanOrEqual(w2.y + w2.height - 8);
  });

  it("shrinks to a small work area", () => {
    const b: R = modelBounds({ x: 300, y: 200 }, { x: 0, y: 0, width: 600, height: 400 });
    expect(b.width).toBe(584);
    expect(b.height).toBe(384);
  });
});
