const fs=require('node:fs'),path=require('node:path'),{fork}=require('node:child_process');
const {createEmbedding,enrol,background,createStream}=require('../../apps/desktop/wake-head');
const {readSample}=require('../../apps/desktop/wake');
const {createCombiner}=require('../../apps/desktop/wake-policy');
const {replayEnrolment}=require('../../apps/desktop/wake-enrolment');
const root='G:/FILOW/tmp/wake-word',out=path.join(root,'round3/heldout');fs.mkdirSync(out,{recursive:true});
const model=path.join(root,'native-profile/models/wake');
const child=fork(path.join(__dirname,'spotter-child.cjs'),[model],{windowsHide:true,serialization:'advanced'});
let next=0;const pending=new Map();child.on('message',m=>{pending.get(m.id)?.(m);pending.delete(m.id)});
const request=m=>new Promise(resolve=>{pending.set(++next,resolve);child.send({...m,id:next})});
const deadline=setTimeout(()=>{child.kill();process.exit(124)},600000);
(async()=>{
  const e=await createEmbedding(model),bg=background(path.resolve('apps/desktop/wake-data'));
  const voices=JSON.parse(fs.readFileSync(path.join(root,'heldout-five-fixtures/manifest.json'))).voices,results=[];
  for(const [i,v] of voices.entries()) {
    const recordings=v.enrol.map(c=>readSample(c.file)), negatives=v.near.slice(0,2).map(c=>readSample(c.file));
    const profiles=[await enrol(e,recordings,bg),await enrol(e,recordings,bg,negatives)];
    fs.writeFileSync(path.join(out,`profile-${i}.json`),JSON.stringify(profiles[0]));
    const rows=profiles.map((p,index)=>({personal:index===1,voice:v.voice,lang:v.lang,total:0,miss:0,near:0,nearAccepted:0,reservedNear:2,conditions:{}}));
    for(const [pi,p] of profiles.entries()) {
      const stream=createStream(e,p);
      const detector={reset:async()=>{stream.reset();await request({type:'reset'});},feed:async(samples,at)=>{const [k,score]=await Promise.all([request({type:'feed',samples,at}),stream.feed(samples)]);return {...k,at,score};}};
      rows[pi].verification=await replayEnrolment(detector,p,recordings,negatives);
      for(const kind of ['test','near'])for(const clip of (kind==='near'?v.near.slice(2):v.test)) {
        await detector.reset();const c=createCombiner(p.thresholds,'balanced');let fired=false;
        const pcm=readSample(clip.file),audio=new Float32Array(pcm.length+32000);audio.set(pcm);
        for(let at=0;at<audio.length;at+=1600){const x=new Float32Array(1600);x.set(audio.subarray(at,at+1600));if(c.push(await detector.feed(x,(at+1600)/16)))fired=true;}
        if(kind==='test'){const condition=rows[pi].conditions[clip.condition]??={total:0,miss:0};condition.total++;condition.miss+=!fired;if(!clip.condition.includes('pitch')){rows[pi].total++;rows[pi].miss+=!fired;}}
        else{rows[pi].near++;rows[pi].nearAccepted+=fired;}
      }
    }
    results.push(...rows);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(rows));
  }
  await e.dispose();
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{clearTimeout(deadline);child.kill()});
