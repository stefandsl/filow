#!/usr/bin/env node
// The speed baseline (PLAN Phase 2, design note G:\FILOW\tmp\design\phase2.md, report docs/perf/LATENCY-2026-11.md):
// where the time goes in a packaged QA build of Filow, from letting go of the talk keys (or submitting a typed
// question) to the first word heard and the first mark, per tier, in spans that each map to one piece of code.
//
//   node tools/eval/latency.mjs prepare                      stores, models, profiles, screens, voices
//   node tools/eval/latency.mjs judge   --exe <win-unpacked>  the 1000 ms judge (standard tier, typed, 40)
//   node tools/eval/latency.mjs measure --exe <..> --tier standard|fast [--conditions warm,cold,typed,stop]
//   node tools/eval/latency.mjs cloud   --exe <..>            cloud voice requests per answer (fast tier, no paid call)
//   node tools/eval/latency.mjs leak    --exe <..>            the content-log mutation: a run with FILOW_OKF_QA_SHOTS must fail
//
// Hard rules kept here: nothing appears on the owner's screens (FILOW_QA_HEADLESS, checked before any measured
// sample: no visible window of our processes); the owner's Ollama on 127.0.0.1:11434 is never used or changed
// (harness-owned instances on 11435/11436 with their own stores, OLLAMA_HOST on every CLI call, OLLAMA_NOPRUNE=1);
// no paid call (FILOW_OFFLINE, the cloud voice answered with silence by CDP); no input to the desktop (QA keys
// over CDP); only our PIDs are stopped; everything under G:\FILOW\tmp\latency; no screen content in any log.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchFilow, logLineCount, logLinesSince, processTable, stopTree, treeOf, waitForLine } from "../autoloop/e2e/launch.mjs";
import {
  addNoiseFloor, canaryHits, grammarBreaks, heardOk, invalidReasons, judgeVerdict, median, medianInterval, message,
  parseServer, parseTimings, quantile, rank2b, SPANS, spanValue, speechEndMs, voiceSchedule,
} from "./latency-lib.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..");
const LAT = "G:\\FILOW\\tmp\\latency";
const WORK = path.join(LAT, "work");
const SCREENS = path.join(LAT, "screens");
const VOICES = path.join(LAT, "voice");
const OLLAMA_EXE = path.join(process.env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama.exe");
const MAIN_STORE = path.join(os.homedir(), ".ollama", "models"); // read only: blobs are copied from it, never written
const FILOW_PORT = 4811, SESSION_PORT = 4812, CDP_PORT = 9361;
const OFFSETS = [-200, 0, 300];
const QUESTIONS = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "eval", "latency-questions.json"), "utf8")).questions;
const CLEAR_HISTORY = /clearHistory:\s*"([^"]+)"/.exec(fs.readFileSync(path.join(ROOT, "apps", "web", "lib", "buddy", "text.ts"), "utf8"))[1];
const SPEECH_MODELS = ["parakeet-tdt-0.6b-v3", "nemotron-3.5-asr-streaming-0.6b", "silero-vad", "supertonic-3-tts-int8"];
const MODEL_SOURCES = ["G:\\FILOW\\tmp\\autoloop-profile\\models", "G:\\FILOW\\tmp\\featdict-profile\\models", "G:\\FILOW\\tmp\\t8-profile\\models", "G:\\FILOW\\tmp\\t7-profile\\models"];

