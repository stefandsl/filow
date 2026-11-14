// Local AI setup for the desktop app: a quick hardware scan, the recommendation that follows
// from it, and the unattended Ollama install (Windows: official OllamaSetup.exe run silently;
// macOS: Ollama.app unzipped into ~/Applications; Linux: the official script needs sudo, so we
// only hand the command over). Models themselves are pulled by the Settings page through Ollama.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFile, execFileSync } = require("node:child_process");
const { download } = require("./download");
const { isCancelled } = require("./model-files");
const { runtimeState, MIN_OLLAMA_VERSION } = require("./ollama-runtime");

const OLLAMA_URL = () => process.env.OLLAMA_URL || "http://127.0.0.1:11434";

/**
 * The setup profiles (packages/core/src/profile.ts) and the graphics card detection
 * (packages/core/src/hardware.ts), bundled into vendor/ by `npm run build:welcome`: the same code
 * the web server runs, so the first-start downloads, Settings and OK Filow follow one rule.
 */
const core = () => ({ ...require("./vendor/profile"), ...require("./vendor/hardware") });

/** Catalogue mirrored from apps/web/lib/localModels.ts (sizes in GB) for the first-start recommendation. */
const CATALOG = {
  "nemotron-streaming": { dl: 0.45, ram: 3, ollama: false },
  "whisper-base": { dl: 0.15, ram: 2, ollama: false },
  "whisper-small": { dl: 0.5, ram: 4, ollama: false },
  "clef-flash": { dl: 11, ram: 16, ollama: true },
  clef: { dl: 17, ram: 32, ollama: true },
  "gemma4:e2b": { dl: 4.3, ram: 8, ollama: true },
  "gemma4:e4b": { dl: 6.1, ram: 16, ollama: true },
  "qwen3-vl:8b": { dl: 6.1, ram: 16, ollama: true },
  "qwen3-vl:4b": { dl: 3.3, ram: 8, ollama: true },
  "qwen3-vl:2b": { dl: 1.9, ram: 6, ollama: true },
  "lfm3-vl": { dl: 1.5, ram: 4, ollama: true },
  // S1-mini by Superwhisper (s1-runtime.js): cleans up English dictation; 484,219,808 bytes, on every tier.
  "s1-mini": { dl: 0.46, ram: 2, ollama: false },
};

/** Runs a probe as a child process: resolves its output, or "" on failure. The main process never waits on it. */
function runProbe(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { encoding: "utf8", timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 20 }, (err, out) => resolve(err ? "" : String(out)));
    } catch {
      resolve("");
    }
  });
}

let scanning = null;

/**
 * { ramGb, gpu, gpuClass: "discrete"|"integrated"|"unknown", gpuKind, vramGb, gpuOllama, freeGb, cpu, cores, platform, arch }
 * Asynchronous (the probes take up to 11 s on Windows and used to freeze every window) and done
 * once per session: later calls get the same promise. `refresh` scans again.
 */
function hardwareScan({ refresh = false, run = runProbe } = {}) {
  if (!scanning || refresh) scanning = scan(run);
  return scanning;
}

async function scan(run) {
  const { detectGpu, ollamaModelsDir, freeGbAt } = core();
  // QA builds only (FILOW_QA_HARDWARE): the laptop a speed baseline pretends to be, without probing the real card
  const qa = require("./qa.js").qaHardware?.() ?? null;
  const g = qa ? qa.gpu : await detectGpu(run, { platform: process.platform, cpuModel: os.cpus()[0]?.model || "", totalMemBytes: os.totalmem() });
  // free space where Ollama will keep the models (OLLAMA_MODELS, else ~/.ollama/models)
  const free = freeGbAt(ollamaModelsDir(process.env, os.homedir(), path.sep), (p) => fs.statfsSync(p), path.dirname);
  return {
    ramGb: qa ? qa.ramGb : Math.ceil(os.totalmem() / 1024 ** 3),
    gpu: g.name,
    gpuClass: g.kind === "discrete" || g.kind === "unified" ? "discrete" : g.kind === "integrated" ? "integrated" : "unknown",
    gpuKind: g.kind,
    vramGb: g.vramGb,
    gpuOllama: g.ollama,
    freeGb: free === null ? -1 : free,
    cpu: os.cpus()[0]?.model || "",
    cores: qa ? qa.cores : os.cpus().length,
    platform: process.platform,
    arch: process.arch,
  };
}

