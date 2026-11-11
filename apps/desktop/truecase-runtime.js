// The runtime for the punctuation and capitals model (docs/dictation/CLEANUP-MULTILINGUAL.md):
// Horizon-Labs/multilingual-punctuation-truecase-small (Apache-2.0, on mmBERT-small, MIT), its quantized
// ONNX file run by onnxruntime (MIT) in a process of its own (truecase-worker.js). Started when a dictation
// in Italian, Russian, Romanian or Japanese needs it, stopped after ten minutes without one. It reads the
// model from the profile and answers Filow's main process; nothing here reaches the network except the
// one download of the model files, which the user starts (the setup or Settings).
const path = require("node:path");
const fs = require("node:fs");

/** The files Filow downloads (revision pinned): each with its size and SHA-256, from the repository's SHA256SUMS. */
const REVISION = "b18abbd2d30e8167e154df444b37faa4d6f5c2ea";
const FILES = [
  { name: "config.json", from: "config.json", bytes: 2630, sha256: "968fa6c797aa9048264d6be3765d462efa27639df5d6a580aef3e8bb187d60dc" },
  { name: "tokenizer_config.json", from: "tokenizer_config.json", bytes: 46440, sha256: "ea349495764b24570b4560fe2e4a557e5c0a47e6bce782c2409b1d6445cf8633" },
  { name: "tokenizer.json", from: "tokenizer.json", bytes: 34363286, sha256: "f34b44a6dc8a0eef651bfa10e8325057530152606a69d9c3b6ae02efb1558f0a" },
  { name: "model_quantized.onnx", from: "onnx/model_quantized.onnx", bytes: 268432863, sha256: "a732af171c17413f709d2a37550353cb92d0f07412fc5b7ed0cf7e34efa1ec57" },
];
const BYTES = FILES.reduce((s, f) => s + f.bytes, 0);
const fileUrl = (f) => `https://huggingface.co/Horizon-Labs/multilingual-punctuation-truecase-small/resolve/${REVISION}/${f.from}`;
/** The name the setup uses for the model (settings, the report). */
const SETUP_ID = "truecase-small";
/** The process with the model holds about 0.6 GB: it is let go after this long without a dictation. */
const IDLE_UNLOAD_MS = 10 * 60_000;
const modelDir = (userData) => path.join(userData, "models", "truecase-small");

/** Is onnxruntime for this platform inside this build (next to app.asar when packaged)? "" when not. */
function runtimeFile({ platform = process.platform, arch = process.arch, baseDir = __dirname, exists = fs.existsSync } = {}) {
  for (const root of [path.join(baseDir, "node_modules"), path.join(baseDir, "..", "..", "node_modules")]) {
    const file = path.join(root, "onnxruntime-node", "bin", "napi-v6", platform, arch, "onnxruntime_binding.node").replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2");
    if (exists(file)) return file;
  }
  return "";
}

/**
 * deps: { userData, logLine, fork(script) -> utility process ({ postMessage, on("message"|"exit"), kill }),
 *         download, sha256File, threads?, runtimeFile?(), modelExists?(dir), startTimeoutMs?, idleMs?,
 *         setTimeout?, clearTimeout?, fileUrl?(file) }
 */
