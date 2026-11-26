// Runs Filow's own local recognizer over a list of 16 kHz mono wav clips.
//
// It does not re-implement anything: the model choice comes from apps/desktop/stt.js
// (chooseModels, recognizerConfig, CATALOGUE) and the decoding runs in the shipped worker
// apps/desktop/stt-worker.js (Silero phrase cutting for the phrase models, endpointing and the
// 0.8 s tail for the streaming model), fed block by block as the app feeds it.
//
// node asr.mjs --list clips.tsv --out out.jsonl --use questions|tracking [--models DIR] [--threads N]
// clips.tsv: clip_id <tab> wav path <tab> language   (no header)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, "..", "..", "apps", "desktop");
const require = createRequire(import.meta.url);
const stt = require(path.join(desktop, "stt.js"));

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const use = args.use === "tracking" ? "tracking" : "questions";
const modelsRoot = args.models || "G:/FILOW/tmp/mic-cleanup/asr-models";
// Default to the shipped live recognizer setting; the benchmark can compare explicit thread counts.
const threads = args.threads ? Number(args.threads) : 1;
// The OK Filow panel feeds 2048-sample blocks (dictation, questions); takes feed 100 ms blocks.
const block = use === "questions" ? 2048 : 1600;

function readWav16k(file) {
  const b = fs.readFileSync(file);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") throw new Error(`not a wav: ${file}`);
  let at = 12, rate = 0, channels = 0, bits = 0, data = null;
  while (at + 8 <= b.length) {
    const id = b.toString("ascii", at, at + 4), size = b.readUInt32LE(at + 4);
    if (id === "fmt ") { channels = b.readUInt16LE(at + 10); rate = b.readUInt32LE(at + 12); bits = b.readUInt16LE(at + 22); }
    if (id === "data") { data = b.subarray(at + 8, Math.min(b.length, at + 8 + size)); break; }
    at += 8 + size + (size % 2);
  }
  if (!data || rate !== 16000 || channels !== 1 || bits !== 16) throw new Error(`need 16 kHz mono 16 bit: ${file} (${rate} Hz, ${channels} ch, ${bits} bit)`);
  const out = new Float32Array(data.length >> 1);
  // The same Int16 -> Float32 conversion as packages/stt/src/sherpa.ts (i16 / 0x8000).
  for (let i = 0; i < out.length; i++) out[i] = data.readInt16LE(i * 2) / 0x8000;
  return out;
}

function startWorker(spec, language) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(desktop, "stt-worker.js"));
    const state = { worker, texts: [], onStopped: null, loadMs: 0 };
    worker.on("message", (m) => {
      if (m.type === "ready") { state.loadMs = m.loadMs; resolve(state); }
      else if (m.type === "result") { if (m.committed) state.texts.push(m.committed); }
      else if (m.type === "error") { state.error = m.message; }
      else if (m.type === "stopped") { const done = state.onStopped; state.onStopped = null; if (done) done(); }
    });
    worker.on("error", reject);
    const dir = path.join(modelsRoot, spec.key);
    worker.postMessage({
      type: "init", kind: spec.kind, config: stt.recognizerConfig(spec, dir, threads),
      vad: spec.kind === "offline" ? path.join(modelsRoot, "silero-vad", "silero_vad.onnx") : null,
      streamLanguage: Boolean(spec.streamLanguage), language,
    });
  });
}

async function transcribe(state, samples) {
  state.texts = [];
  state.error = null;
  for (let at = 0; at < samples.length; at += block) {
    const chunk = samples.slice(at, Math.min(samples.length, at + block));
    state.worker.postMessage({ type: "feed", samples: chunk }, [chunk.buffer]);
  }
  await new Promise((resolve) => { state.onStopped = resolve; state.worker.postMessage({ type: "stop" }); });
  if (state.error) throw new Error(state.error);
  return state.texts.join(" ");
}

const clips = fs.readFileSync(args.list, "utf8").split(/\r?\n/).filter(Boolean).map((line) => {
  const [clip_id, wav, language] = line.split("\t");
  return { clip_id, wav, language };
});
const hardware = stt.hardwareOf();
const byModel = new Map();
for (const c of clips) {
  const key = stt.chooseModels({ language: c.language, use, ...hardware }).models[0];
  const group = `${key}|${stt.CATALOGUE[key].streamLanguage ? c.language : ""}`;
  if (!byModel.has(group)) byModel.set(group, []);
  byModel.get(group).push({ ...c, model: key });
}
const done = new Set();
if (fs.existsSync(args.out)) for (const line of fs.readFileSync(args.out, "utf8").split("\n").filter(Boolean)) done.add(JSON.parse(line).clip_id);
const out = fs.openSync(args.out, "a");
let n = 0, audio = 0, spent = 0;
for (const [group, list] of byModel) {
  const todo = list.filter((c) => !done.has(c.clip_id));
  if (!todo.length) continue;
  const [key, lang] = group.split("|");
  const state = await startWorker(stt.CATALOGUE[key], lang || "auto");
  for (const c of todo) {
    const samples = readWav16k(c.wav);
    const t0 = performance.now();
    const text = await transcribe(state, samples);
    const ms = performance.now() - t0;
    audio += samples.length / 16000; spent += ms / 1000; n++;
    fs.writeSync(out, JSON.stringify({ clip_id: c.clip_id, model: key, use, threads, text, asr_ms: Math.round(ms), audio_s: +(samples.length / 16000).toFixed(3) }) + "\n");
    if (n % 100 === 0) console.log(`${n} clips, ${group}, ASR RTF ${(spent / audio).toFixed(3)}`);
  }
  await state.worker.terminate();
}
fs.closeSync(out);
console.log(`done ${n} clips, audio ${(audio / 60).toFixed(1)} min, ASR RTF ${audio ? (spent / audio).toFixed(3) : "-"}, sherpa-onnx-node ${require(path.join(desktop, "..", "..", "node_modules", "sherpa-onnx-node", "package.json")).version}`);
