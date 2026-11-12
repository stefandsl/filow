#!/usr/bin/env node
// T1 take probe (TST-02 fake-mic session, PR-01 offline, PERF-02 memory): a full LOCAL take in the real
// packaged app with no human. A System.Speech voice (take-voice.ps1) is fed to every microphone through
// Chromium's fake audio capture (QA builds only, FILOW_OKF_FAKE_MIC), the page is put in local mode
// (sherpa Nemotron speech-to-text + Ollama clef decisions) and the Start button is clicked over CDP. The
// probe records when each point of section 1 turns active and done, every /api/decide call (what it saw,
// what the model answered, how fast), the take log, the TCP connections of the app's process tree and of
// every local process it talks to (netstat -ano, from launch to exit), and Chromium's own net log.
//
// The main process (which runs the Next server and the session relay in-process) logs every TCP
// connection it opens (QA builds, FILOW_QA_SOCKET_LOG): the server side is audited per connection, not
// only per netstat sample.
//
// Usage: node tools/autoloop/e2e/take.mjs [--offline] [--minutes N] [--exe <win-unpacked>] [--profile <dir>]
//   (default)     local take, written under "local" in tmp/autoloop/take.json
//   --offline     same with FILOW_OFFLINE=1, written under "offline": no connection may leave the PC
//   --minutes N   long take of N minutes, written under "memory" (PERF-02): a rehearsal loop. The audio
//                 loops; each time every point of section 1 is ticked the probe presses Reset, like a
//                 speaker going over the section again, and the points must tick again from the NEXT
//                 time each paraphrase is spoken (every pass is checked: "fresh"). Working set and private
//                 bytes of the whole tree every 10 s.
//   --probe-outbound  the page (after Start) and the server (once it runs) each open a connection to
//                 another host, to show the audit catches both (a probe run must fail PR-01)
// Ports: --port (or FILOW_E2E_PORT, default 4801; the relay gets port + 1), --devtools (or
// FILOW_E2E_DEVTOOLS, default 9351). Profile G:\FILOW\tmp\t1-profile by default. Stops only its own processes.
import { spawn, execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { HeardTracker, VOICE, classifyConnections, created, isLoopback, parseNetstat, passFresh, processTree, socketLogAudit, splitAddr, sttBackendOf } from "./take-lib.mjs";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../../..");
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const OFFLINE = argv.includes("--offline");
const MINUTES = Number(opt("--minutes", 0));
// --probe-outbound: the page fetches an outside URL right after Start, to show the connection audit can
// see outbound traffic at all (written under "<mode>-probe", which the score ignores).
const PROBE_URL = argv.includes("--probe-outbound") ? "https://www.msftconnecttest.com/connecttest.txt" : null;
const PROBE_WS = "wss://echo.websocket.org";
const MODE = (MINUTES > 0 ? "memory" : OFFLINE ? "offline" : "local") + (PROBE_URL ? "-probe" : "");
const PROBE_SERVER = PROBE_URL ? "www.msftconnecttest.com:80" : null;
const PORT = Number(opt("--port", process.env.FILOW_E2E_PORT || 4801));
const DEVTOOLS = Number(opt("--devtools", process.env.FILOW_E2E_DEVTOOLS || 9351));
const PROFILE = path.resolve(opt("--profile", "G:/FILOW/tmp/t1-profile"));
const WORK = path.resolve(opt("--work", "G:/FILOW/tmp/t1-work"));
const SOURCE_PROFILE = path.resolve(opt("--source-profile", "G:/FILOW/tmp/autoloop-profile"));
const TAKE_TIMEOUT_MS = Number(opt("--timeout", 240)) * 1000; // short take: give up when not all ticked by then
const OUT = path.join(ROOT, "tmp", "autoloop", "take.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0wall = Date.now();
const errors = [];

// ---------- the packaged build ----------
function mainCheckout() {
  try {
    return path.dirname(execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: ROOT, encoding: "utf8" }).trim());
  } catch { return ROOT; }
}
function newestBuild() {
  const found = [];
  for (const r of new Set([ROOT, mainCheckout()])) {
    for (const d of fs.readdirSync(r)) {
      const exe = path.join(r, d, "win-unpacked", "Filow.exe");
      if (/^release-/.test(d) && fs.existsSync(exe)) found.push({ dir: path.dirname(exe), at: fs.statSync(exe).mtimeMs });
    }
  }
  if (!found.length) throw new Error("no packaged build found (release-*/win-unpacked); pass --exe");
  return found.sort((a, b) => b.at - a.at)[0].dir;
}
const exeDir = path.resolve(opt("--exe", "") || newestBuild());
const asar = path.join(exeDir, "resources", "app.asar");
const build = { exe: exeDir, builtAt: fs.existsSync(asar) ? new Date(fs.statSync(asar).mtimeMs).toISOString() : null };

