import assert from "node:assert/strict";
import { aggregate, observation } from "./n06-windows.mjs";
const { it } = process.env.VITEST ? await import("vitest") : await import("node:test");
const id="attempt-1", target="fifth";
const trace={id,target,source:"pcm",phoneType:"surrogate",tier:"reference",temperature:"cold",sha:"candidate",
  initialRows:["one","two","three","four",target],clocks:{desktop:{offset:0,rtt:1},phone:{offset:-8,rtt:4}},
  events:[
    {stage:"lastWord",at:100},{stage:"partial",at:90},{stage:"endpoint",at:110},{stage:"final",at:115},
    {stage:"queueEntry",at:116},{stage:"queueExit",at:117,ids:["one","two","three","four"]},
    {stage:"queueExit",at:125,ids:[target]},{stage:"inferenceStart",at:126,ids:[target]},{stage:"inferenceEnd",at:130},
    {stage:"desktop",at:133,row:target,state:"active"},{stage:"phone",at:140,row:target,state:"active"},
    {stage:"desktop",at:165,row:target,state:"done"},{stage:"phone",at:170,row:target,state:"done"}
  ].map(e=>({...e,id}))};
it("credits only the matching row on both aligned displays after the target enters the batch",()=>{
  const r=observation(trace);
  assert.deepEqual([r.firstMs,r.completeMs,r.timed],[33,70,true]);
  for(const omit of ["phone","endpoint","partial","final","queueEntry","inferenceEnd"]) {
    assert.equal(observation({...trace,events:trace.events.filter(e=>e.stage!==omit)}).timed,false);
  }
  assert.equal(observation({...trace,target:"other"}).timed,false);
  assert.equal(observation({...trace,clocks:{desktop:trace.clocks.desktop}}).timed,false);
});
it("keeps missed and expired attempts in tier, source and temperature counts",()=>{
  const rows=aggregate([trace,{...trace,id:"missing",events:[],timedOut:true},{...trace,id:"warm",temperature:"warm",events:[]}]);
  assert.deepEqual([rows[0].attempts,rows[0].timed,rows[0].timeouts,rows[0].firstMs],[2,1,1,[33,33]]);
  assert.equal(rows[1].misses,1);
  assert.deepEqual(rows[1].completeMs,[null,null]);
  assert.throws(()=>aggregate([trace,trace]));
});
