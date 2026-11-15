import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it.each([[10,0],[11,1]])('enforces the 98 percent gate with %i disagreements', (errors,status) => {
  const base=path.resolve(__dirname,'../../tmp/wake-tests');
  if (/^c:/i.test(base)) throw Error('Wake tests must not write on C:');
  fs.mkdirSync(base,{recursive:true});
  const root=fs.mkdtempSync(path.join(base,'parity-'));
  if(path.dirname(path.resolve(root))!==base) throw Error('Unexpected test directory');
  try {
    const input=path.join(root,'input.json'), output=path.join(root,'report.json');
    const clips=Array.from({length:500},(_,i)=>({stem:String(i),kind:'test',spot:false,
      scores:{python:1,baseline:i<errors?-1:1},fired:{python:true,baseline:i>=errors}}));
    fs.writeFileSync(input,JSON.stringify([{voice:'fixture',lang:'en',clips}]));
    const result=spawnSync(process.execPath,[path.join(__dirname,'training-parity.cjs'),input,output],{encoding:'utf8',timeout:10000,windowsHide:true});
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(status);
    const report=JSON.parse(fs.readFileSync(output,'utf8'));
    expect(report.agreed).toBe(500-errors);
    expect(report.disagreements).toHaveLength(errors);
    expect(report.pass).toBe(status===0);
    expect(report.disagreements[0]).toMatchObject({referenceDecision:true,appDecision:false});
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