/** The scan in the shape packages/core/src/profile.ts reads. */
function machineOf(hw) {
  return {
    ramGb: hw.ramGb,
    cores: hw.cores,
    gpu: { kind: hw.gpuKind, vramGb: hw.vramGb ?? null, ollama: hw.gpuOllama },
    freeDiskGb: hw.freeGb === null || hw.freeGb === undefined || hw.freeGb < 0 ? null : hw.freeGb,
  };
}

/** The setup profile for this machine: recommendProfile in packages/core/src/profile.ts. */
function profileOf(hw) {
  return core().recommendProfile(machineOf(hw)).profile;
}

/**
 * What this machine can run comfortably: exactly its setup profile's downloads (setupChoices), the
 * Whisper model of that profile for the browser, plus the slide model the RAM allows (script from
 * slides). The profile's own models already fit (the core picks a lighter setup, or no screen
 * helper, when they would not); only the slide model is dropped for disk space, keeping 4 GB free.
 */
function recommend(hw) {
  const { recommendProfile, setupChoices, DOWNLOAD_SPARE_GB } = core();
  const machine = machineOf(hw);
  const profile = recommendProfile(machine).profile;
  const choices = setupChoices(profile, machine);
  const whisper = `whisper-${choices.stt.browserWhisper.split("whisper-")[1]}`;
  // the matcher's small model ("browser") loads inside the page on first use and is not listed here
  let models = [
    ...choices.models.filter((m) => m.runtime === "sherpa").map((m) => m.name),
    whisper,
    ...choices.models.filter((m) => m.runtime === "ollama").map((m) => m.name),
  ];
  if (hw.ramGb >= 32) models.push("gemma4:e4b");
  else if (hw.ramGb >= 8) models.push("gemma4:e2b");
  const total = (list) => list.reduce((s, n) => s + (CATALOG[n]?.dl || 0), 0);
  if (hw.freeGb >= 0) {
    // the big slide model gives way to its small sibling, then to nothing (DOWNLOAD_SPARE_GB left free)
    const ollamaTotal = (list) => list.reduce((s, n) => s + (CATALOG[n]?.ollama ? CATALOG[n].dl : 0), 0);
    const fits = (list) => ollamaTotal(list) + DOWNLOAD_SPARE_GB <= hw.freeGb;
    if (models.includes("gemma4:e4b") && !fits(models)) models = models.map((n) => (n === "gemma4:e4b" ? "gemma4:e2b" : n));
    if (models.includes("gemma4:e2b") && !fits(models)) models = models.filter((n) => n !== "gemma4:e2b");
  }
  return { profile, models, ollama: models.some((n) => CATALOG[n]?.ollama), downloadGb: Math.round(total(models) * 10) / 10 };
}

