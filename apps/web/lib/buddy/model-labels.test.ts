import { describe, expect, it } from "vitest";
import { fitScale, frameDistance, labelledParts, layoutPartLabels, slotsOverlap } from "./model-labels";

const view = { width: 760, height: 460 };
const sizes = (n: number, w = 120) => Array.from({ length: n }, () => ({ width: w, height: 28 }));

describe("the 3D view's framing", () => {
  it("stands the camera so the model fills the asked share of the view", () => {
    const d = frameDistance(2, 35, 760 / 460, 0.7);
    // the bounding sphere's projected diameter is 70% of the view's height
    expect((2 / (d * Math.tan((35 * Math.PI) / 360))) ).toBeCloseTo(0.7, 5);
    expect(frameDistance(2, 35, 0.5, 0.7)).toBeGreaterThan(d);
  });

  it("corrects to 70% of the height, or to the free width between the label columns", () => {
    expect(fitScale({ width: 100, height: 161 }, view, 140)).toBeCloseTo(2, 2);
    // a long model: the width between the columns wins
    expect(fitScale({ width: 480, height: 100 }, view, 140)).toBeCloseTo((0.95 * (760 - 280)) / 480, 5);
    expect(fitScale({ width: 0, height: 10 }, view, 140)).toBe(1);
  });
});

describe("the 3D view's part labels", () => {
  it("go to the biggest parts, one per name, numbered in the model's order", () => {
    const names = ["Blade", "Hub", "Blade", "Casing", "Bolt"];
    const size = [1, 2, 1.5, 4, 0.1];
    expect(labelledParts(names, size, 3)).toEqual([1, 2, 3]);
    expect(labelledParts(names, size)).toEqual([1, 2, 3, 4]);
    expect(labelledParts(["", " "], [1, 2])).toEqual([]);
  });

  it("start their leader exactly on their part's anchor and end at the label's inner edge", () => {
    const anchors = [{ x: 300, y: 200 }, { x: 460, y: 240 }];
    const slots = layoutPartLabels(anchors, sizes(2), view, 380);
    expect(slots[0].from).toEqual(anchors[0]);
    expect(slots[1].from).toEqual(anchors[1]);
    expect(slots[0].side).toBe("left");
    expect(slots[0].to).toEqual({ x: slots[0].x + 120, y: slots[0].y + 14 });
    expect(slots[1].side).toBe("right");
    expect(slots[1].to).toEqual({ x: slots[1].x, y: slots[1].y + 14 });
  });

  it("follow their part up and down as the model turns", () => {
    const at = (y: number) => layoutPartLabels([{ x: 300, y }], sizes(1), view, 380)[0];
    expect(at(150).y + 14).toBeCloseTo(150, 5);
    expect(at(300).y + 14).toBeCloseTo(300, 5);
  });

  it("never overlap and stay on screen, even when all parts crowd one side", () => {
    const anchors = Array.from({ length: 16 }, (_, i) => ({ x: 200 + i, y: 220 + i }));
    const slots = layoutPartLabels(anchors, sizes(16), view, 380);
    expect(slotsOverlap(slots)).toBe(false);
    for (const s of slots) {
      expect(s.y).toBeGreaterThanOrEqual(10);
      expect(s.y + s.height).toBeLessThanOrEqual(view.height - 10);
      expect(s.x).toBeGreaterThanOrEqual(10);
      expect(s.x + s.width).toBeLessThanOrEqual(view.width - 10);
    }
    // sixteen labels do not fit one column of 460 px: some went to the other side
    expect(new Set(slots.map((s) => s.side)).size).toBe(2);
  });

  it("keep their side near the middle and change it only once their part is clearly across", () => {
    const one = (x: number, prev: "left" | "right" | null) => layoutPartLabels([{ x, y: 200 }], sizes(1), view, 380, prev ? [prev] : null)[0].side;
    expect(one(385, null)).toBe("right");
    expect(one(385, "left")).toBe("left");
    expect(one(370, "right")).toBe("right");
    expect(one(405, "left")).toBe("right");
    expect(one(350, "right")).toBe("left");
  });
});