/** The two tiers (design note section 2). */
const TIERS = {
  standard: {
    name: "standard", port: 11435, store: path.join(LAT, "ollama-std"), models: ["lfm3-vl:latest"], gpu: false, affinity: "55",
    hardware: "ramGb=16,cores=8,gpu=none", model: "lfm3-vl", split: "100% CPU", picture: true, timeoutMs: 240_000, numThread: 4,
  },
  fast: {
    name: "fast", port: 11436, store: path.join(LAT, "ollama-fast"), models: ["gemma4:e4b", "lfm3-vl:latest"], gpu: true, affinity: "",
    hardware: "", model: "gemma4:e4b", split: "100% GPU", picture: true, timeoutMs: 90_000, numThread: null,
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv.slice(2);
const flag = (name, dflt = "") => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : dflt; };
fs.mkdirSync(WORK, { recursive: true });
const runLog = path.join(WORK, `harness-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
/** Everything the harness says goes to the console and to its own log on G: (scanned for the canary at the end). */
const said = [];
function say(...parts) {
  const line = parts.join(" ");
  said.push(line);
  console.log(line);
  fs.appendFileSync(runLog, line + "\n");
}

// ---------- Ollama: harness-owned instances only ----------
/**
 * The one way this harness runs the ollama CLI: always with OLLAMA_HOST and OLLAMA_MODELS of the tier's
 * own instance (never the owner's 11434 or its store), OLLAMA_NOPRUNE=1, and on the standard tier with
 * no GPU and the processor mask. `serve` returns the child; anything else runs to its end and returns stdout.
 */
function ollamaCli(tier, args, { detached = false } = {}) {
  const env = { ...process.env, OLLAMA_HOST: `127.0.0.1:${tier.port}`, OLLAMA_MODELS: tier.store, OLLAMA_NOPRUNE: "1", OLLAMA_KEEP_ALIVE: "30m", TEMP: path.join(LAT, "tmp"), TMP: path.join(LAT, "tmp") };
  if (!tier.gpu) env.CUDA_VISIBLE_DEVICES = "-1";
  else delete env.CUDA_VISIBLE_DEVICES;
  if (detached) {
    const out = fs.openSync(path.join(LAT, `ollama-${tier.name}.log`), "a");
    if (tier.affinity) {
      return spawn("cmd.exe", ["/d", "/c", "start", '""', "/affinity", tier.affinity, "/b", `"${OLLAMA_EXE}"`, ...args], { env, stdio: ["ignore", out, out], windowsHide: true, windowsVerbatimArguments: true });
    }
    return spawn(OLLAMA_EXE, args, { env, stdio: ["ignore", out, out], windowsHide: true });
  }
  return execFileSync(OLLAMA_EXE, args, { env, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
}
const api = async (tier, p, body, timeoutMs = 600_000) => {
  const res = await fetch(`http://127.0.0.1:${tier.port}${p}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) } : { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`ollama ${tier.name} ${p}: HTTP ${res.status}`);
  return res.json();
};
/** The PID listening on a port (our Ollama instance), or null. */
function listener(port) {
  try {
    const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`], { encoding: "utf8", windowsHide: true }).trim();
    return out ? Number(out) : null;
  } catch { return null; }
}
async function serve(tier) {
  if (tier.port === 11434) throw new Error("never the owner's Ollama");
  let pid = listener(tier.port);
  if (!pid) {
    ollamaCli(tier, ["serve"], { detached: true });
    for (let i = 0; i < 60 && !pid; i++) { await sleep(500); pid = listener(tier.port); }
    if (!pid) throw new Error(`our ${tier.name} Ollama did not start on ${tier.port}`);
    for (let i = 0; i < 40; i++) { try { await api(tier, "/api/version"); break; } catch { await sleep(250); } }
  }
  const table = processTable();
  const me = table.find((p) => p.pid === pid);
  if (!me || !/ollama/i.test(me.name)) throw new Error(`port ${tier.port} is held by ${me ? me.name : "?"}, not our Ollama`);
  return pid;
}
async function unloadAll(tier) {
  const ps = await api(tier, "/api/ps");
  for (const m of ps.models || []) await api(tier, "/api/generate", { model: m.name, keep_alive: 0 });
  for (let i = 0; i < 40; i++) { if (!((await api(tier, "/api/ps")).models || []).length) return; await sleep(250); }
  throw new Error(`${tier.name}: models still loaded after unloading`);
}
/** Run-start assertion: the instance lists only the tier's models, loaded and installed. */
async function assertOnlyTierModels(tier) {
  const want = new Set(tier.models.map((m) => m.replace(/:latest$/, "")));
  const tags = (await api(tier, "/api/tags")).models.map((m) => m.name.replace(/:latest$/, ""));
  const ps = ((await api(tier, "/api/ps")).models || []).map((m) => m.name.replace(/:latest$/, ""));
  const strange = [...tags, ...ps].filter((n) => !want.has(n));
  if (strange.length || tags.length !== want.size) throw new Error(`${tier.name}: instance has models other than the tier's (${[...new Set(strange)].join(", ") || `${tags.length} of ${want.size}`})`);
}
/** "100% GPU", "100% CPU" or the split, for every loaded model of the instance (the /api/ps processor column). */
async function processorSplit(tier) {
  const ps = (await api(tier, "/api/ps")).models || [];
  const splits = ps.map((m) => (m.size_vram >= m.size ? "100% GPU" : m.size_vram === 0 ? "100% CPU" : `${Math.round((m.size_vram / m.size) * 100)}% GPU`));
  return [...new Set(splits)].join(" / ") || "none loaded";
}

// ---------- prepare ----------
function copyIfNeeded(from, to) {
  if (fs.existsSync(to) && fs.statSync(to).size === fs.statSync(from).size) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to + ".part");
  fs.renameSync(to + ".part", to);
  return true;
}
/** Fills a tier's store with the manifests and blobs of its models, copied from the main store (read only). */
function fillStore(tier) {
  for (const model of tier.models) {
    const [name, tag = "latest"] = model.split(":");
    const rel = path.join("manifests", "registry.ollama.ai", "library", name, tag);
    const manifest = JSON.parse(fs.readFileSync(path.join(MAIN_STORE, rel), "utf8"));
    for (const layer of [manifest.config, ...manifest.layers]) {
      const blob = layer.digest.replace(":", "-");
      if (copyIfNeeded(path.join(MAIN_STORE, "blobs", blob), path.join(tier.store, "blobs", blob))) say(`[prepare] ${tier.name}: copied ${blob.slice(0, 19)} (${Math.round(layer.size / 1e6)} MB)`);
    }
    copyIfNeeded(path.join(MAIN_STORE, rel), path.join(tier.store, rel));
  }
}
async function prepare() {
  if (!fs.existsSync(OLLAMA_EXE)) throw new Error(`no ollama.exe at ${OLLAMA_EXE}`);
  for (const tier of Object.values(TIERS)) {
    fillStore(tier);
    await serve(tier);
    if (tier.numThread) {
      // lfm3-vl re-created on the standard tier with num_thread 4 (one thread per P-core of the mask)
      const mf = path.join(WORK, "Modelfile-std");
      fs.writeFileSync(mf, `FROM lfm3-vl:latest\nPARAMETER num_thread ${tier.numThread}\n`);
      const shown = ollamaCli(tier, ["show", "lfm3-vl:latest", "--parameters"]);
      if (!new RegExp(`num_thread\\s+${tier.numThread}\\b`).test(shown)) {
        ollamaCli(tier, ["create", "lfm3-vl:latest", "-f", mf]);
        if (!new RegExp(`num_thread\\s+${tier.numThread}\\b`).test(ollamaCli(tier, ["show", "lfm3-vl:latest", "--parameters"]))) throw new Error("num_thread not set on the standard tier's lfm3-vl");
      }
    }
    await assertOnlyTierModels(tier);
    say(`[prepare] ${tier.name}: Ollama on ${tier.port}, models ${tier.models.join(", ")}`);
  }
  // speech and voice models, copied once into each profile (nothing downloads during a run)
  for (const tier of Object.values(TIERS)) {
    const dest = path.join(LAT, `profile-${tier.name}`, "models");
    for (const m of SPEECH_MODELS) {
      const src = MODEL_SOURCES.map((d) => path.join(d, m)).find((d) => fs.existsSync(d) && fs.readdirSync(d).length);
      if (!src) throw new Error(`model ${m} not found in ${MODEL_SOURCES.join(", ")}`);
      if (!fs.existsSync(path.join(dest, m))) { fs.cpSync(src, path.join(dest, m), { recursive: true }); say(`[prepare] ${tier.name}: model ${m}`); }
    }
  }
  // the synthetic screens
  if (!fs.existsSync(path.join(SCREENS, "040.png"))) {
    const electron = execFileSync(process.execPath, ["-e", "console.log(require('electron'))"], { cwd: ROOT, encoding: "utf8" }).trim();
    execFileSync(electron, [path.join(ROOT, "tools", "eval", "latency-screens.cjs"), SCREENS, "40"], { stdio: "inherit", env: { ...process.env, TEMP: path.join(LAT, "tmp"), TMP: path.join(LAT, "tmp") } });
  }
  // the spoken questions (David), with the room noise floor
  fs.mkdirSync(VOICES, { recursive: true });
  QUESTIONS.forEach((q, i) => {
    const wav = path.join(VOICES, `q${i + 1}.wav`);
    if (fs.existsSync(wav)) return;
    const raw = path.join(VOICES, `q${i + 1}-raw.wav`);
    execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, "tools", "autoloop", "e2e", "take-voice.ps1"), "-Out", raw, "-Voice", "David", "-Text", q.text, "-LeadMs", "300", "-TailMs", "1500"], { stdio: "ignore" });
    fs.writeFileSync(wav, addNoiseFloor(fs.readFileSync(raw)));
  });
  say(`[prepare] done: ${QUESTIONS.length} voices, screens, profiles, stores`);
}

