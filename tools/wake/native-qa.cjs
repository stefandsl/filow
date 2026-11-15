// Hidden, fake-audio-only native regression. Full recordings and profiles stay in
// the caller's QA root. Accelerated audio replay is explicitly marked in results.
const { app, utilityProcess } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
if (process.env.FILOW_QA_NO_GLOBAL_INPUT !== '1' || process.env.FILOW_QA_HEADLESS !== '1') throw new Error('QA isolation required');
const root = process.env.FILOW_USER_DATA_DIR;
if (!root?.replace(/\\/g,'/').toLowerCase().startsWith('g:/filow/tmp/wake-word/')) throw new Error('Own G: profile required');
app.setPath('userData',root); app.setPath('sessionData',root);
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('disable-background-networking');
const { createWake, readSample } = require('../../apps/desktop/wake');
const { FILES } = require('../../apps/desktop/wake-models');
const fixtures = JSON.parse(fs.readFileSync(path.join(root,'../',process.env.FILOW_WAKE_FIXTURES || 'fixtures','manifest.json')));
const reportFile = path.join(root, '../', process.env.FILOW_WAKE_REPORT || 'native-results.json');
let wake;
const deadline = setTimeout(()=>{wake?.stop();app.exit(124)},20*60*1000);
app.whenReady().then(async()=>{
  const models=path.join(root,'models/wake');fs.mkdirSync(models,{recursive:true});
  const source='G:/FILOW/tmp/wakeword-spike/models';
  for(const f of FILES) fs.copyFileSync(path.join(source,f.kws?'sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20':'',f.name),path.join(models,f.name));
  const result={kind:'accelerated native WAV replay, no live microphone',voices:[],positives:0,misses:0,near:0,nearFired:0,backgroundSeconds:0,falseAccepts:0,cpuSeconds:0};
  let last;
  wake=createWake({userData:root,utilityProcess,state:()=>({assistantEnabled:true,mode:'idle',indicator:true,sinceSpeechMs:1000}),changed:s=>{last=s},detected:()=>{throw new Error('Count-only must not ask')}});
  const replay=async(file)=>{
    const samples=readSample(file),before=last.count;
    for(let at=0;at<samples.length;at+=1600){const block=new Float32Array(1600);block.set(samples.subarray(at,at+1600));await wake.feed(block);if(!last.listening)throw new Error(last.error||last.phase)}
    for(let i=0;i<20;i++)await wake.feed(new Float32Array(1600));
    return last.count-before;
  };
  for(const [index,voice] of fixtures.voices.entries()){
    const started=Date.now();
    for(const [i,take] of voice.enrol.entries())wake.sample(i,readSample(take.file));
    await wake.train();if(last.error)throw new Error(last.error);
    const trainMs=Date.now()-started;
    wake.test(true);await wake.enable('balanced');if(!last.listening)throw new Error(last.error||last.phase);
    const row={voice:voice.voice,lang:voice.lang,trainMs,positives:0,misses:0,near:0,nearFired:0,conditions:{}};
    for(const clip of voice.test){const fired=await replay(clip.file);row.positives++;row.misses+=!fired;const c=row.conditions[clip.condition]??={n:0,miss:0};c.n++;c.miss+=!fired}
    for(const clip of voice.near){row.near++;row.nearFired+=Boolean(await replay(clip.file))}
    result.voices.push(row);result.positives+=row.positives;result.misses+=row.misses;result.near+=row.near;result.nearFired+=row.nearFired;
    fs.copyFileSync(path.join(root,'wake/profile.json'),path.join(root,`profile-${index}.json`));
    if(index===0 && process.env.FILOW_WAKE_SKIP_BACKGROUND !== '1'){
      const cpu=()=>app.getAppMetrics().reduce((n,p)=>n+(p.cpu.cumulativeCPUUsage||0),0);
      const before=cpu();
      for(const bg of fixtures.background){result.falseAccepts+=await replay(bg.file);result.backgroundSeconds+=bg.seconds;console.log('background',bg.file,result.falseAccepts)}
      result.cpuSeconds=cpu()-before;
    }
    wake.stop();fs.writeFileSync(reportFile,JSON.stringify(result,null,2));console.log(JSON.stringify(row));
  }
  result.cpuPercentOneCore=result.cpuSeconds/result.backgroundSeconds*100;
  fs.writeFileSync(reportFile,JSON.stringify(result,null,2));
  wake.stop();clearTimeout(deadline);app.exit(0);
}).catch(e=>{console.error(e);wake?.stop();clearTimeout(deadline);app.exit(1)});
