// The runtime for S1-mini by Superwhisper (docs/dictation/S1-MINI.md): llama.cpp's own server program
// (llama-server, MIT), started by Filow as a child process when the first English dictation needs it.
// Why a separate program and not a library inside Filow: a crash or a slow load in it cannot take Filow
// down or stall its windows, it has no tie to Electron's version, and the same official binary exists for
// Windows, macOS and Linux. It listens on this computer only (127.0.0.1), on a port the system picks, and
// answers only requests that carry a key made for this run. Nothing here reaches the network.
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const crypto = require("node:crypto");
const { cancelError, isCancelled, removeInside } = require("./model-files");

const MODEL_FILE = "s1-mini-q4_k_m.gguf";
/** The file Filow downloads (superwhisper/s1-mini-GGUF, revision 34add00a): size and SHA-256 are pinned. */
const MODEL = { file: MODEL_FILE, bytes: 484219808, sha256: "3b41ebe2502cbd03e811d5d16b022f5ab551eda58d62597d152f89535003c634", revision: "34add00a48a2e5d24e5a4ee5405a99620a3a240c" };
/** Where the model comes from: the pinned revision on Hugging Face (no account, no token). */
const MODEL_URL = `https://huggingface.co/superwhisper/s1-mini-GGUF/resolve/${MODEL.revision}/${MODEL_FILE}`;

/** Where the server program is inside Filow (next to app.asar when packaged), or "" when this build has none. */
function serverFile({ platform = process.platform, arch = process.arch, baseDir = __dirname, exists = fs.existsSync } = {}) {
  const name = platform === "win32" ? "llama-server.exe" : "llama-server";
  const file = path.join(baseDir, "native", "llama", `${platform}-${arch}`, name).replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2");
  return exists(file) ? file : "";
}
/** The runtime holds about 0.9 GB of memory with the model loaded: it is let go after this long without a dictation. */
const IDLE_UNLOAD_MS = 10 * 60_000;
const modelFile = (userData) => path.join(userData, "models", "s1-mini", MODEL_FILE);

