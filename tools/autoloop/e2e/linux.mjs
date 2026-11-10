#!/usr/bin/env node
// PLAT-LINUX (docs/PLATFORMS.md): runs the packaged Linux AppImage the way a user meets it and checks
// that the window opens, both local servers answer, the main page renders, axe-core finds 0 WCAG
// violations, the on-device speech-to-text worker loads and transcribes a real recording, and a normal
// quit (Ctrl+Q, the menu's Quit) leaves no process and no listening port behind.
//
// Runs on Linux (tested in WSL2 + WSLg). Run it as root only to let it drop to the desktop user: the app
// itself is started as --uid (default 1000, the WSLg display owner), never as root, because Chromium
// refuses root without --no-sandbox and real users are not root.
//
// Usage: node tools/autoloop/e2e/linux.mjs <Filow.AppImage | /opt/Filow/Filow> [--models <dir>] [--settings <settings.json>]
//          [--wav <16 kHz mono PCM16 file>] [--uid 1000] [--out <result.json>]
// Ports 4841/4842, DevTools 9355, profile and copy of the AppImage under $TMPDIR/filow-linux-e2e.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const appImage = args[0];
if (!appImage || !fs.existsSync(appImage)) { console.error("usage: linux.mjs <Filow.AppImage> [...]"); process.exit(2); }
const UID = Number(opt("uid", "1000"));
const PORT = 4841, SESSION_PORT = 4842, DEVTOOLS = 9355;
const work = path.join(os.tmpdir(), "filow-linux-e2e");
const profile = path.join(work, "profile");
const outFile = opt("out", path.join(ROOT, "tmp", "t4", "linux-e2e.json"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const result = { at: new Date().toISOString(), appImage, kernel: os.release(), checks: {} };
const pass = (name, ok, detail) => { result.checks[name] = { ok, detail }; console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`); };

// ---- fresh profile and a copy of the AppImage the desktop user can read ----
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(path.join(work, "home"), { recursive: true });
fs.mkdirSync(profile, { recursive: true });
// An AppImage is copied (root's home is not readable by the desktop user); an installed .deb
// (/opt/Filow/Filow) runs in place.
const isAppImage = /\.AppImage$/i.test(appImage);
const exe = isAppImage ? path.join(work, "Filow.AppImage") : path.resolve(appImage);
if (isAppImage) { fs.copyFileSync(appImage, exe); fs.chmodSync(exe, 0o755); }
const settings = fs.existsSync(opt("settings", "")) ? JSON.parse(fs.readFileSync(opt("settings"), "utf8")) : {};
Object.assign(settings, { remoteShare: false, remoteShareChosen: true, welcomeCompleted: true, localAiOffered: true, pptAsked: true });
fs.writeFileSync(path.join(profile, "settings.json"), JSON.stringify(settings, null, 2));
if (opt("models")) execFileSync("cp", ["-a", opt("models"), path.join(profile, "models")]);
// A fake key in .env: with a key ring it must move to secrets.json encrypted; without one (basic_text) it must stay.
const FAKE_KEY = "sk-linux-probe-0000";
fs.writeFileSync(path.join(profile, ".env"), `FILOW_PROBE_API_KEY=${FAKE_KEY}\n`);
const asRoot = process.getuid() === 0;
if (asRoot) execFileSync("chown", ["-R", `${UID}:${UID}`, work]);

// AppImages mount themselves with FUSE; without libfuse2 (WSL, containers) they must self-extract.
const hasFuse = fs.existsSync("/dev/fuse") && ["/lib/x86_64-linux-gnu/libfuse.so.2", "/usr/lib/x86_64-linux-gnu/libfuse.so.2", "/usr/lib/libfuse.so.2"].some((f) => fs.existsSync(f));
result.fuse = hasFuse;
const env = {
  PATH: process.env.PATH, HOME: path.join(work, "home"), LANG: "en_US.UTF-8",
  DISPLAY: process.env.DISPLAY || ":0", WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY || "wayland-0",
  XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR && !asRoot ? process.env.XDG_RUNTIME_DIR : "/mnt/wslg/runtime-dir",
  PULSE_SERVER: process.env.PULSE_SERVER || "unix:/mnt/wslg/PulseServer",
  FILOW_USER_DATA_DIR: profile, FILOW_PORT: String(PORT), FILOW_SESSION_PORT: String(SESSION_PORT),
  ...(hasFuse ? {} : { APPIMAGE_EXTRACT_AND_RUN: "1" }),
};
const cmd = asRoot ? "setpriv" : exe;
const cmdArgs = asRoot ? ["--reuid", String(UID), "--regid", String(UID), "--clear-groups", "--", exe, `--remote-debugging-port=${DEVTOOLS}`] : [`--remote-debugging-port=${DEVTOOLS}`];
const appLog = fs.openSync(path.join(work, "app-output.log"), "w");
const t0 = Date.now();
const app = spawn(cmd, cmdArgs, { env, stdio: ["ignore", appLog, appLog], detached: true });
result.pid = app.pid;
let appExited = null;
app.on("exit", (code, signal) => { appExited = { code, signal, afterMs: Date.now() - t0 }; });

/** Every live process whose ancestry reaches `root` (the AppImage runtime we started). */
function tree(root) {
  const rows = execFileSync("ps", ["-eo", "pid=,ppid=,pgid=,args="], { encoding: "utf8" }).trim().split("\n").map((l) => {
    const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
    return m && { pid: +m[1], ppid: +m[2], pgid: +m[3], args: m[4] };
  }).filter(Boolean);
  const keep = new Set([root]);
  for (let grew = true; grew;) { grew = false; for (const r of rows) if (!keep.has(r.pid) && keep.has(r.ppid)) { keep.add(r.pid); grew = true; } }
  // Also anything left in our process group or still pointing at our profile (reparented orphans).
  return rows.filter((r) => keep.has(r.pid) || r.pgid === root || r.args.includes(work));
}
const portOpen = (port) => new Promise((resolve) => { const s = net.connect(port, "127.0.0.1"); s.once("connect", () => { s.destroy(); resolve(true); }); s.once("error", () => resolve(false)); });
const get = async (url) => { try { const r = await fetch(url, { signal: AbortSignal.timeout(10000) }); return { status: r.status, body: await r.text() }; } catch (e) { return { status: 0, body: String(e.message) }; } };

try {
  // ---- window: wait for the app's own "main window shown" line ----
  const startupLog = path.join(profile, "startup.log");
  let shown = "";
  for (let i = 0; i < 240 && !shown && !appExited; i++) {
    const m = fs.existsSync(startupLog) && fs.readFileSync(startupLog, "utf8").match(/main window shown[^\n]*/);
    if (m) shown = m[0]; else await sleep(500);
  }
  pass("window", Boolean(shown), shown || `no "main window shown" (exit: ${JSON.stringify(appExited)})`);
  if (!shown) throw new Error("app did not start");

  // ---- keys at rest: either moved to secrets.json encrypted by the key ring, or (no key ring: Electron
  // reports encryption unavailable rather than use Chromium's built-in basic_text key) left in .env ----
  {
    const envNow = fs.readFileSync(path.join(profile, ".env"), "utf8");
    const storeFile = path.join(profile, "secrets.json");
    const store = fs.existsSync(storeFile) ? fs.readFileSync(storeFile, "utf8") : "";
    const kept = envNow.includes(FAKE_KEY) && !store;
    const moved = !envNow.includes(FAKE_KEY) && /FILOW_PROBE_API_KEY/.test(store) && !store.includes(FAKE_KEY);
    pass("secrets", kept || moved, kept ? "no key ring: key left in .env, nothing written" : moved ? "key ring: key encrypted into secrets.json" : { envNow, store });
  }

  // ---- local servers ----
  const home = await get(`http://127.0.0.1:${PORT}/`);
  const mirror = await get(`http://127.0.0.1:${PORT}/mirror`);
  const health = await get(`http://127.0.0.1:${SESSION_PORT}/health`);
  pass("servers", home.status === 200 && mirror.status === 200 && health.status === 200, { web: home.status, mirror: mirror.status, sessionHealth: health.status });

  // ---- CDP on the main window ----
  let target;
  for (let i = 0; i < 30 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${DEVTOOLS}/json`)).json()).find((t) => t.type === "page" && t.url.startsWith(`http://127.0.0.1:${PORT}/`) && !t.url.includes("/okfilow/")); } catch { /* not yet */ }
    if (!target) await sleep(1000);
  }
  if (!target) throw new Error("no main page over DevTools");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const call = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => (await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await call("Page.enable"); await call("Runtime.enable");

  const page = await evaluate(`({ title: document.title, path: location.pathname, text: document.body.innerText.length, desktop: Boolean(window.filow && window.filow.desktop), ua: navigator.userAgent })`);
  pass("main page", page && page.text > 50 && page.desktop, page);
  const shot = await call("Page.captureScreenshot", { format: "png" });
  if (shot.result?.data) fs.writeFileSync(path.join(path.dirname(outFile), "linux-main.png"), Buffer.from(shot.result.data, "base64"));

  // ---- axe-core over every page, dark and light ----
  const routes = (function pageRoutes(dir, base = "") {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile() && e.name === "page.tsx") out.push(base || "/");
      if (e.isDirectory() && !/^[[(_]/.test(e.name) && e.name !== "api") out.push(...pageRoutes(path.join(dir, e.name), `${base}/${e.name}`));
    }
    return out.sort();
  })(path.join(ROOT, "apps", "web", "app"));
  const axeSource = fs.readFileSync(path.join(ROOT, "node_modules", "axe-core", "axe.min.js"), "utf8");
  const axe = [];
  for (const theme of ["dark", "light"]) {
    await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    for (const route of routes) {
      await call("Page.navigate", { url: `http://127.0.0.1:${PORT}${route}` });
      let last = -1, stable = 0;
      for (let i = 0; i < 30 && stable < 3; i++) { await sleep(500); const len = await evaluate(`document.readyState === "complete" ? document.body.innerText.length : -1`); stable = len === last && len >= 0 ? stable + 1 : 0; last = len; }
      const where = await evaluate("location.pathname");
      await evaluate(axeSource + ";true");
      const v = await evaluate(`axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"] }).then((r) => r.violations.map((v) => v.id + " x" + v.nodes.length))`);
      axe.push({ theme, route, landed: where, violations: v || ["axe-did-not-run"] });
    }
  }
  const wrong = axe.filter((a) => a.landed !== a.route).map((a) => `${a.route} -> ${a.landed}`);
  const violations = axe.flatMap((a) => a.violations.map((v) => `${a.theme} ${a.route}: ${v}`));
  result.axe = axe;
  pass("axe", violations.length === 0 && wrong.length === 0, { runs: axe.length, violations, wrongPages: wrong });
  await call("Emulation.setEmulatedMedia", { features: [] });
  await call("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
  await sleep(2000);

  // ---- speech to text: the sherpa-onnx worker loads and transcribes a real recording ----
  const wav = opt("wav");
  const status = await evaluate(`window.filow.stt.status()`);
  if (wav && fs.existsSync(wav)) {
    const buf = fs.readFileSync(wav);
    const dataAt = buf.indexOf("data") + 8;
    const samples = [];
    for (let i = dataAt; i + 1 < buf.length; i += 2) samples.push(Math.round((buf.readInt16LE(i) / 32768) * 1e4) / 1e4);
    samples.push(...new Array(16000).fill(0)); // a second of silence lets the endpoint commit
    const stt = await evaluate(`(async () => {
      const samples = ${JSON.stringify(samples)};
      let text = "", errors = [];
      const off = window.filow.stt.onResult((r) => { if (r.error) errors.push(r.error); if (r.committed) text += " " + r.committed; else if (r.partial) text = text.replace(/\\s*\\[.*\\]$/, "") + " [" + r.partial + "]"; });
      const t0 = performance.now();
      const started = await window.filow.stt.start("en");
      const startMs = Math.round(performance.now() - t0);
      for (let i = 0; i < samples.length; i += 1600) { window.filow.stt.feed(samples.slice(i, i + 1600)); await new Promise((r) => setTimeout(r, 20)); }
      await new Promise((r) => setTimeout(r, 3000));
      await window.filow.stt.stop();
      off();
      return { started, startMs, text: text.trim(), errors };
    })()`);
    const log = fs.readFileSync(startupLog, "utf8");
    const ready = (log.match(/stt: nemotron ready[^\n]*/) || [""])[0];
    pass("stt", Boolean(ready) && stt && /\w{3,}/.test(stt.text) && !stt.errors.length, { status, ready, ...stt });
  } else {
    pass("stt", false, { status, note: "no --wav given" });
  }

  // ---- the main process keeps its own name (System Monitor, ps, pkill) ----
  const mains = tree(app.pid).filter((p) => !/--type=|chrome_crashpad|AppImage|setpriv|nvidia-smi/.test(p.args)).map((p) => p.args.slice(0, 80));
  pass("process name", mains.length > 0 && !mains.some((t) => /next-server/.test(t)), mains);

  // ---- clean quit: close the main window, the same "close" path as its title-bar X button (Electron lets
  // the page close its own window); with no window left the app quits (window-all-closed) ----
  const before = tree(app.pid);
  result.processesBeforeQuit = before.map((p) => `${p.pid} ${p.args.slice(0, 120)}`);
  await call("Runtime.evaluate", { expression: "setTimeout(() => window.close(), 100); true" });
  ws.close();
  for (let i = 0; i < 60 && !appExited; i++) await sleep(500);
  await sleep(1500);
  const after = tree(app.pid).filter((p) => p.pid !== process.pid);
  const ports = { web: await portOpen(PORT), session: await portOpen(SESSION_PORT), devtools: await portOpen(DEVTOOLS) };
  pass("clean quit", Boolean(appExited) && after.length === 0 && !ports.web && !ports.session && !ports.devtools,
    { exit: appExited, processesBefore: before.length, left: after.map((p) => `${p.pid} ${p.args.slice(0, 100)}`), portsStillOpen: ports });
} catch (err) {
  pass("run", false, String(err && err.stack || err));
} finally {
  // Only our own processes: the group we started and anything still pointing at our work folder.
  for (const p of tree(app.pid)) if (p.pid !== process.pid) { try { process.kill(p.pid, "SIGKILL"); } catch { /* gone */ } }
  result.startupLog = fs.existsSync(path.join(profile, "startup.log")) ? fs.readFileSync(path.join(profile, "startup.log"), "utf8").split("\n").slice(-60) : [];
  result.appOutput = fs.readFileSync(path.join(work, "app-output.log"), "utf8").split("\n").slice(-40);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
  const failed = Object.entries(result.checks).filter(([, c]) => !c.ok).map(([k]) => k);
  console.log(failed.length ? `FAILED: ${failed.join(", ")}` : "all Linux checks passed");
  process.exit(failed.length ? 1 : 0);
}