function ollamaExe() {
  const candidates =
    process.platform === "win32"
      ? [path.join(process.env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama.exe"), "C:\\Program Files\\Ollama\\ollama.exe"]
      : process.platform === "darwin"
        ? [path.join(os.homedir(), "Applications", "Ollama.app", "Contents", "Resources", "ollama"), "/Applications/Ollama.app/Contents/Resources/ollama", "/usr/local/bin/ollama", "/opt/homebrew/bin/ollama"]
        : ["/usr/local/bin/ollama", "/usr/bin/ollama"];
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  try {
    const found = execFileSync(process.platform === "win32" ? "where" : "which", ["ollama"], { encoding: "utf8", windowsHide: true }).split(/\r?\n/)[0].trim();
    return found && fs.existsSync(found) ? found : "";
  } catch {
    return "";
  }
}

/**
 * What is at Ollama's address right now: { state, version }.
 *   up    Ollama answered with its version
 *   busy  something accepted the connection but has not answered. Ollama opens its port first and
 *         answers only after it has looked for graphics cards, which can take a while on a first start.
 *   down  nothing listens there
 */
function probeOllama(ms = 1500) {
  return new Promise((resolve) => {
    let connected = false;
    let settled = false;
    const finish = (state, version = "") => {
      if (settled) return;
      settled = true;
      resolve({ state, version });
    };
    const quiet = () => finish(connected ? "busy" : "down");
    let req;
    try {
      const url = OLLAMA_URL();
      req = require(url.startsWith("https") ? "node:https" : "node:http").get(`${url}/api/version`, { timeout: ms }, (res) => {
        connected = true;
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("error", quiet);
        res.on("end", () => {
          let version = "";
          try {
            version = String(JSON.parse(body).version || "");
          } catch {
            /* not Ollama's answer */
          }
          finish(version ? "up" : "busy", version);
        });
      });
    } catch {
      return finish("down");
    }
    req.on("socket", (socket) => {
      if (socket.connecting === false) connected = true;
      else socket.once("connect", () => (connected = true));
    });
    req.on("error", quiet);
    req.on("timeout", () => {
      req.destroy();
      quiet();
    });
  });
}

async function ollamaVersion() {
  return (await probeOllama()).version;
}

/**
 * Asks Ollama's own desktop app to start in the background (Windows: "ollama app.exe hidden", no
 * window; macOS: Ollama.app). The app runs the server, keeps Ollama updated and starts with the
 * computer. True when there is such an app next to exe and it was asked.
 */
function launchOllamaApp(exe, platform = process.platform) {
  try {
    if (platform === "win32") {
      const appExe = path.join(path.dirname(exe), "ollama app.exe");
      if (!fs.existsSync(appExe)) return false;
      const p = spawn(appExe, ["hidden"], { detached: true, stdio: "ignore", windowsHide: true });
      p.on("error", () => {});
      p.unref();
      return true;
    }
    if (platform === "darwin" && exe.includes(".app/")) {
      const p = spawn("open", ["-a", exe.split("/Contents/")[0], "--background"], { detached: true, stdio: "ignore" });
      p.on("error", () => {});
      p.unref();
      return true;
    }
  } catch {
    /* the caller falls back to "ollama serve" */
  }
  return false;
}

/** False when OLLAMA_URL points at another machine: there is nothing to start on this one. */
function ollamaIsLocal() {
  try {
    return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(OLLAMA_URL()).hostname);
  } catch {
    return false;
  }
}

/** The address "ollama serve" must listen on to be found at OLLAMA_URL, when that is a port on this computer other than Ollama's own. */
function serveHost() {
  try {
    const u = new URL(OLLAMA_URL());
    if (!["127.0.0.1", "localhost"].includes(u.hostname) || !u.port || u.port === "11434") return "";
    return `127.0.0.1:${u.port}`;
  } catch {
    return "";
  }
}

/** The "ollama serve" this process started, if any: { pid, exit: null | { code, signal, error }, logFile }. */
let ownServer = null;

/**
 * Runs "ollama serve" as our own child, its output in logFile (the reason is there when it stops).
 * This is what brings Ollama up when its desktop app is missing or does not start the server.
 */
function serveOllama(exe, logFile) {
  const run = { pid: 0, exit: null, logFile, child: null };
  let fd = null;
  try {
    if (logFile) {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fd = fs.openSync(logFile, "w");
    }
  } catch {
    fd = null;
  }
  try {
    const env = { ...process.env };
    if (!env.OLLAMA_HOST && serveHost()) env.OLLAMA_HOST = serveHost();
    const out = fd === null ? "ignore" : fd;
    const p = spawn(exe, ["serve"], { stdio: ["ignore", out, out], windowsHide: true, env });
    run.child = p;
    run.pid = p.pid || 0;
    p.on("error", (err) => (run.exit = run.exit || { code: null, signal: null, error: String(err && err.message ? err.message : err) }));
    p.on("exit", (code, signal) => (run.exit = run.exit || { code, signal, error: "" }));
    p.unref();
  } catch (err) {
    run.exit = { code: null, signal: null, error: String(err && err.message ? err.message : err) };
  }
  if (fd !== null) {
    try {
      fs.closeSync(fd);
    } catch {
      /* the child holds its own handle */
    }
  }
  ownServer = run;
  return run;
}

/** Whether an "ollama serve" this process started is still running. */
function ownOllamaRunning() {
  return Boolean(ownServer && ownServer.pid && !ownServer.exit);
}

/** Stops the "ollama serve" this process started (with the model runners under it). Ollama's own app is never touched. */
function stopOwnOllama() {
  const run = ownServer;
  ownServer = null;
  if (!run || !run.pid || run.exit) return false;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(run.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, timeout: 10_000 });
    else run.child.kill();
  } catch {
    /* already gone */
  }
  return true;
}

