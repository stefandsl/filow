// Independent local Whisper turbo transcription; never opens a microphone.
const fs = require('node:fs');
const sherpa = require('sherpa-onnx-node');
const app = require('../../apps/desktop/tts.js');
const root = 'G:/FILOW/tmp/voice-natural';
const [lang, ...names] = process.argv.slice(2);
const lock = `${root}/asr-${lang}.lock`;
try { fs.writeFileSync(lock,String(process.pid),{flag:'wx'}); }
catch (error) { if (error.code === 'EEXIST') { console.log('Already scoring',lang); process.exit(0); } throw error; }
process.on('exit',()=>{try{fs.unlinkSync(lock);}catch{/* Already removed during teardown. */}});
const dir = `${root}/models/sherpa-onnx-whisper-turbo`;
const rec = new sherpa.OfflineRecognizer({featConfig: {sampleRate:16000, featureDim:80}, modelConfig: {
  whisper: {encoder:`${dir}/turbo-encoder.int8.onnx`, decoder:`${dir}/turbo-decoder.int8.onnx`, language:lang, task:'transcribe', tailPaddings:-1},
  tokens:`${dir}/turbo-tokens.txt`, numThreads:4, provider:'cpu', debug:0,
}});
for (const name of names) {
  const rows = JSON.parse(fs.readFileSync(`${root}/${name}.json`)).filter(r=>r.lang===lang);
  const output = `${root}/${name}-asr-${lang}.json`;
  if(fs.existsSync(output)){
    const previous=JSON.parse(fs.readFileSync(output));
    if(previous.length===rows.length && previous.every((r,i)=>r.reference===app.speakable(rows[i].source,lang))){console.log('Cached',name,lang);continue;}
  }
  const result=[];
  for (const row of rows) {
    const wave=sherpa.readWave(row.wav);
    const stream=rec.createStream();
    stream.acceptWaveform({sampleRate:wave.sampleRate,samples:wave.samples});
    rec.decode(stream);
    result.push({name,lang,index:row.index,reference:app.speakable(row.source,lang),hypothesis:rec.getResult(stream).text.trim()});
    fs.writeFileSync(output,JSON.stringify(result,null,2));
    console.log(name,lang,row.index,result.at(-1).hypothesis);
  }
}
