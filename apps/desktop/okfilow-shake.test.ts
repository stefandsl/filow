import { createRequire } from "node:module";
import { expect, it } from "vitest";

const { shakeStep } = createRequire(import.meta.url)("./okfilow-gestures.js");
const run = (xs: number[], step = 100, scale = 1) => {
  let state: { x: number; y: number; at: number }[] = [];
  for (const [i, x] of xs.entries()) {
    const result = shakeStep(state, { x, y: 0, at: step * i }, scale);
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

});

it("resets on wheel and close, ignores held buttons and respects the setting", () => {
  let enabled = true, closes = 0, time = 0;
  const hook = createRequire(import.meta.url)("./okfilow-gestures.js").createShakeInput({
    enabled: () => enabled, scale: () => 1, now: () => ++time, close: () => closes++,
  });
  const move = (...xs: number[]) => xs.forEach(x => hook.move({ x, y: 0 }));
  hook.down({ button: 1 });
  move(0, 50, 0, 50, 0);
  hook.reset(); // bubble went away with the mouseup missing
  move(0, 50, 0);
  hook.wheel();
  move(0, 50, 0);
  enabled = false;
  move(0, 50, 0, 50, 0);
  expect(closes).toBe(0);
  enabled = true;
  move(0, 50, 0, 50, 0);
  expect(closes).toBe(1);
});
