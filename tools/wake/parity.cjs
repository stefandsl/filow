// Compare identical decoded WAV samples, offline and streaming, to Python.
const fs = require('node:fs');
const path = require('node:path');
let { createEmbedding, createStream } = require('../../apps/desktop/wake-head');
if (process.argv.includes('--baseline')) {
  const {execFileSync} = require('node:child_process');
  const {createRequire} = require('node:module');
  const source = execFileSync('git', ['show', '0a21663:apps/desktop/wake-head.js'], {encoding:'utf8',windowsHide:true});
  const module = {exports:{}};
  require('node:vm').runInNewContext(source, {module,require:createRequire(path.resolve('apps/desktop/wake-head.js')),Float32Array,Int8Array,Buffer});
  ({createEmbedding,createStream}=module.exports);
}
const { readSample } = require('../../apps/desktop/wake');
const [dir, reference, output] = process.argv.slice(2);
const floats = file => { const b = fs.readFileSync(file); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };
function compare(a, b) {
  if (a.length !== b.length) return { lengths: [a.length, b.length] };
  let max = 0, cosine = 1;
  for (let i = 0; i < a.length; i += 96) {
    let ab = 0, aa = 0, bb = 0;
    for (let j = i; j < Math.min(i + 96, a.length); j++) { max = Math.max(max, Math.abs(a[j] - b[j])); ab += a[j]*b[j]; aa += a[j]*a[j]; bb += b[j]*b[j]; }
    cosine = Math.min(cosine, ab / Math.sqrt(aa * bb));
  }
  return { max, cosine };
}
(async () => {
  const embedding = await createEmbedding(dir), rows = [];
  for (const clip of JSON.parse(fs.readFileSync(path.join(reference, 'index.json')))) {
    const x = readSample(clip.file), ref = floats(path.join(reference, clip.stem + '.emb'));
    const offline = await embedding.embed(x);
    let streamed = new Float32Array();
    const spy = { spectrogram: embedding.spectrogram, vectors: async spec => { const e = await embedding.vectors(spec); streamed = e.length > 96 ? e : Float32Array.from([...streamed, ...e]); streamed = streamed.slice(-1152); return e; } };
    const stream = createStream(spy, {weights: Array(1152).fill(0), bias: 0});
    for (let at = 0; at < x.length; at += 1600) await stream.feed(x.subarray(at, at + 1600));
    const frames = Math.floor((Math.floor((x.length - 480) / 1280) * 8 - 76) / 8) + 1;
    rows.push({...clip, mel: compare(await embedding.spectrogram(x), floats(path.join(reference, clip.stem + '.mel'))), offline: compare(offline, ref), streaming: compare(streamed, ref.subarray(Math.max(0, frames - 12) * 96, frames * 96))});
  }
  await embedding.dispose(); fs.writeFileSync(output, JSON.stringify(rows, null, 2));
  console.log(JSON.stringify({clips: rows.length, offlineMax: Math.max(...rows.map(r=>r.offline.max)), streamMax: Math.max(...rows.map(r=>r.streaming.max)), streamCosine: Math.min(...rows.map(r=>r.streaming.cosine)), first:rows[0]}));
})().catch(e => {console.error(e); process.exitCode = 1;});