// ---------- the build ----------
function buildInfo(exe) {
  const info = JSON.parse(fs.readFileSync(path.join(path.dirname(exe), "build-info.json"), "utf8"));
  if (info.filowQa !== true || !/^[0-9a-f]{40}$/.test(info.sha)) throw new Error("not a QA build with a source sha (build-info.json)");
  return info;
}

// ---------- the profile and the launch ----------
const SETTINGS = (voice = "natural") => ({
  welcomeCompleted: true, localAiOffered: true, firewallOffered: true, pptAsked: true,
  remoteShareChosen: true, remoteShare: false, practicePending: false, ollamaWanted: false,
  lang: "en", speechLanguage: "en",
  dictation: { enabled: false },
  okFilow: {
    enabled: true, onboarded: true, provider: "local", voice, voiceChosen: true,
    typedVoice: true, showAlways: false, seeScreen: "auto", allScreens: false, answerLog: false,
    allowScreenshots: false, speed: 1, consent: {},
  },
});
const REMOVED_ENV = ["ELEVENLABS_API_KEY", "OPENROUTER_API_KEY", "BUDDY_LOCAL_MODEL", "FILOW_OKF_QA_SHOTS", "FILOW_OKF_QA_TTS_DIR", "FILOW_DEV_ANSWERS_DIR", "FILOW_OKF_QA"];

/** One Filow launch on a tier: { pid, profile, log, fromLine, sockets, stop() }. */
async function launch(tier, exe, { wav = "", voice = "natural", offline = true, extraEnv = {} } = {}) {
  const profile = path.join(LAT, `profile-${tier.name}`);
  fs.mkdirSync(profile, { recursive: true });
  for (const m of SPEECH_MODELS) if (!fs.existsSync(path.join(profile, "models", m))) throw new Error(`model ${m} missing from the profile (run prepare)`);
  fs.writeFileSync(path.join(profile, "settings.json"), JSON.stringify(SETTINGS(voice), null, 2));
  // a fresh panel each launch: no conversation, no answers kept
  fs.rmSync(path.join(profile, "Local Storage"), { recursive: true, force: true });
  const log = path.join(profile, "startup.log");
  const fromLine = logLineCount(log);
  const sockets = path.join(WORK, `sockets-${tier.name}-${Date.now()}.jsonl`);
  const env = { ...process.env };
  for (const k of REMOVED_ENV) delete env[k];
  delete env.FILOW_QA_HARDWARE;
  Object.assign(env, {
    FILOW_USER_DATA_DIR: profile, FILOW_PORT: String(FILOW_PORT), FILOW_SESSION_PORT: String(SESSION_PORT),
    OLLAMA_URL: `http://127.0.0.1:${tier.port}`, OLLAMA_HOST: `127.0.0.1:${tier.port}`, OLLAMA_MODELS: tier.store,
    FILOW_QA_HEADLESS: "1", FILOW_QA_NO_GLOBAL_INPUT: "1", FILOW_OKF_QA_KEYS: "1", FILOW_OKF_QA_SCREEN: SCREENS,
    FILOW_QA_SOCKET_LOG: sockets, TEMP: path.join(LAT, "tmp"), TMP: path.join(LAT, "tmp"),
    ...extraEnv,
  });
  if (offline) env.FILOW_OFFLINE = "1"; else delete env.FILOW_OFFLINE;
  if (tier.hardware) env.FILOW_QA_HARDWARE = tier.hardware;
  if (wav) env.FILOW_OKF_FAKE_MIC = `${wav}%noloop`; else delete env.FILOW_OKF_FAKE_MIC;
  const { pid } = await launchFilow({ exeDir: exe, profile, env, args: [`--remote-debugging-port=${CDP_PORT}`, "--mute-audio"], affinity: tier.affinity });
  const stop = async () => { await stopTree(pid); await sleep(1500); };
  try {
    await waitForLine(log, /qa headless: on/, { fromLine, timeoutMs: 30_000 });
    // nothing of ours may be on screen: checked before anything is measured
    const shown = visibleWindows(treeOf(processTable(), pid));
    if (shown) throw new Error(`${shown} visible window(s) of the test Filow: stopping (FILOW_QA_HEADLESS)`);
    await waitForLine(log, /qa: global input is off/, { fromLine, timeoutMs: 30_000 });
    await waitForLine(log, /okfilow: qa screen: 40 picture\(s\), overlays off/, { fromLine, timeoutMs: 30_000 });
  } catch (e) { await stop(); throw e; }
  return { pid, profile, log, fromLine, sockets, stop };
}

/** How many visible top-level windows these processes have (none may: nothing shows on the owner's screens). Counts only. */
function visibleWindows(pids) {
  const ps = `
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class Vis {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  public static int Count(int[] pids) { var set = new HashSet<uint>(); foreach (var p in pids) set.Add((uint)p); int n = 0;
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (set.Contains(p) && IsWindowVisible(h)) n++; return true; }, IntPtr.Zero); return n; }
}
"@
[Vis]::Count(@(${pids.join(",")}))`;
  return Number(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", windowsHide: true }).trim()) || 0;
}

// ---------- CDP: the panel page ----------
async function panelPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const pages = list.filter((t) => t.type === "page" && new URL(t.url).pathname === "/okfilow/panel");
      if (pages.length > 1) throw new Error("more than one panel page");
      if (pages.length === 1) return connect(pages[0].webSocketDebuggerUrl);
    } catch (e) { if (/more than one/.test(String(e))) throw e; }
    await sleep(500);
  }
  throw new Error("no OK Filow panel page");
}
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error("CDP connection failed")); });
  let id = 0;
  const pending = new Map();
  const handlers = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); if (m.error) reject(new Error(m.error.message)); else resolve(m.result); }
    else if (m.method && handlers.has(m.method)) for (const fn of handlers.get(m.method)) fn(m.params);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("page script failed");
    return r.result.value;
  };
  return { send, evaluate, on: (method, fn) => { if (!handlers.has(method)) handlers.set(method, []); handlers.get(method).push(fn); }, close: () => ws.close() };
}
const signal = (page, name) => page.evaluate(`(() => { const v = document.documentElement.dataset.${name}; return v === undefined ? null : v; })()`);
async function until(fn, timeoutMs, everyMs = 20) {
  const end = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await sleep(everyMs); }
}
const isIdle = (page) => page.evaluate("Boolean(document.querySelector('.okf-dot.okf-dot--idle'))");
async function clearHistory(page) {
  const clicked = await page.evaluate(`(() => { const b = [...document.querySelectorAll("button.okf-link")].find((x) => x.textContent === ${JSON.stringify(CLEAR_HISTORY)}); if (!b) return false; b.click(); return true; })()`);
  if (!clicked) throw new Error("no clear-history button in the panel");
  if (!(await until(() => isIdle(page), 30_000, 100))) throw new Error("the panel did not come back to idle");
  await sleep(3000);
}
const typeQuestion = (page, q) => page.evaluate(`(() => {
  const el = document.querySelector("form.okf-type input");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(q)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return new Promise((r) => setTimeout(() => { el.form.requestSubmit(); r(true); }, 50));
})()`);
const qaKey = (page, type, key) => page.evaluate(`window.okFilow.qaKey(${JSON.stringify(type)}, ${JSON.stringify(key)})`);
/** What the panel heard, read in memory and compared there: never logged. */
const heardText = (page) => page.evaluate(`(document.querySelector(".okf-q")?.textContent || "")`);

