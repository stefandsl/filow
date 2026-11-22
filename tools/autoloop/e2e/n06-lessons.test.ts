import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { reserve, grades, trial } from "./n06-lessons.mjs";
const { it } = process.env.VITEST ? await import("vitest") : await import("node:test");
it("keeps the worst-case reservation after interruption and across arms", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),"n06-budget-"));
  try {
    assert.throws(() => reserve(dir, randomUUID(), NaN));
    const id = randomUUID();
    assert.equal(reserve(dir,id,650000),650000);
    assert.throws(() => reserve(dir,id,1));
    assert.throws(() => reserve(dir,randomUUID(),350001));
    assert.equal(reserve(dir,randomUUID(),350000),1000000);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
it("withholds the Google send on an unknown quote and retains an interrupted send", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),"n06-transport-"));
  const api = { generateCloud: async (ask: (c: unknown) => Promise<string>) => ask({system:"development",user:"topic",maxTokens:10}) };
  const spec = {model:"gemini-development-flash",locale:"en",maxSteps:4,sha:"candidate",trialId:"one"};
  let sends=0, price:number|undefined;
  const exchange = async (m: {type:string;id:string}) => {
    if(m.type==="quote") return {id:m.id,maxMicroEur:price};
    sends++; throw Error("interrupted");
  };
  try {
    await assert.rejects(trial(spec,"development",dir,exchange,api),/cost/);
    assert.equal(sends,0);
    price=600000;
    await assert.rejects(trial(spec,"development",dir,exchange,api),/interrupted/);
    await assert.rejects(trial({...spec,sha:"base"},"development",dir,exchange,api),/allowance/);
    assert.equal(sends,1);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
it("counts blind grades on delivered renders and keeps audit replays separate", () => {
  const rows = Array.from({length:20},(_,i) => {
    const lesson = {steps:[{say:"Trial "+i}]}, svg=["<svg><text>"+i+"</text></svg>"];
    const renderHash=createHash("sha256").update(JSON.stringify([lesson,svg])).digest("hex");
    return {id:String(i),sha:"candidate",delivered:true,lesson,svg,renderHash};
  });
  const marks = rows.map(r => ({id:r.id,renderHash:r.renderHash,criticalErrors:0}));
  assert.equal(grades([...rows,{...rows[0],id:"audit",auditReplay:true}],marks)[0].factualBar,true);
  assert.equal(grades(rows,marks.slice(1))[0].factualBar,false);
  assert.throws(() => grades(rows,[{...marks[0],renderHash:"other"}]));
  assert.equal(grades([...rows,{id:"failed",sha:"candidate",renderFailure:true}],marks)[0].factualBar,false);
});
