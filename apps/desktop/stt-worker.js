// Worker thread: streaming speech-to-text with sherpa-onnx (Nemotron 3.5 ASR streaming, int8, CPU).
// Runs off the main thread so a 100 ms decode never stalls the window. Protocol (parentPort):
//   in : { type: "init", dir, threads, language } | { type: "feed", samples: Float32Array } | { type: "stop" }
//   out: { type: "ready", loadMs } | { type: "result", partial, committed } | { type: "error", message } | { type: "stopped" }
// `committed` is non-empty only when the endpoint detector closed a segment; `partial` is the live text.
const { parentPort } = require("node:worker_threads");
const path = require("node:path");

let sherpa = null;
let recognizer = null;
let stream = null;
let language = "auto";

function init(msg) {
  const t0 = Date.now();
  sherpa = require("sherpa-onnx-node");
  recognizer = new sherpa.OnlineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: path.join(msg.dir, "encoder.int8.onnx"),
        decoder: path.join(msg.dir, "decoder.int8.onnx"),
        joiner: path.join(msg.dir, "joiner.int8.onnx"),
      },
      tokens: path.join(msg.dir, "tokens.txt"),
      numThreads: msg.threads || 2,
      provider: "cpu",
      modelType: "",
      debug: 0,
    },
    decodingMethod: "greedy_search",
    enableEndpoint: 1,
    // A sentence is "committed" after 1.2 s of silence following speech, or 2.4 s of silence after
    // nothing, or 20 s of continuous speech. The live partial keeps the engine fed meanwhile.
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 1.2,
    rule3MinUtteranceLength: 20,
  });
  language = msg.language || "auto";
  newStream();
  parentPort.postMessage({ type: "ready", loadMs: Date.now() - t0 });
}

function newStream() {
  stream = recognizer.createStream();
  if (language && language !== "auto") stream.setOption("language", language);
}

function feed(samples) {
  if (!recognizer || !stream) return;
  stream.acceptWaveform({ samples, sampleRate: 16000 });
  while (recognizer.isReady(stream)) recognizer.decode(stream);
  const r = recognizer.getResult(stream);
  if (recognizer.isEndpoint(stream)) {
    const committed = (r.text || "").trim();
    recognizer.reset(stream);
    parentPort.postMessage({ type: "result", partial: "", committed });
  } else {
    parentPort.postMessage({ type: "result", partial: r.text || "", committed: "" });
  }
}

parentPort.on("message", (msg) => {
  try {
    if (msg.type === "init") init(msg);
    else if (msg.type === "feed") feed(msg.samples instanceof Float32Array ? msg.samples : new Float32Array(msg.samples));
    else if (msg.type === "language") {
      language = msg.language || "auto";
      if (recognizer) newStream();
    } else if (msg.type === "stop") {
      // flush what is still in the stream
      if (recognizer && stream) {
        stream.inputFinished();
        while (recognizer.isReady(stream)) recognizer.decode(stream);
        const r = recognizer.getResult(stream);
        if (r.text) parentPort.postMessage({ type: "result", partial: "", committed: r.text.trim() });
        newStream();
      }
    }
  } catch (err) {
    parentPort.postMessage({ type: "error", message: String((err && err.message) || err) });
  } finally {
    if (msg.type === "stop") parentPort.postMessage({ type: "stopped" });
  }
});
