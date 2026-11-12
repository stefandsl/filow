import { expect, it } from "vitest";
import { createRequire } from "node:module";
const { practiceMark } = createRequire(import.meta.url)("./tour.js");
it("maps zoom and negative monitor origins without using physical pixels", () => {
  expect(practiceMark({ x: 100, y: 50, width: 80, height: 40 }, { x: -1920, y: 20, width: 1200, height: 800 }, 1.5)).toEqual({ kind: "box", x1: -1770, y1: 95, x2: -1650, y2: 155, label: "" });
});
it("rejects malformed or off-window targets", () => {
  const bounds = { x: 0, y: 0, width: 500, height: 500 };
  for (const r of [null, {}, { x: NaN, y: 1, width: 4, height: 4 }, { x: 480, y: 10, width: 100, height: 40 }]) expect(practiceMark(r, bounds)).toBeNull();
});
