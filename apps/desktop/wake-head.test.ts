import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { expect, it } from 'vitest';
import fixture from './wake-data/reference.json';
const require = createRequire(import.meta.url);
const { createStream, createEmbedding, trainHead, dot, background } = require('./wake-head');
const { speechEnd, positiveWindows } = require('./wake-head');
const { enrol } = require('./wake-head');

it('uses optional personal negatives in training and rejects more than two', async () => {
  const embedding={embed:async (pcm:Float32Array)=>{
    const negative=pcm[16000]>.7;
    const out=new Float32Array(60*96);
    for(let i=0;i<60;i++){out[i*96]=negative?.8:1;out[i*96+1]=negative?1:0;}
    return out;
  }};
  const takes=Array.from({length:5},()=>new Float32Array(16000).fill(.3));
  const negative=new Float32Array(16000).fill(.8),data=new Float32Array(3000*96);
  for(let i=0;i<data.length;i+=96)data[i]=-1;
  const bg={data,meta:{segments:[{frames:3000}]}};
  const before=await enrol(embedding,takes,bg),after=await enrol(embedding,takes,bg,[negative,negative]);
  const feature=(await embedding.embed(Float32Array.from([...new Float32Array(16000),...negative]))).slice(0,1152);
  expect(dot(after.weights,feature)+after.bias).toBeLessThan(dot(before.weights,feature)+before.bias-1);
  await expect(enrol(embedding,takes,bg,[negative,negative,negative])).rejects.toThrow('At most two');
});

it('labels the last energetic complete frame relative to peak energy at any gain', () => {
  const audio = new Float32Array(16000);
  audio.fill(.5, 3200, 6400);
  audio.fill(.01, 6400, 9600); // below -30 dB energy
  audio[15999] = .02; // isolated tail sample is not a speech frame
  expect(speechEnd(audio)).toBe(6400);
  expect(speechEnd(Float32Array.from(audio, x => x * .001))).toBe(6400);
  expect(speechEnd(new Float32Array(16001))).toBe(16001);
});

it('keeps enrolment tails while locating positive windows at the speech end', async () => {
  const audio = new Float32Array(32000);
  audio.fill(.5, 3200, 16000);
  audio.fill(.001, 16000); // retain context even though this is not speech
  const lengths: number[] = [];
  const embedding = { embed: async (pcm: Float32Array) => {
    lengths.push(pcm.length);
    // Each feature identifies its vector index, independently of the trainer.
    return Float32Array.from({length: 60 * 96}, (_, i) => Math.floor(i / 96));
  }};
  const windows = await positiveWindows(embedding, Array(5).fill(audio));
  expect(lengths).toHaveLength(80);
  expect(lengths[1]).toBe(16000 + 32000 + 9600);
  expect(windows).toHaveLength(320);
  // Speed 1, end 1 s, lead 1 s, offset 80 ms: reference index_at is 17.
  expect(windows[4][0]).toBe(6);
  expect(windows[4].at(-1)).toBe(17);
});

it('rejects tampered hard-negative features before training', () => {
  const root = path.resolve(__dirname, '../../tmp/wake-tests');
  if (/^c:/i.test(root)) throw new Error('Wake tests must not write on C:');
  fs.mkdirSync(root, {recursive:true});
  const dir = fs.mkdtempSync(path.join(root, 'wake-hard-'));
  if (path.dirname(path.resolve(dir)) !== root) throw new Error('Unexpected test directory');
  try {
    const b = Buffer.alloc(96);
    fs.writeFileSync(path.join(dir, 'background.bin'), b);
    fs.writeFileSync(path.join(dir, 'background.json'), JSON.stringify({sha256:crypto.createHash('sha256').update(b).digest('hex')}));
    fs.writeFileSync(path.join(dir, 'hard-negatives.bin'), Buffer.alloc(1152 * 4));
    fs.writeFileSync(path.join(dir, 'hard-negatives.json'), JSON.stringify({windows:1,sha256:'tampered'}));
    expect(() => background(dir)).toThrow('hard-negative checksum');
  } finally {
    fs.rmSync(dir, {recursive:true,force:true});
  }
});