// ---------- interference ----------
/** A PowerShell sampler of every process's CPU, every 2 s, into a file: foreign load = all minus our trees. */
function startCpuSampler(file) {
  const ps = `$n=[Environment]::ProcessorCount; while ($true) { $t=Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $_.Name -ne '_Total' -and $_.Name -ne 'Idle' } | Select-Object IDProcess,PercentProcessorTime; $o=@{ at=[DateTimeOffset]::Now.ToUnixTimeMilliseconds(); n=$n; p=@($t | ForEach-Object { @($_.IDProcess, $_.PercentProcessorTime) }) }; ($o | ConvertTo-Json -Compress -Depth 4) | Add-Content -Encoding ascii '${file}'; Start-Sleep -Milliseconds 1500 }`;
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { stdio: "ignore", windowsHide: true });
  return child;
}
/** Mean foreign CPU (% of the whole machine) between two times, from the sampler's file. */
function foreignCpu(file, from, to, ours) {
  let lines;
  try { lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean); } catch { return null; }
  const vals = [];
  for (const l of lines) {
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (o.at < from || o.at > to + 2000) continue;
    const flat = o.p.flat ? o.p.flat() : o.p;
    let foreign = 0;
    for (let i = 0; i + 1 < flat.length; i += 2) if (!ours.has(flat[i])) foreign += flat[i + 1];
    vals.push(foreign / o.n);
  }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
function foreignGpuApps(ours) {
  try {
    const out = execFileSync("nvidia-smi", ["--query-compute-apps=pid,used_memory", "--format=csv,noheader,nounits"], { encoding: "utf8", windowsHide: true });
    return out.split(/\r?\n/).filter(Boolean).map((l) => Number(l.split(",")[0])).filter((p) => !ours.has(p));
  } catch { return []; }
}
function gpuUtil() {
  try { return Number(execFileSync("nvidia-smi", ["--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"], { encoding: "utf8", windowsHide: true }).trim().split(/\r?\n/)[0]); } catch { return null; }
}

// ---------- one sample ----------
/**
 * Asks one question and collects its lines. kind: "voice" | "typed" | "stop-speaking" | "stop-thinking".
 * Returns the sample (numbers and ids only).
 */
async function sample(ctx, { kind, question, offset = 0, speechEnd = 0, hold = 0 }) {
  const { page, run: launched, tier } = ctx;
  await clearHistory(page);
  const fromLine = logLineCount(launched.log);
  let t0;
  let heard = null;
  if (kind === "voice") {
    await qaKey(page, "down", "ctrl");
    await qaKey(page, "down", "alt");
    const mic = await until(() => signal(page, "okfMicOpenAt"), 10_000);
    if (!mic) { await qaKey(page, "up", "alt"); await qaKey(page, "up", "ctrl"); return { kind, question, offset, timings: null, reasons: ["microphone did not open"] }; }
    const releaseAt = Number(mic) + speechEnd + offset;
    await sleep(Math.max(0, releaseAt - Date.now()));
    t0 = Date.now();
    await qaKey(page, "up", "alt");
    await qaKey(page, "up", "ctrl");
  } else {
    ctx.holdNext = hold;
    t0 = Date.now();
    await typeQuestion(page, QUESTIONS[question].text);
  }
  let stopKeyAt = null;
  if (kind === "stop-speaking" || kind === "stop-thinking") {
    if (kind === "stop-speaking") {
      const v = await until(() => signal(page, "okfVoiceAt"), tier.timeoutMs, 10);
      if (v) { await sleep(Math.max(0, Number(v) + 1000 - Date.now())); stopKeyAt = Date.now(); }
    } else {
      const f = await until(() => signal(page, "okfFetchAt"), tier.timeoutMs, 10);
      if (f) {
        await sleep(Math.max(0, Number(f) + 300 - Date.now()));
        if (!(await signal(page, "okfVoiceAt"))) stopKeyAt = Date.now();
      }
    }
    if (stopKeyAt) { await qaKey(page, "down", "escape"); await qaKey(page, "up", "escape"); }
  }
  const ended = await until(() => signal(page, "okfEnd"), tier.timeoutMs, 50);
  if (kind === "voice") heard = heardOk(QUESTIONS[question].text, await heardText(page), offset);
  // the server line comes at the end of the answer's stream; the stopped line 2 s after Stop
  const runId = await signal(page, "okfRun");
  let timings = null, server = null, lines;
  for (let i = 0; i < 60; i++) {
    lines = logLinesSince(launched.log, fromLine);
    timings = lines.map(parseTimings).find((t) => t && t.kind !== "warm") ?? null;
    server = runId ? lines.map(parseServer).find((s) => s && s.run === String(runId) && s.role === "main") ?? null : null;
    if (timings && (server || kind.startsWith("stop"))) break;
    await sleep(100);
  }
  const msgs = lines.map(message);
  const s = {
    kind: kind.startsWith("stop") ? "stop" : kind, variant: kind, question, offset, t0Harness: t0, timedOut: !ended,
    timings, server, heardOk: heard, mode: msgs.some((l) => l.startsWith("okfilow: mode error")) ? "error" : "",
    ttsLevels: msgs.map((l) => /^tts: \w+ voice \d+ (\w+) \d+\/\d+ pieces/.exec(l)?.[1]).filter(Boolean),
    tooSlow: msgs.some((l) => l.startsWith("tts: this PC is too slow")),
    ground: runId ? lines.map(parseServer).filter((x) => x && x.run === `${runId}g`).map((x) => ({ marks: x.marks, promptEvalMs: x.promptEvalMs })) : [],
    grammar: grammarBreaks(lines).length,
    contentLines: msgs.filter((l) => /^okfilow qa (text|points|overlay|bubble|mouse|stop hover)/.test(l)).length,
  };
  if (kind.startsWith("stop")) {
    s.stopKey = stopKeyAt;
    const stopLine = lines.find((l) => message(l).startsWith("okfilow: answer stopped by the user (escape)"));
    s.stopLineMs = stopLine && stopKeyAt ? Date.parse(stopLine.slice(0, 24)) - stopKeyAt : null;
    const idleLine = lines.find((l, i) => i > lines.indexOf(stopLine) && message(l).startsWith("okfilow: mode idle"));
    s.idleMs = idleLine && stopKeyAt ? Date.parse(idleLine.slice(0, 24)) - stopKeyAt : null;
    const played = lines.find((l) => /^tts: played .*\(interrupted\)/.test(message(l)));
    s.interruptedMs = played && stopKeyAt ? Date.parse(played.slice(0, 24)) - stopKeyAt : null;
    if (!stopKeyAt) s.timings = s.timings && { ...s.timings, end: "no-stop" };
  }
  try { s.split = await processorSplit(tier); } catch { s.split = "unknown"; }
  const ours = new Set([...treeOf(processTable(), launched.pid), ...treeOf(processTable(), ctx.ollamaPid), process.pid, ctx.sampler?.pid].filter(Boolean));
  s.foreignCpu = foreignCpu(ctx.cpuFile, t0 - 2000, Date.now(), ours);
  const foreignGpu = tier.gpu ? foreignGpuApps(new Set([...ours, ...(ctx.ownerOllama || [])])) : [];
  const util = tier.gpu ? gpuUtil() : null;
  s.interference = (s.foreignCpu !== null && s.foreignCpu > 15) || (foreignGpu.length > 0 && util !== null && util > 10);
  s.reasons = invalidReasons(s, tier);
  if (s.contentLines) s.reasons.push("content line in the log");
  if (s.grammar) s.reasons.push("grammar");
  s.valid = s.reasons.length === 0;
  return s;
}

