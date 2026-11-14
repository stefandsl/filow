// Real desktop sessions/workers, deterministic virtual Web Audio schedule, no player/device.
const fs=require('node:fs');
const path=require('node:path');
const {Worker}=require('node:worker_threads');
const app=require('../../apps/desktop/tts');
const before=require('G:/FILOW/tmp/voice-natural/round2-before.cjs');
const {listen}=require('./round2-corpus.cjs');
const root='G:/FILOW/tmp/voice-natural';
const opts={model:{...app.MODEL,id:'int8'},makeWorker:()=>new Worker(path.resolve('apps/desktop/tts-worker.js'))};
const sessions={before:new before.TtsSession(root,()=>{},opts),after:new app.TtsSession(root,()=>{},opts)};
const profile=app.pickProfile();
const rows=[];
const chosen={it:[listen.it[0],listen.it[6],listen.it[9]],ru:[listen.ru[0],listen.ru[3],'Нажмите синюю кнопку справа.'],ro:[listen.ro[0],listen.ro[3],'Apasă butonul albastru din dreapta.'],en:[listen.en[0],listen.en[1],listen.en[2]],ja:['Fileを開いてください。','会議は2026年11月14日の9:05です。','右上の青いボタンを押してください。']};
(async()=>{
  try{
    for(const session of Object.values(sessions)){
      await session.start(profile.threads);
      await session.speak({text:'Ready.',lang:'en',sid:5,speed:1.05,steps:5,threads:profile.threads},()=>{});
    }
    for(let repeat=0;repeat<3;repeat++)for(const [lang,texts]of Object.entries(chosen))for(const [index,text]of texts.entries())for(const mode of repeat%2?['after','before']:['before','after']){
      const start=performance.now();let first=0,next=0,end=0,gaps=0;const chunks=[];
      const request={text,lang,sid:{it:0,en:5,ru:0,ro:9,ja:0}[lang],speed:1.05,steps:5,threads:profile.threads};
      await sessions[mode].speak(request,c=>{
        const arrived=(performance.now()-start)/1000;
        const lead=chunks.length?0.03:(c.leadMs??30)/1000;
        const at=Math.max(arrived+lead,next);
        if(chunks.length)gaps+=Math.max(0,at-next);
        else first=at*1000;
        end=at+c.samples.length/c.sampleRate;
        next=end+(c.last?0:c.pause/1000);
        chunks.push({arrivedMs:arrived*1000,atMs:at*1000,seconds:c.samples.length/c.sampleRate,pause:c.pause,text:c.text,leadMs:c.leadMs??30});
      });
      rows.push({mode,repeat,lang,index,text,firstMs:first,extraGapMs:gaps*1000,chunks});
      fs.writeFileSync(`${root}/round2/latency.json`,JSON.stringify(rows,null,2));
      console.log(mode,lang,index,repeat,first.toFixed(0),Math.round(gaps*1000));
    }
  }finally{for(const session of Object.values(sessions))session.dispose();}
})().catch(e=>{console.error(e);process.exitCode=1;});
