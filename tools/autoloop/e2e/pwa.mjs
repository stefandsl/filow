#!/usr/bin/env node
// PLAT-PWA (docs/PLATFORMS.md): the phone companion is installable. Starts the packaged Windows app on its
// own profile and ports, opens /mirror in Edge (or Chrome) emulating a 390x844 phone over the DevTools
// Protocol, and checks Page.getInstallabilityErrors (must be empty), the parsed manifest, the iOS meta
// tags and icons, axe-core on the phone pages, and pairing with the desktop's live session code. Saves
// screenshots of the phone pages. Also records what Chrome says about the same page over the LAN address
// (plain http, so not a secure origin: Android cannot install from it).
//
// Not covered: pairing over the public link. There the QR names two different trycloudflare hosts, so the
// phone still asks before it trusts the relay; this script runs with the public link off (LAN only).
//
// Usage: node tools/autoloop/e2e/pwa.mjs <path\to\win-unpacked> [--browser <msedge.exe|chrome.exe>] [--settings <settings.json>]
// Ports FILOW_E2E_PORT (default 4831) and the next one up, app DevTools FILOW_E2E_DEVTOOLS (default 9354), browser
// DevTools FILOW_E2E_BROWSER_DEVTOOLS (default 9356). Profile tmp/t4/pwa-profile, seeded from --settings or else
// tmp/autoloop-profile/settings.json when that exists.
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../../..");
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const exeDir = args[0];
const PORT = Number(process.env.FILOW_E2E_PORT || 4831), SESSION_PORT = PORT + 1;
const APP_DT = Number(process.env.FILOW_E2E_DEVTOOLS || 9354), BROWSER_DT = Number(process.env.FILOW_E2E_BROWSER_DEVTOOLS || 9356);
const out = path.join(ROOT, "tmp", "t4");
const profile = path.join(out, "pwa-profile");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const result = { at: new Date().toISOString(), build: exeDir, checks: {} };
const pass = (name, ok, detail) => { result.checks[name] = { ok, detail }; console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`); };
const browserExe = opt("browser") || ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find((p) => fs.existsSync(p));
if (!exeDir || !fs.existsSync(path.join(exeDir, "Filow.exe")) || !browserExe) { console.error("usage: pwa.mjs <win-unpacked holding Filow.exe> [--browser <exe>] (or no Edge or Chrome found)"); process.exit(2); }
const settingsFile = opt("settings");
if (settingsFile !== undefined && !fs.existsSync(settingsFile)) { console.error(`pwa.mjs: --settings ${settingsFile} does not exist`); process.exit(2); }

// ---- the packaged app on a fresh profile (public link off, onboarding done) ----
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });
// Same seed as a11y.mjs and coldstart.mjs, inside this checkout.
const seed = settingsFile || path.join(ROOT, "tmp", "autoloop-profile", "settings.json");
const settings = fs.existsSync(seed) ? JSON.parse(fs.readFileSync(seed, "utf8")) : {};
Object.assign(settings, { remoteShare: false, remoteShareChosen: true, welcomeCompleted: true, localAiOffered: true, firewallOffered: true, pptAsked: true });
fs.writeFileSync(path.join(profile, "settings.json"), JSON.stringify(settings, null, 2));
const browserProfile = path.join(out, "browser-profile");
fs.rmSync(browserProfile, { recursive: true, force: true });
let app = null, browser = null;
/** The first DevTools page target that matches, retried while the process starts. */
async function pageTarget(port, match, what) {
  for (let i = 0; i < 30; i++) {
    try { const t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(match); if (t) return t; } catch { /* not listening yet */ }
    await sleep(500);
  }
  throw new Error(`no ${what} page over DevTools on port ${port}`);
}
const kill = (p) => { if (p && p.pid) try { execSync(`taskkill /PID ${p.pid} /T /F`, { stdio: "ignore" }); } catch { /* gone */ } };

/** Minimal CDP client over a target's WebSocket URL. */
async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map(); const listeners = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method) for (const [name, fn] of listeners) if (name === d.method) fn(d.params);
  };
  const call = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => (await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  return { call, evaluate, on: (name, fn) => listeners.push([name, fn]), close: () => ws.close() };
}

try {
  app = spawn(path.join(exeDir, "Filow.exe"), [`--remote-debugging-port=${APP_DT}`], {
    env: { ...process.env, FILOW_USER_DATA_DIR: profile, FILOW_PORT: String(PORT), FILOW_SESSION_PORT: String(SESSION_PORT) }, stdio: "ignore",
  });
  const startupLog = path.join(profile, "startup.log");
  let shown = false;
  for (let i = 0; i < 240 && !shown; i++) { shown = fs.existsSync(startupLog) && /main window shown/.test(fs.readFileSync(startupLog, "utf8")); if (!shown) await sleep(500); }
  if (!shown) throw new Error("app did not show its main window");

  // The pairing code the desktop shows (a 6-digit chip in the top bar).
  const appTarget = await pageTarget(APP_DT, (t) => t.type === "page" && t.url.startsWith(`http://127.0.0.1:${PORT}/`) && !t.url.includes("/okfilow/"), "desktop main");
  const desk = await cdp(appTarget.webSocketDebuggerUrl);
  // The URL in the QR code, as the pairing dialog prints it under the code.
  let pairUrl = null;
  for (let i = 0; i < 20 && !pairUrl; i++) {
    pairUrl = await desk.evaluate(`(async () => { const b = [...document.querySelectorAll("button")].find((e) => /^\\d{6}$/.test(e.textContent.trim()) || e.querySelector(".pair-code"));
      if (b && !document.querySelector(".bigcode")) { b.click(); await new Promise((r) => setTimeout(r, 800)); }
      const m = document.body.innerText.match(/https?:\\/\\/\\S+\\/mirror\\?code=\\d{6}\\S*/); return m ? m[0].replace(/[.,;)]+$/, "") : null; })()`);
    if (!pairUrl) await sleep(500);
  }
  await desk.evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); true`);
  desk.close();
  result.pairUrl = pairUrl;
  const code = pairUrl ? new URL(pairUrl).searchParams.get("code") : null;

  // ---- a phone in Edge/Chrome ----
  browser = spawn(browserExe, ["--headless=new", `--remote-debugging-port=${BROWSER_DT}`, `--user-data-dir=${browserProfile}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  let version;
  for (let i = 0; i < 40 && !version; i++) { try { version = await (await fetch(`http://127.0.0.1:${BROWSER_DT}/json/version`)).json(); } catch { await sleep(500); } }
  result.browser = version?.Browser;
  if (!version) throw new Error(`the browser did not open DevTools on port ${BROWSER_DT}`);
  // A tab of our own (not whichever page the browser lists first, which may lack the tab helpers that answer
  // Page.getInstallabilityErrors).
  const page = await (await fetch(`http://127.0.0.1:${BROWSER_DT}/json/new?about:blank`, { method: "PUT" })).json();
  if (!page?.webSocketDebuggerUrl) throw new Error(`the browser did not open a tab: ${JSON.stringify(page)}`);
  result.browserTargets = (await (await fetch(`http://127.0.0.1:${BROWSER_DT}/json`)).json()).map((t) => `${t.type} ${t.url.slice(0, 60)}`);
  const ph = await cdp(page.webSocketDebuggerUrl);
  await ph.call("Page.enable"); await ph.call("Runtime.enable");
  // A confirm() on the phone is recorded and answered "OK", as a user who trusts their own PC would.
  const dialogs = [];
  ph.on("Page.javascriptDialogOpening", (p) => { dialogs.push(`${p.type}: ${p.message}`); void ph.call("Page.handleJavaScriptDialog", { accept: true }); });
  const UA = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36";
  await ph.call("Emulation.setUserAgentOverride", { userAgent: UA, platform: "Android" });
  await ph.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await ph.call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  const open = async (url) => {
    await ph.call("Page.navigate", { url });
    let last = -1, stable = 0;
    for (let i = 0; i < 30 && stable < 3; i++) { await sleep(500); const len = await ph.evaluate(`document.readyState === "complete" ? document.body.innerText.length : -1`); stable = len === last && len >= 0 ? stable + 1 : 0; last = len; }
  };
  // Screenshots wait for running transitions (a live theme switch fades buttons for 180 ms) so they show the end state.
  const settle = () => ph.evaluate(`new Promise((r) => { const t0 = performance.now(); (function f() { if (!document.getAnimations().some((a) => a.playState === "running") || performance.now() - t0 > 3000) r(true); else setTimeout(f, 50); })(); })`);
  const shot = async (name) => { await settle(); const s = await ph.call("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(out, `phone-${name}.png`), Buffer.from(s.result.data, "base64")); };

  // ---- installability over localhost (a secure origin, like the https public link) ----
  await open(`http://127.0.0.1:${PORT}/mirror`);
  await sleep(1500);
  // The browser can answer with an error while it is still fetching the manifest: ask again, and keep the error
  // (an "Unable to fetch errors for target" here meant a page without tab helpers: see the tab opened above).
  let errors, cdpError;
  for (let i = 0; i < 10 && !Array.isArray(errors); i++) {
    const r = await ph.call("Page.getInstallabilityErrors");
    errors = r.result?.installabilityErrors;
    cdpError = r.error;
    if (!Array.isArray(errors)) await sleep(500);
  }
  const man = (await ph.call("Page.getAppManifest")).result;
  const parsed = man?.data ? JSON.parse(man.data) : null;
  pass("installable", Array.isArray(errors) && errors.length === 0 && !(man.errors || []).length, { installabilityErrors: errors, ...(cdpError ? { cdpError } : {}), manifestErrors: man?.errors, manifestUrl: man?.url });
  pass("manifest", parsed && parsed.id === "/mirror" && parsed.start_url === "/mirror" && parsed.scope === "/mirror" && parsed.display === "standalone", parsed && { id: parsed.id, start_url: parsed.start_url, scope: parsed.scope, display: parsed.display, icons: parsed.icons.length });
  const meta = await ph.evaluate(`(() => { const m = (n) => [...document.querySelectorAll('meta[name="' + n + '"]')].map((e) => (e.media ? e.media + " " : "") + e.content);
    return { appleCapable: m("apple-mobile-web-app-capable"), mobileCapable: m("mobile-web-app-capable"), title: m("apple-mobile-web-app-title"), statusBar: m("apple-mobile-web-app-status-bar-style"),
      themeColor: m("theme-color"), formatDetection: m("format-detection"), viewport: m("viewport"), touchIcon: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href"), manifest: document.querySelector('link[rel="manifest"]')?.getAttribute("href") }; })()`);
  const touch = meta.touchIcon ? (await fetch(`http://127.0.0.1:${PORT}${meta.touchIcon}`)).status : 0;
  pass("ios meta", meta.appleCapable[0] === "yes" && meta.title[0] === "Filow" && meta.themeColor.length === 2 && /telephone=no/.test(meta.formatDetection[0] || "") && touch === 200 && /width=device-width/.test(meta.viewport[0] || ""), { ...meta, touchIconStatus: touch });
  const sw = await ph.evaluate(`navigator.serviceWorker.getRegistrations().then((r) => r.length)`);
  pass("no service worker", sw === 0, `${sw} registration(s): live session traffic is never intercepted`);

  // ---- phone pages: unpaired, then paired with the desktop's session; both themes ----
  const axeSource = fs.readFileSync(path.join(ROOT, "node_modules", "axe-core", "axe.min.js"), "utf8");
  const axe = async () => { await ph.evaluate(axeSource + ";true"); return ph.evaluate(`axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"] }).then((r) => r.violations.map((v) => v.id + " x" + v.nodes.length))`); };
  const overflow = `Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)`;
  const phone = [];
  const theme = (t) => ph.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: t }] });
  for (const t of ["dark", "light"]) {
    await theme(t);
    await open(`http://127.0.0.1:${PORT}/mirror`);
    phone.push({ page: `mirror-code-${t}`, violations: await axe(), overflowPx: await ph.evaluate(overflow) });
    await shot(`mirror-code-${t}`);
  }
  if (pairUrl) {
    // Exactly what a phone opens from the QR code (a code is single use, so pair once, then switch theme live).
    await theme("dark");
    await open(pairUrl);
    await sleep(3000);
    for (const t of ["dark", "light"]) {
      await theme(t);
      await sleep(800);
      const text = await ph.evaluate(`document.body.innerText.slice(0, 400)`);
      // Paired = the live stage (StageView), not the code form or the "waiting for approval" card (both .pair).
      const paired = await ph.evaluate(`Boolean(document.querySelector(".app.stage:not(.pair)")) && !document.querySelector(".pair")`);
      await settle();
      const buttons = await ph.evaluate(`[...document.querySelectorAll(".controls .btn")].map((b) => b.textContent.trim() + " " + getComputedStyle(b).backgroundColor).join(" | ")`);
      phone.push({ page: `mirror-live-${t}`, paired, buttons, text: text.replace(/\s+/g, " ").slice(0, 120), violations: await axe(), overflowPx: await ph.evaluate(overflow) });
      await shot(`mirror-live-${t}`);
    }
  }
  result.phone = phone;
  pass("phone pages", Boolean(code) && phone.every((p) => p.violations.length === 0 && p.overflowPx === 0) && phone.filter((p) => p.paired).length === 2, phone.map((p) => `${p.page}: ${p.violations.length} axe, ${p.overflowPx}px overflow${"paired" in p ? (p.paired ? ", paired" : ", NOT paired") : ""}`));

  // ---- the same page over the LAN address the QR code uses ----
  result.dialogs = dialogs;
  pass("pairing without a prompt", dialogs.length === 0, dialogs.length ? dialogs : "the QR code of the desktop opens the live mirror with no confirm()");
  const lan = pairUrl ? new URL(pairUrl).origin : (() => { const i = Object.values(os.networkInterfaces()).flat().find((n) => n && n.family === "IPv4" && !n.internal); return i && `http://${i.address}:${PORT}`; })();
  if (lan) {
    await ph.call("Emulation.setEmulatedMedia", { features: [] });
    await open(`${lan}/mirror`);
    await sleep(1500);
    result.lan = { origin: lan, installabilityErrors: (await ph.call("Page.getInstallabilityErrors")).result?.installabilityErrors };
    console.log(`INFO lan: ${JSON.stringify(result.lan)}`);
  }
  ph.close();
} catch (err) {
  pass("run", false, String(err && err.stack || err));
} finally {
  kill(browser);
  kill(app);
  fs.writeFileSync(path.join(out, "pwa.json"), JSON.stringify(result, null, 2));
  const failed = Object.entries(result.checks).filter(([, c]) => !c.ok).map(([k]) => k);
  console.log(failed.length ? `FAILED: ${failed.join(", ")}` : "all PWA checks passed");
  process.exit(failed.length ? 1 : 0);
}
