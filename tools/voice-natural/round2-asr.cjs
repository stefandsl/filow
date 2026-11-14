// Offline recognizer. English-word recall is a proxy, not an accent or naturalness judge.
const fs=require('node:fs');
const sherpa=require('sherpa-onnx-node');
const {normalizeNumbers}=require('../../apps/desktop/tts-numbers');
const root='G:/FILOW/tmp/voice-natural/round2';
const [mode='before',kind='foreign',lang='en',sourceLang='all']=process.argv.slice(2);
const input=`${root}/${mode}-${kind}-all.json`;
const rows=JSON.parse(fs.readFileSync(input)).filter(r=>(kind==='foreign'||r.lang===lang) && (sourceLang==='all'||r.lang===sourceLang));
const output=`${root}/asr-${mode}-${kind}-${lang}${sourceLang==='all'?'':'-'+sourceLang}.json`;
const seed=`${root}/asr-${mode}-${kind}-${lang}.json`;
const cached=fs.existsSync(output)?JSON.parse(fs.readFileSync(output)):fs.existsSync(seed)?JSON.parse(fs.readFileSync(seed)):[];
const contextBefore=mode==='span-before'?JSON.parse(fs.readFileSync(`${root}/asr-before-foreign-en.json`)):[];
const dir='G:/FILOW/tmp/voice-natural/models/sherpa-onnx-whisper-turbo';
const rec=new sherpa.OfflineRecognizer({featConfig:{sampleRate:16000,featureDim:80},modelConfig:{whisper:{encoder:`${dir}/turbo-encoder.int8.onnx`,decoder:`${dir}/turbo-decoder.int8.onnx`,language:lang,task:'transcribe',tailPaddings:-1},tokens:`${dir}/turbo-tokens.txt`,numThreads:4,provider:'cpu',debug:0}});
const transcribe=wav=>{const wave=sherpa.readWave(wav),stream=rec.createStream();stream.acceptWaveform({sampleRate:wave.sampleRate,samples:wave.samples});rec.decode(stream);return rec.getResult(stream).text.trim();};
const tokens=s=>s.toLowerCase().normalize('NFD').replace(/\p{M}/gu,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(/\s+/);
const results=[];
for(const row of rows){
  const previous=cached.find(r=>r.id===row.id);
  if(previous){results.push(previous);fs.writeFileSync(output,JSON.stringify(results,null,2));continue;}
  const hypothesis=contextBefore.find(r=>r.id===row.id)?.hypothesis??transcribe(row.wav);
  const got=tokens(hypothesis);
  const matched=(row.targets??[]).filter(w=>got.includes(w.toLowerCase()));
  const spans=[];
  if(kind==='foreign' && (mode==='after'||mode==='span-before')) for(const span of row.spans) spans.push({...span,hypothesis:transcribe(span.wav)});
  results.push({id:row.id,lang:row.lang,source:row.text,targets:row.targets,matched,hypothesis,spans,normalized:normalizeNumbers(hypothesis,row.lang)});
  fs.writeFileSync(output,JSON.stringify(results,null,2));
  console.log(row.id,hypothesis);
}