/** A free port on this computer, picked by the system. */
function freePort(netLib = net) {
  return new Promise((resolve, reject) => {
    const s = netLib.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

/**
 * deps: { userData, logLine, spawn (child_process.spawn), fetch, threads?, serverFile?(), modelExists?(file),
 *         startTimeoutMs?, sleep? }
 */
function createS1Runtime(deps) {
  const log = deps.logLine || (() => {});
  const fetchFn = deps.fetch || globalThis.fetch;
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const exe = () => (deps.serverFile ? deps.serverFile() : serverFile());
  const model = () => modelFile(deps.userData);
  const hasModel = () => (deps.modelExists ? deps.modelExists(model()) : fs.existsSync(model()));
  let child = null;
  let base = "";
  let key = "";
  let starting = null;
  let lastError = "";
  let startedMs = 0;
  // Unload when idle: every use (and every start) pushes the moment back.
  const st = deps.setTimeout || setTimeout;
  const ct = deps.clearTimeout || clearTimeout;
  let idleTimer = null;
  let unloads = 0;
  function touch() {
    ct(idleTimer);
    idleTimer = st(() => {
      if (!child) return;
      unloads += 1;
      log(`s1: no dictation for ${Math.round(IDLE_UNLOAD_MS / 60000)} minutes: the runtime is stopped and its memory given back (it starts again with the next English dictation)`);
      stop();
    }, deps.idleMs || IDLE_UNLOAD_MS);
    if (idleTimer && idleTimer.unref) idleTimer.unref();
  }

  /** Can a dictation be cleaned at all on this PC? Says why not in a few words (for the report). */
  function ready() {
    if (!exe()) return { ok: false, reason: "runtime not in this build" };
    if (!hasModel()) return { ok: false, reason: "model not on this computer" };
    if (lastError && !child) return { ok: false, reason: `runtime did not start: ${lastError}` };
    return { ok: true, reason: "" };
  }

  async function start() {
    if (child) return;
    if (starting) return starting;
    starting = (async () => {
      const t0 = Date.now();
      const port = await freePort();
      key = crypto.randomBytes(24).toString("hex");
      const threads = Math.max(1, Math.min(8, Number(deps.threads ? deps.threads() : 4) || 4));
      const args = ["-m", model(), "--host", "127.0.0.1", "--port", String(port), "--api-key", key, "--jinja",
        "--chat-template-kwargs", JSON.stringify({ enable_thinking: false }), "--temp", "0", "--ctx-size", "2048",
        "--threads", String(threads), "--parallel", "1", "--no-webui"];
      const c = deps.spawn(exe(), args, { windowsHide: true, stdio: "ignore" });
      let exited = false;
      c.once("exit", (code) => { exited = true; if (child === c) { child = null; base = ""; log(`s1: the runtime stopped (code ${code})`); } });
      c.once("error", (e) => { exited = true; lastError = String((e && e.message) || e).slice(0, 80); });
      const url = `http://127.0.0.1:${port}`;
      const until = Date.now() + (deps.startTimeoutMs || 20000);
      for (;;) {
        if (exited) throw new Error(lastError || "the runtime stopped while starting");
        try { const r = await fetchFn(`${url}/health`, { headers: { authorization: `Bearer ${key}` } }); if (r.ok) break; } catch { /* not listening yet */ }
        if (Date.now() > until) { try { c.kill(); } catch { /* gone */ } throw new Error("the runtime did not answer in time"); }
        await sleep(100);
      }
      child = c;
      base = url;
      lastError = "";
      touch();
      startedMs = Date.now() - t0;
      log(`s1: runtime ready in ${startedMs} ms (llama-server, ${threads} threads, this computer only)`);
    })().catch((e) => { lastError = String((e && e.message) || e).slice(0, 80); log(`s1: runtime did not start (${lastError})`); throw e; }).finally(() => { starting = null; });
    return starting;
  }

  /** The cleaned text for one request body (dictation-cleanup.js buildRequest). Starts the runtime when needed. */
  async function run(body, signal) {
    await start();
    touch();
    const r = await fetchFn(`${base}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(body), signal });
    if (!r.ok) throw new Error(`runtime answered ${r.status}`);
    const j = await r.json();
    const text = j && j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : null;
    if (typeof text !== "string") throw new Error("runtime answer without text");
    return text;
  }

  // ---- the model file: downloaded once, resumable, used only when its SHA-256 is the pinned one ----
  /** The pinned SHA-256 or nothing: a file that differs is deleted and the download fails. */
  async function verifyDownload(file) {
    const sha = await deps.sha256File(file);
    if (sha === MODEL.sha256) return;
    try { fs.rmSync(file, { force: true }); } catch { /* the next try starts again */ }
    throw new Error("the downloaded model is not the expected file (hash differs); it was deleted");
  }
  let fetching = null;
  let stopFetch = null;
  let pct = 0;
  let fetchError = "";
  /**
   * Downloads the model (462 MiB) into the profile. A broken download continues where it stopped; the
   * file gets its real name only after its hash was checked, so a half or altered file is never loaded.
   * The downloader (resume, progress) and the SHA-256 reader come from Filow's own modules, through deps.
   * cancelFetch() is the user's Stop: the transfer ends, the part is deleted, and it is not an error.
   */
  function fetchModel() {
    if (hasModel()) return Promise.resolve(true);
    if (fetching) return fetching;
    const dest = model();
    const part = `${dest}.part`;
    const ctl = new AbortController();
    fetchError = "";
    pct = 0;
    stopFetch = () => ctl.abort(cancelError());
    fetching = (async () => {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      log(`s1: downloading the model (${Math.round(MODEL.bytes / 1024 / 1024)} MiB) from huggingface.co`);
      await deps.download(deps.modelUrl || MODEL_URL, part, { resume: true, fallbackSize: MODEL.bytes, onPct: (p) => { pct = p; }, signal: ctl.signal });
      await verifyDownload(part);
      if (ctl.signal.aborted) throw cancelError();
      fs.renameSync(part, dest);
      pct = 100;
      lastError = "";
      log("s1: model on this computer, hash checked"); // loaded at the next English dictation, not now
      return true;
    })().catch((e) => {
      if (isCancelled(e) || ctl.signal.aborted) {
        try { fs.rmSync(part, { force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* the next download starts over anyway */ }
        try { fs.rmdirSync(path.dirname(part)); } catch { /* not empty: the model itself is there */ }
        pct = 0;
        log("s1: model download stopped by the user, nothing kept on disk");
        return false;
      }
      fetchError = String((e && e.message) || e).slice(0, 120); log(`s1: model download failed (${fetchError})`); return false;
    }).finally(() => { fetching = null; stopFetch = null; });
    return fetching;
  }
  /** Stop: true when a download was running. It settles (file closed, part deleted) before the promise of fetchModel does. */
  function cancelFetch() {
    if (!stopFetch) return false;
    stopFetch();
    return true;
  }

  /** Loads the model ahead of the first dictation, so that one does not pay the start. Errors are kept for the report. */
  function warm() { if (ready().ok) void start().catch(() => {}); }
  function stop() { ct(idleTimer); idleTimer = null; const c = child; child = null; base = ""; if (c) { try { c.kill(); } catch { /* gone */ } } }
  /**
   * Delete: any download is stopped, the runtime is stopped and waited for (Windows will not delete a
   * model a running llama-server has open), then the model's folder goes, part included. Returns the
   * bytes freed. Dictation carries on without the cleanup step (ready() says "model not on this computer").
   */
  async function remove() {
    cancelFetch();
    if (fetching) await fetching;
    if (starting) await starting.catch(() => {});
    const c = child;
    stop();
    await exited(c);
    lastError = "";
    fetchError = "";
    pct = 0;
    const freed = removeInside(path.join(deps.userData, "models"), path.dirname(model()));
    log(`s1: model deleted by the user (${Math.round(freed / 1024 / 1024)} MB freed)`);
    return freed;
  }
  const status = () => ({ runtime: Boolean(exe()), model: hasModel(), running: Boolean(child), startedMs, error: lastError || fetchError, downloading: Boolean(fetching), pct, bytes: MODEL.bytes, unloads });
  return { ready, run, warm, stop, status, fetchModel, cancelFetch, remove };
}

/** Settles when a child process (or utility process) has exited, or after `ms` when it does not say so. */
function exited(child, ms = 5000) {
  if (!child || typeof child.once !== "function" || child.exitCode !== null && child.exitCode !== undefined) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (timer.unref) timer.unref();
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}

/** The name the setup uses for the model (build/installer.nsh, welcome-setup.js, packages/core profile.ts). */
const SETUP_ID = "s1-mini";
/**
 * The installer, the welcome or Settings asked for the model: one path for all three. The wish is kept
 * (store.set(true)) until the file is on this computer, so a setup done without a network is finished at
 * a later start; Settings shows its button meanwhile. A build without the runtime never keeps the wish.
 */
function wantModel(rt, store, canFetch = () => true) {
  const s = rt.status();
  if (s.model) { store.set(false); return { started: false, reason: "present" }; }
  if (!s.runtime) return { started: false, reason: "no runtime" };
  store.set(true);
  if (!canFetch()) return { started: false, reason: "offline" };
  void rt.fetchModel().then((ok) => { if (ok) store.set(false); });
  return { started: true };
}

module.exports = { exited, createS1Runtime, serverFile, modelFile, freePort, wantModel, MODEL, MODEL_URL, IDLE_UNLOAD_MS, SETUP_ID };
