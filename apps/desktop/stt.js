// Streaming speech-to-text on this PC (Step 2 of docs/gauntlet/REPORT-lap1.md): the Nemotron 3.5
// ASR streaming model (NVIDIA, OpenMDW licence, int8 export by sherpa-onnx) run by sherpa-onnx-node
// in a worker thread. This file owns the model download and the worker; main.js wires the IPC.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const https = require("node:https");
const { execFile } = require("node:child_process");
const { Worker } = require("node:worker_threads");
const { idleTimeout, receiveArchive, retryDownload } = require("./stt-download");

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
    let response;
    let req;
    const idle = idleTimeout(err => req?.destroy(err));
    try {
      req = https.get(url, { headers: { "User-Agent": "Filow" } }, (res) => {
        idle.stop();
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops > 0) {
          res.destroy();
          try { return downloadWithProgress(new URL(res.headers.location, url).href, dest, onPct, hops - 1).then(resolve, reject); }
          catch (err) { return reject(err); }
        }
        if (res.statusCode !== 200) {
          res.destroy();
          return reject(new Error(`download failed: HTTP ${res.statusCode}`));
        }
        response = res;
        receiveArchive(res, fs.createWriteStream(dest), {
          contentLength: res.headers["content-length"], fallbackSize: MODEL.sizeBytes, onPct,
        }).then(resolve, reject);
      })
      .on("error", err => {
        idle.stop();
        // Once writing, settle through pipeline so Windows can delete the closed file.
        if (response) response.destroy(err); else reject(err);
      });
    } catch (err) { idle.stop(); reject(err); }
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
  const archive = path.join(models, `${MODEL.archive}.tar.bz2`);
  try {
    fs.mkdirSync(models, { recursive: true });
    await retryDownload(async () => {
      // Never resume an archive whose integrity is unknown, including leftovers from a crash.
      fs.rmSync(archive, { force: true });
      try {
        await downloadWithProgress(MODEL.url, archive, (pct) => onStatus({ state: "downloading", pct }));
        onStatus({ state: "extracting", pct: 99 });
        const extracted = path.join(models, MODEL.archive);
        // A failed extraction must not contribute stale files to a later attempt.
        fs.rmSync(extracted, { recursive: true, force: true });
        await extract(archive, models);
        if (!MODEL.files.every(f => fs.existsSync(path.join(extracted, f)))) throw new Error("archive did not contain the expected files");
        if (fs.existsSync(modelDir(userData))) fs.rmSync(modelDir(userData), { recursive: true, force: true });
        fs.renameSync(extracted, modelDir(userData));
      } finally { fs.rmSync(archive, { force: true }); }
    }, attempt => onStatus({ state: "downloading", pct: 0, message: `download attempt ${attempt}/4` }),
    (attempt, delay, err) => onStatus({ state: "downloading", pct: 0, message: `attempt ${attempt} failed: ${err.message}; retry in ${delay / 1000} s` }));
    onStatus({ state: "ready", pct: 100 });
  } catch (err) {
    let error = String((err && err.message) || err);
    try { fs.rmSync(archive, { force: true }); }
    catch (cleanup) { error += `; partial archive cleanup failed: ${cleanup.message}`; }
    onStatus({ state: "error", pct: 0, error });
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
    this.stopping = null;
    this.onResult = () => {};
    this.onError = () => {};
  }

  threads() {
    return Math.max(2, Math.min(4, os.cpus().length - 2));
  }

  async start(language) {
    await this.stopping;
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
        if (this.worker !== worker) return reject(err);
        const wasReady = this.ready;
        this.ready = false;
        this.worker = null;
        if (!wasReady) reject(err);
        this.onError(err.message);
      });
      worker.on("exit", () => {
        if (this.worker !== worker) return;
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
    if (this.stopping) return this.stopping;
    const worker = this.worker;
    if (!worker || !this.ready) return Promise.resolve();
    this.stopping = new Promise((resolve) => {
      const finish = () => {
        worker.off("message", onMessage);
        worker.off("error", finish);
        worker.off("exit", finish);
        resolve();
      };
      const onMessage = (m) => {
        if (m.type === "stopped") finish();
      };
      worker.on("message", onMessage);
      worker.once("error", finish);
      worker.once("exit", finish);
      // The worker sends its final result before this acknowledgement.
      try { worker.postMessage({ type: "stop" }); }
      catch (err) { finish(); this.onError(err.message); }
    }).finally(() => { this.stopping = null; });
    return this.stopping;
  }

  dispose() {
    if (this.worker) void this.worker.terminate();
    this.worker = null;
    this.ready = false;
  }
}

module.exports = { MODEL, modelDir, modelReady, ensureModel, removeModel, SttSession };