/** Where Ollama's desktop app writes its logs. */
function ollamaLogFiles(platform = process.platform) {
  if (platform === "win32") {
    const dir = path.join(process.env.LOCALAPPDATA || "", "Ollama");
    return process.env.LOCALAPPDATA ? [path.join(dir, "server.log"), path.join(dir, "app.log")] : [];
  }
  if (platform === "darwin") return [path.join(os.homedir(), ".ollama", "logs", "server.log"), path.join(os.homedir(), ".ollama", "logs", "app.log")];
  return [];
}

/**
 * A line of Ollama's log made safe for a report, before the report's own masking (diag.js): Go
 * prints Windows paths with doubled backslashes, which hides the home folder from that masking; a
 * proxy address may carry a user name and password; the first start prints the public key.
 */
function scrubLogLine(line) {
  return String(line)
    .replace(/\\\\/g, "\\")
    .replace(/\b((?:HTTPS?|ALL|NO)_PROXY):[^\s\]]+/gi, "$1:<set>")
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, "$1<secret>@")
    .replace(/\bssh-(?:ed25519|rsa) [A-Za-z0-9+/=]{20,}/g, "<public key>");
}

/** The last lines of a log, scrubbed and each cut short, under a title; nothing when the file is missing. */
function tailLines(title, file, { lines = 12, width = 300 } = {}) {
  let text;
  try {
    if (!file || fs.statSync(file).size > 16 * 1024 * 1024) return [];
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const last = text.split(/\r?\n/).filter((l) => l.trim()).slice(-lines).map(scrubLogLine);
  if (!last.length) return [`${title}: empty`];
  return [`${title}, last ${last.length} lines:`, ...last.map((l) => `  ${l.length > width ? `${l.slice(0, width)}...` : l}`)];
}

/** How long Ollama's desktop app gets before we run the server ourselves, and how long a start may take in all. */
const START_TIMES = { appGraceMs: 20_000, totalMs: 240_000, pollMs: 1000 };

/**
 * Brings up an installed Ollama that is not answering, and waits for it.
 *   1. Ollama's own desktop app is asked to start, hidden. It gets appGraceMs.
 *   2. Still nothing on the port: we run "ollama serve" ourselves. On some Windows PCs the app starts
 *      but its server never does, with nothing in its logs (ollama/ollama#18061); the server itself runs.
 *   3. While the port is open but silent (Ollama is looking for graphics cards) we only wait.
 * Ends within totalMs whatever happens. Resolves { ok: true, version, by } or
 * { ok: false, code: "start_exited" | "start_timeout", exitCode, error, minutes, lines } where lines
 * is the reason for the startup log: the exit code and the end of the server's own output.
 */
async function startOllama(exe, deps = {}) {
  const {
    platform = process.platform, probe = probeOllama, launchApp = launchOllamaApp, serve = serveOllama, stop = stopOwnOllama, hasOwn = ownOllamaRunning,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, log = () => {},
    appGraceMs = START_TIMES.appGraceMs, totalMs = START_TIMES.totalMs, pollMs = START_TIMES.pollMs,
    logFile = "", ollamaLogs = ollamaLogFiles(platform),
  } = deps;
  const t0 = now();
  const seconds = () => Math.round((now() - t0) / 1000);
  let p = await probe();
  if (p.state === "up") return { ok: true, version: p.version, by: "running", seconds: 0 };
  // A server we started earlier that no longer answers would hold the port against every new try.
  // It gets a few seconds first: one slow answer from a busy server is no reason to stop it.
  if (hasOwn()) {
    for (let i = 0; i < 4 && p.state !== "up"; i++) {
      await sleep(pollMs);
      p = await probe();
    }
    if (p.state === "up") return { ok: true, version: p.version, by: "running", seconds: seconds() };
    stop();
    log('stopped the "ollama serve" Filow started earlier: it no longer answered');
    p = await probe();
  }
  const viaApp = p.state === "down" && launchApp(exe, platform);
  if (viaApp) log("asked the Ollama app to start in the background");
  const serveAt = viaApp ? t0 + appGraceMs : t0;
  let own = null;
  let goneFor = 0;
  while (now() - t0 < totalMs) {
    if (!own && p.state === "down" && now() >= serveAt) {
      own = serve(exe, logFile);
      log(`${viaApp ? `the Ollama app did not open its port in ${seconds()} s: ` : ""}started "ollama serve" (pid ${own.pid || "?"})`);
    }
    await sleep(pollMs);
    p = await probe();
    if (p.state === "up") return { ok: true, version: p.version, by: own && !own.exit ? "serve" : viaApp ? "app" : "other", seconds: seconds() };
    // our server stopped and nothing else holds the port: waiting longer changes nothing
    goneFor = own && own.exit && p.state === "down" ? goneFor + 1 : 0;
    if (goneFor >= 2) break;
  }
  // "stopped at once" only when nothing else is at the port: a server of ours that gave way to
  // something silent already there is a start that timed out, and "restart the computer" fits that
  const exited = Boolean(own && own.exit) && p.state === "down";
  const minutes = Math.max(1, Math.round(totalMs / 60_000));
  const exitCode = exited && typeof own.exit.code === "number" ? own.exit.code : null;
  const error = exited
    ? `Ollama stopped right after it was started (${own.exit.error || (exitCode === null ? `signal ${own.exit.signal || "?"}` : `exit code ${exitCode}`)})`
    : `Ollama did not answer within ${minutes} minutes (${p.state === "busy" ? "its port is open but it does not answer" : "nothing listens on its port"})`;
  if (own && !own.exit) stop(); // a server that never answered is not left running; a retry starts clean
  const lines = [...tailLines('"ollama serve" output', own ? logFile : ""), ...ollamaLogs.flatMap((f) => tailLines(`Ollama ${path.basename(f)}`, f))];
  return { ok: false, code: exited ? "start_exited" : "start_timeout", exitCode, error, minutes, lines };
}

/** Ollama's official installers. */
const OLLAMA_DOWNLOADS = { win32: "https://ollama.com/download/OllamaSetup.exe", darwin: "https://ollama.com/download/Ollama-darwin.zip" };

/** Ollama's Apple Team ID: the subject.OU of its Developer ID certificate (docs/PLATFORMS.md, macOS). */
const OLLAMA_MAC_TEAM_ID = "3MU9H2V9Y9";

/**
 * macOS half of the install (SEC-15; not run on a Mac yet, docs/PLATFORMS.md). The zip is unpacked aside and
 * must carry a Developer ID signature from Ollama's Team ID before it lands where ollamaExe() finds and starts
 * it. An Ollama.app already in appsDir stays until the new one is in place and is put back if the swap fails.
 * The zip and the staging folder are removed whatever happens.
 */
function installMacApp(zip, staging, appsDir, run = execFileSync) {
  const fresh = path.join(staging, "Ollama.app");
  const target = path.join(appsDir, "Ollama.app");
  const old = `${target}.filow-old`;
  try {
    fs.rmSync(staging, { recursive: true, force: true });
    run("ditto", ["-xk", zip, staging]);
    try {
      run("codesign", ["--verify", "--deep", "--strict", `-R=${require("./integrity.js").macDeveloperIdRequirement(OLLAMA_MAC_TEAM_ID)}`, fresh]);
    } catch {
      throw new Error("The Ollama download is not signed by Ollama's Apple Developer ID, so it was not installed.");
    }
    fs.mkdirSync(appsDir, { recursive: true });
    fs.rmSync(old, { recursive: true, force: true });
    const had = fs.existsSync(target);
    if (had) fs.renameSync(target, old);
    try {
      fs.renameSync(fresh, target);
    } catch (err) {
      if (had) fs.renameSync(old, target);
      throw err;
    }
    fs.rmSync(old, { recursive: true, force: true });
  } finally {
    fs.rmSync(zip, { force: true });
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

/** An install step that failed: `code` picks the sentence the user reads in their language, the message goes to the log. */
function stepError(code, err) {
  const e = new Error(String(err && err.message ? err.message : err));
  e.code = code;
  return e;
}

/**
 * Unattended install, then start. onStatus gets {state, pct, code, error, version, command}:
 * states: idle | checking | downloading | installing | starting | ready | manual | error.
 * On "error", `code` says what failed (download_failed, not_signed, installer_failed, exe_missing,
 * start_exited, start_timeout, unexpected): the page shows its own sentence for it, in the user's
 * language. `error` is the same in plain English, for the startup log. Always ends in ready, manual,
 * error or (startOnly, nothing installed) idle: a status can not stay on "starting".
 */
async function installOllama(binDir, onStatus, deps = {}) {
  // deps: `startOnly` (never download: start what is installed), `log` (lines for the startup log); the rest are
  // test seams (no installed Ollama, a platform, a local download server, a short idle timeout, a start).
  // `signal` is the user's Stop while the installer downloads (model-files.js): the transfer ends, the
  // partial installer is deleted and the status goes back to idle. It is not an error.
  const { findExe = ollamaExe, version: probeVersion = ollamaVersion, platform = process.platform, urls = OLLAMA_DOWNLOADS, idleMs, start = startOllama, startOnly = false, log = () => {}, installMs = 15 * 60_000, signal } = deps;
  const report = (s) => onStatus({ pct: 0, code: "", error: "", version: "", command: "", ...s });
  const ready = version => runtimeState(version) === "ready"
    ? report({ state: "ready", version, pct: 100 })
    : report({ state: "error", code: "runtime_old", version, minimum: MIN_OLLAMA_VERSION });
  const bringUp = async (exe) => {
    report({ state: "starting" });
    const r = await start(exe, { ...deps, platform, log, logFile: deps.logFile || path.join(path.dirname(binDir), "ollama-serve.log") });
    if (r.ok) {
      log(`Ollama ${r.version} answers (${r.by}, ${r.seconds} s)`);
      return ready(r.version);
    }
    for (const line of r.lines || []) log(line);
    return report({ state: "error", code: r.code, error: r.error });
  };
  try {
    report({ state: "checking" });
    let exe = findExe();
    const version = await probeVersion();
    if (version) return ready(version);
    if (exe) return await bringUp(exe);
    if (startOnly) return report({ state: "idle" });
    if (platform === "linux") {
      return report({ state: "manual", command: "curl -fsSL https://ollama.com/install.sh | sh" });
    }
    // Existing executables and answering runtimes returned above are never claimed.
    const installedByUs = require("./local-ownership").ownership(path.dirname(binDir));
    installedByUs.beginRuntime(platform);
    fs.mkdirSync(binDir, { recursive: true });
    if (platform === "win32") {
      const setup = path.join(binDir, "OllamaSetup.exe");
      report({ state: "downloading", pct: 0 });
      await download(urls.win32, setup, { onPct: (pct) => report({ state: "downloading", pct }), idleMs, signal }).catch((err) => {
        throw isCancelled(err) ? err : stepError("download_failed", `Ollama download failed: ${err && err.message ? err.message : err}`);
      });
      // SEC-15: run the installer only with a valid Windows signature from Ollama Inc.
      try {
        await require("./integrity.js").verifyAuthenticode(setup, "Ollama Inc.");
      } catch (err) {
        fs.rmSync(setup, { force: true });
        throw stepError("not_signed", err);
      }
      report({ state: "installing", pct: 0 });
      // The installer closes any running Ollama, installs for this user only (no administrator
      // question) and starts Ollama's desktop app itself when it is done.
      await new Promise((resolve, reject) => {
        const p = spawn(setup, ["/VERYSILENT", "/NORESTART", "/SUPPRESSMSGBOXES"], { stdio: "ignore", windowsHide: true });
        // it takes a minute or two; one that hangs must not leave the status on "installing"
        const limit = setTimeout(() => {
          reject(stepError("installer_failed", `OllamaSetup did not finish within ${Math.round(installMs / 60_000)} minutes`));
          try {
            p.kill();
          } catch {
            /* already gone */
          }
        }, installMs);
        if (limit && limit.unref) limit.unref();
        const ended = (fn, value) => {
          clearTimeout(limit);
          fn(value);
        };
        p.on("error", (err) => ended(reject, stepError("installer_failed", err)));
        p.on("exit", (code) => (code === 0 ? ended(resolve) : ended(reject, stepError("installer_failed", `OllamaSetup exited with code ${code}`))));
      });
      fs.rmSync(setup, { force: true });
    } else {
      const zip = path.join(binDir, "Ollama-darwin.zip");
      const staging = path.join(binDir, "ollama-staging");
      report({ state: "downloading", pct: 0 });
      await download(urls.darwin, zip, { onPct: (pct) => report({ state: "downloading", pct }), idleMs, signal }).catch((err) => {
        throw isCancelled(err) ? err : stepError("download_failed", `Ollama download failed: ${err && err.message ? err.message : err}`);
      });
      report({ state: "installing", pct: 0 });
      try {
        installMacApp(zip, staging, path.join(os.homedir(), "Applications"));
      } catch (err) {
        throw stepError(/not signed/.test(String(err && err.message)) ? "not_signed" : "installer_failed", err);
      }
    }
    exe = findExe();
    if (!exe) throw stepError("exe_missing", "Ollama was installed but its executable was not found.");
    installedByUs.completeRuntime(exe);
    return await bringUp(exe);
  } catch (err) {
    if (isCancelled(err)) {
      log("Ollama installer download stopped by the user, nothing kept on disk");
      return report({ state: "idle" });
    }
    return report({ state: "error", code: (err && typeof err.code === "string" && /^[a-z_]+$/.test(err.code) && err.code) || "unexpected", error: String(err && err.message ? err.message : err) });
  }
}

/** OK Filow's answer when Ollama does not answer at all (apps/web/lib/buddy/providers.ts, askOllama). */
const OLLAMA_STOPPED = /\bOllama\b.*\bis not running\b/;
/** A failed OK Filow answer { error, code } that means Ollama is stopped: the panel's code for it, or the server's sentence itself. */
const isOllamaStopped = (failure) => Boolean(failure && (failure.code === "ollama_stopped" || OLLAMA_STOPPED.test(String(failure.error || ""))));

module.exports = { CATALOG, OLLAMA_STOPPED, isOllamaStopped, hardwareScan, profileOf, recommend, ollamaExe, ollamaVersion, ollamaIsLocal, probeOllama, scrubLogLine, startOllama, stopOwnOllama, installOllama, installMacApp };
