import { createRequire } from "node:module";
import { expect, it } from "vitest";

const { shakeStep } = createRequire(import.meta.url)("./okfilow-gestures.js");
const run = (xs: number[], step = 100, scale = 1, kind = "move") => {
  let state: { x: number; y: number; at: number; kind: string }[] = [];
  for (const [i, x] of xs.entries()) {
    const result = shakeStep(state, { x, y: 0, at: step * i, kind }, scale);
    if (result.close) return true;
    state = result.samples;
  }
  return false;
};
it("requires four long alternating horizontal legs inside 700 ms, in display pixels", () => {
  expect(run([0, 41, 0, 41, 0])).toBe(true);
  expect(run([0, 41, 0, 41, 0], 100, 2)).toBe(false);
  expect(run([0, 80, 0, 80, 0], 175, 2)).toBe(true);
  expect(run([0, 50, 0, 50, 0], 180)).toBe(false);
  expect(run([0, 80, 160, 240, 320])).toBe(false);
  for (const kind of ["drag", "wheel"]) expect(run([0, 80, 0, 80, 0], 50, 1, kind)).toBe(false);
});
