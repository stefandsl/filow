// Worker thread for the natural voice (tts.js): loads the Supertonic model once and turns one
// piece of text into audio per message, so the main process and the windows never wait on it.
const path = require("node:path");
const { parentPort } = require("node:worker_threads");

let sherpa = null;
let tts = null;

parentPort.on("message", (msg) => {
  if (msg.type === "init") {
    try {
      const t0 = Date.now();
      sherpa = require("sherpa-onnx-node");
      const f = (name) => path.join(msg.dir, name);
      tts = new sherpa.OfflineTts({
        model: {
          supertonic: {
            durationPredictor: f("duration_predictor.int8.onnx"),
            textEncoder: f("text_encoder.int8.onnx"),
            vectorEstimator: f("vector_estimator.int8.onnx"),
            vocoder: f("vocoder.int8.onnx"),
            ttsJson: f("tts.json"),
            unicodeIndexer: f("unicode_indexer.bin"),
            voiceStyle: f("voice.bin"),
          },
          debug: false,
          numThreads: msg.threads,
          provider: "cpu",
        },
        maxNumSentences: 1,
      });
      parentPort.postMessage({ type: "ready", loadMs: Date.now() - t0 });
    } catch (err) {
      parentPort.postMessage({ type: "error", message: String((err && err.message) || err) });
    }
    return;
  }
  if (msg.type === "say") {
    try {
      if (!tts) throw new Error("voice model not loaded");
      const t0 = Date.now();
      const audio = tts.generate({
        text: msg.text,
        generationConfig: new sherpa.GenerationConfig({ sid: msg.sid, speed: msg.speed, numSteps: msg.steps, extra: { lang: msg.lang } }),
      });
      // A copy that owns its memory, so it can be handed to the main thread without another copy.
      const samples = new Float32Array(audio.samples);
      parentPort.postMessage({ type: "audio", rid: msg.rid, samples, sampleRate: audio.sampleRate, ms: Date.now() - t0 }, [samples.buffer]);
    } catch (err) {
      parentPort.postMessage({ type: "error", rid: msg.rid, message: String((err && err.message) || err) });
    }
  }
});
