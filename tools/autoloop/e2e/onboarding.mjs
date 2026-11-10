#!/usr/bin/env node
// T3 onboarding probe: walks the first run of the packaged app on a NEW empty profile, the way a first-time
// user meets it, and records every screen (CDP screenshot or native dialog capture), the clicks and decisions
// it asked for, the seconds between steps, axe-core violations, a keyboard-only pass, reduced motion and
// 125 % / 150 % zoom on the welcome window. Ends at the first take with a script point ticking.
//
// Usage: node tools/autoloop/e2e/onboarding.mjs --exe <win-unpacked> --round <name>
//          [--lang en|it] [--keyboard] [--models <dir to copy into the profile>] [--mic <wav> (QA build)]
//          [--offline] [--no-ollama] [--no-mic] [--accept-local-ai] [--welcome-only]
//          [--devtools <port>] [--port <app port; the session port is the next one>] [--profile <new dir on G:>]
// Writes G:/FILOW/tmp/t3-shots/<round>/*.png and report.json. Stops only the process tree it started.
// Exit code: 0 PASS; 1 the probe crashed; 2 no main window; 3 timeout; 4 a check failed (no point ticked,
// an axe violation or axe error, a Tab stop without visible focus, zoom overflow): onboarding-verdict.mjs.
import { spawn, execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { onboardingFailures, onboardingExitCode } from "./onboarding-verdict.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../../..");
const args = process.argv.slice(2);
const opt = (name, dflt = null) => { const i = args.indexOf(`--${name}`); return i < 0 ? dflt : args[i + 1]; };
const flag = (name) => args.includes(`--${name}`);
const exeDir = opt("exe");
const round = opt("round", "probe");
const lang = opt("lang", "en");
const keyboard = flag("keyboard");
const DEVTOOLS = Number(opt("devtools", "9353")), PORT = Number(opt("port", "4821"));
const OUT = path.join("G:/FILOW/tmp/t3-shots", round);
const profile = opt("profile") ? path.resolve(opt("profile")) : path.join("G:/FILOW/tmp", `t3-profile-${round}-${Date.now().toString(36)}`);
// A first run needs an empty profile: never reuse one (it would skip the welcome and measure nothing).
if (fs.existsSync(profile) && fs.readdirSync(profile).length) { console.error(`profile not empty: ${profile}`); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(profile, { recursive: true });
// The app's temp files (Chromium, downloads, installers) go next to the profile, never to C:.
const appTemp = path.join(profile, "tmp");
fs.mkdirSync(appTemp, { recursive: true });
if (opt("models")) fs.cpSync(opt("models"), path.join(profile, "models"), { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const now = () => Date.now() - t0;
const report = { round, lang, keyboard, exeDir, profile, steps: [], clicks: 0, keys: 0, decisions: 0, timeline: [], axe: {}, keyboardPass: null, zoom: {}, reducedMotion: null, problems: [] };
const mark = (event, extra = {}) => { const e = { ms: now(), event, ...extra }; report.timeline.push(e); console.log(`${(e.ms / 1000).toFixed(1).padStart(6)} s  ${event}${extra.note ? "  " + extra.note : ""}`); };
let shotN = 0;
const shotName = (label) => path.join(OUT, `${String(++shotN).padStart(2, "0")}-${label}.png`);

const env = { ...process.env, FILOW_USER_DATA_DIR: profile, FILOW_PORT: String(PORT), FILOW_SESSION_PORT: String(PORT + 1), TEMP: appTemp, TMP: appTemp };
for (const k of ["OPENROUTER_API_KEY", "ELEVENLABS_API_KEY", "OPENAI_API_KEY", "FILOW_PUBLIC_WEB"]) delete env[k];
if (flag("offline")) env.FILOW_OFFLINE = "1";
if (flag("no-ollama")) env.OLLAMA_URL = "http://127.0.0.1:9";
if (opt("mic")) env.FILOW_OKF_FAKE_MIC = path.resolve(opt("mic"));
const app = spawn(path.join(exeDir, "Filow.exe"), [`--remote-debugging-port=${DEVTOOLS}`, `--lang=${lang === "it" ? "it-IT" : "en-US"}`], { env, stdio: "ignore" });
const stop = () => { try { execSync(`taskkill /PID ${app.pid} /T /F`, { stdio: "ignore" }); } catch { /* gone */ } };
process.on("exit", stop);
setTimeout(() => { report.problems.push("probe timeout (6 min)"); finish(3); }, 360000);

// ---- CDP ----
async function targets() { try { return await (await fetch(`http://127.0.0.1:${DEVTOOLS}/json`)).json(); } catch { return []; } }
async function connect(t) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  // A window that closes mid-call (the welcome window on its last click) never answers: settle on close
  // or after 15 s instead of hanging the probe.
  ws.onclose = () => { for (const r of pending.values()) r({ error: "closed" }); pending.clear(); };
  const call = (method, params = {}) => new Promise((r) => {
    const i = ++id; pending.set(i, r);
    setTimeout(() => { if (pending.delete(i)) r({ error: "timeout" }); }, 15000);
    if (ws.readyState === 1) ws.send(JSON.stringify({ id: i, method, params })); else { pending.delete(i); r({ error: "closed" }); }
  });
  const evaluate = async (expression) => { const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result?.result?.value; };
  const shot = async (label) => { const r = await call("Page.captureScreenshot", { format: "png" }); const f = shotName(label); fs.writeFileSync(f, Buffer.from(r.result.data, "base64")); return path.basename(f); };
  const click = async (selector) => {
    const box = await evaluate(`(() => { const el = ${selector}; if (!el) return null; el.scrollIntoView({block:"nearest"}); const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
    if (!box) throw new Error(`not found: ${selector}`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await call("Input.dispatchMouseEvent", { type, x: box[0], y: box[1], button: "left", clickCount: 1 });
    report.clicks++;
  };
  const key = async (k, code = k, keyCode = 0) => {
    // Enter and Space activate buttons only when the key event carries its text, as a real keyboard's does.
    const text = k === "Enter" ? "\r" : k === " " ? " " : undefined;
    await call("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: keyCode, ...(text ? { text } : {}) });
    await call("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: keyCode });
    report.keys++;
  };
  await call("Page.enable"); await call("Runtime.enable");
  return { ws, call, evaluate, shot, click, key, close: () => ws.close() };
}
async function waitTarget(match, timeoutMs) {
  for (const end = Date.now() + timeoutMs; Date.now() < end;) {
    const t = (await targets()).find((x) => x.type === "page" && match(x.url));
    if (t) return t;
    await sleep(250);
  }
  return null;
}
const AXE = fs.readFileSync(path.join(ROOT, "node_modules", "axe-core", "axe.min.js"), "utf8");
async function axe(page, label) {
  await page.call("Page.setBypassCSP", { enabled: true });
  await page.evaluate(`${AXE};"ok"`);
  const v = await page.evaluate(`axe.run(document, { runOnly: { type: "tag", values: ["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"] } }).then(r => r.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, targets: v.nodes.slice(0, 4).map(n => n.target.join(" ")) })))`);
  report.axe[label] = v;
  return v;
}
const WORDS = `(() => { const t = document.body.innerText.trim(); return t ? t.split(/\\s+/).length : 0; })()`;
function step(name, extra) { report.steps.push({ name, ms: now(), ...extra }); }

// ---- native dialogs ----
function classify(d) {
  const all = `${d.title} ${d.texts.join(" ")}`;
  if (/PowerPoint/i.test(d.title)) return "dialog-powerpoint";
  if (/OpenRouter/i.test(all)) return "dialog-openrouter";
  if (/firewall|rete|network/i.test(all)) return "dialog-firewall";
  if (/\bAI\b|modell|model/i.test(d.title)) return "dialog-local-ai";
  return "dialog";
}
// label null = only look; otherwise save a PNG named after it and press button `press` (-1 = none).
function dialog(press = -1, label = null) {
  const shot = label ? shotName(label) : "";
  const out = execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, "tools", "autoloop", "e2e", "native-dialog.ps1"), "-ProcessId", String(app.pid), "-Shot", shot, "-Press", String(press)], { encoding: "utf8" }).trim();
  const list = JSON.parse(out || "[]");
  if (!list.length && shot) shotN--;
  if (list[0] && shot) list[0].shot = path.basename(shot);
  return list[0] || null;
}

// ---- the walk ----
let finished = false;
async function finish(code = 0) {
  if (finished) return; finished = true;
  // Time the user spends waiting on the app (not reading or deciding): to the welcome, from the welcome to
  // the main window (splash and any dialogs), and from "Start take" to the first ticked point.
  const at = (re) => report.timeline.find((e) => re.test(e.event))?.ms;
  const lastWelcome = [...report.timeline].reverse().find((e) => /^welcome .* done$/.test(e.event))?.ms;
  report.waits = { toWelcome: at(/^welcome visible/), welcomeToMain: at(/^main window shown/) - lastWelcome, startToTick: at(/^first point ticked/) - at(/^start take clicked/) };
  try { report.startupLog = fs.readFileSync(path.join(profile, "startup.log"), "utf8").split("\n").filter(Boolean).slice(-80); } catch { /* none */ }
  report.failures = onboardingFailures(report);
  report.verdict = report.failures.length || code ? "FAIL" : "PASS";
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  stop();
  console.log(`\nsteps ${report.steps.length}, clicks ${report.clicks}, keys ${report.keys}, decisions ${report.decisions}; report ${path.join(OUT, "report.json")}`);
  for (const f of report.failures) console.log(`FAIL ${f}`);
  console.log(report.verdict);
  process.exit(onboardingExitCode(code, report.failures));
}

try {
  mark("launch");
  const wt = await waitTarget((u) => u.startsWith("file:") && u.includes("welcome.html"), 60000);
  if (!wt) throw new Error("welcome window never appeared");
  const w = await connect(wt);
  let hydrated = false;
  for (let i = 0; i < 80 && !hydrated; i++) { hydrated = await w.evaluate(`!!document.querySelector("h1")?.textContent`).catch(() => false); if (!hydrated) await sleep(100); }
  if (!hydrated) report.problems.push("welcome: no title after 8 s");
  mark("welcome visible");
  const welcomeWords = await w.evaluate(WORDS);
  const welcomeControls = await w.evaluate(`[...document.querySelectorAll("select, input, button")].filter(e => e.offsetParent).length`);
  step("welcome", { shot: await w.shot("welcome"), words: welcomeWords, controls: welcomeControls });
  report.decisions += Math.max(0, welcomeControls - 1);
  await axe(w, "welcome");
  // The light theme too (the window follows the system theme; flip the page's theme attribute to see it).
  const themeWas = await w.evaluate(`document.documentElement.dataset.theme || ""`);
  await w.evaluate(`document.documentElement.dataset.theme = "light"; true`);
  await sleep(200);
  report.lightShot = await w.shot("welcome-light");
  await axe(w, "welcome-light");
  await w.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(themeWas)}; true`);

  // Keyboard-only pass: Tab order, visible focus on each stop.
  const order = [];
  const keysBefore = report.keys;
  await w.evaluate(`document.activeElement?.blur(); document.body.focus(); true`);
  for (let i = 0; i < 14; i++) {
    await w.key("Tab", "Tab", 9);
    // A radio's ring is drawn on its card (.choice:has(input:focus-visible)), so the label's outline counts.
    const d = await w.evaluate(`(() => { const e = document.activeElement; if (!e || e === document.body) return null; const ring = (el) => { const s = getComputedStyle(el); return s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0; }; const holder = e.closest("label"); const s = { outlineStyle: ring(e) || (holder && ring(holder)) ? "solid" : "none", outlineWidth: "2" }; const name = e.getAttribute("aria-label") || (e.labels && e.labels[0] ? e.labels[0].textContent : "") || e.textContent || e.id; return { tag: e.tagName.toLowerCase(), id: e.id, name: name.trim().slice(0, 40), outline: s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0, visible: e.offsetParent !== null }; })()`);
    if (d && order.length && d.id === order[0].id && d.name === order[0].name) break;
    order.push(d);
  }
  report.keys = keysBefore; // the audit's own key presses are not user effort
  report.keyboardPass = { order, allFocusVisible: order.every((d) => d && d.outline) };
  // Reduced motion: count elements that still animate or transition.
  await w.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  report.reducedMotion = { welcome: await w.evaluate(`[...document.querySelectorAll("*")].filter(e => { const s = getComputedStyle(e); return (s.animationName !== "none" && parseFloat(s.animationDuration) > 0) || s.transitionDuration.split(",").some(d => parseFloat(d) > 0); }).length`) };
  await w.call("Emulation.setEmulatedMedia", { features: [] });
  // Zoom: the same window at 125 % and 150 % text scaling = fewer CSS pixels.
  const vp = await w.evaluate(`[innerWidth, innerHeight]`);
  for (const z of [1.25, 1.5]) {
    await w.call("Emulation.setDeviceMetricsOverride", { width: Math.round(vp[0] / z), height: Math.round(vp[1] / z), deviceScaleFactor: z, mobile: false });
    await sleep(300);
    report.zoom[z] = await w.evaluate(`(() => { const b = document.querySelector("#start, [data-primary]"); const r = b ? b.getBoundingClientRect() : null; return { hOverflow: document.documentElement.scrollWidth > innerWidth, vScroll: document.documentElement.scrollHeight > innerHeight, primaryVisible: !!r && r.bottom <= innerHeight && r.right <= innerWidth }; })()`);
    report.zoom[z].shot = await w.shot(`welcome-zoom${Math.round(z * 100)}`);
  }
  await w.call("Emulation.clearDeviceMetricsOverride");
  await sleep(300);

  if (lang === "it") {
    if (await w.evaluate(`!!document.querySelector('input[name="lang"][value="it"]')`)) {
      // Guided welcome: a radio group. Keyboard: focus starts on the checked option, arrows move.
      if (keyboard) {
        await w.evaluate(`document.querySelector('input[name="lang"]:checked')?.focus(); true`);
        for (let i = 0; i < 2 && !(await w.evaluate(`document.querySelector('input[name="lang"][value="it"]').checked`)); i++) await w.key("ArrowDown", "ArrowDown", 40);
      } else await w.click(`document.querySelector('input[name="lang"][value="it"]').closest("label")`);
    } else {
      await w.evaluate(`(() => { const s = document.querySelector("#language"); if (s && s.value !== "it") { s.value = "it"; s.dispatchEvent(new Event("change", { bubbles: true })); } return true; })()`);
      report.clicks += 2; // open the list, pick the item
    }
    await sleep(500);
    step("welcome-it", { shot: await w.shot("welcome-it") });
  }
  // Leave each welcome page: keyboard (Tab to the primary button, Enter) or mouse.
  const primary = `document.querySelector("#start, [data-primary]")`;
  async function pressPrimary() {
    if (keyboard) {
      if (!(await w.evaluate(`!!document.activeElement && (document.activeElement.id === "start" || document.activeElement.hasAttribute("data-primary"))`))) {
        for (let i = 0; i < 20; i++) {
          await w.key("Tab", "Tab", 9);
          if (await w.evaluate(`document.activeElement?.id === "start" || !!document.activeElement?.hasAttribute("data-primary")`)) break;
        }
      }
      await w.key("Enter", "Enter", 13);
    } else await w.click(primary);
  }
  // --welcome-mic-error NotFoundError|NotAllowedError|NotReadableError: the welcome's microphone fails that way.
  if (opt("welcome-mic-error")) await w.evaluate(`navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error("probe"), { name: ${JSON.stringify(opt("welcome-mic-error"))} })); true`);
  const firstStep = await w.evaluate(`document.querySelector("[data-step]:not([hidden])")?.dataset.step || "welcome"`);
  await pressPrimary();
  mark(`welcome ${firstStep} done`);
  // Multi-page welcome flows: keep pressing the primary action until the window closes.
  for (let page = 2; page <= 8; page++) {
    await sleep(600);
    const alive = (await targets()).some((x) => x.id === wt.id);
    if (!alive) break;
    const info = await w.evaluate(`(() => { const p = document.querySelector("[data-step]:not([hidden])"); return p ? p.dataset.step : null; })()`).catch(() => null);
    if (!info) break;
    if (info === "mic") {
      // The microphone check: wait for its verdict (heard, silent or an error), as a user would.
      const t = now();
      let state = "listening";
      for (let i = 0; i < 40 && state === "listening"; i++) { await sleep(250); state = await w.evaluate(`document.querySelector("#mic-card")?.dataset.state || "?"`).catch(() => "?"); }
      report.mic = { state, ms: now() - t };
      mark("microphone check", { note: `${state} after ${((now() - t) / 1000).toFixed(1)} s` });
    }
    if (info === "setup") for (let i = 0; i < 20 && !(await w.evaluate(`!!document.querySelector("#setup-name")?.textContent`)); i++) await sleep(250);
    const words = await w.evaluate(WORDS).catch(() => 0);
    step(`welcome:${info}`, { shot: await w.shot(`welcome-${info}`), words });
    await axe(w, `welcome-${info}`).catch((err) => { report.axe[`welcome-${info}`] = { error: String(err && err.message || err).slice(0, 200) }; });
    for (const z of [1.25, 1.5]) {
      await w.call("Emulation.setDeviceMetricsOverride", { width: Math.round(vp[0] / z), height: Math.round(vp[1] / z), deviceScaleFactor: z, mobile: false });
      await sleep(250);
      const zr = await w.evaluate(`(() => { const r = ${primary}?.getBoundingClientRect(); return { hOverflow: document.documentElement.scrollWidth > innerWidth, primaryVisible: !!r && r.bottom <= innerHeight && r.right <= innerWidth }; })()`);
      report.zoom[`${info}@${z}`] = { ...zr, shot: await w.shot(`welcome-${info}-zoom${Math.round(z * 100)}`) };
    }
    await w.call("Emulation.clearDeviceMetricsOverride");
    await sleep(250);
    if (info === "setup" && flag("welcome-only")) await finish(0); // never start a real download from a probe
    // Ready for a take with an optional rest to download: answer "Not now" (Escape on the keyboard) unless
    // --accept-local-ai; the probe measures the way to the first take, not a 10 GB download.
    const optionalRest = info === "setup" && !flag("accept-local-ai") && await w.evaluate(`!document.querySelector("#setup-ready")?.hidden && !document.querySelector("#secondary")?.hidden`).catch(() => false);
    if (optionalRest) { if (keyboard) await w.key("Escape", "Escape", 27); else await w.click(`document.querySelector("#secondary")`); }
    else await pressPrimary();
    mark(`welcome ${info} done`);
  }
  w.close();
  if (flag("welcome-only")) await finish(0);

  // After welcome: splash, native dialogs, main window.
  let main = null, mainShown = false;
  const log = () => { try { return fs.readFileSync(path.join(profile, "startup.log"), "utf8"); } catch { return ""; } };
  for (const end = Date.now() + 120000; Date.now() < end && !mainShown;) {
    const d = dialog();
    if (d) {
      const label = classify(d);
      const accept = label === "dialog-local-ai" && flag("accept-local-ai");
      const press = accept ? 0 : d.buttons.length - 1;
      await sleep(400);
      const seen = dialog(press, label);
      report.clicks++; report.decisions++;
      const words = (d.title + " " + d.texts.join(" ")).split(/\s+/).length;
      step(label, { shot: seen?.shot, title: d.title, texts: d.texts, buttons: d.buttons, pressed: seen ? d.buttons[press] : null, words });
      mark(`${label} answered`, { note: d.buttons[press] });
      continue;
    }
    if (/main window shown|startup watchdog/.test(log())) { mainShown = true; break; }
    await sleep(400);
  }
  if (!mainShown) {
    const wins = execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, "tools", "autoloop", "e2e", "native-dialog.ps1"), "-ProcessId", String(app.pid), "-List"], { encoding: "utf8" }).trim();
    report.problems.push(`main window not shown after 120 s; windows: ${wins}`);
    await finish(2);
  }
  mark("main window shown");
  const mt = await waitTarget((u) => u.startsWith(`http://127.0.0.1:${PORT}`) && !u.includes("/okfilow/") && !u.includes("/mirror"), 20000);
  main = await connect(mt);
  await sleep(1500);
  // Dialogs that come after the main window (PowerPoint, OpenRouter key).
  for (let quietSince = Date.now(); Date.now() - quietSince < 5000;) {
    const d = dialog();
    if (!d) { await sleep(300); continue; }
    quietSince = Date.now();
    const label = classify(d);
    const press = d.buttons.length - 1;
    const seen = dialog(press, label);
    report.clicks++; report.decisions++;
    step(label, { shot: seen?.shot, title: d.title, texts: d.texts, buttons: d.buttons, pressed: d.buttons[press], words: (d.title + " " + d.texts.join(" ")).split(/\s+/).length });
    mark(`${label} answered`, { note: d.buttons[press] });
    await sleep(600);
  }
  const mainWords = await main.evaluate(WORDS);
  step("main", { shot: await main.shot("main"), words: mainWords, url: await main.evaluate("location.href") });
  await axe(main, "main");

  // First take.
  if (flag("no-mic")) await main.evaluate(`navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error("Requested device not found"), { name: "NotFoundError" })); true`);
  const startSel = `[...document.querySelectorAll("button")].find(b => b.querySelector('[data-icon="play"], svg') && /Start take|Avvia/.test(b.textContent))`;
  for (let i = 0; i < 40; i++) { if (await main.evaluate(`!!(${startSel}) && !(${startSel}).disabled`)) break; await sleep(500); }
  const tStart = now();
  await main.click(startSel);
  mark("start take clicked");
  let ticked = null, dialogSeen = false;
  for (const end = Date.now() + 150000; Date.now() < end && !ticked;) {
    const s = await main.evaluate(`(() => ({ dialog: !!document.querySelector(".startmode"), err: document.querySelector('.chip.err.banner, [role="alert"]')?.textContent || "", states: [...document.querySelectorAll(".point-row")].map(p => p.dataset.state), live: /live|in corso/i.test(document.body.innerText) }))()`).catch(() => null);
    if (!s) { await sleep(500); continue; }
    if (s.dialog && !dialogSeen) {
      dialogSeen = true;
      await sleep(400);
      const words = await main.evaluate(`document.querySelector(".startmode").innerText.trim().split(/\\s+/).length`);
      step("start-dialog", { shot: await main.shot("start-dialog"), words });
      await axe(main, "start-dialog");
      report.decisions++;
      const pick = `(() => { const d = document.querySelector(".startmode"); return [...d.querySelectorAll("button.primary")].find(b => !b.disabled); })()`;
      if (await main.evaluate(`!!${pick}`)) { await main.click(pick); mark("start mode picked"); }
      else { report.problems.push("start dialog: no enabled start button"); step("blocked", { shot: await main.shot("start-blocked") }); break; }
    }
    if (s.err && !report.firstError) { report.firstError = s.err; mark("error shown", { note: s.err.slice(0, 120) }); step("error", { shot: await main.shot("take-error"), text: s.err }); break; }
    if (!report.firstActiveMs && s.states.includes("active")) { report.firstActiveMs = now(); mark("a point is being heard (active)"); }
    const done = s.states.indexOf("done");
    if (done >= 0) ticked = { index: done, state: s.states[done] };
    else await sleep(500);
  }
  if (ticked) {
    mark("first point ticked", { note: `#${ticked.index + 1} ${ticked.state}` });
    step("first-take", { shot: await main.shot("first-take"), secondsFromStart: (now() - tStart) / 1000 });
    report.secondsToFirstTake = now() / 1000;
  } else {
    report.problems.push("no point ticked");
    step("take-end", { shot: await main.shot("take-end"), text: (await main.evaluate(`document.body.innerText`).catch(() => "")).slice(-1500) });
  }
  await finish(0);
} catch (err) {
  report.problems.push(String(err && err.stack || err));
  console.error(err);
  await finish(1);
}
