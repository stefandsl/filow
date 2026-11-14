import {createRequire} from 'node:module';
import crypto from 'node:crypto';
import {expect,it} from 'vitest';
import fixture from './wake-data/portable-reference.json';
const require=createRequire(import.meta.url);
const {augment,random}=require('./wake-augmentation');
const {createEmbedding,trainHead}=require('./wake-head');
it('matches independent Python augmentation checksums, draw order and durations',()=>{
 const rng=random(fixture.seed),x=Float32Array.from(Array(fixture.repeats).fill(fixture.pattern).flat());
 for(const row of fixture.rows){const {audio}=augment(x,row.variant,rng);expect(audio.length).toBe(row.samples);expect(crypto.createHash('sha256').update(Buffer.from(audio.buffer)).digest('hex')).toBe(row.sha256);}
});
it.skipIf(!process.env.FILOW_WAKE_MODEL_DIR)('matches portable Python embedding sequences on augmented clips',async()=>{
 const e=await createEmbedding(process.env.FILOW_WAKE_MODEL_DIR),rng=random(fixture.seed),x=Float32Array.from(Array(fixture.repeats).fill(fixture.pattern).flat());
 try{for(const row of fixture.rows){const actual=(await e.embed(augment(x,row.variant,rng).audio)).slice(-96);expect(actual.length).toBe(96);expect(Math.max(...actual.map((v:number,i:number)=>Math.abs(v-row.embedding[i])))).toBeLessThan(2e-6);}}finally{await e.dispose();}
});
it('matches independent optimizer states after 1, 10 and all steps',()=>{
 const positives=Array.from({length:20},()=>{const x=new Float32Array(1152);x[0]=1;return x;});
 const data=new Float32Array(3000*96);for(let i=0;i<data.length;i+=96)data[i]=-1;
 const trace: {step:number;weights:number[];bias:number;loss:number}[]=[];
 trainHead(positives,{data,meta:{segments:[{frames:3000}]}},{trace:(x:typeof trace[number])=>trace.push(x)});
 expect(trace).toHaveLength(3);
 for(const [i,row] of trace.entries()){const ref=fixture.optimizer[i];expect(row.step).toBe(ref.step);expect(row.bias).toBeCloseTo(ref.bias,6);expect(row.loss).toBeCloseTo(ref.loss,6);for(let j=0;j<8;j++)expect(row.weights[j]).toBeCloseTo(ref.weights[j],6);}
});
