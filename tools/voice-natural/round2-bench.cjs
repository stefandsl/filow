// File rendering only. Run via run.py with a hard deadline.
const fs = require('node:fs');
const {performance} = require('node:perf_hooks');
const sherpa = require('sherpa-onnx-node');
const before = require('G:/FILOW/tmp/voice-natural/round2-before.cjs');
const app = require('../../apps/desktop/tts');
const {normalizeNumbers} = require('../../apps/desktop/tts-numbers');
const {languageSpans, crossfade} = require('../../apps/desktop/tts-spans');
const {finishAudio} = require('../../apps/desktop/tts-audio');
const {rows} = require('./round2-corpus.cjs');
const {respell} = require('./round2-lexicon.cjs');
const root = 'G:/FILOW/tmp/voice-natural/round2';
fs.mkdirSync(root,{recursive:true});
const [mode='after',kind='listen',langFilter='all'] = process.argv.slice(2);
const idFilter = process.argv[5];
const dir='G:/FILOW/tmp/voice-natural/models/int8';
const f = n=>`${dir}/${n}`;
const tts=new sherpa.OfflineTts({model:{supertonic:{durationPredictor:f('duration_predictor.int8.onnx'),textEncoder:f('text_encoder.int8.onnx'),vectorEstimator:f('vector_estimator.int8.onnx'),vocoder:f('vocoder.int8.onnx'),ttsJson:f('tts.json'),unicodeIndexer:f('unicode_indexer.bin'),voiceStyle:f('voice.bin')},numThreads:app.pickProfile().threads,provider:'cpu',debug:false},maxNumSentences:1});
// speed100: the round-2 pipeline at speed 1.0 instead of the 1.05 lift (Russian speed A/B on the listening page).
const speed=mode==='speed100'?1:1.05;
const generate=(text,lang,sid)=>tts.generate({text,enableExternalBuffer:false,generationConfig:new sherpa.GenerationConfig({sid,speed,numSteps:5,extra:{lang}})});
generate('Ready.','en',5);
const concat=chunks=>{const out=new Float32Array(chunks.reduce((n,c)=>n+c.length,0));let at=0;for(const c of chunks){out.set(c,at);at+=c.length;}return out;};
const rms=s=>Math.sqrt(s.reduce((n,x)=>n+x*x,0)/Math.max(1,s.length));
const results=[];
for(const row of rows.filter(r=>r.kind===kind && (langFilter==='all'||r.lang===langFilter) && (!idFilter||r.id===idFilter))){
  const sid={it:0,en:5,ru:0,ro:9,ja:0}[row.lang];
  const pieces=before.splitSentences(mode==='before'?before.speakable(row.text,row.lang):app.speakable(row.text,row.lang,false),row.lang);
  const chunks=[],spans=[],details=[];
  let firstMs=0,workMs=0,firstDuration=0;
  for(const [i,piece] of pieces.entries()){
    const parts=mode==='before'||mode==='lexicon'?[{text:piece.text,lang:row.lang}]:languageSpans(piece.text,row.lang);
    let joined=new Float32Array(0);
    for(const [j,span] of parts.entries()){
      const text=mode==='before'?span.text:mode==='lexicon'?respell(normalizeNumbers(span.text,span.lang),span.lang):normalizeNumbers(span.text,span.lang);
      const start=performance.now();const audio=generate(text,span.lang,sid);const ms=performance.now()-start;
      const end=j===parts.length-1;
      const trimmed=mode==='before'?before.trimSilence(audio.samples,audio.sampleRate):finishAudio(audio.samples,audio.sampleRate,0.003,!end);
      if(!i&&!j){firstMs=ms;firstDuration=trimmed.length/audio.sampleRate;}
      workMs+=ms;
      details.push({text,lang:span.lang,ms,seconds:trimmed.length/audio.sampleRate,rawTailRms:rms(audio.samples.slice(-Math.round(audio.sampleRate*.02)))});
      joined=mode==='before'?trimmed:crossfade(joined,trimmed,audio.sampleRate);
      if(span.lang==='en' && row.lang!=='en'){
        const wav=`${root}/${mode}-${row.id}-span-${i}-${j}.wav`;
        fs.writeFileSync(wav,app.wavBytes(trimmed,audio.sampleRate));spans.push({text:span.text,wav});
      }
    }
    chunks.push(joined);
    if(i<pieces.length-1) chunks.push(new Float32Array(Math.round(tts.sampleRate*piece.pause/1000)));
  }
  const samples=concat(chunks),wav=`${root}/${mode}-${row.id}.wav`;
  fs.writeFileSync(wav,app.wavBytes(samples,tts.sampleRate));
  results.push({...row,mode,sid,wav,firstMs,firstDuration,workMs,seconds:samples.length/tts.sampleRate,spans,details,tail20Rms:rms(samples.slice(-Math.round(tts.sampleRate*.02))),tail150Rms:rms(samples.slice(-Math.round(tts.sampleRate*.15)))});
  fs.writeFileSync(`${root}/${mode}-${kind}-${langFilter}.json`,JSON.stringify(results,null,2));
  console.log(mode,row.id,firstMs.toFixed(0),workMs.toFixed(0));
}
