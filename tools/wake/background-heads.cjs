// One feature pass, five independently enrolled heads, and one KWS pass on the
// same continuous samples. No microphone, no retained audio, one native thread.
const fs=require('node:fs'),path=require('node:path'),{fork}=require('node:child_process');
const {createEmbedding,createStream,dot}=require('../../apps/desktop/wake-head');
const {createCombiner}=require('../../apps/desktop/wake-policy');
const {readSample}=require('../../apps/desktop/wake');
const [root,fixtures,output]=process.argv.slice(2);
if(!root.replace(/\\/g,'/').toLowerCase().startsWith('g:/filow/tmp/wake-word/'))throw Error('Own G: root required');
const child=fork(path.join(__dirname,'spotter-child.cjs'),[path.join(root,'models/wake')],{windowsHide:true,serialization:'advanced'});
let next=0;const pending=new Map();
child.on('message',m=>{pending.get(m.id)?.(m);pending.delete(m.id)});
const request=m=>new Promise(resolve=>{pending.set(++next,resolve);child.send({...m,id:next})});
const deadline=setTimeout(()=>{child.kill();process.exit(124)},20*60*1000);
(async()=>{
  const profiles=Array.from({length:5},(_,i)=>JSON.parse(fs.readFileSync(path.join(root,`profile-${i}.json`))));
  const e=await createEmbedding(path.join(root,'models/wake'));
  const results=profiles.map((p,i)=>({head:i,thresholds:p.thresholds,seconds:0,strict:0,balanced:0,sensitive:0}));
  for(const bg of JSON.parse(fs.readFileSync(path.join(fixtures,'manifest.json'))).background){
    let history=new Float32Array(),scores=profiles.map(()=>-Infinity);
    const tapped={spectrogram:e.spectrogram,vectors:async spec=>{
      const v=await e.vectors(spec); history=v.length>96?v:Float32Array.from([...history,...v]);history=history.slice(-1152);
      if(history.length===1152)profiles.forEach((p,i)=>{scores[i]=Math.max(scores[i],dot(p.weights,history)+p.bias)});
      return v;
    }};
    const stream=createStream(tapped,{weights:Array(1152).fill(0),bias:0});
    const combiners=profiles.map(p=>Object.fromEntries(['strict','balanced','sensitive'].map(mode=>[mode,createCombiner(p.thresholds,mode)])));
    await request({type:'reset'});
    const x=readSample(bg.file);
    for(let at=0;at<x.length;at+=1600){
      const samples=new Float32Array(1600);samples.set(x.subarray(at,at+1600));scores=profiles.map(()=>-Infinity);
      const [k]=await Promise.all([request({type:'feed',samples,at:(at+1600)/16}),stream.feed(samples)]);
      profiles.forEach((_,i)=>{for(const mode of ['strict','balanced','sensitive'])results[i][mode]+=Number(combiners[i][mode].push({at:(at+1600)/16,score:scores[i],keyword:k.keyword}))});
    }
    results.forEach(r=>{r.seconds+=x.length/16000});fs.writeFileSync(output,JSON.stringify(results,null,2));console.log(bg.file,JSON.stringify(results));
  }
  await e.dispose();
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{clearTimeout(deadline);child.kill()});
