#!/usr/bin/env node
// End to end: what OK Filow and dictation do when the microphone is slow to open, or the saved one is gone.
// Owner report (0.9.36, 0.9.37): Windows took 15 s to open the microphone; the pointer said "listening"
// from the key press, nothing was recorded, and the user was told to hold the keys longer.
//
// A QA build is started for each scenario on its own profile and ports, invisible and deaf to the PC
// (FILOW_QA_HEADLESS, FILOW_QA_NO_GLOBAL_INPUT), with a recording as its only microphone
// (FILOW_OKF_FAKE_MIC) and the open made late by FILOW_OKF_QA_MIC_DELAY. Keys go in through the QA key
// path; answers come from a stand-in for Ollama on this tool's own port, so no model runs and nothing
// leaves the PC. The owner's microphone, keys, screen and Filow are never touched.
//
// The recording: "Remember the red bicycle." from 0.3 s, then "Where is Paris?" from 3.3 s. The fake
// device plays from the moment the microphone is asked for, so words said while it "opens" are lost
// exactly as a real slow microphone loses them.
//
// Usage: node tools/autoloop/e2e/mic-open.mjs --exe <win-unpacked> [--work G:\FILOW\tmp\fix-mic-open]
//          [--models <folder with the speech models>] [--only T15,D15] [--out <result.json>]
// Exit code 0 when every scenario matches what a truthful app does, 1 otherwise.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchFilow, lineTime, logLineCount, logLinesSince, processTable, stopTree, treeOf, waitForLine, wavData } from "./launch.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, fallback = "") => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (line) => console.log(line);

const EXE = opt("exe");
const WORK = path.resolve(opt("work", "G:\\FILOW\\tmp\\fix-mic-open"));
const MODELS = opt("models", "G:\\FILOW\\tmp\\latency\\profile-fast\\models");
const OUT = opt("out", path.join(WORK, "mic-open-result.json"));
const ONLY = opt("only") ? new Set(opt("only").split(",")) : null;
const FILOW_PORT = 4871, SESSION_PORT = 4872, OLLAMA_PORT = 4873, CDP_PORT = 9371;
const SPEECH_MODELS = ["parakeet-tdt-0.6b-v3", "nemotron-3.5-asr-streaming-0.6b", "silero-vad"];
const FIRST = "Remember the red bicycle.", SECOND = "Where is Paris?";
const SECOND_AT_MS = 3300;

/** What a truthful app does, per scenario. `heard`: words that must be in what was heard; `lost`: words that must not. */
const SCENARIOS = [
  { id: "T0", kind: "talk", delay: 0, release: 5000, heard: ["bicycle", "paris"], lost: [], note: false, outcome: "asked" },
  { id: "T3", kind: "talk", delay: 3000, release: 5000, heard: ["paris"], lost: ["bicycle"], note: true, outcome: "asked" },
  { id: "T15", kind: "talk", delay: 15000, release: 3000, heard: [], lost: ["bicycle", "paris"], note: true, outcome: "mic-message" },
  { id: "TM", kind: "talk", delay: 0, release: 5000, heard: ["bicycle", "paris"], lost: [], note: false, outcome: "asked", missingMic: true },
  // The recognizer loads on the first press of a launch (about 2 s): the words said meanwhile are kept and heard.
  // The microphone closes when the keys go up, also while the recognizer is still loading: nothing said after is heard.
  { id: "TC", kind: "talk", delay: 0, release: 2900, heard: ["bicycle"], lost: ["where"], note: false, outcome: "asked" },
  { id: "TQ", kind: "talk", delay: 0, release: 1500, heard: [], lost: ["bicycle", "where"], note: false, outcome: "closed-at-keys-up" },
  // 13 Nov: a tap, the keys down again while the tap's "I didn't catch that" is still on its way, and up
  // right after listening restarts. That release was dropped and the microphone stayed open with the keys up.
  { id: "TL", kind: "talk", delay: 0, release: 600, again: 1350, warm: true, heard: [], lost: [], note: false, outcome: "capture-closed" },
  { id: "D0", kind: "dictate", delay: 0, release: 5000, heard: ["bicycle", "paris"], lost: [], note: false, outcome: "words" },
  { id: "D3", kind: "dictate", delay: 3000, release: 5000, heard: ["paris"], lost: ["bicycle"], note: true, outcome: "words" },
  { id: "D15", kind: "dictate", delay: 15000, release: 3000, heard: [], lost: ["bicycle", "paris"], note: true, outcome: "mic-message" },
  { id: "DM", kind: "dictate", delay: 0, release: 5000, heard: ["bicycle", "paris"], lost: [], note: false, outcome: "words", missingMic: true },
];
/** The sentences this tool looks for on the pointer (English interface). */
const OPENING = /opening the microphone/i;
const BLAMES_USER = /hold the keys|hold .* while you speak/i;
const MIC_MESSAGE = /microphone .*(nothing was recorded)/i;
const FALLBACK = /microphone .*(not connected|unavailable|not found|default)/i;