// ---------- conditions ----------
/** The run-level checks after each launch: the canary, the grammar, content lines, sockets, Filow's own Ollama. */
function afterLaunch(tier, launched, extraPorts = [], remoteOk = null) {
  const lines = logLinesSince(launched.log, launched.fromLine);
  const problems = [];
  if (canaryHits({ startupLog: lines.join("\n") }).length) problems.push("canary in startup.log");
  if (grammarBreaks(lines).length) problems.push("a timing line breaks the numbers-only grammar");
  if (lines.some((l) => /^okfilow qa (text|points|overlay)/.test(message(l)))) problems.push("content-logging switch active");
  if (lines.some((l) => message(l).startsWith("local AI: start"))) problems.push("Filow started its own Ollama");
  let socketText = "";
  try { socketText = fs.readFileSync(launched.sockets, "utf8"); } catch { /* none */ }
  const allowed = new Set([FILOW_PORT, SESSION_PORT, tier.port, ...extraPorts]);
  const bad = new Set();
  for (const l of socketText.split(/\r?\n/).filter(Boolean)) {
    let e; try { e = JSON.parse(l); } catch { continue; }
    if (e.path) continue;
    const local = /^(127\.0\.0\.1|localhost|::1|\[::1\])$/.test(String(e.host));
    if (local ? !allowed.has(Number(e.port)) : !(remoteOk && remoteOk.test(String(e.host)) && Number(e.port) === 443)) bad.add(`${local ? "local" : String(e.host)}:${e.port}`);
  }
  if (bad.size) problems.push(`main process connected outside the allowlist (${[...bad].join(", ")})`);
  return problems;
}

async function withLaunch(ctx, opts, fn) {
  const launched = await launch(ctx.tier, ctx.exe, opts);
  ctx.run = launched;
  ctx.launches.push({ at: Date.now(), wav: opts.wav ? path.basename(opts.wav) : "" });
  let result, error;
  try {
    ctx.page = await panelPage();
    await enableHold(ctx);
    result = await fn(launched);
  } catch (e) { error = e; }
  try { ctx.page?.close(); } catch { /* gone */ }
  ctx.page = null;
  await launched.stop();
  const problems = afterLaunch(ctx.tier, launched, opts.extraPorts, opts.remoteOk);
  if (problems.length) { ctx.failed = problems; throw new Error(`run failed: ${problems.join("; ")}`); }
  if (error) throw error;
  return result;
}
/** The judge's hold: the first /api/buddy/ask of a sample waits `ctx.holdNext` ms; everything else goes on at once. */
async function enableHold(ctx) {
  const page = ctx.page;
  ctx.holdNext = 0;
  await page.send("Fetch.enable", { patterns: [{ urlPattern: `http://127.0.0.1:${FILOW_PORT}/api/buddy/ask*`, requestStage: "Request" }] });
  page.on("Fetch.requestPaused", (p) => {
    if (!p.request.url.includes("/api/buddy/ask")) return;
    const hold = ctx.holdNext;
    ctx.holdNext = 0;
    const go = () => page.send("Fetch.continueRequest", { requestId: p.requestId }).catch(() => {});
    if (hold > 0) setTimeout(go, hold); else go();
  });
}

const wavFor = (q) => path.join(VOICES, `q${q + 1}.wav`);
const speechEnds = () => QUESTIONS.map((_, q) => speechEndMs(fs.readFileSync(wavFor(q))));

/** Re-asks invalid samples at the end, in the same cell; stops the condition above 25% re-asks. */
async function collect(ctx, name, plan, runOne) {
  const out = [];
  let reasks = 0;
  const queue = plan.map((p, i) => ({ ...p, slot: i }));
  const budget = Math.floor(plan.length * 0.25);
  while (queue.length) {
    const p = queue.shift();
    const s = await runOne(p);
    Object.assign(s, { condition: name, tier: ctx.tier.name, slot: p.slot, attempt: (p.attempt ?? 0) + 1 });
    out.push(s);
    say(`[${ctx.tier.name} ${name}] #${p.slot + 1} q${p.question + 1}${p.offset !== undefined ? ` off ${p.offset}` : ""}${p.hold ? " held" : ""}: ${s.valid ? `ok t0->voice ${spanValue(s, SPANS.find((x) => x.name === "t0->voice")) ?? "-"} ms` : `invalid (${s.reasons.join(", ")})`}`);
    if (!s.valid) {
      if (++reasks > budget) { say(`[${ctx.tier.name} ${name}] stopped: more than 25% re-asks (last: ${s.reasons.join(", ")})`); ctx.stopped[name] = s.reasons.join(", "); break; }
      queue.push({ ...p, attempt: (p.attempt ?? 0) + 1 });
    }
    saveResults(ctx);
  }
  return out;
}

async function warmVoice(ctx, n) {
  const ends = speechEnds();
  const plan = voiceSchedule(QUESTIONS.length, OFFSETS, n);
  const byQ = new Map();
  for (const p of plan) { if (!byQ.has(p.question)) byQ.set(p.question, []); byQ.get(p.question).push(p); }
  const all = [];
  for (const [q, cells] of byQ) {
    // one launch per question (the fake microphone file is read at start), one discarded question first
    await withLaunch(ctx, { wav: wavFor(q) }, async () => {
      const warmup = await sample(ctx, { kind: "voice", question: q, offset: 0, speechEnd: ends[q] });
      say(`[${ctx.tier.name} warm-voice] q${q + 1} discarded first question (${warmup.valid ? "ok" : warmup.reasons.join(", ")})`);
      const got = await collect(ctx, "warm-voice", cells, (p) => sample(ctx, { kind: "voice", question: p.question, offset: p.offset, speechEnd: ends[p.question] }));
      all.push(...got);
    });
  }
  return all;
}

