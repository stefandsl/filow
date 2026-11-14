import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { LEADER, POINTER } from "./overlay-motion-params";
import { LEADER_EASE_MS } from "./leader-motion";
import { LEADER_LANE_GAP } from "./model-labels";
import { arrivalPhase, planFlight } from "./pointer-flight";

// The AR-2 loop changes overlay-motion-params.ts only. These are the round 2B values; a kept
// experiment updates them here in the same commit.
it("keeps the round 2B pointer and leader values", () => {
  expect(POINTER).toEqual({
    approachSplit: 0.7, ramp: 0.15, baseMs: 400, perPxMs: 0.4, minMs: 450, maxMs: 900, floorMs: 600, pacedMs: 510,
    dockReach: 40, dockGap: 12, lifts: [0, 0.25, 0.5, 0.75, 1], pillClearPx: 8, edgePx: 4,
    overlapWeight: 1000, clearanceWeight: 100000, lengthWeight: 0.001, targetWeight: 3, arrivalMs: 600, arrivalGrow: 0.15,
  });
  expect(LEADER).toEqual({
    gridStep: 8, anchorRadius: 8, keepClearance: 13, directClearance: 14, goodClearance: 12.2, corridor: 14,
    exitSpacing: 28, endReach: 32, attempts: 12, permutations: 64, easeMs: 160, laneGap: 28,
  });
});

it("is the only source of the motion values", () => {
  expect(LEADER_EASE_MS).toBe(LEADER.easeMs);
  expect(LEADER_LANE_GAP).toBe(LEADER.laneGap);
  expect(arrivalPhase(POINTER.arrivalMs * 2, POINTER.arrivalMs).scale).toBeCloseTo(1 + POINTER.arrivalGrow);
  const plan = planFlight({ x: 64, y: 80 }, { x: 500, y: 262 }, [], { width: 1000, height: 700 }, 90);
  expect(plan.duration).toBeGreaterThanOrEqual(POINTER.floorMs);
  expect(plan.duration).toBeLessThanOrEqual(POINTER.maxMs);
  for (const file of ["pointer-flight.ts", "leader-route.ts"]) {
    const src = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    expect(src, file).toContain('from "./overlay-motion-params"');
  }
});
