import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { flightPoint, planFlight, overlapArea, pointerBoxes } from "./pointer-flight";
import { createLeaderMotion, routeChange } from "./leader-motion";
import { forwardLeader, hookCount, routeLeaders } from "./leader-route";

it("keeps landing ink outside the target glyph rectangle and ends the underline before the ring", () => {
  const target = { left: 450, top: 250, right: 600, bottom: 277 };
  const plan = planFlight({ x: 80, y: 100 }, { x: 500, y: 262 }, [target], { width: 1000, height: 700 }, 90);
  expect(plan.to).toEqual({ x: target.right, y: target.bottom });
  for (const box of pointerBoxes(plan.to, plan.dock, plan.width)) expect(overlapArea(box, target)).toBe(0);
  // The cut-out quadrant is the only quadrant inside the text bounds.
  const css = readFileSync("apps/web/app/okfilow/okfilow.css", "utf8");
  expect(css).toContain('data-landed="true"] .okf-arrow { filter: none; clip-path:');
  expect(css).toContain("clip-path: polygon(50% -20%, 120% -20%, 120% 120%, -20% 120%, -20% 50%, 50% 50%)");
  const page = readFileSync("apps/web/app/okfilow/overlay/page.tsx", "utf8");
  expect(page).toContain("r.right-r.left-18");
  expect(page).toContain("dot.current.dataset.landed = String(k >= 1)");
});

it("rejects backward hooks, including a previous route carried into a new pose", () => {
  const hooked = [[{x:300,y:100},{x:330,y:120},{x:100,y:160}]];
  expect(hookCount(hooked)).toBe(1);
  expect(hookCount(hooked.map(forwardLeader))).toBe(0);
  const forward=routeLeaders(hooked,{width:760,height:460},hooked);
  expect(hookCount(forward)).toBe(0);
  expect(forward[0][0]).toEqual(hooked[0][0]);
  expect(forward[0].at(-1)).toEqual(hooked[0].at(-1));
});

it("eases route shape changes over 160 ms without backward segments or a mid-pose snap", () => {
  const before=[[{x:400,y:100},{x:300,y:100},{x:100,y:150}]];
  const after=[[{x:400,y:250},{x:200,y:300},{x:100,y:150}]];
  const move=createLeaderMotion();
  move(before,0);
  expect(move(after,100)).toEqual(before);
  let previous=before, max=0;
  for(let time=100+1000/60;time<260;time+=1000/60) {
    const frame=move(after,time);
    expect(hookCount(frame)).toBe(0);
    max=Math.max(max,routeChange(previous,frame)); previous=frame;
  }
  expect(max).toBeLessThan(routeChange(before,after)*0.17);
  expect(move(after,260)).toEqual(after);
});

it("keeps every 60 fps flight step below 4% of distance, in all directions", () => {
  for (const end of [{ x: 500, y: 262 }, { x: 80, y: 600 }, { x: 100, y: 100 }, { x: 800, y: 100 }, { x: 501, y: 301 }]) {
    const plan = planFlight({ x: 500, y: 300 }, end, [], { width: 1000, height: 700 }, 90);
    const distance = Math.hypot(plan.to.x-plan.from.x, plan.to.y-plan.from.y);
    let previous = plan.from;
    for (let time = 1000/60; time < plan.duration+1000/60; time += 1000/60) {
      const point = flightPoint(plan, time/plan.duration);
      expect(Math.hypot(point.x-previous.x, point.y-previous.y)/distance).toBeLessThan(0.04);
      previous = point;
    }
    expect(previous).toEqual(plan.to);
  }
});
