// Real-time factor of the streaming speech model (Nemotron 3.5 int8, sherpa-onnx, CPU), fed in 100 ms
// chunks like the microphone, with the settings of apps/desktop/stt-worker.js. Used for the P3 setup
// profiles (docs/gauntlet/BASELINE.md). No network.
//   node scripts/bench/stt-rtf.cjs <threads> <modelDir> <file.wav> [more.wav ...]
const path = require("node:path");
const sherpa = require("sherpa-onnx-node");

const [threads, dir, ...wavs] = process.argv.slice(2);
if (!threads || !dir || !wavs.length) {
  console.log("usage: node scripts/bench/stt-rtf.cjs <threads> <modelDir> <file.wav> [more.wav ...]");
  process.exit(1);
}
const t0 = Date.now();
const recognizer = new sherpa.OnlineRecognizer({
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: {
    transducer: { encoder: path.join(dir, "encoder.int8.onnx"), decoder: path.join(dir, "decoder.int8.onnx"), joiner: path.join(dir, "joiner.int8.onnx") },
    tokens: path.join(dir, "tokens.txt"),
    numThreads: Number(threads),
    provider: "cpu",
    modelType: "",
    debug: 0,
  },
  decodingMethod: "greedy_search",
  enableEndpoint: 1,
  rule1MinTrailingSilence: 2.4,
  rule2MinTrailingSilence: 1.2,
  rule3MinUtteranceLength: 20,
});
const loadMs = Date.now() - t0;
let audioSec = 0;
let computeMs = 0;
const decodes = [];
for (const file of wavs) {
  const w = sherpa.readWave(file);
  const s = recognizer.createStream();
  const step = Math.round(w.sampleRate / 10);
  for (let i = 0; i < w.samples.length; i += step) {
    const c0 = process.hrtime.bigint();
    s.acceptWaveform({ samples: w.samples.subarray(i, i + step), sampleRate: w.sampleRate });
    while (recognizer.isReady(s)) recognizer.decode(s);
    recognizer.getResult(s);
    const ms = Number(process.hrtime.bigint() - c0) / 1e6;
    computeMs += ms;
    if (ms > 1) decodes.push(ms); // the chunks that ran a decode (one per 560 ms of audio)
  }
  audioSec += w.samples.length / w.sampleRate;
}
decodes.sort((a, b) => a - b);
const q = (p) => Math.round(decodes[Math.min(decodes.length - 1, Math.floor(decodes.length * p))]);
console.log(`threads ${threads}: load ${loadMs} ms, audio ${audioSec.toFixed(1)} s, compute ${Math.round(computeMs)} ms, RTF ${(computeMs / 1000 / audioSec).toFixed(3)}, decode per chunk p50 ${q(0.5)} ms p95 ${q(0.95)} ms (${decodes.length} decodes)`);