// ---------- the recording ----------
function speak(text, file, leadMs, tailMs) {
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(HERE, "take-voice.ps1"), "-Out", file, "-Text", text, "-LeadMs", String(leadMs), "-TailMs", String(tailMs)], { windowsHide: true, stdio: "ignore" });
  const buf = fs.readFileSync(file);
  const d = wavData(buf);
  return buf.subarray(d.offset, d.offset + d.length);
}
/** 16 kHz mono 16-bit: the first sentence, silence up to SECOND_AT_MS, the second sentence, a tail. */
function makeRecording(file) {
  if (fs.existsSync(file)) return;
  const a = speak(FIRST, path.join(WORK, "voice-a.wav"), 300, 0);
  const b = speak(SECOND, path.join(WORK, "voice-b.wav"), 0, 4000);
  const gap = SECOND_AT_MS * 32 - a.length;
  if (gap < 0) throw new Error(`the first sentence is ${Math.round(a.length / 32)} ms long, longer than ${SECOND_AT_MS} ms`);
  const pcm = Buffer.concat([a, Buffer.alloc(gap - (gap % 2)), b]);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + pcm.length, 4); head.write("WAVEfmt ", 8); head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(16000, 24); head.writeUInt32LE(32000, 28);
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write("data", 36); head.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([head, pcm]));
  say(`recording: first sentence ${Math.round(a.length / 32)} ms, second from ${SECOND_AT_MS} ms, ${Math.round(pcm.length / 32)} ms in all`);
}

// ---------- a stand-in for Ollama (this tool's own port; one short answer, no model) ----------
function fakeOllama() {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const url = req.url || "";
      if (url.startsWith("/api/chat")) {
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        res.write(JSON.stringify({ message: { role: "assistant", content: "Paris is in France." }, done: false }) + "\n");
        return res.end(JSON.stringify({ message: { role: "assistant", content: "" }, done: true }) + "\n");
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      if (url.startsWith("/api/tags")) return res.end(JSON.stringify({ models: [{ name: "fake:latest", model: "fake:latest", size: 1 }] }));
      if (url.startsWith("/api/show")) return res.end(JSON.stringify({ capabilities: ["completion"], details: {} }));
      if (url.startsWith("/api/ps")) return res.end(JSON.stringify({ models: [] }));
      if (url.startsWith("/api/version")) return res.end(JSON.stringify({ version: "0.0.0" }));
      return res.end(JSON.stringify({ response: "", done: true }));
    });
  });
  return new Promise((resolve, reject) => { server.once("error", reject); server.listen(OLLAMA_PORT, "127.0.0.1", () => resolve(server)); });
}
const portFree = (port) => new Promise((resolve) => { const s = net.createServer(); s.once("error", () => resolve(false)); s.listen(port, "127.0.0.1", () => s.close(() => resolve(true))); });

// ---------- the profile and the launch ----------
const SETTINGS = {
  welcomeCompleted: true, localAiOffered: true, firewallOffered: true, pptAsked: true,
  remoteShareChosen: true, remoteShare: false, practicePending: false, ollamaWanted: false,
  lang: "en", speechLanguage: "en",
  dictation: { enabled: true, chord: "ctrl+meta", mode: "hold", language: "en", sound: false, cleanup: false, punctuate: false },
  okFilow: {
    enabled: true, onboarded: true, provider: "local", voice: "off", voiceChosen: true, hotkey: "ctrl+alt",
    typedVoice: false, showAlways: false, seeScreen: "off", allScreens: false, answerLog: false,
    allowScreenshots: false, speed: 1, consent: {},
  },
};
const REMOVED_ENV = ["ELEVENLABS_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY", "FILOW_OKF_QA_SHOTS", "FILOW_OKF_QA_TTS_DIR", "FILOW_OKF_QA_SCREEN", "FILOW_DEV_ANSWERS_DIR", "FILOW_OKF_QA", "FILOW_QA_HARDWARE"];

