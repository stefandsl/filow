// One-thread spotter, reusable inside the combined detector utility process.
const { parentPort, workerData } = require("node:worker_threads");
const path = require("node:path");
const sherpa = require("sherpa-onnx-node");
const { SPELLINGS } = require("./wake-policy");
function createSpotter(dir, keywords) {
const kws = new sherpa.KeywordSpotter({
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: {
    transducer: {
      encoder: path.join(dir, "encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx"),
      decoder: path.join(dir, "decoder-epoch-13-avg-2-chunk-16-left-64.onnx"),
      joiner: path.join(dir, "joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx"),
    },
    tokens: path.join(dir, "tokens.txt"), numThreads: 1, provider: "cpu", debug: 0,
  },
  keywordsFile: keywords, maxActivePaths: 16, keywordsScore: 2.5, keywordsThreshold: 0.05,
});
if (SPELLINGS.length !== 15) throw new Error("Expected 15 wake spellings");
let stream = kws.createStream();
let startAt = null;
return {
 reset() { stream = kws.createStream(); startAt = null; },
 feed(m) {
  if (startAt === null) startAt = m.at - 100;
  const started = performance.now();
  stream.acceptWaveform({ samples: m.samples, sampleRate: 16000 });
  let keyword = false;
  let phraseEndMs;
  while (kws.isReady(stream)) {
    kws.decode(stream);
    const result = kws.getResult(stream);
    if (result.keyword) {
      keyword = true;
      if (Array.isArray(result.timestamps) && result.timestamps.length) phraseEndMs = startAt + Math.max(...result.timestamps) * 1000 + 80;
      kws.reset(stream);
    }
  }
  return { id: m.id, at: m.at, keyword, phraseEndMs, ms: performance.now() - started };
 }
};
}
if(parentPort && workerData) {
const spotter = createSpotter(workerData.dir, workerData.keywords);
parentPort.on("message", (m) => {
  if(m.type === "reset") spotter.reset();
  if(m.type === "feed") parentPort.postMessage(spotter.feed(m));
});
parentPort.postMessage({ type: "ready" });
}
module.exports = { createSpotter };
