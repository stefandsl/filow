// Actual webAudioPlayer scheduling into an in-memory AudioContext stand-in, never a device.
const fs = require('node:fs');
const esbuild = require('esbuild');
const ts = require('typescript');
const {execFileSync} = require('node:child_process');
const app = require('../../apps/desktop/tts.js');
const root = 'G:/FILOW/tmp/voice-natural';
esbuild.buildSync({stdin:{contents:'export {createSpeaker} from "./apps/web/lib/buddy/voice"; export {createProgressiveSpeech} from "./apps/web/lib/buddy/progressive";',resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',outfile:`${root}/queue-runtime.cjs`});
const {createSpeaker,createProgressiveSpeech}=require(`${root}/queue-runtime.cjs`);
fs.mkdirSync(`${root}/compiled`,{recursive:true});
for(const name of ['progressive','turn']){
  const source=execFileSync('git',['show',`92f28bf88d1a97f5c543428ff195adeb17366184:apps/web/lib/buddy/${name}.ts`],{encoding:'utf8',timeout:10000,windowsHide:true});
  fs.writeFileSync(`${root}/compiled/${name}.js`,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText);
}
const before=require(`${root}/compiled/progressive.js`).createProgressiveSpeech;
let events=[];
class SilentContext {
  constructor(){this.started=performance.now();this.state='running';this.destination={};}
  get currentTime(){return (performance.now()-this.started)/1000;}
  createBuffer(_channels,length,rate){const samples=new Float32Array(length);return {duration:length/rate,samples,rate,getChannelData:()=>samples};}
  createGain(){return {gain:{value:1,setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){}};}
  createBufferSource(){return {buffer:null,connect(){},start(at){events.push({at,buffer:this.buffer});},stop(){}};}
}
global.AudioContext=SilentContext;
const session=new app.TtsSession(root,()=>{}, {model:{...app.MODEL,id:'int8'}});
const threads=app.pickProfile().threads;
const listeners=new Set();
let requests=0;
const tts={
  onChunk:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
  speak:async req=>{requests++;const r=await session.speak({text:req.text,lang:req.lang,sid:req.voice,speed:1.05*req.speed,steps:5,threads},c=>{for(const fn of listeners)fn({...c,id:req.id});});return {ok:true,...r};},
  cancel:async()=>session.cancel(),played(){},
};
const speaker=createSpeaker({bridge:()=>({tts}),status:()=>({voice:'natural',naturalVoice:0,speed:1,offline:true}),
  uiLang:()=> 'it',isCurrent:()=>true,onFallback:r=>{throw new Error('Unexpected fallback '+r);}});
const texts=[
  'Apri il menu File. Scegli Salva con nome. Controlla il nome del documento. Infine premi Salva.',
  'Questo comando salva una copia del documento. Il file originale rimane disponibile.',
  'Ecco i passaggi:\n1. Apri il PDF.\n2. Controlla l’anteprima.\n3. Premi Stampa.',
];
const rows=[];
(async()=>{
  try{
    await session.start(threads);
    await session.speak({text:'Pronto.',lang:'it',sid:0,speed:1.05,steps:5,threads},()=>{});
    for(let index=0;index<texts.length;index++)for(const [variant,make] of [['before',before],['after',createProgressiveSpeech]]){
      events=[]; requests=0;
      const start=performance.now();
      const queue=make({isCurrent:()=>true,speak:text=>speaker.speak(text,1,{lang:'it'})});
      for(let n=1;n<=texts[index].length;n++)queue.update(texts[index].slice(0,n));
      await queue.finish(texts[index]);
      const first=events[0].at;
      const end=events.at(-1).at+events.at(-1).buffer.duration;
      const audio=new Float32Array(Math.ceil((end-first)*44100));
      const gaps=[];
      for(let n=0;n<events.length;n++){
        const e=events[n];
        audio.set(e.buffer.samples,Math.round((e.at-first)*44100));
        if(n)gaps.push((e.at-events[n-1].at-events[n-1].buffer.duration)*1000);
      }
      fs.writeFileSync(`${root}/queue-${variant}-${index}.wav`,app.wavBytes(audio,44100));
      rows.push({variant,index,requests,elapsedMs:performance.now()-start,gapsMs:gaps});
      fs.writeFileSync(`${root}/queue-results.json`,JSON.stringify(rows,null,2));
      console.log(variant,index,requests,gaps);
    }
  }finally{speaker.stop();await session.dispose();}
})().catch(e=>{console.error(e);process.exitCode=1;});
