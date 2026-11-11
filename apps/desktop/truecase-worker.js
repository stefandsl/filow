// Runs the punctuation and capitals model (truecase-runtime.js) in a process of its own, started by Filow
// with Electron's utilityProcess. Why not inside Filow's main process: the speech recognizer there already
// loads an onnxruntime library of another version (sherpa-onnx), and two libraries of the same name in one
// process do not mix; a crash or a slow load here also cannot stall Filow's windows. Nothing here opens a
// network connection: it reads the model files from the folder it is given and answers messages.
//
// in:  { type: "init", dir, threads }            out: { type: "ready", ms } or { type: "failed", error }
// in:  { type: "run", id, text }                 out: { type: "done", id, pieces, labels } or { type: "error", id, error }
// `text` is already stripped and lowercased (truecase-text.js); the answer is one label per piece.
const fs = require("node:fs");
const path = require("node:path");

const port = process.parentPort;
let session = null;
let tokenizer = null;
let config = null;
let ort = null;

async function init({ dir, threads }) {
  const t0 = Date.now();
  ort = require("onnxruntime-node");
  const { Tokenizer } = require("@huggingface/tokenizers");
  const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  config = read("config.json");
  tokenizer = new Tokenizer(read("tokenizer.json"), read("tokenizer_config.json"));
  session = await ort.InferenceSession.create(path.join(dir, "model_quantized.onnx"), { intraOpNumThreads: threads, executionProviders: ["cpu"] });
  return Date.now() - t0;
}

async function run(text) {
  const pieces = tokenizer.tokenize(text, { add_special_tokens: false });
  const ids = tokenizer.encode(text, { add_special_tokens: false }).ids;
  if (ids.length !== pieces.length) throw new Error("pieces and ids differ");
  if (ids.length > 480) throw new Error("too long"); // one dictation phrase is far shorter; the model's window is not chunked here
  const input = [config.cls_token_id, ...ids, config.sep_token_id ?? config.eos_token_id];
  const feeds = { input_ids: new ort.Tensor("int64", BigInt64Array.from(input.map(BigInt)), [1, input.length]) };
  if (session.inputNames.includes("attention_mask")) feeds.attention_mask = new ort.Tensor("int64", BigInt64Array.from(input.map(() => 1n)), [1, input.length]);
  const logits = (await session.run(feeds))[session.outputNames[0]];
  const n = logits.dims[2];
  const labels = [];
  for (let i = 1; i < input.length - 1; i++) {
    let best = 0;
    for (let k = 1; k < n; k++) if (logits.data[i * n + k] > logits.data[i * n + best]) best = k;
    labels.push(config.id2label[best]);
  }
  return { pieces, labels };
}

port.on("message", (event) => {
  const m = event.data;
  if (!m || typeof m !== "object") return;
  if (m.type === "init") init(m).then((ms) => port.postMessage({ type: "ready", ms }), (e) => port.postMessage({ type: "failed", error: String((e && e.message) || e).slice(0, 200) }));
  else if (m.type === "run") run(String(m.text || "")).then((r) => port.postMessage({ type: "done", id: m.id, ...r }), (e) => port.postMessage({ type: "error", id: m.id, error: String((e && e.message) || e).slice(0, 200) }));
});
