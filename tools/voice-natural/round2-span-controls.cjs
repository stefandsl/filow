// Isolated span controls: the same English spans/speaker, rendered with the host-language tag.
// Contextual before/after sentences remain a separate measurement.
const fs=require('node:fs');
const sherpa=require('sherpa-onnx-node');
const before=require('G:/FILOW/tmp/voice-natural/round2-before.cjs');
const root='G:/FILOW/tmp/voice-natural/round2';
const dir='G:/FILOW/tmp/voice-natural/models/int8';
const f=n=>`${dir}/${n}`;
const tts=new sherpa.OfflineTts({model:{supertonic:{durationPredictor:f('duration_predictor.int8.onnx'),textEncoder:f('text_encoder.int8.onnx'),vectorEstimator:f('vector_estimator.int8.onnx'),vocoder:f('vocoder.int8.onnx'),ttsJson:f('tts.json'),unicodeIndexer:f('unicode_indexer.bin'),voiceStyle:f('voice.bin')},numThreads:4,provider:'cpu',debug:false},maxNumSentences:1});
const baseline=JSON.parse(fs.readFileSync(`${root}/before-foreign-all.json`));
const rows=[];
for(const row of JSON.parse(fs.readFileSync(`${root}/after-foreign-all.json`))){
  const spans=[];
  for(const [index,span] of row.spans.entries()){
    const audio=tts.generate({text:span.text,enableExternalBuffer:false,generationConfig:new sherpa.GenerationConfig({sid:row.sid,speed:1.05,numSteps:5,extra:{lang:row.lang}})});
    const wav=`${root}/span-before-${row.id}-${index}.wav`;
    fs.writeFileSync(wav,before.wavBytes(before.trimSilence(audio.samples,audio.sampleRate),audio.sampleRate));
    spans.push({text:span.text,wav});
  }
  rows.push({...row,wav:baseline.find(r=>r.id===row.id).wav,spans});
  fs.writeFileSync(`${root}/span-before-foreign-all.json`,JSON.stringify(rows,null,2));
  console.log(row.id,spans.length);
}
