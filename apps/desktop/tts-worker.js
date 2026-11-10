// Worker thread for the natural voice (tts.js): loads the Supertonic model once and turns one
// piece of text into audio per message, so the main process and the windows never wait on it.
const path = require("node:path");
const { parentPort } = require("node:worker_threads");

/**
 * The message handler of the worker. `post(message, transfer)` answers the main thread and
 * `load()` returns the sherpa-onnx module (the tests hand in a stand-in).
 */
function createHandler(post, load) {
  let sherpa = null;
  let tts = null;

  return (msg) => {
    if (msg.type === "init") {
      try {
        const t0 = Date.now();
        sherpa = load();
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
        post({ type: "ready", loadMs: Date.now() - t0 });
      } catch (err) {
        post({ type: "error", message: String((err && err.message) || err) });
      }
      return;
    }
    if (msg.type === "say") {
      try {
        if (!tts) throw new Error("voice model not loaded");
        const t0 = Date.now();
        const audio = tts.generate({
          text: msg.text,
          // Electron refuses memory a native module hands over as it is ("External buffers are
          // not allowed"), so the module must copy the audio into memory that JavaScript owns.
          enableExternalBuffer: false,
          generationConfig: new sherpa.GenerationConfig({ sid: msg.sid, speed: msg.speed, numSteps: msg.steps, extra: { lang: msg.lang } }),
        });
        // Our own copy, so it can be handed to the main thread without another copy.
        const samples = new Float32Array(audio.samples);
        post({ type: "audio", rid: msg.rid, samples, sampleRate: audio.sampleRate, ms: Date.now() - t0 }, [samples.buffer]);
      } catch (err) {
        post({ type: "error", rid: msg.rid, message: String((err && err.message) || err) });
      }
    }
  };
}

// Inside the worker thread; when a test loads this file there is no parent to listen to.
if (parentPort) parentPort.on("message", createHandler((message, transfer) => parentPort.postMessage(message, transfer), () => require("sherpa-onnx-node")));

module.exports = { createHandler };
