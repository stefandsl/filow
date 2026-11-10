// Local AI setup for the desktop app: a quick hardware scan, the recommendation that follows
// from it, and the unattended Ollama install (Windows: official OllamaSetup.exe run silently;
// macOS: Ollama.app unzipped into ~/Applications; Linux: the official script needs sudo, so we
// only hand the command over). Models themselves are pulled by the Settings page through Ollama.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const https = require("node:https");
const { spawn, execFileSync } = require("node:child_process");

const OLLAMA_URL = () => process.env.OLLAMA_URL || "http://127.0.0.1:11434";

/** Catalogue mirrored from apps/web/lib/localModels.ts (sizes in GB) for the first-start recommendation. */
const CATALOG = {
  "nemotron-streaming": { dl: 0.45, ram: 3, ollama: false, label: "Nemotron streaming speech-to-text" },
  "whisper-base": { dl: 0.15, ram: 2, ollama: false, label: "Whisper base" },
  "whisper-small": { dl: 0.5, ram: 4, ollama: false, label: "Whisper small" },
  "clef-flash": { dl: 11, ram: 16, ollama: true, label: "Clef Flash (local decisions)" },
  clef: { dl: 17, ram: 32, ollama: true, label: "Clef 27B (local decisions)" },
  "gemma4:e2b": { dl: 6, ram: 8, ollama: true, label: "Gemma 4 E2B (script from slides)" },
  "gemma4:e4b": { dl: 9, ram: 16, ollama: true, label: "Gemma 4 E4B (script from slides)" },
  "qwen3-vl:8b": { dl: 6.1, ram: 16, ollama: true, label: "Qwen3-VL 8B (OK Filow screen helper)" },
  "qwen3-vl:4b": { dl: 3.3, ram: 8, ollama: true, label: "Qwen3-VL 4B (OK Filow screen helper)" },
  "qwen3-vl:2b": { dl: 1.9, ram: 6, ollama: true, label: "Qwen3-VL 2B (OK Filow screen helper, fastest)" },
};

function gpuName() {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", "(Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notmatch 'Remote|Basic' } | Select-Object -First 1 -ExpandProperty Name)"], { encoding: "utf8", timeout: 8000, windowsHide: true });
      return out.trim();
    }
    if (process.platform === "darwin") {
      const cpu = os.cpus()[0]?.model || "";
      return /apple/i.test(cpu) ? `${cpu} (unified memory)` : "";
    }
    const out = execFileSync("sh", ["-c", "lspci 2>/dev/null | grep -iE 'vga|3d' | head -1 | cut -d: -f3"], { encoding: "utf8", timeout: 4000 });
    return out.trim();
  } catch {
    return "";
  }
}

function freeGb(dir) {
  try {
    const s = fs.statfsSync(dir);
    return Math.round((s.bavail * s.bsize) / 1024 ** 3);
  } catch {
    return -1;
  }
}

/** { ramGb, gpu, gpuClass: "discrete"|"integrated"|"unknown", freeGb, cpu, cores } */
function hardwareScan() {
  const gpu = gpuName();
  const gpuClass = /nvidia|geforce|rtx|radeon|rx \d|apple/i.test(gpu) ? "discrete" : /arc|iris|uhd|intel|vega/i.test(gpu) ? "integrated" : "unknown";
  return {
    ramGb: Math.ceil(os.totalmem() / 1024 ** 3),
    gpu,
    gpuClass,
    freeGb: freeGb(os.homedir()),
    cpu: os.cpus()[0]?.model || "",
    cores: os.cpus().length,
    platform: process.platform,
    arch: process.arch,
  };
}

