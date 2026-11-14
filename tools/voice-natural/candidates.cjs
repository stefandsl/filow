const fs = require('node:fs');
const {performance} = require('node:perf_hooks');
const root = 'G:/FILOW/tmp/voice-natural';
const sherpa = require(`${root}/legacy/node_modules/sherpa-onnx-node`);
const app = require('../../apps/desktop/tts.js');
const corpus = require('./corpus.json');
const family = process.argv[2];
const voices = {en: 'en_US-joe-medium', it: 'it_IT-paola-medium', ru: 'ru_RU-denis-medium', ro: 'ro_RO-mihai-medium'};
const rows = [];
for (const lang of family === 'kokoro' ? ['en', 'it'] : Object.keys(voices)) {
  const dir = `${root}/models/${family === 'kokoro' ? 'kokoro-int8-multi-lang-v1_0' : 'vits-piper-' + voices[lang]}`;
  const threads = app.pickProfile().threads;
  const model = family === 'kokoro' ? {kokoro: {model: `${dir}/model.int8.onnx`, voices: `${dir}/voices.bin`,
    tokens: `${dir}/tokens.txt`, dataDir: `${dir}/espeak-ng-data`, dictDir: `${dir}/dict`,
    lang: lang === 'it' ? 'it' : 'en-us', lexicon: lang === 'it' ? '' : `${dir}/lexicon-us-en.txt`}} :
    {vits: {model: `${dir}/${voices[lang]}.onnx`, tokens: `${dir}/tokens.txt`, dataDir: `${dir}/espeak-ng-data`}};
  const load = performance.now();
  const tts = new sherpa.OfflineTts({model: {...model, numThreads: threads, provider: 'cpu', debug: false}, maxNumSentences: 1});
  const loadMs = performance.now() - load;
  const generate = (text) => tts.generate({text, sid: family === 'kokoro' ? (lang === 'it' ? 35 : 3) : 0, speed: 1});
  generate(corpus[lang][0]);
  fs.mkdirSync(`${root}/audio/${family}`, {recursive: true});
  for (const [index, source] of corpus[lang].entries()) {
    const text = app.speakable(source, lang);
    const pieces = app.splitSentences(text, lang);
    let workMs = 0, firstMs = 0;
    const chunks = [], detail = [];
    for (const [i,p] of pieces.entries()) {
      const start = performance.now();
      const a = generate(p.text);
      const ms = performance.now() - start;
      const trim = app.trimSilence(a.samples, a.sampleRate);
      if (!i) firstMs = ms;
      workMs += ms;
      chunks.push(trim);
      if (i < pieces.length - 1) chunks.push(new Float32Array(Math.round(p.pause/1000*a.sampleRate)));
      detail.push({text:p.text, ms, rawSeconds:a.samples.length/a.sampleRate, trimmedSeconds:trim.length/a.sampleRate, pauseMs:p.pause});
    }
    const samples = new Float32Array(chunks.reduce((n,c)=>n+c.length,0));
    let offset=0;
    for (const c of chunks) { samples.set(c,offset); offset+=c.length; }
    const wav = `${root}/audio/${family}/${lang}-${index}.wav`;
    fs.writeFileSync(wav,app.wavBytes(samples,tts.sampleRate));
    rows.push({name:family,lang,index,source,text,wav,threads,loadMs,firstMs,workMs,
      seconds:samples.length/tts.sampleRate,rtf:workMs/1000/(samples.length/tts.sampleRate),rssMB:process.memoryUsage().rss/2**20, detail});
    fs.writeFileSync(`${root}/${family}.json`,JSON.stringify(rows,null,2));
    console.log(family,lang,index,firstMs.toFixed(0));
  }
}