function createTruecaseRuntime(deps) {
  const log = deps.logLine || (() => {});
  const dir = () => modelDir(deps.userData);
  const hasRuntime = () => Boolean(deps.runtimeFile ? deps.runtimeFile() : runtimeFile());
  const hasModel = () => (deps.modelExists ? deps.modelExists(dir()) : FILES.every((f) => fs.existsSync(path.join(dir(), f.name))));
  const st = deps.setTimeout || setTimeout;
  const ct = deps.clearTimeout || clearTimeout;
  let child = null;
  let starting = null;
  let lastError = "";
  let startedMs = 0;
  let idleTimer = null;
  let unloads = 0;
  let nextId = 1;
  const waiting = new Map();

  function touch() {
    ct(idleTimer);
    idleTimer = st(() => {
      if (!child) return;
      unloads += 1;
      log(`truecase: no dictation for ${Math.round(IDLE_UNLOAD_MS / 60000)} minutes: the model is unloaded and its memory given back`);
      stop();
    }, deps.idleMs || IDLE_UNLOAD_MS);
    if (idleTimer && idleTimer.unref) idleTimer.unref();
  }

  function ready() {
    if (!hasRuntime()) return { ok: false, reason: "runtime not in this build" };
    if (!hasModel()) return { ok: false, reason: "model not on this computer" };
    if (lastError && !child) return { ok: false, reason: `runtime did not start: ${lastError}` };
    return { ok: true, reason: "" };
  }

  function failAll(why) { for (const w of waiting.values()) w.reject(new Error(why)); waiting.clear(); }

  function start() {
    if (child) return Promise.resolve();
    if (starting) return starting;
    starting = new Promise((resolve, reject) => {
      const t0 = Date.now();
      const c = deps.fork(path.join(__dirname, "truecase-worker.js").replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2"));
      const threads = Math.max(1, Math.min(4, Number(deps.threads ? deps.threads() : 2) || 2));
      const timer = st(() => { try { c.kill(); } catch { /* gone */ } reject(new Error("the model did not load in time")); }, deps.startTimeoutMs || 30000);
      c.on("message", (m) => {
        if (!m || typeof m !== "object") return;
        if (m.type === "ready") {
          ct(timer);
          child = c;
          lastError = "";
          startedMs = Date.now() - t0;
          touch();
          log(`truecase: model loaded in ${startedMs} ms (onnxruntime, ${threads} threads, this computer only)`);
          resolve();
        } else if (m.type === "failed") { ct(timer); try { c.kill(); } catch { /* gone */ } reject(new Error(m.error || "the model did not load")); }
        else if ((m.type === "done" || m.type === "error") && waiting.has(m.id)) {
          const w = waiting.get(m.id);
          waiting.delete(m.id);
          if (m.type === "done" && Array.isArray(m.pieces) && Array.isArray(m.labels)) w.resolve({ pieces: m.pieces, labels: m.labels });
          else w.reject(new Error(m.error || "no answer"));
        }
      });
      c.on("exit", (code) => {
        ct(timer);
        if (child === c) { child = null; log(`truecase: the model's process stopped (code ${code})`); }
        failAll("the model's process stopped");
        reject(new Error("the model's process stopped while loading"));
      });
      c.postMessage({ type: "init", dir: dir(), threads });
    }).catch((e) => { lastError = String((e && e.message) || e).slice(0, 80); log(`truecase: model did not load (${lastError})`); throw e; }).finally(() => { starting = null; });
    return starting;
  }

  /** The model's labels for one stripped, lowercased dictation: { pieces, labels }. Starts the process when needed. */
  async function run(lower, signal) {
    await start();
    touch();
    const c = child;
    if (!c) throw new Error("the model's process stopped");
    return new Promise((resolve, reject) => {
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      if (signal) signal.addEventListener("abort", () => { if (waiting.delete(id)) reject(new Error("aborted")); }, { once: true });
      c.postMessage({ type: "run", id, text: lower });
    });
  }

  // ---- the model files: downloaded once, resumable, used only when every SHA-256 is the pinned one ----
  /** The pinned SHA-256 or nothing: a file that differs is deleted and the download fails. */
  async function verifyDownload(file, sha256) {
    const sha = await deps.sha256File(file);
    if (sha === sha256) return;
    try { fs.rmSync(file, { force: true }); } catch { /* the next try starts again */ }
    throw new Error("a downloaded model file is not the expected one (hash differs); it was deleted");
  }
  let fetching = null;
  let pct = 0;
  let fetchError = "";
  /** Downloads the model files into the profile. A broken download continues where it stopped; each file gets its name only after its hash was checked. */
  function fetchModel() {
    if (hasModel()) return Promise.resolve(true);
    if (fetching) return fetching;
    fetchError = "";
    pct = 0;
    fetching = (async () => {
      fs.mkdirSync(dir(), { recursive: true });
      log(`truecase: downloading the model (${Math.round(BYTES / 1024 / 1024)} MiB) from huggingface.co`);
      let before = 0;
      for (const f of FILES) {
        const dest = path.join(dir(), f.name);
        if (!fs.existsSync(dest)) {
          const part = `${dest}.part`;
          const share = (p) => { pct = Math.min(99, Math.round(((before + (f.bytes * p) / 100) / BYTES) * 100)); };
          await deps.download(deps.fileUrl ? deps.fileUrl(f) : fileUrl(f), part, { resume: true, fallbackSize: f.bytes, onPct: share });
          await verifyDownload(part, f.sha256);
          fs.renameSync(part, dest);
        }
        before += f.bytes;
      }
      pct = 100;
      lastError = "";
      log("truecase: model on this computer, hashes checked");
      return true;
    })().catch((e) => { fetchError = String((e && e.message) || e).slice(0, 120); log(`truecase: model download failed (${fetchError})`); return false; }).finally(() => { fetching = null; });
    return fetching;
  }

  /** Loads the model ahead of the first dictation, so that one does not pay the load. */
  function warm() { if (ready().ok) void start().catch(() => {}); }
  function stop() { ct(idleTimer); idleTimer = null; const c = child; child = null; failAll("stopped"); if (c) { try { c.kill(); } catch { /* gone */ } } }
  const status = () => ({ runtime: hasRuntime(), model: hasModel(), running: Boolean(child), startedMs, error: lastError || fetchError, downloading: Boolean(fetching), pct, bytes: BYTES, unloads });
  return { ready, run, warm, stop, status, fetchModel };
}

module.exports = { createTruecaseRuntime, runtimeFile, modelDir, FILES, BYTES, REVISION, SETUP_ID, IDLE_UNLOAD_MS };