async function coldVoice(ctx, n) {
  const ends = speechEnds();
  const plan = voiceSchedule(QUESTIONS.length, OFFSETS, n);
  return collect(ctx, "cold-voice", plan, async (p) => {
    await unloadAll(ctx.tier);
    let s;
    await withLaunch(ctx, { wav: wavFor(p.question) }, async (launched) => {
      await waitForLine(launched.log, /main window shown/, { fromLine: launched.fromLine, timeoutMs: 120_000 });
      await sleep(5000);
      s = await sample(ctx, { kind: "voice", question: p.question, offset: p.offset, speechEnd: ends[p.question] });
      // the warm-up race: was the panel's warm-up over before t0?
      const warm = logLinesSince(launched.log, launched.fromLine).map(parseTimings).find((t) => t && t.kind === "warm");
      s.warmEndAbs = warm ? warm.t0 + warm.marks.warmEnd : null;
      s.warmBeforeT0 = warm && s.timings ? warm.t0 + warm.marks.warmEnd <= s.timings.t0 : false;
    });
    return s;
  });
}

async function warmTyped(ctx, n, condition = "warm-typed", holds = null) {
  const plan = Array.from({ length: n }, (_, i) => ({ question: i % QUESTIONS.length, hold: holds ? holds(i) : 0 }));
  let out;
  await withLaunch(ctx, {}, async () => {
    const warmup = await sample(ctx, { kind: "typed", question: 0 });
    say(`[${ctx.tier.name} ${condition}] discarded first question (${warmup.valid ? "ok" : warmup.reasons.join(", ")})`);
    out = await collect(ctx, condition, plan, (p) => sample(ctx, { kind: "typed", question: p.question, hold: p.hold }));
  });
  return out;
}

async function stops(ctx, n) {
  const plan = Array.from({ length: 2 * n }, (_, i) => ({ question: i % QUESTIONS.length, variant: i % 2 ? "stop-thinking" : "stop-speaking" }));
  let out;
  await withLaunch(ctx, {}, async () => {
    await sample(ctx, { kind: "typed", question: 0 });
    out = await collect(ctx, "stop", plan, async (p) => {
      const s = await sample(ctx, { kind: p.variant, question: p.question });
      const extra = [];
      if (s.stopLineMs === null || s.stopLineMs > 100) extra.push("stop line not within 100 ms");
      if (s.idleMs === null || s.idleMs > 500) extra.push("idle not within 500 ms");
      if (p.variant === "stop-speaking" && (s.interruptedMs === null || s.interruptedMs > 2000)) extra.push("voice not interrupted within 2 s");
      if ((s.timings?.counts?.afterStop ?? 0) !== 0) extra.push("visual or voice after stop");
      s.regression = extra;
      return s;
    });
  });
  return out;
}

// ---------- results ----------
function resultsFile(ctx) {
  return path.join(LAT, `results-${ctx.info.sha.slice(0, 7)}-${ctx.tier.name}-${ctx.label}-${new Date(ctx.started).toISOString().slice(0, 10)}.json`);
}
function saveResults(ctx) {
  const body = JSON.stringify({ sha: ctx.info.sha, tier: ctx.tier.name, label: ctx.label, started: ctx.started, machine: ctx.machine, launches: ctx.launches.length, stopped: ctx.stopped, samples: ctx.samples.concat(ctx.current ?? []) }, null, 1);
  if (body.includes("QUOKKA")) throw new Error("canary in the results");
  fs.writeFileSync(resultsFile(ctx), body);
}

function summarize(samples) {
  const valid = samples.filter((s) => s.valid);
  const invalid = {};
  for (const s of samples.filter((x) => !x.valid)) for (const r of s.reasons) invalid[r] = (invalid[r] ?? 0) + 1;
  const spans = {};
  for (const span of SPANS) {
    const kindOk = valid.filter((s) => span.kinds.includes(s.kind));
    const vals = kindOk.map((s) => spanValue(s, span)).filter(Number.isFinite);
    if (!vals.length) continue;
    spans[span.name] = { n: vals.length, median: median(vals), interval: medianInterval(vals), p90: quantile(vals, 0.9), min: Math.min(...vals), max: Math.max(...vals) };
  }
  return { n: valid.length, attempts: samples.length, invalid, spans };
}

function machineBlock(tier) {
  const ps = (cmd) => { try { return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd], { encoding: "utf8", windowsHide: true }).trim(); } catch { return ""; } };
  const m = {
    cpu: ps("(Get-CimInstance Win32_Processor | Select-Object -First 1 Name, NumberOfCores, NumberOfLogicalProcessors | ConvertTo-Json -Compress)"),
    system: ps("(Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer, Model, TotalPhysicalMemory | ConvertTo-Json -Compress)"),
    power: ps("powercfg /getactivescheme"),
    ac: ps("(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1 BatteryStatus | ConvertTo-Json -Compress)") || "no battery (desktop, on AC)",
  };
  try { m.gpu = execFileSync("nvidia-smi", ["--query-gpu=name,driver_version,memory.total,memory.used", "--format=csv,noheader"], { encoding: "utf8", windowsHide: true }).trim(); } catch { m.gpu = "none"; }
  try { m.ollamaVersion = ollamaCli(tier, ["--version"]).trim(); } catch { m.ollamaVersion = "?"; }
  m.instance = { port: tier.port, OLLAMA_MODELS: tier.store, OLLAMA_NOPRUNE: "1", CUDA_VISIBLE_DEVICES: tier.gpu ? "(unset)" : "-1", mask: tier.affinity ? `0x${tier.affinity}` : "none", num_thread: tier.numThread ?? "default", hardware: tier.hardware || "this PC" };
  return m;
}
/** The owner's own Ollama (read only, never changed): which models it holds loaded right now, and their VRAM. */
async function ownerOllama() {
  try {
    const ps = await (await fetch("http://127.0.0.1:11434/api/ps", { signal: AbortSignal.timeout(2000) })).json();
    return (ps.models || []).map((m) => ({ name: m.name, vramGb: Math.round((m.size_vram / 1024 ** 3) * 10) / 10 }));
  } catch { return "not reachable"; }
}

