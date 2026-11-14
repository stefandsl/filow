// Alternating warm worker pairs for the strict first-piece latency allowance.
const fs=require('node:fs');
const app=require('../../apps/desktop/tts.js');
const corpus=require('./corpus.json');
const root='G:/FILOW/tmp/voice-natural';
const lang=process.argv[2]||'ro';
const sid=Number(process.argv[3]||2);
const session=new app.TtsSession(root,()=>{}, {model:{...app.MODEL,id:'int8'}});
const threads=app.pickProfile().threads;
const rows=[];
(async()=>{
  try{
    await session.start(threads);
    await session.speak({text:corpus[lang][0],lang,sid:0,speed:1.05,steps:5,threads},()=>{});
    for(let repeat=0;repeat<5;repeat++)for(const [index,source] of corpus[lang].entries()){
      const text=app.splitSentences(app.speakable(source,lang),lang)[0].text;
      for(const speaker of repeat%2?[sid,0]:[0,sid]){
        const start=performance.now();let firstMs=0;
        await session.speak({text,lang,sid:speaker,speed:1.05,steps:5,threads},()=>{if(!firstMs)firstMs=performance.now()-start;});
        rows.push({lang,index,repeat,sid:speaker,text,firstMs});
        fs.writeFileSync(`${root}/latency-${lang}.json`,JSON.stringify(rows,null,2));
      }
    }
  }finally{await session.dispose();}
})().catch(e=>{console.error(e);process.exitCode=1;});
