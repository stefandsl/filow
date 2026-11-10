// Worker thread: speech-to-text with sherpa-onnx on the CPU, off the main thread so a 100 ms decode
// never stalls the window. stt.js picks the model and builds its recognizer configuration.
// Protocol (parentPort):
//   in : { type: "init", kind: "online" | "offline", config, vad, streamLanguage, language }
//        | { type: "feed", samples: Float32Array } | { type: "language", language } | { type: "stop" }
//   out: { type: "ready", loadMs } | { type: "result", partial, committed } | { type: "error", message } | { type: "stopped" }
// `committed` is non-empty only when a phrase is closed; `partial` is the live text. A streaming
// ("online") model closes a phrase with its endpoint detector and writes partials while the person
// speaks. A phrase ("offline") model gets whole phrases cut by the Silero voice detector and has no
// partials: each phrase arrives once, committed.
const { parentPort } = require("node:worker_threads");

const SAMPLE_RATE = 16000;
// Silero works on 512-sample windows at 16 kHz. A phrase longer than 8 s is cut so a speaker who
// never pauses still sees text.
const VAD_WINDOW = 512;

let sherpa = null;
let recognizer = null;
let stream = null;
let vad = null;
let pending = new Float32Array(0);
let kind = "online";
let streamLanguage = false;
let language = "auto";

function init(msg) {
  const t0 = Date.now();
  sherpa = require("sherpa-onnx-node");
  kind = msg.kind === "offline" ? "offline" : "online";
  streamLanguage = Boolean(msg.streamLanguage);
  language = msg.language || "auto";
  if (kind === "online") {
    recognizer = new sherpa.OnlineRecognizer(msg.config);
    newStream();
  } else {
    recognizer = new sherpa.OfflineRecognizer(msg.config);
    vad = new sherpa.Vad({
      sileroVad: { model: msg.vad, threshold: 0.5, minSilenceDuration: 0.4, minSpeechDuration: 0.25, maxSpeechDuration: 8, windowSize: VAD_WINDOW },
      sampleRate: SAMPLE_RATE,
      numThreads: 1,
      provider: "cpu",
      debug: 0,
    }, 30);
  }
  parentPort.postMessage({ type: "ready", loadMs: Date.now() - t0 });
}

function newStream() {
  stream = recognizer.createStream();
  if (streamLanguage && language && language !== "auto") stream.setOption("language", language);
}

/** Transcribes every phrase the voice detector has closed. */
function drainPhrases() {
  while (!vad.isEmpty()) {
    const segment = vad.front();
    vad.pop();
    const s = recognizer.createStream();
    s.acceptWaveform({ samples: segment.samples, sampleRate: SAMPLE_RATE });
    recognizer.decode(s);
    const committed = (recognizer.getResult(s).text || "").trim();
    if (committed) parentPort.postMessage({ type: "result", partial: "", committed });
  }
}

function feedOffline(samples) {
  const all = new Float32Array(pending.length + samples.length);
  all.set(pending);
  all.set(samples, pending.length);
  let at = 0;
  for (; at + VAD_WINDOW <= all.length; at += VAD_WINDOW) vad.acceptWaveform(all.subarray(at, at + VAD_WINDOW));
  pending = all.slice(at);
  drainPhrases();
}

function feed(samples) {
  if (!recognizer) return;
  if (kind === "offline") return feedOffline(samples);
  if (!stream) return;
  stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE });
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

/** Sends what is still buffered as a last committed phrase and starts clean for the next take. */
function flush() {
  if (!recognizer) return;
  if (kind === "offline") {
    pending = new Float32Array(0);
    vad.flush();
    drainPhrases();
    vad.reset();
    return;
  }
  if (!stream) return;
  stream.inputFinished();
  while (recognizer.isReady(stream)) recognizer.decode(stream);
  const r = recognizer.getResult(stream);
  if (r.text) parentPort.postMessage({ type: "result", partial: "", committed: r.text.trim() });
  newStream();
}

parentPort.on("message", (msg) => {
  try {
    if (msg.type === "init") init(msg);
    else if (msg.type === "feed") feed(msg.samples instanceof Float32Array ? msg.samples : new Float32Array(msg.samples));
    else if (msg.type === "language") {
      language = msg.language || "auto";
      if (recognizer && kind === "online") newStream();
    } else if (msg.type === "stop") flush();
  } catch (err) {
    parentPort.postMessage({ type: "error", message: String((err && err.message) || err) });
  } finally {
    if (msg.type === "stop") parentPort.postMessage({ type: "stopped" });
  }
});
