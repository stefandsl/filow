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

const MODEL_FILE = "s1-mini-q4_k_m.gguf";
/** The file Filow downloads (superwhisper/s1-mini-GGUF, revision 34add00a): size and SHA-256 are pinned. */
const MODEL = { file: MODEL_FILE, bytes: 484219808, sha256: "3b41ebe2502cbd03e811d5d16b022f5ab551eda58d62597d152f89535003c634", revision: "34add00a48a2e5d24e5a4ee5405a99620a3a240c" };

/** Where the server program is inside Filow (next to app.asar when packaged), or "" when this build has none. */
function serverFile({ platform = process.platform, arch = process.arch, baseDir = __dirname, exists = fs.existsSync } = {}) {
  const name = platform === "win32" ? "llama-server.exe" : "llama-server";
  const file = path.join(baseDir, "native", "llama", `${platform}-${arch}`, name).replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2");
  return exists(file) ? file : "";
}
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
      startedMs = Date.now() - t0;
      log(`s1: runtime ready in ${startedMs} ms (llama-server, ${threads} threads, this computer only)`);
    })().catch((e) => { lastError = String((e && e.message) || e).slice(0, 80); log(`s1: runtime did not start (${lastError})`); throw e; }).finally(() => { starting = null; });
    return starting;
  }

  /** The cleaned text for one request body (dictation-cleanup.js buildRequest). Starts the runtime when needed. */
  async function run(body, signal) {
    await start();
    const r = await fetchFn(`${base}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(body), signal });
    if (!r.ok) throw new Error(`runtime answered ${r.status}`);
    const j = await r.json();
    const text = j && j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : null;
    if (typeof text !== "string") throw new Error("runtime answer without text");
    return text;
  }

  /** Loads the model ahead of the first dictation, so that one does not pay the start. Errors are kept for the report. */
  function warm() { if (ready().ok) void start().catch(() => {}); }
  function stop() { const c = child; child = null; base = ""; if (c) { try { c.kill(); } catch { /* gone */ } } }
  const status = () => ({ runtime: Boolean(exe()), model: hasModel(), running: Boolean(child), startedMs, error: lastError });
  return { ready, run, warm, stop, status };
}

module.exports = { createS1Runtime, serverFile, modelFile, freePort, MODEL };