it('shipped hard negatives are verified numbers and reduce a confusable negative score', () => {
  const shipped = background(path.join(__dirname, 'wake-data'));
  expect(shipped.hard.length).toBe(shipped.hardMeta.windows * 1152);
  expect(shipped.hardMeta.voices).toHaveLength(10);
  const positives = Array.from({length: 20}, () => { const x = new Float32Array(1152); x[0] = 1; return x; });
  const data = new Float32Array(3000 * 96);
  for (let i = 0; i < data.length; i += 96) data[i] = -1;
  const hard = new Float32Array(1152); hard[0] = .8; hard[1] = 1;
  const bg = {data, meta: {segments: [{frames: 3000}], sha256: 'fixture'}};
  const before = trainHead(positives, bg), after = trainHead(positives, {...bg, hard});
  expect(dot(after.weights, hard) + after.bias).toBeLessThan(dot(before.weights, hard) + before.bias - 2);
  expect(dot(after.weights, positives[0]) + after.bias).toBeGreaterThan(0);
});

it('re-normalizes old context when the mel floor rises, preserves stride and resets', async () => {
  let block = 0;
  const calls: Float32Array[] = [];
  const embedding = {
    spectrogram: async () => new Float32Array(256).fill(++block < 22 ? -10 : 3),
    vectors: async (spec: Float32Array) => {
      calls.push(spec.slice());
      return new Float32Array((Math.floor((spec.length / 32 - 76) / 8) + 1) * 96).fill(spec[0]);
    },
  };
  const stream = createStream(embedding, { weights: Array(1152).fill(1), bias: 0 });
  let score = 0;
  for (let i = 0; i < 22; i++) score = await stream.feed(new Float32Array(i ? 1280 : 1760));
  expect(calls.at(-1)![0]).toBe(-5);
  expect(score).toBe(-5 * 1152);
  expect(calls.at(-1)!.length / 32).toBe(172);
  stream.reset(); block = 0; calls.length = 0;
  await stream.feed(new Float32Array(1760 + 9 * 1280));
  expect(calls).toHaveLength(1); expect(calls[0][0]).toBe(-10);
});

// Models are downloaded only by explicit setup. CI can provide this path to run
// the native numerical gate; the pure framing/floor test above always runs.
it.skipIf(!process.env.FILOW_WAKE_MODEL_DIR)('matches spike prefix reference vectors through real ONNX sessions', async () => {
  const e = await createEmbedding(path.resolve(process.env.FILOW_WAKE_MODEL_DIR!));
  try {
    let state = fixture.seed;
    const audio = Float32Array.from({length: 480 + 1280 * 30}, (_, i) => {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return i < 14000 ? 0 : ((state >>> 16) - 32768) / 32768 * (i < 26000 ? .03 : .4);
    });
    let history = new Float32Array();
    const tapped = { spectrogram: e.spectrogram, vectors: async (spec: Float32Array) => {
      const next = await e.vectors(spec);
      history = next.length > 96 ? next : Float32Array.from([...history, ...next]);
      history = history.slice(-1152); return next;
    }};
    const stream = createStream(tapped, {weights: Array(1152).fill(0), bias: 0});
    let at = 0;
    for (const row of fixture.rows) {
      while (at < row.samples) { const end = Math.min(row.samples, at + 1600); await stream.feed(audio.subarray(at, end)); at = end; }
      expect(history.length).toBe(row.vectors.length);
      expect(Math.max(...history.map((v, i) => Math.abs(v - row.vectors[i])))).toBeLessThan(2e-5);
      const offline = (await e.embed(audio.subarray(0, at))).slice(-1152);
      expect(Math.max(...offline.map((v: number, i: number) => Math.abs(v - row.vectors[i])))).toBeLessThan(2e-5);
    }
  } finally { await e.dispose(); }
});
