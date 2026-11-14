// File-only CPU benchmark. Each invocation has an external hard timeout (run.py).
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const sherpa = require('sherpa-onnx-node');
const app = require('../../apps/desktop/tts.js');
const corpus = require('./corpus.json');
const root = 'G:/FILOW/tmp/voice-natural';
const [name = 'baseline', stepsArg = '5', sidArg = '0', mode = 'app', precision = 'int8', speedArg = '1.05'] = process.argv.slice(2);
const steps = Number(stepsArg), sid = Number(sidArg), speed = Number(speedArg);
const threads = app.pickProfile().threads;
const dir = `${root}/models/${precision}`;
const f = (stem) => `${dir}/${stem}${precision === 'int8' ? '.int8' : ''}.onnx`;
const started = performance.now();
const tts = new sherpa.OfflineTts({model: {supertonic: {
  durationPredictor: f('duration_predictor'), textEncoder: f('text_encoder'),
  vectorEstimator: f('vector_estimator'), vocoder: f('vocoder'),
  ttsJson: `${dir}/tts.json`, unicodeIndexer: `${dir}/unicode_indexer.bin`, voiceStyle: `${dir}/voice.bin`,
}, numThreads: threads, provider: 'cpu', debug: false}, maxNumSentences: 1});
const loadMs = performance.now() - started;
const generate = (text, lang) => tts.generate({text, enableExternalBuffer: false,
  generationConfig: new sherpa.GenerationConfig({sid, speed, numSteps: steps, extra: {lang}})});
generate('Pronto.', 'it');
fs.mkdirSync(`${root}/audio/${name}`, {recursive: true});
const rows = [];
for (const [lang, texts] of Object.entries(corpus)) {
  for (const [index, source] of texts.entries()) {
    const text = mode === 'raw' ? source : app.speakable(source, lang);
    const pieces = mode === 'whole' || mode === 'raw' ? [{text, pause: 0}] : app.splitSentences(text, lang);
    const chunks = [], detail = [];
    let workMs = 0, firstMs = 0;
    for (const [n, piece] of pieces.entries()) {
      const start = performance.now();
      const audio = generate(piece.text, lang);
      const ms = performance.now() - start;
      const trimmed = app.trimSilence(audio.samples, audio.sampleRate);
      if (!n) firstMs = ms;
      workMs += ms;
      fs.writeFileSync(`${root}/audio/${name}/${lang}-${index}-${n}-raw.wav`, app.wavBytes(audio.samples, audio.sampleRate));
      chunks.push(trimmed);
      if (n < pieces.length - 1) chunks.push(new Float32Array(Math.round(piece.pause / 1000 * audio.sampleRate)));
      detail.push({text: piece.text, ms, rawSeconds: audio.samples.length/audio.sampleRate, trimmedSeconds: trimmed.length/audio.sampleRate, pauseMs: piece.pause});
    }
    const samples = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
    let offset = 0;
    for (const c of chunks) { samples.set(c, offset); offset += c.length; }
    const wav = `${root}/audio/${name}/${lang}-${index}.wav`;
    fs.writeFileSync(wav, app.wavBytes(samples, tts.sampleRate));
    rows.push({name, lang, index, source, text, wav, steps, sid, speed, threads, mode, precision,
      loadMs, firstMs, workMs, seconds: samples.length/tts.sampleRate, rtf: workMs/1000/(samples.length/tts.sampleRate),
      rssMB: process.memoryUsage().rss/2**20, sampleRate: tts.sampleRate, detail});
    fs.writeFileSync(`${root}/${name}.json`, JSON.stringify(rows, null, 2));
    console.log(`${name} ${lang}-${index} first=${firstMs.toFixed(0)}ms RTF=${rows.at(-1).rtf.toFixed(3)}`);
  }
}