// ---------- the profile: a copy of the autoloop profile, no public link, the installed speech model ----------
const MODEL = "nemotron-3.5-asr-streaming-0.6b";
fs.mkdirSync(PROFILE, { recursive: true });
fs.mkdirSync(WORK, { recursive: true });
{
  const settings = JSON.parse(fs.readFileSync(path.join(SOURCE_PROFILE, "settings.json"), "utf8"));
  // The Cloudflare quick tunnel rate-limits test launches and is not part of a local take.
  Object.assign(settings, { remoteShare: false, remoteShareChosen: true });
  fs.writeFileSync(path.join(PROFILE, "settings.json"), JSON.stringify(settings, null, 2));
  fs.copyFileSync(path.join(SOURCE_PROFILE, "script.md"), path.join(PROFILE, "script.md"));
  const model = path.join(PROFILE, "models", MODEL);
  if (!fs.existsSync(model)) fs.cpSync(path.join(SOURCE_PROFILE, "models", MODEL), model, { recursive: true });
}

// Section 1 of the script: what must be ticked.
const script = fs.readFileSync(path.join(PROFILE, "script.md"), "utf8").split(/\r?\n/);
const firstHeading = script.findIndex((l) => /^#\s/.test(l));
const section1 = { title: script[firstHeading].replace(/^#\s+/, ""), points: [] };
for (const l of script.slice(firstHeading + 1)) {
  if (/^#\s/.test(l)) break;
  if (/^\s*[-*]\s+/.test(l)) section1.points.push(l.replace(/^\s*[-*]\s+/, "").trim());
}

// ---------- the voice ----------
/** Offset and length of the PCM samples: System.Speech writes an 18-byte fmt chunk, so not always 44. */
function wavData(buf) {
  for (let o = 12; o + 8 <= buf.length;) {
    const id = buf.toString("ascii", o, o + 4), size = buf.readUInt32LE(o + 4);
    if (id === "data") return { offset: o + 8, length: Math.min(size, buf.length - o - 8) };
    o += 8 + size + (size % 2);
  }
  throw new Error("no data chunk in the WAV");
}
const wav = path.join(WORK, "take.wav");
const linesFile = path.join(WORK, "take-lines.json");
if (!fs.existsSync(wav) || !fs.existsSync(linesFile)) {
  const raw = path.join(WORK, "take-raw.wav");
  execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, "tools", "autoloop", "e2e", "take-voice.ps1"), "-Out", raw, "-Lines", linesFile], { stdio: "inherit" });
  // A room noise floor (about -60 dBFS). The synthetic voice pauses in exact digital zeros, which no
  // real microphone delivers and which the app rightly reports as a dead microphone (peak <= 1e-4).
  const buf = fs.readFileSync(raw);
  const { offset, length } = wavData(buf);
  let seed = 1;
  for (let o = offset; o + 1 < offset + length; o += 2) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, buf.readInt16LE(o) + ((seed % 65) - 32))), o);
  }
  fs.writeFileSync(wav, buf);
}
const spoken = JSON.parse(fs.readFileSync(linesFile, "utf8").replace(/^\uFEFF/, ""));
const wavSeconds = Math.round((wavData(fs.readFileSync(wav)).length / 32000) * 10) / 10;

// UI labels, read from the dictionary so the probe follows wording changes in both languages.
const i18nDir = path.join(ROOT, "packages", "core", "src", "i18n");
const i18n = fs.readdirSync(i18nDir).filter((f) => /^[a-z]{2}\.ts$/.test(f)).map((f) => fs.readFileSync(path.join(i18nDir, f), "utf8")).join("\n");
const labels = (key) => [...i18n.matchAll(new RegExp(`"${key.replace(/\./g, "\\.")}":\\s*"([^"]+)"`, "g"))].map((m) => m[1]);
const START = labels("ctl.start"), STOP = labels("ctl.stop"), LOG = labels("ctl.logReport"), RESET = labels("ctl.reset"), OFFLINE_CHIP = labels("app.offline");

