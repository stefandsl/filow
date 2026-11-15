// Isolated compatibility probe, fake silence only, bounded by the caller.
const {Worker}=require('node:worker_threads'),path=require('node:path');
const {createEmbedding}=require('../../apps/desktop/wake-head');
(async()=>{
 const dir='G:/FILOW/tmp/wake-word/native-profile/models/wake';
 const embedding=await createEmbedding(dir); console.log('embedding loaded');
 const worker=new Worker(path.resolve('apps/desktop/wake-worker.js'),{workerData:{dir,keywords:path.join(dir,'keywords.txt')}});
 worker.on('error',e=>{console.error(e);process.exitCode=1;});
 worker.on('message',async m=>{
  if(m.type==='ready'){console.log('spotter loaded');worker.postMessage({id:1,type:'feed',samples:new Float32Array(1600),at:100});}
  if(m.id===1){console.log('both inferred',m.ms,(await embedding.embed(new Float32Array(32000))).length);await worker.terminate();await embedding.dispose();}
 });
})().catch(e=>{console.error(e);process.exitCode=1});