async function launch(wav, delay) {
  const profile = path.join(WORK, "profile");
  fs.mkdirSync(path.join(profile, "models"), { recursive: true });
  for (const m of SPEECH_MODELS) {
    const dest = path.join(profile, "models", m);
    if (fs.existsSync(dest)) continue;
    if (!fs.existsSync(path.join(MODELS, m))) throw new Error(`speech model ${m} not found in ${MODELS} (--models)`);
    fs.cpSync(path.join(MODELS, m), dest, { recursive: true });
    say(`profile: copied model ${m}`);
  }
  fs.writeFileSync(path.join(profile, "settings.json"), JSON.stringify(SETTINGS, null, 2));
  // a fresh panel each launch: no conversation, no saved microphone
  // (the last launch's processes can hold the files for a few seconds after they were stopped)
  for (let i = 0; ; i++) {
    try { fs.rmSync(path.join(profile, "Local Storage"), { recursive: true, force: true }); break; }
    catch (e) { if (i >= 40) throw e; await sleep(500); }
  }
  const log = path.join(profile, "startup.log");
  const fromLine = logLineCount(log);
  const tmp = path.join(WORK, "tmp");
  fs.mkdirSync(tmp, { recursive: true });
  const env = { ...process.env };
  for (const k of REMOVED_ENV) delete env[k];
  Object.assign(env, {
    FILOW_USER_DATA_DIR: profile, FILOW_PORT: String(FILOW_PORT), FILOW_SESSION_PORT: String(SESSION_PORT),
    OLLAMA_URL: `http://127.0.0.1:${OLLAMA_PORT}`, OLLAMA_HOST: `127.0.0.1:${OLLAMA_PORT}`, BUDDY_LOCAL_MODEL: "fake:latest",
    FILOW_QA_HEADLESS: "1", FILOW_QA_NO_GLOBAL_INPUT: "1", FILOW_OKF_QA_KEYS: "1", FILOW_OFFLINE: "1",
    FILOW_OKF_FAKE_MIC: `${wav}%noloop`, FILOW_OKF_QA_MIC_DELAY: String(delay), TEMP: tmp, TMP: tmp,
  });
  const { pid } = await launchFilow({ exeDir: EXE, profile, env, args: [`--remote-debugging-port=${CDP_PORT}`, "--mute-audio"] });
  const stop = async () => { await stopTree(pid); await sleep(1500); };
  try {
    await waitForLine(log, /qa headless: on/, { fromLine, timeoutMs: 30_000 });
    await waitForLine(log, /qa: global input is off/, { fromLine, timeoutMs: 30_000 });
    const shown = visibleWindows(treeOf(processTable(), pid));
    if (shown) throw new Error(`${shown} visible window(s) of the test Filow: stopping`);
  } catch (e) { await stop(); throw e; }
  return { pid, log, fromLine, stop };
}
/** How many visible top-level windows these processes have (none may). */
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