async function context(tierName, label) {
  const exe = flag("exe");
  if (!exe) throw new Error("--exe <...\\build-<sha7>\\win-unpacked> is required");
  const info = buildInfo(path.join(exe, "Filow.exe"));
  const tier = TIERS[tierName];
  if (!tier) throw new Error(`no tier ${tierName}`);
  const ollamaPid = await serve(tier);
  await assertOnlyTierModels(tier);
  const cpuFile = path.join(WORK, `cpu-${tier.name}-${Date.now()}.jsonl`);
  const sampler = startCpuSampler(cpuFile);
  const owner = await ownerOllama();
  const ownerPids = processTable().filter((p) => /ollama/i.test(p.name) && p.pid !== ollamaPid && !treeOf(processTable(), ollamaPid).includes(p.pid)).map((p) => p.pid);
  const ctx = { exe, info, tier, label, ollamaPid, cpuFile, sampler, ownerOllama: ownerPids, launches: [], samples: [], stopped: {}, started: Date.now(), machine: { ...machineBlock(tier), ownerOllama: owner } };
  process.on("exit", () => { try { sampler.kill(); } catch { /* gone */ } });
  return ctx;
}
function finish(ctx) {
  try { ctx.sampler.kill(); } catch { /* gone */ }
  saveResults(ctx);
  const file = resultsFile(ctx);
  const hits = canaryHits({ results: fs.readFileSync(file, "utf8"), harness: said.join("\n") });
  if (hits.length) throw new Error(`canary found in ${hits.join(", ")}`);
  say(`[${ctx.tier.name}] results: ${file}`);
  return file;
}

// ---------- commands ----------
async function judge() {
  const ctx = await context("standard", "judge");
  const n = Number(flag("n", "40"));
  ctx.current = [];
  const got = await warmTyped(ctx, n, "judge", (i) => (i % 2 === 0 ? 1000 : 0));
  ctx.samples.push(...got);
  ctx.current = [];
  const valid = got.filter((s) => s.valid);
  const delayed = valid.filter((s) => s.slot % 2 === 0);
  const plain = valid.filter((s) => s.slot % 2 === 1);
  const verdict = judgeVerdict(plain, delayed);
  ctx.judge = verdict;
  fs.writeFileSync(path.join(LAT, `judge-${ctx.info.sha.slice(0, 7)}.json`), JSON.stringify(verdict, null, 1));
  say(`[judge] ${verdict.pass ? "PASS" : "FAIL"}: fetchStart->firstToken diff ${verdict.checks.fetch.interval.map(Math.round).join("..")} ms, t0->fetchStart ${verdict.checks.before.interval.map(Math.round).join("..")} ms, t0->voice ${verdict.checks.voice.interval.map(Math.round).join("..")} ms (n plain ${verdict.n.plain}, delayed ${verdict.n.delayed})`);
  finish(ctx);
  process.exitCode = verdict.pass ? 0 : 1;
}

async function measure() {
  const tierName = flag("tier", "standard");
  const ctx = await context(tierName, "measure");
  const gate = tierName === "standard";
  const conditions = flag("conditions", "warm,cold,typed,stop").split(",");
  const nVoice = Number(flag("n", gate ? "40" : "20"));
  for (const c of conditions) {
    ctx.current = [];
    const got = c === "warm" ? await warmVoice(ctx, nVoice)
      : c === "cold" ? await coldVoice(ctx, nVoice)
        : c === "typed" ? await warmTyped(ctx, 20)
          : c === "stop" ? await stops(ctx, 20) : [];
    ctx.samples.push(...got);
    ctx.current = [];
    saveResults(ctx);
    const sum = summarize(got);
    say(`[${tierName} ${c}] n ${sum.n} of ${sum.attempts}; t0->voice median ${sum.spans["t0->voice"]?.median ?? "-"} ms`);
  }
  finish(ctx);
}

