// Local AI setup for the desktop app: a quick hardware scan, the recommendation that follows
// from it, and the unattended Ollama install (Windows: official OllamaSetup.exe run silently;
// macOS: Ollama.app unzipped into ~/Applications; Linux: the official script needs sudo, so we
// only hand the command over). Models themselves are pulled by the Settings page through Ollama.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFile, execFileSync } = require("node:child_process");
const { download } = require("./download");

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
  "gemma4:e2b": { dl: 6, ram: 8, ollama: true },
  "gemma4:e4b": { dl: 9, ram: 16, ollama: true },
  "qwen3-vl:8b": { dl: 6.1, ram: 16, ollama: true },
  "qwen3-vl:4b": { dl: 3.3, ram: 8, ollama: true },
  "qwen3-vl:2b": { dl: 1.9, ram: 6, ollama: true },
  "lfm3-vl": { dl: 1.5, ram: 4, ollama: true },
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
  const g = await detectGpu(run, { platform: process.platform, cpuModel: os.cpus()[0]?.model || "", totalMemBytes: os.totalmem() });
  // free space where Ollama will keep the models (OLLAMA_MODELS, else ~/.ollama/models)
  const free = freeGbAt(ollamaModelsDir(process.env, os.homedir(), path.sep), (p) => fs.statfsSync(p), path.dirname);
  return {
    ramGb: Math.ceil(os.totalmem() / 1024 ** 3),
    gpu: g.name,
    gpuClass: g.kind === "discrete" || g.kind === "unified" ? "discrete" : g.kind === "integrated" ? "integrated" : "unknown",
    gpuKind: g.kind,
    vramGb: g.vramGb,
    gpuOllama: g.ollama,
    freeGb: free === null ? -1 : free,
    cpu: os.cpus()[0]?.model || "",
    cores: os.cpus().length,
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

function fetchJson(url, ms = 1500) {
  return new Promise((resolve) => {
    const req = require(url.startsWith("https") ? "node:https" : "node:http").get(url, { timeout: ms }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function ollamaVersion() {
  const v = await fetchJson(`${OLLAMA_URL()}/api/version`);
  return v && v.version ? String(v.version) : "";
}

/** Start the Ollama server if it is installed but not answering. */
function startOllama(exe) {
  try {
    if (process.platform === "win32") {
      const appExe = path.join(path.dirname(exe), "ollama app.exe");
      const p = spawn(fs.existsSync(appExe) ? appExe : exe, fs.existsSync(appExe) ? [] : ["serve"], { detached: true, stdio: "ignore", windowsHide: true });
      p.unref();
    } else if (process.platform === "darwin" && exe.includes(".app/")) {
      spawn("open", ["-a", exe.split("/Contents/")[0], "--background"], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn(exe, ["serve"], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    /* reported by the readiness wait */
  }
}

async function waitForOllama(ms = 60_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = await ollamaVersion();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return "";
}

/** Ollama's official installers. */
const OLLAMA_DOWNLOADS = { win32: "https://ollama.com/download/OllamaSetup.exe", darwin: "https://ollama.com/download/Ollama-darwin.zip" };
/** The shared downloader already removed the partial file; say what failed in plain words. */
const downloadFailed = (err) => {
  throw new Error(`Ollama download failed: ${err && err.message ? err.message : err}`);
};

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

/**
 * Unattended install. onStatus gets {state, pct, error, version, command}:
 * states: checking | downloading | installing | starting | ready | manual | error.
 */
async function installOllama(binDir, onStatus, deps = {}) {
  // deps: test seams only (no installed Ollama, a platform, a local download server, a short idle timeout).
  const { findExe = ollamaExe, version: probeVersion = ollamaVersion, platform = process.platform, urls = OLLAMA_DOWNLOADS, idleMs } = deps;
  const report = (s) => onStatus({ pct: 0, error: "", version: "", command: "", ...s });
  report({ state: "checking" });
  let exe = findExe();
  let version = await probeVersion();
  if (version) return report({ state: "ready", version, pct: 100 });
  if (exe) {
    report({ state: "starting" });
    startOllama(exe);
    version = await waitForOllama();
    return version ? report({ state: "ready", version, pct: 100 }) : report({ state: "error", error: "Ollama is installed but did not start; open it once by hand." });
  }
  if (platform === "linux") {
    return report({ state: "manual", command: "curl -fsSL https://ollama.com/install.sh | sh" });
  }
  fs.mkdirSync(binDir, { recursive: true });
  try {
    if (platform === "win32") {
      const setup = path.join(binDir, "OllamaSetup.exe");
      report({ state: "downloading", pct: 0 });
      await download(urls.win32, setup, { onPct: (pct) => report({ state: "downloading", pct }), idleMs }).catch(downloadFailed);
      // SEC-15: run the installer only with a valid Windows signature from Ollama Inc.
      try {
        await require("./integrity.js").verifyAuthenticode(setup, "Ollama Inc.");
      } catch (err) {
        fs.rmSync(setup, { force: true });
        throw err;
      }
      report({ state: "installing", pct: 0 });
      await new Promise((resolve, reject) => {
        const p = spawn(setup, ["/VERYSILENT", "/NORESTART", "/SUPPRESSMSGBOXES"], { stdio: "ignore", windowsHide: true });
        p.on("error", reject);
        p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`OllamaSetup exited with code ${code}`))));
      });
      fs.rmSync(setup, { force: true });
    } else {
      const zip = path.join(binDir, "Ollama-darwin.zip");
      const staging = path.join(binDir, "ollama-staging");
      report({ state: "downloading", pct: 0 });
      await download(urls.darwin, zip, { onPct: (pct) => report({ state: "downloading", pct }), idleMs }).catch(downloadFailed);
      report({ state: "installing", pct: 0 });
      installMacApp(zip, staging, path.join(os.homedir(), "Applications"));
    }
  } catch (err) {
    return report({ state: "error", error: String(err && err.message ? err.message : err) });
  }
  exe = findExe();
  if (!exe) return report({ state: "error", error: "Ollama was installed but its executable was not found." });
  report({ state: "starting" });
  version = await probeVersion();
  if (!version) {
    startOllama(exe);
    version = await waitForOllama(90_000);
  }
  return version ? report({ state: "ready", version, pct: 100 }) : report({ state: "error", error: "Ollama did not answer after the install; open it once by hand." });
}

module.exports = { CATALOG, hardwareScan, profileOf, recommend, ollamaExe, ollamaVersion, installOllama, installMacApp };
