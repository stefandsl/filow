// The actual desktop worker/session, fed by the actual progressive queue. No player/device.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const {execFileSync} = require('node:child_process');
const app = require('../../apps/desktop/tts.js');
const corpus = require('./corpus.json');
const root = 'G:/FILOW/tmp/voice-natural';
const out = `${root}/compiled`;
fs.mkdirSync(out,{recursive:true});
for (const name of ['turn','progressive']) {
  const source=name === 'progressive'
    ? execFileSync('git',['show','92f28bf88d1a97f5c543428ff195adeb17366184:apps/web/lib/buddy/progressive.ts'],{encoding:'utf8',timeout:10000,windowsHide:true})
    : fs.readFileSync(path.join(__dirname,`../../apps/web/lib/buddy/${name}.ts`),'utf8');
  fs.writeFileSync(`${out}/${name}.js`,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText);
}
const {createProgressiveSpeech}=require(`${out}/progressive.js`);
const profile=app.pickProfile();
const [name='pipeline',stepsArg='5']=process.argv.slice(2);
const session=new app.TtsSession(root,()=>{}, {model:{...app.MODEL,id:'int8'}});
const rows=[];
(async()=>{
  try {
    await session.start(profile.threads);
    await session.speak({text:'Pronto.',lang:'it',sid:0,speed:1.05,steps:5,threads:profile.threads},()=>{});
    fs.mkdirSync(`${root}/audio/${name}`,{recursive:true});
    for (const [lang,texts] of Object.entries(corpus)) for (const [index,source] of texts.entries()) {
      const chunks=[],detail=[];
      let firstMs=0,workMs=0;
      const start=performance.now();
      const queue=createProgressiveSpeech({isCurrent:()=>true,speak:async(text)=>{
        await session.speak({text,lang,sid:0,speed:1.05,steps:Number(stepsArg),threads:profile.threads},c=>{
          if (!chunks.length) firstMs=performance.now()-start;
          chunks.push(c.samples);
          // Matches voice.ts: the last piece of a request has no appended pause.
          if (!c.last) chunks.push(new Float32Array(Math.round(c.pause/1000*c.sampleRate)));
          detail.push({text:c.text,last:c.last,pauseMs:c.last?0:c.pause});
        });
      }});
      // Fully available token stream isolates speech scheduling from LLM/network time.
      for(let n=1;n<=source.length;n++) queue.update(source.slice(0,n));
      await queue.finish(source);
      workMs=performance.now()-start;
      const audio=new Float32Array(chunks.reduce((n,c)=>n+c.length,0));
      let offset=0; for(const c of chunks){audio.set(c,offset);offset+=c.length;}
      const wav=`${root}/audio/${name}/${lang}-${index}.wav`;
      fs.writeFileSync(wav,app.wavBytes(audio,44100));
      rows.push({name,lang,index,source,text:app.speakable(source,lang),wav,firstMs,workMs,seconds:audio.length/44100,
        rtf:workMs/1000/(audio.length/44100),threads:profile.threads,steps:Number(stepsArg),detail});
      fs.writeFileSync(`${root}/${name}.json`,JSON.stringify(rows,null,2));
      console.log(name,lang,index,firstMs.toFixed(0));
    }
  } finally { await session.dispose(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
