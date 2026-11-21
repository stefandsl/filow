import {createRequire} from 'node:module';
import {expect,it,vi} from 'vitest';
const require=createRequire(import.meta.url);
const {canEnable,replayEnrolment}=require('./wake-enrolment');
it('requires a completed five-take replay, four successes and zero negative accepts in the selected mode',()=>{
  const row={total:5,recognised:4,negativeAccepts:0};
  expect(canEnable({balanced:row})).toBe(true);
  expect(canEnable(undefined)).toBe(false);
  expect(canEnable({balanced:{...row,total:4}})).toBe(false);
  expect(canEnable({balanced:{...row,recognised:3}})).toBe(false);
  expect(canEnable({balanced:{...row,negativeAccepts:1}})).toBe(false);
  expect(canEnable({balanced:row},'strict')).toBe(false);
});
it('replays each take and negative through both detectors with independent timing and bounded padding',async()=>{
  let clip=-1;
  const detector={reset:vi.fn(async()=>{clip++;}),feed:vi.fn(async(_x:Float32Array,at:number)=>({at,score:clip===4?0:6,keyword:clip!==0}))};
  const result=await replayEnrolment(detector,{thresholds:{loose:1,sensitive:3,sure:5}},Array.from({length:5},()=>new Float32Array(1600)),[new Float32Array(1600)]);
  expect(detector.reset).toHaveBeenCalledTimes(6);
  expect(detector.feed).toHaveBeenCalledTimes(126);
  expect(result.balanced).toEqual({total:5,recognised:4,negatives:1,negativeAccepts:1});
  expect(result.strict.recognised).toBe(3);
  expect(canEnable(result)).toBe(false);
});

it("preserves personal negative rejection on the fallback route", () => {
  const { prefixFallback } = require("./wake-enrolment");
  const row = { total: 5, recognised: 2, negatives: 1, negativeAccepts: 1 };
  const profile = { phrase: "Filow", verification: { balanced: row } };
  expect(prefixFallback(profile, "balanced")).toBe(false);
  expect(prefixFallback({ ...profile, prefixNegatives: { balanced: 0 } }, "balanced")).toBe(true);
  expect(prefixFallback({ ...profile, prefixNegatives: { balanced: 1 } }, "balanced")).toBe(false);
  expect(prefixFallback({ ...profile, verification: {} }, "balanced")).toBe(false);
});