async function cloud() {
  // fast tier, the five typed questions, the cloud voice answered with 1 s of silence: requests and characters only
  const ctx = await context("fast", "cloud");
  const silent = silentWav();
  const seen = [];
  ctx.current = [];
  // only the update check may leave this PC (GitHub); a connection to api.elevenlabs.io fails the run
  await withLaunch(ctx, { voice: "cloud", offline: false, remoteOk: /^(api\.)?github\.com$|githubusercontent\.com$/ }, async () => {
    const page = ctx.page;
    await page.send("Fetch.enable", { patterns: [{ urlPattern: `http://127.0.0.1:${FILOW_PORT}/api/buddy/ask*`, requestStage: "Request" }, { urlPattern: `http://127.0.0.1:${FILOW_PORT}/api/buddy/tts*`, requestStage: "Request" }] });
    let answer = 0;
    page.on("Fetch.requestPaused", (p) => {
      if (!p.request.url.includes("/api/buddy/tts")) return;
      let chars = 0;
      try { chars = String(JSON.parse(p.request.postData || "{}").text || "").length; } catch { /* none */ }
      seen.push({ answer, chars });
      page.send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "audio/wav" }], body: silent.toString("base64") }).catch(() => {});
    });
    // the voice notice: Yes once, over CDP (the panel stays hidden)
    for (let q = 0; q < QUESTIONS.length; q++) {
      answer = q;
      const s = sample(ctx, { kind: "typed", question: q });
      const yes = await until(() => page.evaluate(`(() => { const b = document.querySelector(".okf-notice .okf-notice-send"); if (!b) return false; b.click(); return true; })()`), 30_000, 100);
      void yes;
      ctx.current.push(await s);
    }
  });
  ctx.cloud = { perAnswer: QUESTIONS.map((_, q) => ({ requests: seen.filter((x) => x.answer === q).length, chars: seen.filter((x) => x.answer === q).reduce((a, x) => a + x.chars, 0) })) };
  fs.writeFileSync(path.join(LAT, `cloud-${ctx.info.sha.slice(0, 7)}.json`), JSON.stringify(ctx.cloud, null, 1));
  say(`[cloud] requests per answer ${ctx.cloud.perAnswer.map((x) => x.requests).join(", ")}; characters ${ctx.cloud.perAnswer.map((x) => x.chars).join(", ")}`);
  ctx.samples.push(...ctx.current);
  finish(ctx);
}
function silentWav() {
  const rate = 16000, n = rate, data = Buffer.alloc(n * 2);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVE", 8); head.write("fmt ", 12); head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write("data", 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

/** The content-log mutation (design note section 8): a launch with FILOW_OKF_QA_SHOTS must fail the run. */
async function leak() {
  const ctx = await context("fast", "leak");
  let failed = false;
  try {
    await withLaunch(ctx, { extraEnv: { FILOW_OKF_QA_SHOTS: path.join(WORK, "shots") } }, async () => {
      await sample(ctx, { kind: "typed", question: 0 });
      await sleep(2000);
    });
  } catch (e) { failed = /run failed/.test(String(e.message)); say(`[leak] ${e.message}`); }
  try { ctx.sampler.kill(); } catch { /* gone */ }
  fs.rmSync(path.join(WORK, "shots"), { recursive: true, force: true });
  say(`[leak] a run with FILOW_OKF_QA_SHOTS ${failed ? "failed, as it must" : "DID NOT FAIL"}`);
  process.exitCode = failed ? 0 : 1;
}

/** One picture's prompt tokens at the product's width and a smaller one (the 2b prompt-evaluation candidate), on our standard instance. */
async function tokens() {
  const tier = TIERS.standard;
  await serve(tier);
  const electron = execFileSync(process.execPath, ["-e", "console.log(require('electron'))"], { cwd: ROOT, encoding: "utf8" }).trim();
  const script = path.join(WORK, "resize.cjs");
  fs.writeFileSync(script, `const { app, nativeImage } = require("electron"); app.setPath("userData", ${JSON.stringify(path.join(WORK, ".electron-profile"))}); app.whenReady().then(() => { const img = nativeImage.createFromPath(${JSON.stringify(path.join(SCREENS, "001.png"))}); for (const w of [1024, 768]) require("fs").writeFileSync(${JSON.stringify(WORK)} + "/w" + w + ".jpg", img.resize({ width: w, quality: "good" }).toJPEG(72)); app.quit(); });`);
  execFileSync(electron, [script], { stdio: "ignore" });
  const out = {};
  for (const w of [1024, 768]) {
    const img = fs.readFileSync(path.join(WORK, `w${w}.jpg`)).toString("base64");
    const r = await api(tier, "/api/chat", { model: "lfm3-vl:latest", stream: false, keep_alive: "30m", options: { num_predict: 1 }, messages: [{ role: "user", content: "Where is the Pay now button?", images: [img] }] });
    out[w] = r.prompt_eval_count;
  }
  fs.writeFileSync(path.join(LAT, "tokens.json"), JSON.stringify(out));
  say(`[tokens] prompt tokens: 1024 px ${out[1024]}, 768 px ${out[768]}`);
}

/**
 * The report's numbers (docs/perf/LATENCY-2026-11.md is written from this draft): per tier and condition n,
 * invalid samples by reason, median with its interval, p90, min and max per span, the waterfall of median
 * spans, the Phase 2b ranking and the 20% gate, the judge and the cloud voice counts.
 */
async function report() {
  const sha7 = flag("sha");
  if (!/^[0-9a-f]{7}$/.test(sha7)) throw new Error("--sha <7 hex> is required");
  const files = fs.readdirSync(LAT).filter((f) => f.startsWith(`results-${sha7}-`) && f.endsWith(".json"));
  const runs = files.map((f) => JSON.parse(fs.readFileSync(path.join(LAT, f), "utf8")));
  const of = (tier, cond) => runs.filter((r) => r.tier === tier).flatMap((r) => r.samples).filter((s) => s.condition === cond);
  const out = [];
  const fmt = (v) => (Number.isFinite(v) ? String(Math.round(v)) : "-");
  for (const tier of ["standard", "fast"]) {
    for (const cond of ["warm-voice", "cold-voice", "warm-typed", "stop"]) {
      const samples = of(tier, cond);
      if (!samples.length) continue;
      const sum = summarize(samples);
      out.push(`### ${tier} tier, ${cond}: n = ${sum.n} valid of ${sum.attempts} asked`, "");
      out.push(`Invalid: ${Object.entries(sum.invalid).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`, "");
      if (cond === "cold-voice") {
        const before = samples.filter((s) => s.valid && s.warmBeforeT0);
        const after = samples.filter((s) => s.valid && !s.warmBeforeT0);
        const t = (xs) => fmt(median(xs.map((s) => spanValue(s, SPANS.find((x) => x.name === "t0->voice")))));
        out.push(`Warm-up over before t0: ${before.length} (release -> voice median ${t(before)} ms); not over: ${after.length} (median ${t(after)} ms)`, "");
      }
      if (cond === "stop") {
        const valid = samples.filter((s) => s.valid);
        out.push(`Regression checks failed: ${valid.filter((s) => s.regression?.length).length} of ${valid.length} (${[...new Set(valid.flatMap((s) => s.regression ?? []))].join(", ") || "none"})`, "");
      }
      out.push("| Span | n | Median | 95% interval | p90 | Min | Max |", "|---|---|---|---|---|---|---|");
      for (const [name, v] of Object.entries(sum.spans)) out.push(`| ${name} | ${v.n} | ${fmt(v.median)} | ${v.interval.map(fmt).join(" to ")} | ${fmt(v.p90)} | ${fmt(v.min)} | ${fmt(v.max)} |`);
      out.push("");
    }
  }
  const stdWarm = of("standard", "warm-voice").filter((s) => s.valid);
  const fastWarm = of("fast", "warm-voice").filter((s) => s.valid);
  let tok = {};
  try { tok = JSON.parse(fs.readFileSync(path.join(LAT, "tokens.json"), "utf8")); } catch { /* not measured */ }
  const ranking = rank2b(stdWarm, { tokensSmall: tok[768], smallWidth: 768, clauseShare: Number(flag("clause-share", "NaN")) }, fastWarm);
  out.push("### Phase 2b ranking (standard tier, warm voice)", "", "| Candidate | Formula | Realistic saving (median, ms) |", "|---|---|---|");
  for (const c of ranking.candidates) out.push(`| ${c.name} | ${c.formula} | ${fmt(c.saving)} |`);
  out.push("", `Top two: ${ranking.ranked.slice(0, 2).map((c) => c.id).join(" + ")} = ${fmt(ranking.top2)} ms of release -> voice median ${fmt(ranking.total)} ms (${Number.isFinite(ranking.share) ? (ranking.share * 100).toFixed(1) : "-"}%); gate: ${ranking.gateToOwner ? "under 20%, the 2b note goes to the owner first" : "at least 20%, 2b proceeds"}`, "");
  const draft = path.join(WORK, `LATENCY-draft-${sha7}.md`);
  const text = out.join("\n");
  if (canaryHits({ draft: text }).length) throw new Error("canary in the report draft");
  fs.writeFileSync(draft, text);
  fs.writeFileSync(path.join(WORK, `ranking-${sha7}.json`), JSON.stringify(ranking, null, 1));
  say(`[report] draft ${draft}`);
}

const commands = { prepare, judge, measure, cloud, leak, tokens, report };
const cmd = argv[0];
if (!commands[cmd]) {
  console.error(`usage: node tools/eval/latency.mjs <${Object.keys(commands).join("|")}> [--exe <win-unpacked>] [--tier standard|fast] [--conditions warm,cold,typed,stop] [--n 40]`);
  process.exit(2);
}
commands[cmd]().catch((e) => { say(`[latency] stopped: ${e && e.message}`); process.exitCode = 1; });