// ---------- CDP ----------
async function targets(pathname) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
    return list.filter((t) => t.type === "page" && new URL(t.url).pathname === pathname);
  } catch { return []; }
}
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error("CDP connection failed")); });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); if (m.error) reject(new Error(m.error.message)); else resolve(m.result); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`page script failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  return { evaluate, close: () => ws.close() };
}
async function panelPage() {
  for (let i = 0; i < 120; i++) {
    const pages = await targets("/okfilow/panel");
    if (pages.length === 1) return connect(pages[0].webSocketDebuggerUrl);
    await sleep(500);
  }
  throw new Error("no OK Filow panel page");
}
const qaKey = (page, type, key) => page.evaluate(`window.okFilow.qaKey(${JSON.stringify(type)}, ${JSON.stringify(key)})`);
const PANEL_STATE = `(() => ({
  mode: (document.querySelector(".okf-dot")?.className.match(/okf-dot--(\\w+)/) || [])[1] || "",
  heard: document.querySelector(".okf-q")?.textContent || "",
  error: document.querySelector(".okf-err")?.textContent || "",
  notes: [...document.querySelectorAll("p.okf-note")].map((p) => p.textContent || ""),
}))()`;
const OVERLAY_STATE = `(() => ({
  pointer: (document.querySelector(".okf-buddy")?.className.match(/okf-buddy--(\\w+)/) || [])[1] || "",
  bubble: document.querySelector("[data-testid=okf-bubble-text]")?.textContent || "",
  wave: Boolean(document.querySelector(".okf-wave")),
  pill: document.querySelector(".okf-notch-status")?.textContent || "",
}))()`;

// ---------- one scenario ----------
async function runScenario(sc, wav) {
  const run = await launch(wav, sc.delay);
  const overlays = new Map(); // target id -> page
  let panel;
  try {
    panel = await panelPage();
    // the panel has its status (the keys are known) once its settings are drawn
    for (let i = 0; i < 300 && !(await panel.evaluate(`Boolean(document.querySelector(".okf-dot"))`)); i++) await sleep(200);
    await waitForLine(run.log, /okfilow: global input is off/, { fromLine: run.fromLine, timeoutMs: 60_000 });
    await sleep(2500);
    /** What the page may know about microphones before it has ever opened one (counts only). */
    const devices = await panel.evaluate(`navigator.mediaDevices.enumerateDevices().then((l) => { const a = l.filter((d) => d.kind === "audioinput"); return { inputs: a.length, withId: a.filter((d) => d.deviceId).length, withLabel: a.filter((d) => d.label).length }; })`);
    if (sc.missingMic) await panel.evaluate(`localStorage.setItem("prefs:micDeviceId", "a-microphone-that-was-unplugged"); true`);

    const keys = sc.kind === "dictate" ? ["ctrl", "meta"] : ["ctrl", "alt"];
    if (sc.warm) {
      // a first press loads the recognizer (about 2 s on the first use), so the presses below meet a loaded one
      const warmFrom = logLineCount(run.log);
      for (const k of keys) await qaKey(panel, "down", k);
      await sleep(800);
      for (const k of [...keys].reverse()) await qaKey(panel, "up", k);
      await waitForLine(run.log, /okfilow: mode (error|idle)/, { fromLine: warmFrom, timeoutMs: 30_000 });
      await sleep(1500);
    }
    const fromLine = logLineCount(run.log);
    const timeline = []; // { at, where, ...state } on every change
    const last = new Map();
    let sampling = true;
    const sampler = (async () => {
      let listed = 0;
      while (sampling) {
        const now = Date.now();
        if (now - listed > 500) {
          listed = now;
          for (const t of await targets("/okfilow/overlay")) if (!overlays.has(t.id)) { try { overlays.set(t.id, await connect(t.webSocketDebuggerUrl)); } catch { /* next round */ } }
        }
        const reads = [["panel", panel, PANEL_STATE], ...[...overlays.entries()].map(([id, p]) => [`overlay-${id.slice(0, 4)}`, p, OVERLAY_STATE])];
        for (const [where, page, script] of reads) {
          try {
            const state = await page.evaluate(script);
            const key = JSON.stringify(state);
            if (last.get(where) !== key) { last.set(where, key); timeline.push({ at: Date.now(), where, ...state }); }
          } catch { /* the page went away */ }
        }
        await sleep(60);
      }
    })();

    const pressAt = Date.now();
    for (const k of keys) await qaKey(panel, "down", k);
    await sleep(Math.max(0, pressAt + sc.release - Date.now()));
    let releaseAt = Date.now();
    for (const k of [...keys].reverse()) await qaKey(panel, "up", k);
    let captureOpenMs = null; // how long the microphone stayed open after the last key-up (lost-stop scenario)
    if (sc.again) {
      // keys down again while the first recording is still ending; up as soon as listening restarts
      await sleep(Math.max(0, pressAt + sc.again - Date.now()));
      const againAt = Date.now();
      for (const k of keys) await qaKey(panel, "down", k);
      for (const end = Date.now() + 8000; Date.now() < end;) {
        if (logLinesSince(run.log, fromLine).some((l) => /okfilow: mode (opening|listening)/.test(l) && lineTime(l) >= againAt)) break;
        await sleep(15);
      }
      releaseAt = Date.now();
      for (const k of [...keys].reverse()) await qaKey(panel, "up", k);
    }
    if (sc.outcome === "capture-closed" || sc.outcome === "closed-at-keys-up") {
      // the capture graph is up while the panel's microphone mark is set (stopAudio clears it)
      const open = () => panel.evaluate(`document.documentElement.dataset.okfMicOpenAt !== undefined`);
      let closedAt = null;
      for (const end = Date.now() + 9000; Date.now() < end;) {
        if (!(await open())) { closedAt = Date.now(); break; }
        await sleep(25);
      }
      captureOpenMs = closedAt === null ? Infinity : closedAt - releaseAt;
    }

    // the end: an error, or idle again after the release (an answer passes through thinking and speaking first)
    const until = Date.now() + sc.delay + 30_000;
    const msg = (l) => l.replace(/^\S+\s+/, "");
    let lines = [];
    for (;;) {
      lines = logLinesSince(run.log, fromLine);
      const modes = lines.filter((l) => /okfilow: mode /.test(l) && lineTime(l) >= releaseAt - 50);
      if (modes.some((l) => /mode error/.test(l))) break;
      if (modes.some((l) => /mode idle/.test(l)) && !/mode (thinking|speaking|listening|opening)/.test(msg(modes[modes.length - 1]))) break;
      if (Date.now() > until) break;
      await sleep(200);
    }
    // a late microphone (the QA delay) and the last words on the pointer
    await sleep(Math.max(2500, pressAt + sc.delay + 2500 - Date.now()));
    sampling = false;
    await sampler;
    lines = logLinesSince(run.log, fromLine);

    const rel = (at) => at - pressAt;
    const modeLines = lines.filter((l) => /okfilow: mode /.test(l)).map((l) => ({ ms: rel(lineTime(l)), text: msg(l).replace(/^okfilow: /, "") }));
    const micLines = lines.filter((l) => /microphone/i.test(msg(l)) && !/okfilow: mode /.test(l)).map((l) => ({ ms: rel(lineTime(l)), text: msg(l).slice(0, 200) }));
    const texts = [];
    for (const e of timeline) if (e.where !== "panel" && e.bubble && texts[texts.length - 1]?.text !== e.bubble) texts.push({ ms: rel(e.at), text: e.bubble });
    const pointer = [];
    for (const e of timeline) if (e.where !== "panel" && e.pointer && pointer[pointer.length - 1]?.mode !== e.pointer) pointer.push({ ms: rel(e.at), mode: e.pointer });
    const panelEnd = timeline.filter((e) => e.where === "panel").pop() ?? {};
    const heardAll = timeline.filter((e) => e.where === "panel" && e.heard).map((e) => e.heard);
    const heard = (heardAll[heardAll.length - 1] ?? "").toLowerCase();
    const notes = [...new Set(timeline.filter((e) => e.where === "panel").flatMap((e) => e.notes ?? []))];
    const everything = [...texts.map((t) => t.text), ...modeLines.map((m) => m.text), panelEnd.error ?? "", ...notes].join(" | ");

    const listeningAt = modeLines.find((m) => /^mode listening/.test(m.text))?.ms ?? null;
    const pointerListeningAt = pointer.find((p) => p.mode === "listening")?.ms ?? null;
    const firstError = modeLines.find((m) => /^mode error/.test(m.text)) ?? null;
    const micMessage = [...texts, ...modeLines].find((t) => MIC_MESSAGE.test(t.text)) ?? null;
    const asked = modeLines.some((m) => /^mode thinking/.test(m.text));

    const fails = [];
    for (const w of sc.heard) if (!heard.includes(w)) fails.push(`"${w}" was not heard`);
    for (const w of sc.lost) if (heard.includes(w)) fails.push(`"${w}" was heard although it was said while nothing should be recorded (microphone not open yet, or keys already up)`);
    // (a tap too short to say anything is rightly told to hold the keys longer)
    if (sc.outcome !== "capture-closed" && sc.outcome !== "closed-at-keys-up" && BLAMES_USER.test(everything)) fails.push("the user was told to hold the keys longer");
    // "listening" is shown only once the microphone is open (never before the late open)
    for (const [name, at] of [["the log", listeningAt], ["the pointer", pointerListeningAt]]) if (at !== null && at < sc.delay - 150) fails.push(`${name} said listening at ${at} ms, before the microphone opened (${sc.delay} ms)`);
    if (sc.note !== texts.some((t) => OPENING.test(t.text))) fails.push(sc.note ? `no "Opening the microphone" on the pointer` : `"Opening the microphone" shown although it opened at once`);
    if (sc.outcome === "asked" && (!asked || firstError)) fails.push(firstError ? `ended in an error: ${firstError.text}` : "the question was not asked");
    if (sc.outcome === "words" && firstError) fails.push(`ended in an error: ${firstError.text}`);
    if (sc.outcome === "mic-message") {
      if (!micMessage) fails.push("no message saying the microphone was slow and nothing was recorded");
      else if (micMessage.ms > sc.release + 1500) fails.push(`the message came ${micMessage.ms - sc.release} ms after the keys went up`);
      if (listeningAt !== null) fails.push("it said listening although nothing could be recorded");
    }
    if (sc.outcome === "capture-closed" || sc.outcome === "closed-at-keys-up") {
      // closed by the release itself, at once: not when the recognizer is ready, and not seconds later by the watchdog
      if (captureOpenMs === Infinity) fails.push("the microphone stayed open with the keys up (more than 9 s)");
      else if (captureOpenMs > 500) fails.push(`the microphone stayed open ${captureOpenMs} ms after the keys went up`);
      if (lines.some((l) => /still open with no key held/.test(l))) fails.push("the watchdog had to stop it: the release was lost");
    }
    if (sc.missingMic && !FALLBACK.test(everything)) fails.push("no note that the saved microphone is gone and the default is used");

    return {
      id: sc.id, kind: sc.kind, delayMs: sc.delay, releaseMs: rel(releaseAt), missingMic: Boolean(sc.missingMic), devices,
      heard, modes: modeLines, pointer, pointerTexts: texts, panelError: panelEnd.error ?? "", panelNotes: notes, micLog: micLines,
      listeningAtMs: listeningAt, captureOpenAfterKeysUpMs: captureOpenMs === Infinity ? "still open after 9000" : captureOpenMs, verdict: fails.length ? "FAIL" : "PASS", fails,
    };
  } finally {
    try { panel?.close(); } catch { /* gone */ }
    for (const p of overlays.values()) { try { p.close(); } catch { /* gone */ } }
    await run.stop();
  }
}

// ---------- main ----------
if (!EXE) { console.error("usage: node tools/autoloop/e2e/mic-open.mjs --exe <win-unpacked> [--work <folder on G:>] [--models <folder>] [--only T0,D15] [--out <json>]"); process.exit(2); }
fs.mkdirSync(WORK, { recursive: true });
for (const p of [FILOW_PORT, SESSION_PORT, OLLAMA_PORT, CDP_PORT]) if (!(await portFree(p))) { console.error(`port ${p} is in use: not starting`); process.exit(2); }
const wav = path.join(WORK, "mic-open.wav");
makeRecording(wav);
const ollama = await fakeOllama();
const results = [];
try {
  for (const sc of SCENARIOS) {
    if (ONLY && !ONLY.has(sc.id)) continue;
    say(`[${sc.id}] ${sc.kind}, microphone ${sc.delay} ms late, keys up at ${sc.release} ms${sc.missingMic ? ", saved microphone unplugged" : ""}`);
    let r;
    try { r = await runScenario(sc, wav); } catch (e) { r = { id: sc.id, kind: sc.kind, delayMs: sc.delay, verdict: "FAIL", fails: [`the run broke: ${e.message}`], heard: "", modes: [], pointerTexts: [] }; }
    results.push(r);
    say(`[${sc.id}] ${r.verdict}: heard "${r.heard}"; modes ${r.modes.map((m) => `${m.ms}:${m.text.replace(/^mode /, "")}`).join(" > ").slice(0, 400)}`);
    for (const t of r.pointerTexts ?? []) say(`[${sc.id}]   pointer ${t.ms} ms: ${t.text.slice(0, 200)}`);
    for (const f of r.fails) say(`[${sc.id}]   FAIL ${f}`);
  }
} finally {
  await new Promise((r) => ollama.close(r));
}
fs.writeFileSync(OUT, JSON.stringify({ exe: EXE, at: new Date().toISOString(), recording: { first: FIRST, second: SECOND, secondAtMs: SECOND_AT_MS }, results }, null, 2));
const failed = results.filter((r) => r.verdict !== "PASS");
say(`mic-open: ${results.length - failed.length} of ${results.length} scenarios as a truthful app does${failed.length ? ` (failing: ${failed.map((r) => r.id).join(", ")})` : ""}; ${OUT}`);
process.exit(failed.length ? 1 : 0);
