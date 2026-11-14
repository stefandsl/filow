const { Worker } = require('node:worker_threads');
const fs = require('node:fs'), path = require('node:path');
const {readSample} = require('../../apps/desktop/wake');
const [dir, reference, expected, output] = process.argv.slice(2);
const worker = new Worker(path.resolve('apps/desktop/wake-worker.js'), {workerData:{dir, keywords:path.join(dir,'keywords.txt')}});
let id = 0;
const pending = new Map();
worker.on('message', m => {pending.get(m.id)?.(m); pending.delete(m.id);});
const feed = samples => new Promise(resolve => {pending.set(++id, resolve); worker.postMessage({type:'feed',samples,id,at:id*100});});
(async()=>{
  const rows=[];
  const refs=JSON.parse(fs.readFileSync(expected));
  for(const clip of JSON.parse(fs.readFileSync(path.join(reference,'index.json')))){
    worker.postMessage({type:'reset'});
    const x=readSample(clip.file),hits=[];
    for(let at=0;at<Math.ceil(x.length/1600)*1600+32000;at+=1600){const samples=new Float32Array(1600);samples.set(x.subarray(at,at+1600));if((await feed(samples)).keyword)hits.push((at+1600)/16);}
    const ref=refs.find(r=>r.stem===clip.stem);
    rows.push({stem:clip.stem,hits,reference:ref.hits,match:JSON.stringify(hits)===JSON.stringify(ref.hits)});
  }
  fs.writeFileSync(output,JSON.stringify(rows,null,2));console.log('clips',rows.length,'mismatches',rows.filter(r=>!r.match).length);
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>worker.terminate());
