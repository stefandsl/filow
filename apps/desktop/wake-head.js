// Personal logistic head. No network, device access or audio writes.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { readSample } = require("./wake-pcm");
const { augment } = require("./wake-augmentation");
const WIDTH = 96, WINDOW = 12, FEATURES = WIDTH * WINDOW;
const HARD_NEGATIVE_RATE = 0.2;
const dot = (w, x, start = 0) => { let s = 0; for (let j = 0; j < w.length; j++) s += w[j] * x[start + j]; return s; };
function validateProfile(p) {
  return p?.version === 1 && Array.isArray(p.weights) && p.weights.length === FEATURES && p.weights.every(Number.isFinite) && Number.isFinite(p.bias) && p.thresholds &&
    [p.thresholds.loose, p.thresholds.sensitive, p.thresholds.sure].every(Number.isFinite) && p.thresholds.loose <= p.thresholds.sensitive && p.thresholds.sensitive <= p.thresholds.sure;
}
function background(dir, bare = false) {
  const bank = bare ? "phrase-negatives" : "hard-negatives";
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "background.json"), "utf8"));
  const bytes = fs.readFileSync(path.join(dir, "background.bin"));
  if (crypto.createHash("sha256").update(bytes).digest("hex") !== meta.sha256) throw new Error("Wake background checksum mismatch");
  const data = Float32Array.from(new Int8Array(bytes.buffer, bytes.byteOffset, bytes.length), (v) => v / 127);
  const hardMeta = JSON.parse(fs.readFileSync(path.join(dir, `${bank}.json`), "utf8"));
  const hardBytes = fs.readFileSync(path.join(dir, `${bank}.bin`));
  if (crypto.createHash("sha256").update(hardBytes).digest("hex") !== hardMeta.sha256 || hardBytes.length !== hardMeta.windows * FEATURES * 4) throw new Error("Wake hard-negative checksum mismatch");
  const hard = new Float32Array(hardBytes.buffer.slice(hardBytes.byteOffset, hardBytes.byteOffset + hardBytes.length));
  if (!hard.every(Number.isFinite)) throw new Error("Invalid wake hard negatives");
  const prefixes = bare ? ["en", "it", "ro", "ru", "ja"].flatMap(lang =>
    ["ok", "hey"].map(name => readSample(path.join(dir, `prefix-${lang}-${name}.wav`)))) : [];
  return { data, meta, hard, hardMeta, prefixes };
}
function random(seed = 12345) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
// Balanced-class stochastic logistic regression with L2 regularization. Training
// and calibration are separate portions of the bundled background, never QA audio.
function trainHead(positives, bg, options = {}) {
  if (positives.length < 20 || positives.some((x) => x.length !== FEATURES)) throw new Error("Not enough usable enrolment windows");
  const rng = random();
  const w = new Float32Array(FEATURES);
  let bias = 0;
  const ranges = [];
  let start = 0;
  for (const s of bg.meta.segments) { ranges.push([start, start + Math.floor(s.frames / 3)]); start += s.frames; }
  for (let epoch = 0; epoch < 50; epoch++) {
    const rate = 0.08 / (1 + epoch / 12);
    for (let i = 0; i < 2400; i++) {
      const positive = i % 2 === 0;
      const range = ranges[Math.floor(rng() * ranges.length)];
      const hardRate = options.hardRate ?? HARD_NEGATIVE_RATE;
      const useHard = !positive && bg.hard?.length && hardRate > 0 && i % (2 * Math.round(1 / hardRate)) === 1;
      const offset = positive ? 0 : useHard ? Math.floor(rng() * (bg.hard.length / FEATURES)) * FEATURES : (range[0] + Math.floor(rng() * (range[1] - range[0] - WINDOW))) * WIDTH;
      const x = positive ? positives[Math.floor(rng() * positives.length)] : useHard ? bg.hard : bg.data;
      const error = (positive ? 1 : 0) - 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, dot(w, x, offset) + bias))));
      for (let j = 0; j < FEATURES; j++) w[j] += rate * (error * x[offset + j] - 0.00003 * w[j]);
      bias += rate * error;
      const step = epoch * 2400 + i + 1;
      if (options.trace && [1, 10, 120000].includes(step)) options.trace({ step, weights: Array.from(w), bias, loss: -Math.log(Math.max(1e-15, positive ? 1 - error : 1 + error)) });
    }
  }
  const scores = [];
  let hours = 0;
  start = 0;
  for (const segment of bg.meta.segments) {
    const cut = start + Math.floor(segment.frames / 3), end = start + segment.frames;
    for (let at = cut; at + WINDOW + 25 <= end; at += 25) {
      let best = -Infinity;
      for (let k = 0; k < 25; k++) best = Math.max(best, dot(w, bg.data, (at + k) * WIDTH) + bias);
      scores.push(best); hours += 2 / 3600;
    }
    start = end;
  }
  scores.sort((a, b) => b - a);
  const threshold = (budget) => scores[Math.floor(budget * hours)];
  const result = { version: 1, weights: Array.from(w), bias, thresholds: { loose: threshold(5), sensitive: threshold(0.5), sure: threshold(0.1) }, calibrationHours: hours, background: bg.meta.sha256, hardNegatives: bg.hardMeta?.sha256 };
  if (bg.prefixes?.length) {
    // Short keywords resemble ordinary words. Require the enrolled speaker's
    // score to move toward the lower tail of their positive training windows.
    const own = positives.map(x => dot(w, x) + bias).sort((a, b) => a - b);
    for (const [key, fraction] of [["loose", .05], ["sensitive", .1], ["sure", .2]]) {
      const floor = own[Math.floor(fraction * own.length)];
      result.thresholds[key] += .3 * Math.max(0, floor - result.thresholds[key]);
    }
  }
  if (!validateProfile(result)) throw new Error("Wake training failed");
  return result;
}
async function createEmbedding(dir) {
  const ort = require("onnxruntime-node");
  const opts = { intraOpNumThreads: 1, interOpNumThreads: 1, executionMode: "sequential", executionProviders: ["cpu"] };
  const mel = await ort.InferenceSession.create(path.join(dir, "melspectrogram.onnx"), opts);
  const emb = await ort.InferenceSession.create(path.join(dir, "embedding_model.onnx"), opts);
  async function spectrogram(samples) {
    const scaled = Float32Array.from(samples, (v) => v * 32767);
    const out = (await mel.run({ input: new ort.Tensor("float32", scaled, [1, scaled.length]) }))[mel.outputNames[0]];
    return Float32Array.from(out.data, (v) => v / 10 + 2);
  }
  async function vectors(spec) {
    const n = Math.floor((spec.length / 32 - 76) / 8) + 1;
    if (n <= 0) return new Float32Array();
    const input = new Float32Array(n * 76 * 32);
    for (let i = 0; i < n; i++) input.set(spec.subarray(i * 256, i * 256 + 76 * 32), i * 76 * 32);
    const out = (await emb.run({ input_1: new ort.Tensor("float32", input, [n, 76, 32, 1]) }))[emb.outputNames[0]].data;
    const result = Float32Array.from(out);
    for (let i = 0; i < n; i++) {
      let sum = 1e-18;
      for (let j = 0; j < WIDTH; j++) sum += result[i * WIDTH + j] ** 2;
      const norm = Math.sqrt(sum);
      for (let j = 0; j < WIDTH; j++) result[i * WIDTH + j] /= norm;
    }
    return result;
  }
  return { spectrogram, vectors, embed: async (samples) => vectors(await spectrogram(samples)), dispose: async () => { await mel.release(); await emb.release(); } };
}
function join(a, b) { const out = new Float32Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; }
function createStream(embedding, profile) {
  let audio = new Float32Array(), mel = new Float32Array(), history = new Float32Array();
  let peak = -Infinity, frames = 0;
  return {
    reset() { audio = new Float32Array(); mel = new Float32Array(); history = new Float32Array(); peak = -Infinity; frames = 0; },
    async feed(samples) {
      audio = join(audio, samples);
      let score = -Infinity;
      while (audio.length >= 1760) {
        const next = await embedding.spectrogram(audio.subarray(0, 1760));
        let nextPeak = peak;
        for (const value of next) nextPeak = Math.max(nextPeak, value);
        const changed = nextPeak > peak;
        peak = nextPeak;
        // The model clips log-mel to max(input)-80 dB. Normalize the retained
        // context to the same prefix maximum, not each 110 ms block's maximum.
        // Rebuild cached vectors when a louder block changes that floor.
        mel = join(mel, next);
        for (let i = 0; i < mel.length; i++) mel[i] = Math.max(mel[i], peak - 8);
        audio = audio.slice(1280);
        frames += next.length / 32;
        if (frames >= 76) {
          const end = mel.length - ((frames - 76) % 8) * 32;
          if (changed || !history.length) history = await embedding.vectors(mel.subarray(0, end));
          else history = join(history, await embedding.vectors(mel.subarray(end - 76 * 32, end)));
          history = history.slice(-FEATURES);
          if (history.length === FEATURES) score = Math.max(score, dot(profile.weights, history) + profile.bias);
          // Keep exactly the mel context required by the twelve-vector head,
          // aligned to the original eight-frame embedding stride.
          if (mel.length >= (76 + 8 * WINDOW) * 32) mel = mel.slice(8 * 32);
        }
      }
      return score;
    },
  };
}
// Match wk.speech_end: last complete 20 ms frame within 30 dB of the
// loudest frame. Absolute sample thresholds move labels when gain changes.
function speechEnd(samples) {
  const frames = Math.floor(samples.length / 320);
  const energy = new Float64Array(frames);
  let peak = 0;
  for (let f = 0; f < frames; f++) {
    for (let j = 0; j < 320; j++) energy[f] += samples[f * 320 + j] ** 2;
    peak = Math.max(peak, energy[f]);
  }
  for (let f = frames - 1; f >= 0; f--) if (energy[f] > peak * 1e-3) return (f + 1) * 320;
  return samples.length;
}
async function positiveWindows(embedding, recordings, prefixes = []) {
  if (recordings.length !== 5) throw new Error("Exactly five recordings required");
  const positives = [], rng = random();
  for (const samples of recordings) {
    const end = speechEnd(samples);
    const start = prefixes.length ? samples.length - speechEnd(samples.slice().reverse()) : 0;
    for (let a = 0; a < 16; a++) {
      const { audio: padded, speed } = augment(samples, a, rng);
      // Give half of each speaker's examples a spoken prefix. Align it with the
      // first voiced frame, since microphone enrolment can start with silence.
      if (prefixes.length && a % 2) {
        const boundary = 16000 + Math.floor(start / speed) - (a % 3) * 640;
        const prefix = prefixes[(positives.length + a) % prefixes.length];
        const tail = prefix.subarray(Math.max(0, prefix.length - boundary));
        padded.set(tail, boundary - tail.length);
      }
      const e = await embedding.embed(padded);
      for (const dt of [0.08, 0.16, 0.24, 0.32]) {
        const i = Math.ceil(((1 + end / speed / 16000 + dt - 0.015) / .01 - 76) / 8);
        if (i >= WINDOW - 1 && (i + 1) * WIDTH <= e.length) positives.push(e.slice((i - WINDOW + 1) * WIDTH, (i + 1) * WIDTH));
      }
    }
  }
  return positives;
}
async function enrol(embedding, recordings, bg, negatives = []) {
  if (negatives.length > 2) throw new Error("At most two personal negatives");
  const personal = [];
  for (const pcm of negatives) {
    const padded = new Float32Array(16000 + pcm.length + 9600); padded.set(pcm,16000);
    const vectors = await embedding.embed(padded);
    for(let at=0;at+FEATURES<=vectors.length;at+=WIDTH) personal.push(vectors.slice(at,at+FEATURES));
  }
  if(personal.length) bg = { ...bg, hard: Float32Array.from([...(bg.hard || []),...personal.flatMap(x=>Array.from(x))]) };
  return trainHead(await positiveWindows(embedding, recordings, bg.prefixes), bg);
}
module.exports = { WIDTH, WINDOW, FEATURES, HARD_NEGATIVE_RATE, dot, validateProfile, background, trainHead, createEmbedding, createStream, enrol, speechEnd, positiveWindows };
