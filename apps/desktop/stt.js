// Streaming speech-to-text on this PC (Step 2 of docs/gauntlet/REPORT-lap1.md): the Nemotron 3.5
// ASR streaming model (NVIDIA, OpenMDW licence, int8 export by sherpa-onnx) run by sherpa-onnx-node
// in a worker thread. This file owns the model download and the worker; main.js wires the IPC.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const https = require("node:https");
const { execFile } = require("node:child_process");
const { Worker } = require("node:worker_threads");

const MODEL = {
  id: "nemotron-3.5-asr-streaming-0.6b",
  archive: "sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11",
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11.tar.bz2",
  sizeBytes: 475271763,
  files: ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"],
};

function modelDir(userData) {
  return path.join(userData, "models", MODEL.id);
}

function modelReady(userData) {
  const dir = modelDir(userData);
  return MODEL.files.every((f) => fs.existsSync(path.join(dir, f)));
}

function downloadWithProgress(url, dest, onPct, hops = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "Filow" } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops > 0) {
          res.resume();
          return downloadWithProgress(res.headers.location, dest, onPct, hops - 1).then(resolve, reject);
        }
        if (res.statusCode !== 200) return reject(new Error(`download failed: HTTP ${res.statusCode}`));
        const total = Number(res.headers["content-length"] || MODEL.sizeBytes);
        let got = 0;
        const out = fs.createWriteStream(dest);
        res.on("data", (c) => {
          got += c.length;
          if (total) onPct(Math.min(99, Math.round((got / total) * 100)));
        });
        res.pipe(out);
        out.on("finish", () => out.close(resolve));
        out.on("error", reject);
      })
      .on("error", reject);
  });
}

/** Windows ships bsdtar as tar.exe (bzip2 built in); macOS and Linux have tar with -j. Runs as a child process: a 475 MB bzip2 takes tens of seconds and must not block the app. */
function extract(archive, into) {
  const tar = process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
  return new Promise((resolve, reject) => {
    execFile(tar, ["-xjf", archive, "-C", into], { timeout: 15 * 60_000, windowsHide: true, maxBuffer: 1 << 20 }, (err) => (err ? reject(err) : resolve()));
  });
}

/** Downloads and unpacks the model into userData/models; onStatus gets {state, pct}. */
async function ensureModel(userData, onStatus) {
  if (modelReady(userData)) return onStatus({ state: "ready", pct: 100 });
  const models = path.join(userData, "models");
  fs.mkdirSync(models, { recursive: true });
  const archive = path.join(models, `${MODEL.archive}.tar.bz2`);
  try {
    onStatus({ state: "downloading", pct: 0 });
    await downloadWithProgress(MODEL.url, archive, (pct) => onStatus({ state: "downloading", pct }));
    onStatus({ state: "extracting", pct: 99 });
    await extract(archive, models);
    const extracted = path.join(models, MODEL.archive);
    if (fs.existsSync(modelDir(userData))) fs.rmSync(modelDir(userData), { recursive: true, force: true });
    fs.renameSync(extracted, modelDir(userData));
    fs.rmSync(archive, { force: true });
    if (!modelReady(userData)) throw new Error("archive did not contain the expected files");
    onStatus({ state: "ready", pct: 100 });
  } catch (err) {
    fs.rmSync(archive, { force: true });
    onStatus({ state: "error", pct: 0, error: String((err && err.message) || err) });
  }
}

function removeModel(userData) {
  fs.rmSync(modelDir(userData), { recursive: true, force: true });
}

/** One recognizer worker per app; started on demand, kept across takes (the model load takes ~2 s). */
class SttSession {
  constructor(userData, log) {
    this.userData = userData;
    this.log = log || (() => {});
    this.worker = null;
    this.ready = false;
    this.onResult = () => {};
    this.onError = () => {};
  }

  threads() {
    return Math.max(2, Math.min(4, os.cpus().length - 2));
  }

  async start(language) {
    if (!modelReady(this.userData)) throw new Error("model not downloaded");
    if (this.worker && this.ready) {
      this.worker.postMessage({ type: "language", language });
      return { loadMs: 0 };
    }
    const script = path.join(__dirname, "stt-worker.js").replace("app.asar" + path.sep, "app.asar.unpacked" + path.sep);
    const worker = new Worker(script);
    this.worker = worker;
    return new Promise((resolve, reject) => {
      const onMsg = (m) => {
        if (m.type === "ready") {
          this.ready = true;
          this.log(`stt: nemotron ready in ${m.loadMs} ms (${this.threads()} threads)`);
          resolve({ loadMs: m.loadMs });
        } else if (m.type === "result") this.onResult(m);
        else if (m.type === "error") {
          this.log(`stt error: ${m.message}`);
          if (!this.ready) reject(new Error(m.message));
          this.onError(m.message);
        }
      };
      worker.on("message", onMsg);
      worker.on("error", (err) => {
        this.log(`stt worker crashed: ${err.message}`);
        this.ready = false;
        this.worker = null;
        if (!this.ready) reject(err);
        this.onError(err.message);
      });
      worker.on("exit", () => {
        this.ready = false;
        this.worker = null;
      });
      worker.postMessage({ type: "init", dir: modelDir(this.userData), threads: this.threads(), language });
    });
  }

  feed(samples) {
    if (this.worker && this.ready) this.worker.postMessage({ type: "feed", samples }, [samples.buffer]);
  }

  stop() {
    if (this.worker && this.ready) this.worker.postMessage({ type: "stop" });
  }

  dispose() {
    if (this.worker) void this.worker.terminate();
    this.worker = null;
    this.ready = false;
  }
}

module.exports = { MODEL, modelDir, modelReady, ensureModel, removeModel, SttSession };