/** What this machine can run comfortably. Keeps 3 GB of disk headroom; drops the biggest Ollama model first. */
function recommend(hw) {
  let models;
  if (hw.ramGb >= 32) models = ["nemotron-streaming", "whisper-small", "clef-flash", "gemma4:e4b", "qwen3-vl:2b"];
  else if (hw.ramGb >= 16) models = ["nemotron-streaming", hw.gpuClass === "unknown" ? "whisper-base" : "whisper-small", "clef-flash", "gemma4:e2b", "qwen3-vl:2b"];
  else if (hw.ramGb >= 8) models = ["nemotron-streaming", "whisper-base", "gemma4:e2b", "qwen3-vl:2b"];
  else models = ["nemotron-streaming", "whisper-base"];
  const total = (list) => list.reduce((s, n) => s + (CATALOG[n]?.dl || 0), 0);
  if (hw.freeGb >= 0) {
    // Drop order: big slide model (its small sibling steps in), small slide model, then Clef:
    // decisions are the core feature, so they go last. Keep 3 GB spare after the downloads.
    const spare = 3 + 1; // + ~1 GB for Ollama itself
    for (const drop of ["gemma4:e4b", "gemma4:e2b", "qwen3-vl:8b", "qwen3-vl:4b", "clef", "clef-flash"]) {
      if (total(models) + spare <= hw.freeGb) break;
      if (!models.includes(drop)) continue;
      models = models.filter((n) => n !== drop);
      if (drop === "gemma4:e4b" && !models.includes("gemma4:e2b")) models.splice(1, 0, "gemma4:e2b");
      if (drop === "qwen3-vl:8b" && !models.includes("qwen3-vl:4b")) models.push("qwen3-vl:4b");
    }
  }
  return { models, ollama: models.some((n) => CATALOG[n]?.ollama), downloadGb: Math.round(total(models) * 10) / 10, labels: models.map((n) => CATALOG[n]?.label || n) };
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

function downloadWithProgress(url, dest, onPct, hops = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "Filow" } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops > 0) {
          res.resume();
          return downloadWithProgress(res.headers.location, dest, onPct, hops - 1).then(resolve, reject);
        }
        if (res.statusCode !== 200) return reject(new Error(`download failed: HTTP ${res.statusCode}`));
        const total = Number(res.headers["content-length"] || 0);
        let got = 0;
        const out = fs.createWriteStream(dest);
        res.on("data", (chunk) => {
          got += chunk.length;
          if (total) onPct(Math.min(99, Math.round((got / total) * 100)));
        });
        res.pipe(out);
        out.on("finish", () => out.close(resolve));
        out.on("error", reject);
      })
      .on("error", reject);
  });
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

/**
 * Unattended install. onStatus gets {state, pct, error, version, command}:
 * states: checking | downloading | installing | starting | ready | manual | error.
 */
async function installOllama(binDir, onStatus) {
  const report = (s) => onStatus({ pct: 0, error: "", version: "", command: "", ...s });
  report({ state: "checking" });
  let exe = ollamaExe();
  let version = await ollamaVersion();
  if (version) return report({ state: "ready", version, pct: 100 });
  if (exe) {
    report({ state: "starting" });
    startOllama(exe);
    version = await waitForOllama();
    return version ? report({ state: "ready", version, pct: 100 }) : report({ state: "error", error: "Ollama is installed but did not start; open it once by hand." });
  }
  if (process.platform === "linux") {
    return report({ state: "manual", command: "curl -fsSL https://ollama.com/install.sh | sh" });
  }
  fs.mkdirSync(binDir, { recursive: true });
  try {
    if (process.platform === "win32") {
      const setup = path.join(binDir, "OllamaSetup.exe");
      report({ state: "downloading", pct: 0 });
      await downloadWithProgress("https://ollama.com/download/OllamaSetup.exe", setup, (pct) => report({ state: "downloading", pct }));
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
      await downloadWithProgress("https://ollama.com/download/Ollama-darwin.zip", zip, (pct) => report({ state: "downloading", pct }));
      report({ state: "installing", pct: 0 });
      fs.rmSync(staging, { recursive: true, force: true });
      execFileSync("ditto", ["-xk", zip, staging]);
      // SEC-15: unpacked aside and checked before it lands where ollamaExe() finds and starts it: a Developer ID
      // signature from Ollama Inc., not just any valid signature (not tested on macOS yet, docs/PLATFORMS.md).
      try {
        execFileSync("codesign", ["--verify", "--deep", "--strict", `-R=${require("./integrity.js").macDeveloperIdRequirement("Ollama Inc.")}`, path.join(staging, "Ollama.app")]);
      } catch (err) {
        fs.rmSync(staging, { recursive: true, force: true });
        throw err;
      } finally {
        fs.rmSync(zip, { force: true });
      }
      const apps = path.join(os.homedir(), "Applications");
      fs.mkdirSync(apps, { recursive: true });
      fs.rmSync(path.join(apps, "Ollama.app"), { recursive: true, force: true }); // only reached when it held no ollama binary
      fs.renameSync(path.join(staging, "Ollama.app"), path.join(apps, "Ollama.app"));
      fs.rmSync(staging, { recursive: true, force: true });
    }
  } catch (err) {
    return report({ state: "error", error: String(err && err.message ? err.message : err) });
  }
  exe = ollamaExe();
  if (!exe) return report({ state: "error", error: "Ollama was installed but its executable was not found." });
  report({ state: "starting" });
  version = await ollamaVersion();
  if (!version) {
    startOllama(exe);
    version = await waitForOllama(90_000);
  }
  return version ? report({ state: "ready", version, pct: 100 }) : report({ state: "error", error: "Ollama did not answer after the install; open it once by hand." });
}

module.exports = { CATALOG, hardwareScan, recommend, ollamaExe, ollamaVersion, installOllama };