// ---------- netstat ----------
// This PC's own addresses (how connections to them are counted: classifyConnections in take-lib.mjs).
const OWN = new Set(Object.values(os.networkInterfaces()).flat().filter(Boolean).map((i) => (i.family === "IPv6" ? `[${i.address}]` : i.address)));
async function netstat() {
  const { stdout } = await run("netstat", ["-ano"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return parseNetstat(stdout);
}
if (!argv.includes("--no-preflight")) {
  // A take already running on these ports would be driven and audited instead of ours.
  const busy = (await netstat()).filter((r) => r.proto === "TCP" && r.state === "LISTENING" && [PORT, PORT + 1, DEVTOOLS].includes(Number(splitAddr(r.local)[1])));
  if (busy.length) { console.error(`[take] ports in use: ${busy.map((r) => `${r.local} pid ${r.pid}`).join(", ")}`); process.exit(2); }
}

// ---------- launch ----------
const startupLog = path.join(PROFILE, "startup.log");
const logLinesBefore = fs.existsSync(startupLog) ? fs.readFileSync(startupLog, "utf8").split("\n").length : 0;
const netLog = path.join(WORK, `netlog-${MODE}.json`);
const socketLog = path.join(WORK, `sockets-${MODE}.jsonl`);
fs.rmSync(socketLog, { force: true });
const env = { ...process.env, FILOW_USER_DATA_DIR: PROFILE, FILOW_PORT: String(PORT), FILOW_SESSION_PORT: String(PORT + 1), FILOW_OKF_FAKE_MIC: wav, FILOW_QA_SOCKET_LOG: socketLog };
if (OFFLINE) env.FILOW_OFFLINE = "1"; else delete env.FILOW_OFFLINE;
if (PROBE_SERVER) env.FILOW_QA_PROBE_SERVER_OUTBOUND = PROBE_SERVER; else delete env.FILOW_QA_PROBE_SERVER_OUTBOUND;
const app = spawn(path.join(exeDir, "Filow.exe"), [`--remote-debugging-port=${DEVTOOLS}`, `--log-net-log=${netLog}`], { env, stdio: "ignore", detached: false });
let stopping = false;
let tClick = null; // when Start was clicked
// The app ending by itself during a take is a finding, not a harness hang: record when and how.
let appExit = null, exited = false;
app.on("exit", (code, signal) => {
  exited = true; // its PID may now be reused by an unrelated process: never taskkill it again
  if (!stopping) { appExit = { code, signal, atMs: tClick ? Date.now() - tClick : null }; console.log(`[take] the app exited by itself: ${JSON.stringify(appExit)}`); }
});
console.log(`[take] ${MODE}: ${exeDir} pid ${app.pid}, profile ${PROFILE}`);

// ---------- process tree, connections, memory (sampled from launch to exit) ----------
let table = []; // the last process table: { ProcessId, ParentProcessId, Name, WorkingSetSize, PrivatePageCount, created }
let treeNow = []; // our processes in it
async function refreshTable() {
  const { stdout } = await run("powershell", ["-NoProfile", "-Command",
    "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,PrivatePageCount,CreationDate | ConvertTo-Json -Compress"],
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  table = JSON.parse(stdout).map((p) => ({ ...p, created: created(p.CreationDate) }));
  const inTree = processTree(table, app.pid);
  treeNow = table.filter((p) => inTree.has(p.ProcessId));
}
const net = { samples: 0, processesMax: 0, rows: new Map(), outbound: new Map(), self: new Map(), peers: new Map(), peerOutbound: new Map(), udp: new Map(), devtoolsOwnerOk: null };
const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
async function auditConnections() {
  const rows = await netstat();
  const tree = new Map(treeNow.map((p) => [p.ProcessId, p.Name]));
  const names = new Map(table.map((p) => [p.ProcessId, p.Name]));
  net.samples++;
  net.processesMax = Math.max(net.processesMax, tree.size);
  const devtools = rows.find((r) => r.proto === "TCP" && r.state === "LISTENING" && Number(splitAddr(r.local)[1]) === DEVTOOLS);
  if (net.devtoolsOwnerOk === null && devtools && tree.size) net.devtoolsOwnerOk = tree.has(devtools.pid);
  const c = classifyConnections(rows, tree, names, OWN);
  for (const k of c.keys) bump(net.rows, k);
  for (const k of c.outbound) bump(net.outbound, k);
  for (const k of c.self) bump(net.self, k);
  for (const k of c.peers) bump(net.peers, k);
  for (const k of c.peerOutbound) bump(net.peerOutbound, k);
  for (const k of c.udp) bump(net.udp, k);
}
const mem = [];
let lastMemAt = -Infinity;
function sampleMemory() {
  if (!treeNow.length || tClick == null) return;
  const t = Date.now() - tClick;
  if (t - lastMemAt < 9000) return; // the table refresh itself takes 1-2 s: keeps the spacing near 10 s
  lastMemAt = t;
  const ws = treeNow.reduce((s, p) => s + Number(p.WorkingSetSize || 0), 0) / 2 ** 20;
  const priv = treeNow.reduce((s, p) => s + Number(p.PrivatePageCount || 0), 0) / 2 ** 20;
  mem.push({ t: Math.round(t / 1000), wsMB: Math.round(ws), privateMB: Math.round(priv), procs: treeNow.length });
}
// Process table every 5 s (about every 2 s in a long take, so memory lands every 10 s), netstat every
// 500 ms from launch to exit: short connections show up too.
let sampling = true;
const samplers = [
  (async () => { while (sampling) { try { await refreshTable(); if (MODE === "memory") sampleMemory(); } catch (e) { errors.push(`process table: ${e.message}`); } await sleep(MODE === "memory" ? 1000 : 5000); } })(),
  (async () => { while (sampling) { try { if (treeNow.length) await auditConnections(); } catch (e) { errors.push(`netstat: ${e.message}`); } await sleep(500); } })(),
];

// ---------- CDP ----------
let target;
for (let i = 0; i < 90 && !target && !exited; i++) {
  await sleep(1000);
  try { target = (await (await fetch(`http://127.0.0.1:${DEVTOOLS}/json`)).json()).find((t) => t.type === "page" && t.url.startsWith(`http://127.0.0.1:${PORT}/`) && !t.url.includes("/okfilow/")); } catch { /* not up yet */ }
}
if (!target) { console.error("[take] app did not come up"); await shutdown(); process.exit(2); }
let mainShownMs = null;
for (let i = 0; i < 240; i++) {
  const fresh = fs.existsSync(startupLog) ? fs.readFileSync(startupLog, "utf8").split("\n").slice(Math.max(0, logLinesBefore - 1)).join("\n") : "";
  const m = fresh.match(/main window shown \((\d+) ms/);
  if (m) { mainShownMs = Number(m[1]); break; }
  await sleep(500);
}
if (mainShownMs == null) errors.push("no 'main window shown' line in startup.log");

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let seq = 0; const pending = new Map(); const listeners = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  else if (d.method) for (const l of listeners) l(d);
};
let wsClosed = false;
ws.onclose = () => { wsClosed = true; for (const r of pending.values()) r({ error: { message: "DevTools connection closed" } }); pending.clear(); };
// Every call settles: an answer, a closed connection, or 20 s without one.
const call = (method, params = {}) => new Promise((r) => {
  if (wsClosed) return r({ error: { message: "DevTools connection closed" } });
  const i = ++seq;
  const timer = setTimeout(() => { pending.delete(i); r({ error: { message: `${method} timed out` } }); }, 20_000);
  pending.set(i, (d) => { clearTimeout(timer); r(d); });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const evaluate = async (expression) => {
  const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.error) throw new Error(r.error.message);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result?.result?.value;
};
await call("Page.enable"); await call("Runtime.enable");

// Every /api/decide call: what it saw (the transcript window), what the model answered, how fast.
const decide = { calls: 0, ok: 0, failed: 0, aborted: 0, models: {}, providers: {}, latencies: [], errors: [], firstAtMs: null, lastAtMs: null, trace: [] };
const reqs = new Map();
listeners.push(async (d) => {
  if (d.method === "Network.requestWillBeSent" && /\/api\/decide$/.test(d.params.request.url)) {
    let provider = "?", body = {};
    try { body = JSON.parse(d.params.request.postData || "{}"); provider = body.provider ?? "(none)"; } catch { /* not JSON */ }
    // A verification call (a point about to tick) is kept whole: the model's answer depends on every field.
    reqs.set(d.params.requestId, { provider, sentAtMs: tClick ? Date.now() - tClick : null, transcript: String(body.transcript ?? "").slice(-200), request: Array.isArray(body.verify) && body.verify.length ? body : undefined });
  } else if (d.method === "Network.loadingFinished" && reqs.has(d.params.requestId)) {
    const r = reqs.get(d.params.requestId); reqs.delete(d.params.requestId);
    decide.calls++;
    decide.providers[r.provider] = (decide.providers[r.provider] || 0) + 1;
    if (decide.firstAtMs == null && tClick) decide.firstAtMs = Date.now() - tClick;
    if (tClick) decide.lastAtMs = Date.now() - tClick;
    const b = await call("Network.getResponseBody", { requestId: d.params.requestId });
    try {
      const j = JSON.parse(b.result?.body || "{}");
      if (j.error) { decide.failed++; if (decide.errors.length < 5) decide.errors.push(String(j.error).slice(0, 200)); return; }
      decide.ok++;
      decide.models[j.model] = (decide.models[j.model] || 0) + 1;
      if (typeof j.latencyMs === "number") decide.latencies.push(j.latencyMs);
      if (decide.trace.length < 400) decide.trace.push({ t: r.sentAtMs, latencyMs: j.latencyMs, transcript: r.transcript, decisions: (j.decisions ?? []).map((x) => `${x.id} ${x.started ? "yes" : "no"} ${Math.round(x.confidence * 100) / 100}${x.verification ? ` verified real ${x.verification.real} same party ${x.verification.sameParty}` : ""}`), ...(r.request ? { request: r.request } : {}) });
    } catch { decide.failed++; }
  } else if (d.method === "Network.loadingFailed" && reqs.has(d.params.requestId)) {
    reqs.delete(d.params.requestId); decide.calls++;
    // The engine aborts a call on purpose when the take, section or a point changes under it.
    if (/ERR_ABORTED/.test(d.params.errorText)) decide.aborted++;
    else { decide.failed++; if (decide.errors.length < 5) decide.errors.push(d.params.errorText); }
  }
});

// Local mode without the Cloud/Local dialog, English speech; then reload so the page reads them.
// --gate-off: no embedding pre-filter in front of the model (a diagnosis switch; the default is the user's default, on).
const GATE_OFF = argv.includes("--gate-off");
await evaluate(`localStorage.setItem("prefs:startMode", "local"); localStorage.setItem("prefs:speechLang", "en"); ${GATE_OFF ? `localStorage.setItem("prefs:gate", "off")` : `localStorage.removeItem("prefs:gate")`}; true`);
await call("Page.reload");
await sleep(2000);
await call("Network.enable");

const clickByText = (texts, selector = "button") => `(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => ${JSON.stringify(texts)}.some((s) => x.textContent.trim() === s || x.textContent.includes(s))); b?.click(); return Boolean(b); })()`;
const openMenuItem = (texts) => `(() => { document.querySelector(".overflow-menu > button")?.click();
  const item = [...document.querySelectorAll("[role=menuitem]")].find((b) => ${JSON.stringify(texts)}.includes(b.textContent.trim()));
  item?.click(); return Boolean(item); })()`;
const readState = `(() => {
  const rows = [...document.querySelectorAll(".prompter-points .point-item")].map((item) => {
    const row = item.querySelector(".point-row");
    return { text: row?.querySelector(".point-text")?.textContent ?? "", state: row?.dataset.state ?? "", why: item.querySelector(".point-why")?.textContent ?? "" };
  });
  const buttons = [...document.querySelectorAll("button")];
  const start = buttons.find((b) => ${JSON.stringify(START)}.some((s) => b.textContent.includes(s)));
  const stop = buttons.find((b) => ${JSON.stringify(STOP)}.some((s) => b.textContent.includes(s)));
  // Errors on screen; the OFFLINE chip is a status (it is how offline mode shows), read apart.
  const shown = [...document.querySelectorAll(".chip.err, [role=alert]")].map((e) => e.textContent.trim()).filter(Boolean);
  const offlineChip = [...document.querySelectorAll(".chip")].some((e) => ${JSON.stringify(OFFLINE_CHIP)}.includes(e.textContent.trim()));
  const errs = shown.filter((s) => !${JSON.stringify(OFFLINE_CHIP)}.includes(s));
  return { rows, transcript: document.getElementById("prompter-transcript-text")?.textContent ?? "",
    startEnabled: Boolean(start && !start.disabled), recording: Boolean(stop), dialog: Boolean(document.querySelector(".startmode")), errs, offlineChip,
    log: [...document.querySelectorAll(".log > div")].map((d) => d.textContent) };
})()`;

// Wait until the page is ready: section 1 on screen, nothing ticked yet, Start enabled (the page checks
// local readiness: sherpa model and an Ollama clef model).
let st;
for (let i = 0; i < 120 && !exited; i++) {
  st = await evaluate(readState).catch(() => null);
  if (st?.startEnabled && st.rows.length) break;
  await sleep(500);
}
if (!st?.startEnabled) errors.push("Start never became enabled");
const onScreen = (st?.rows ?? []).map((r) => r.text);
if (JSON.stringify(onScreen) !== JSON.stringify(section1.points)) errors.push(`points on screen ${JSON.stringify(onScreen)} are not section 1 of script.md`);
if ((st?.rows ?? []).some((r) => r.state !== "waiting")) errors.push(`points not all waiting before Start: ${(st?.rows ?? []).map((r) => r.state).join(",")}`);
// Offline mode as the app itself reports it, not as the probe was asked to run: the shell's flag the page
// reads (preload), the server's flag (/api/local/status) and the OFFLINE chip on screen.
const offlineSeen = await evaluate(`(async () => ({
  preload: typeof window.filow?.offline === "boolean" ? window.filow.offline : null,
  server: await fetch("/api/local/status", { cache: "no-store" }).then((r) => r.json()).then((j) => (typeof j.offline === "boolean" ? j.offline : null), () => null),
}))()`).catch(() => ({ preload: null, server: null }));
offlineSeen.chip = Boolean(st?.offlineChip);

// ---------- the take ----------
await evaluate(clickByText(START)).catch(() => false);
tClick = Date.now();
console.log(`[take] Start clicked; audio ${wavSeconds} s looped`);
let probe = null;
// The fetch is over in well under a netstat sample (only the net log sees it); the WebSocket stays open
// for the rest of the take, which netstat must see.
if (PROBE_URL) await evaluate(`window.__takeProbe = new WebSocket(${JSON.stringify(PROBE_WS)}); true`).catch(() => false);
if (PROBE_URL) probe = await evaluate(`fetch(${JSON.stringify(PROBE_URL)}, { mode: "no-cors", cache: "no-store" }).then((r) => "HTTP " + r.status, (e) => "failed: " + e.message)`).catch((e) => `failed: ${e.message}`);

const fresh = () => section1.points.map((text) => ({ text, activeAtMs: null, doneAtMs: null, state: "waiting", transcriptAtDone: null, ownLineHeardAtMs: null, why: "" }));
let points = fresh();
const firstCycle = points; // what the score reads: the first time through section 1
const cycles = []; // long take: one entry per pass through section 1 (Start or Reset to all ticked)
let cycleStart = 0, resetPending = false;
// When each spoken line shows on screen: a point must tick after its own paraphrase, never from the
// off-topic sentence, and after a Reset only from the paraphrase said again (take-lib.mjs).
const heard = new HeardTracker(spoken);
const ownLineHeard = (i, from, to) => heard.edges.find((e) => e.line === VOICE.lineOfPoint[i] && e.atMs >= from && e.atMs <= to)?.atMs ?? null;
let firstTranscriptMs = null, recordingAtMs = null, logOpened = false, dialogSeen = false;
const transcripts = [];
let lastTranscript = "", logLines = [];
const pageErrors = new Set();
const durationMs = MODE === "memory" ? MINUTES * 60_000 : TAKE_TIMEOUT_MS;
while (Date.now() - tClick < durationMs && !appExit && !wsClosed) {
  const now = Date.now() - tClick;
  st = await evaluate(readState).catch((e) => { errors.push(`read: ${e.message}`); return null; });
  if (st) {
    if (st.dialog && !dialogSeen) { dialogSeen = true; errors.push("the Cloud/Local dialog opened: local mode was not ready"); }
    if (st.recording && recordingAtMs == null) recordingAtMs = now;
    for (const e of st.errs) pageErrors.add(e.slice(0, 200));
    if (st.offlineChip) offlineSeen.chip = true;
    heard.update(st.transcript, now);
    if (st.transcript && st.transcript !== lastTranscript) {
      if (firstTranscriptMs == null) firstTranscriptMs = now;
      lastTranscript = st.transcript;
      transcripts.push({ t: Math.round(now / 100) / 10, text: st.transcript.slice(-240) });
      if (transcripts.length > 400) transcripts.splice(1, 1);
    }
    if (resetPending && st.rows.every((r) => r.state === "waiting")) resetPending = false;
    if (!resetPending) st.rows.forEach((r, i) => {
      const p = points[i];
      if (!p || r.text !== p.text) return;
      if (r.state !== "waiting" && p.activeAtMs == null) p.activeAtMs = now;
      if (r.state === "done" && p.doneAtMs == null) {
        p.doneAtMs = now; p.transcriptAtDone = st.transcript.slice(-240); p.ownLineHeardAtMs = ownLineHeard(i, cycleStart, now);
        if (points === firstCycle) console.log(`[take] done ${Math.round(now / 100) / 10}s: ${p.text}`);
      }
      p.state = r.state;
      if (r.why) p.why = r.why.slice(0, 300);
    });
    // Open the take log once the take is live (it names the speech backend).
    if (st.recording && !logOpened) { logOpened = true; await evaluate(openMenuItem(LOG)).catch(() => false); }
    for (const l of st.log) if (!logLines.includes(l)) logLines.push(l);
    if (logLines.length > 200) logLines = logLines.slice(0, 40).concat(logLines.slice(-160));
  }
  if (points.every((p) => p.doneAtMs != null)) {
    if (MODE !== "memory") { await sleep(5000); break; } // a few more seconds of decisions and connections
    // Long take: start section 1 over, like a speaker rehearsing it again, so decisions keep coming.
    // Each pass records when its points ticked and whether each followed its own paraphrase said again.
    const pass = { startMs: cycleStart, done: points.map((p) => p.doneAtMs) };
    cycles.push({ ...pass, allDoneMs: Math.max(...pass.done), ...passFresh(pass, heard.edges) });
    cycleStart = now;
    points = fresh();
    resetPending = true;
    if (!(await evaluate(openMenuItem(RESET)).catch(() => false))) errors.push("could not reset the section");
  }
  await sleep(250);
}
const takeMs = Date.now() - tClick;
const closedDuringTake = wsClosed; // the probe closes the connection itself below
if (appExit) errors.push(`the app exited by itself ${Math.round((appExit.atMs ?? 0) / 1000)} s into the take (code ${appExit.code})`);
else if (wsClosed) errors.push("the page's DevTools connection closed during the take");
// The take must still be live at the end; a failed read means it cannot be shown to be.
const last = await evaluate(readState).catch(() => null);
const stillRecording = Boolean(last?.recording);
for (const l of last?.log ?? []) if (!logLines.includes(l)) logLines.push(l);
// Stop the take like a user would, then the app.
await evaluate(clickByText(STOP)).catch(() => undefined);
await sleep(1000);
ws.close();
await shutdown();

/** Closes the app (Browser.close, so the net log is written out), then kills whatever of our tree is left. */
async function shutdown() {
  stopping = true;
  sampling = false;
  await Promise.allSettled(samplers);
  const ours = treeNow.map((p) => ({ pid: p.ProcessId, created: p.created }));
  if (!exited) {
    try {
      const v = await (await fetch(`http://127.0.0.1:${DEVTOOLS}/json/version`)).json();
      const b = new WebSocket(v.webSocketDebuggerUrl);
      await new Promise((r, j) => { b.onopen = r; b.onerror = j; });
      b.send(JSON.stringify({ id: 1, method: "Browser.close" }));
    } catch { /* DevTools gone */ }
    for (let i = 0; i < 40 && !exited; i++) await sleep(250);
    if (!exited) { try { execFileSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ } }
  }
  // Leftovers (for example a child of an app that exited by itself): only PIDs still owned by the
  // same process, checked by creation time, never by image name.
  try {
    await refreshTable();
    for (const o of ours) {
      const p = table.find((x) => x.ProcessId === o.pid && x.created === o.created);
      if (p) { try { execFileSync("taskkill", ["/PID", String(o.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ } }
    }
  } catch { /* best effort */ }
}

// Chromium's own record of what the browser side did (the Node side, Next and the relay, is covered by
// netstat). It sees connections too short for a netstat sample. Findings: a request for a URL on another
// host (even one offline mode then cancels), and a TCP connection to another host. UDP "connects" are
// listed apart: Chromium connects a UDP socket to a public address only to learn its route (IPv6 probe
// to 2001:4860:4860::8888), which sends no packet.
function netLogAudit() {
  try {
    const text = fs.readFileSync(netLog, "utf8"); // may be cut short if the app was killed: read line by line
    const start = text.indexOf('"events"');
    const head = JSON.parse(text.slice(0, start).replace(/,\s*$/, "") + "}");
    const type = Object.fromEntries(Object.entries(head.constants.logEventTypes).map(([k, v]) => [v, k]));
    const hostOf = (a) => a.replace(/:\d+$/, "");
    const isLocal = (host) => host === "localhost" || isLoopback(host) || OWN.has(host) || OWN.has(`[${host}]`);
    const urls = new Set(), tcp = new Set(), udp = new Set();
    let events = 0;
    for (const line of text.slice(start).split("\n")) {
      let e;
      try { e = JSON.parse(line.replace(/,\s*$/, "")); } catch { continue; }
      events++;
      const t = type[e.type], p = e.params ?? {};
      const u = /^([a-z]+):\/\/([^/:"]+|\[[^\]]+\])/.exec(p.url ?? "");
      if (u && /^(https?|wss?)$/.test(u[1]) && !isLocal(u[2])) urls.add(`${u[1]}://${u[2]}`);
      if (t === "TCP_CONNECT_ATTEMPT" && p.address && !isLocal(hostOf(p.address))) tcp.add(p.address);
      if (t === "UDP_CONNECT" && p.address && !isLocal(hostOf(p.address))) udp.add(p.address);
    }
    return { file: netLog, events, externalUrls: [...urls], externalTcp: [...tcp], udpRouteProbes: [...udp] };
  } catch (e) { return { file: netLog, error: e.message }; }
}

// ---------- result ----------
const quant = (xs, q) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
// The take log says "<backend label>: live". The labels are read from the dictionary (ctl.backend.*):
// the sherpa one was "Streaming on this device (Nemotron)" and is "Speech model on this device" now.
const sttLine = logLines.find((l) => /: live$/.test(l.trim())) ?? null;
const sttBackend = sttBackendOf(sttLine, labels("ctl.backend.sherpa"));
const allDone = firstCycle.every((p) => p.doneAtMs != null);
const result = {
  at: new Date().toISOString(),
  mode: MODE, offline: OFFLINE, gate: GATE_OFF ? "off" : "default", build, probe: PROBE_URL ? { url: PROBE_URL, answer: probe } : undefined,
  commit: (() => { try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return ""; } })(),
  audio: { wav, seconds: wavSeconds, spoken, ...VOICE },
  offlineSeen,
  // every time a spoken line showed on screen (index into audio.spoken), and the best share of its words seen
  heard: { edges: heard.edges.slice(0, 2000), best: heard.best.map((b) => Math.round(b * 100) / 100) },
  startup: { mainWindowShownMs: mainShownMs },
  section: section1,
  stt: { backend: sttBackend, line: sttLine, firstTranscriptMs },
  recordingAtMs,
  points: firstCycle,
  allDone,
  timeToAllDoneMs: allDone ? Math.max(...firstCycle.map((p) => p.doneAtMs)) : null,
  cycles: MODE === "memory" ? cycles : undefined,
  takeMs, stillRecording, appExit, devtoolsClosed: closedDuringTake,
  decide: {
    calls: decide.calls, ok: decide.ok, failed: decide.failed, aborted: decide.aborted, models: decide.models, providers: decide.providers,
    allLocal: decide.ok > 0 && Object.keys(decide.models).every((m) => /\(local\)$/.test(m)),
    firstAtMs: decide.firstAtMs, lastAtMs: decide.lastAtMs,
    latencyMs: { median: quant(decide.latencies, 0.5), p95: quant(decide.latencies, 0.95), max: decide.latencies.length ? Math.max(...decide.latencies) : null },
    errors: decide.errors, trace: decide.trace.slice(0, 120),
  },
  transcript: { last: lastTranscript.slice(-600), samples: transcripts.slice(-40) },
  log: logLines.slice(-60),
  pageErrors: [...pageErrors],
  network: {
    samples: net.samples, intervalMs: 500, processesMax: net.processesMax, devtoolsOwnerOk: net.devtoolsOwnerOk,
    ownAddresses: [...OWN],
    loopbackSeen: [...net.rows.keys()].filter((k) => !net.outbound.has(k) && !net.self.has(k) && !k.startsWith("UDP") && !k.includes(" LISTENING ")).length,
    // To this PC's own LAN address (the in-process relay): never leaves the machine.
    selfLan: net.self.size, selfLanSeen: [...net.self.keys()],
    outbound: net.outbound.size, outboundSeen: [...net.outbound.keys()],
    // Local processes outside the tree that the app talked to (Ollama), and their outbound connections.
    peers: [...net.peers.keys()], peerOutbound: net.peerOutbound.size, peerOutboundSeen: [...net.peerOutbound.keys()],
    udpBound: [...net.udp.keys()],
    netLog: netLogAudit(),
    // Every TCP connection the main process (Next server, session relay, shell) opened, from its QA socket log.
    serverSockets: (() => { try { return { file: socketLog, ...socketLogAudit(fs.readFileSync(socketLog, "utf8"), OWN) }; } catch (e) { return { file: socketLog, error: e.message }; } })(),
    connections: [...net.rows.entries()].map(([k, n]) => `${k} x${n}`).slice(0, 150),
  },
  errors,
};
if (net.devtoolsOwnerOk === false) errors.push("the DevTools port belongs to another process: the probe drove someone else's app");
if (MODE === "memory") {
  const slope = (xs, key) => {
    if (xs.length < 2) return null;
    const n = xs.length, mt = xs.reduce((s, m) => s + m.t, 0) / n, mv = xs.reduce((s, m) => s + m[key], 0) / n;
    const num = xs.reduce((s, m) => s + (m.t - mt) * (m[key] - mv), 0), den = xs.reduce((s, m) => s + (m.t - mt) ** 2, 0);
    return den ? Math.round((num / den) * 600 * 10) / 10 : null; // MB per 10 minutes
  };
  const median = (xs) => quant(xs, 0.5);
  // Growth after the warm-up: median of the first minute after it against the median of the last
  // minute (one GC or a trimmed working set does not swing it). Private bytes is what a leak grows.
  const warmupS = Math.min(600, (MINUTES * 60) / 2);
  const after = mem.filter((m) => m.t >= warmupS);
  const endT = mem.at(-1)?.t ?? 0;
  const growth = (key) => {
    const a = median(after.filter((m) => m.t < warmupS + 60).map((m) => m[key])), b = median(mem.filter((m) => m.t > endT - 60).map((m) => m[key]));
    return a && b ? Math.round(((b - a) / a) * 1000) / 10 : null;
  };
  const series = (key) => mem.map((m) => m[key]);
  result.memory = {
    minutes: Math.round((takeMs / 60000) * 10) / 10, intervalS: 10, samples: mem.length, cycles: cycles.length,
    freshCycles: cycles.filter((c) => c.fresh).length,
    startMB: mem[0]?.wsMB ?? null, endMB: mem.at(-1)?.wsMB ?? null, maxMB: mem.length ? Math.max(...series("wsMB")) : null,
    privateStartMB: mem[0]?.privateMB ?? null, privateEndMB: mem.at(-1)?.privateMB ?? null, privateMaxMB: mem.length ? Math.max(...series("privateMB")) : null,
    slopeMBper10min: slope(mem, "wsMB"), warmupMin: warmupS / 60,
    slopeAfterWarmupMBper10min: slope(after, "wsMB"), privateSlopeAfterWarmupMBper10min: slope(after, "privateMB"),
    wsGrowthAfterWarmupPct: growth("wsMB"), privateGrowthAfterWarmupPct: growth("privateMB"),
    // The budget figure: the larger of the two.
    growthAfterWarmupPct: Math.max(growth("wsMB") ?? -Infinity, growth("privateMB") ?? -Infinity),
    series: mem,
  };
  if (!Number.isFinite(result.memory.growthAfterWarmupPct)) result.memory.growthAfterWarmupPct = null;
}
let all = {};
try { all = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch { /* first run */ }
all[MODE] = result;
all.at = result.at;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(all, null, 2));
const n = result.network;
console.log(`[take] ${MODE}: ${firstCycle.filter((p) => p.doneAtMs != null).length}/${firstCycle.length} done` +
  `${result.timeToAllDoneMs != null ? ` in ${(result.timeToAllDoneMs / 1000).toFixed(1)} s` : ""}; stt ${sttBackend}; decide ${decide.ok} ok / ${decide.failed} failed, models ${JSON.stringify(decide.models)}; ` +
  `${n.samples} netstat samples: outbound ${n.outbound}, to this PC's LAN address ${n.selfLan}, peers ${JSON.stringify(n.peers)} (their outbound ${n.peerOutbound}), UDP bound ${n.udpBound.length}, net log (${n.netLog.events ?? 0} events) external URLs ${JSON.stringify(n.netLog.externalUrls ?? n.netLog.error)} TCP ${JSON.stringify(n.netLog.externalTcp ?? [])}` +
  `; server sockets ${n.serverSockets.lines ?? n.serverSockets.error} (${n.serverSockets.local ?? 0} local, external ${JSON.stringify(n.serverSockets.external ?? [])}); offline seen ${JSON.stringify(offlineSeen)}; page errors ${pageErrors.size}` +
  `; heard ${heard.edges.length} lines (best ${heard.best.map((b) => b.toFixed(2)).join("/")}), first pass own line before tick: ${firstCycle.map((p) => p.ownLineHeardAtMs != null).join(",")}` +
  `${result.memory ? `; ${result.memory.cycles} cycles (${result.memory.freshCycles} fresh, durations ${cycles.slice(0, 6).map((c) => ((c.allDoneMs - c.startMs) / 1000).toFixed(1)).join(",")} s); working set ${result.memory.startMB} -> ${result.memory.endMB} MB (max ${result.memory.maxMB}), private ${result.memory.privateStartMB} -> ${result.memory.privateEndMB} MB, growth after warm-up ws ${result.memory.wsGrowthAfterWarmupPct}% private ${result.memory.privateGrowthAfterWarmupPct}%` : ""}`);
if (errors.length) console.log(`[take] errors: ${errors.join(" | ")}`);
console.log(`[take] wrote ${OUT} (${((Date.now() - t0wall) / 1000).toFixed(0)} s)`);
process.exit(allDone && !errors.length ? 0 : 1);
