#!/usr/bin/env node
// A11Y-01..07 (docs/autoloop/STANDARDS.md): runs axe-core (WCAG 2.2 A and AA rules) inside every Filow page
// of the real packaged app over the Chrome DevTools Protocol, in dark and light themes, and writes
// tmp/autoloop/a11y.json. score.mjs reads that file when it is less than 48 hours old.
//
// Usage: node tools/autoloop/e2e/a11y.mjs [path\to\win-unpacked]   (default: newest G:\FILOW\release-autoloop*)
// Starts the app on its own profile and ports (4787/4788, DevTools 9344) and stops its process tree after.
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../../..");
// Every page the web app ships, read from apps/web/app (a hand-kept list once scanned two 404 pages).
function pageRoutes(dir = path.join(ROOT, "apps", "web", "app"), base = "") {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && e.name === "page.tsx") out.push(base || "/");
    if (e.isDirectory() && !/^[[(_]/.test(e.name) && e.name !== "api") out.push(...pageRoutes(path.join(dir, e.name), `${base}/${e.name}`));
  }
  return out.sort();
}
const ROUTES = pageRoutes();
const THEMES = ["dark", "light"];
const PORT = 4787, DEVTOOLS = 9344;

function newestBuild() {
  const dirs = fs.readdirSync(ROOT).filter((d) => /^release-autoloop/.test(d) && fs.existsSync(path.join(ROOT, d, "win-unpacked", "Filow.exe")));
  dirs.sort((a, b) => fs.statSync(path.join(ROOT, b, "win-unpacked", "Filow.exe")).mtimeMs - fs.statSync(path.join(ROOT, a, "win-unpacked", "Filow.exe")).mtimeMs);
  if (!dirs.length) throw new Error("no packaged build found (release-autoloop*)");
  return path.join(ROOT, dirs[0], "win-unpacked");
}

const exeDir = process.argv[2] || newestBuild();
const profile = path.join(ROOT, "tmp", "autoloop-profile");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const startupLog = path.join(profile, "startup.log");
const logLinesBefore = fs.existsSync(startupLog) ? fs.readFileSync(startupLog, "utf8").split("\n").length : 0;
const app = spawn(path.join(exeDir, "Filow.exe"), [`--remote-debugging-port=${DEVTOOLS}`], {
  env: { ...process.env, FILOW_USER_DATA_DIR: profile, FILOW_PORT: String(PORT), FILOW_SESSION_PORT: String(PORT + 1) },
  stdio: "ignore", detached: false,
});
const stop = () => { try { execSync(`taskkill /PID ${app.pid} /T /F`, { stdio: "ignore" }); } catch { /* gone */ } };
process.on("exit", stop);

let target;
for (let i = 0; i < 60 && !target; i++) {
  await sleep(2000);
  try { target = (await (await fetch(`http://127.0.0.1:${DEVTOOLS}/json`)).json()).find((t) => t.type === "page" && t.url.startsWith(`http://127.0.0.1:${PORT}/`) && !t.url.includes("/okfilow/")); } catch { /* not up yet */ }
}
if (!target) { console.error("app did not come up"); process.exit(2); }
// The window reloads once the public link is up (or has failed); navigating before that lands back on "/".
for (let i = 0; i < 120; i++) {
  const fresh = fs.existsSync(startupLog) ? fs.readFileSync(startupLog, "utf8").split("\n").slice(logLinesBefore - 1).join("\n") : "";
  if (/main window shown/.test(fresh)) break;
  await sleep(500);
}
await sleep(1500);

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const call = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => (await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
// Opens a route and waits until its text stops changing (data-driven pages fill in after load).
// Returns a problem string when the page is not the one asked for or is a 404.
const wrongPages = [];
async function open(route) {
  await call("Page.navigate", { url: `http://127.0.0.1:${PORT}${route}` });
  await sleep(1500);
  let last = -1, stable = 0;
  for (let i = 0; i < 30 && stable < 3; i++) {
    const len = await evaluate(`document.readyState === "complete" ? document.body.innerText.length : -1`);
    stable = len === last && len >= 0 ? stable + 1 : 0;
    last = len;
    await sleep(500);
  }
  const where = await evaluate(`location.pathname + "|" + /could not be found/.test(document.body.innerText)`);
  const [pathname, notFound] = String(where).split("|");
  const problem = pathname !== route ? `${route}: landed on ${pathname}` : notFound === "true" ? `${route}: 404` : null;
  if (problem && !wrongPages.includes(problem)) wrongPages.push(problem);
  return problem;
}

const axeSource = fs.readFileSync(path.join(ROOT, "node_modules", "axe-core", "axe.min.js"), "utf8");
await call("Page.enable"); await call("Runtime.enable");
const results = [];
for (const theme of THEMES) {
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
  for (const route of ROUTES) {
    await open(route);
    await evaluate(axeSource + ";true");
    const r = await evaluate(`axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"] })
      .then((res) => res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) })))`);
    results.push({ theme, route, violations: r || [{ id: "axe-did-not-run", impact: "critical", nodes: 1 }] });
    console.log(`${theme} ${route}: ${(r || []).length} rule(s) violated`);
  }
}
const total = results.reduce((s, r) => s + r.violations.length, 0);

// A11Y-06: with "reduce motion" on, nothing may still animate or transition. The same count with the
// setting off shows the probe can see motion at all (it must be > 0 somewhere, or the check measures nothing).
const countMoving = `[...document.querySelectorAll("*")].filter((el) => { const s = getComputedStyle(el);
  const anim = s.animationName !== "none" && parseFloat(s.animationDuration) > 0;
  const trans = s.transitionProperty !== "none" && s.transitionDuration.split(",").some((d) => parseFloat(d) > 0);
  return anim || trans; }).length`;
const motion = { reduce: {}, normal: {} };
for (const mode of ["reduce", "no-preference"]) {
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: mode }] });
  for (const route of ROUTES) {
    await open(route);
    motion[mode === "reduce" ? "reduce" : "normal"][route] = await evaluate(countMoving);
  }
}
const moving = Object.values(motion.reduce).reduce((a, b) => a + (b || 0), 0);
const movingNormally = Object.values(motion.normal).reduce((a, b) => a + (b || 0), 0);
console.log(`reduced motion: ${moving} element(s) still moving (without the setting: ${movingNormally})`);

await call("Emulation.setEmulatedMedia", { features: [] });

// A11Y-07 (WCAG 1.4.10 reflow, 1.4.4 resize): at 640 CSS px (a 1280 px window at 200% zoom) and at 320 px
// no page may need horizontal scrolling. 200 px is a control width where overflow is expected, so the
// probe is shown able to see it.
const overflow = `(() => { const d = document.documentElement; return Math.max(0, d.scrollWidth - d.clientWidth); })()`;
const reflow = {};
for (const width of [640, 320, 200]) {
  await call("Emulation.setDeviceMetricsOverride", { width, height: 700, deviceScaleFactor: 1, mobile: false });
  reflow[width] = {};
  for (const route of ROUTES) {
    await open(route);
    reflow[width][route] = await evaluate(overflow);
  }
}
await call("Emulation.clearDeviceMetricsOverride");
const reflowFailures = [640, 320].flatMap((w) => Object.entries(reflow[w]).filter(([, px]) => px > 0).map(([r, px]) => `${w}px ${r}: ${px}px wider`));
const controlOverflows = Object.values(reflow[200]).filter((px) => px > 0).length;
console.log(`reflow: ${reflowFailures.length} page/width overflow(s) at 640/320 px; control at 200 px overflows on ${controlOverflows} page(s)`);
for (const f of reflowFailures) console.log("  " + f);

fs.mkdirSync(path.join(ROOT, "tmp", "autoloop"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "tmp", "autoloop", "a11y.json"), JSON.stringify({ at: new Date().toISOString(), build: exeDir, total, results, motion, moving, movingNormally, reflow, reflowFailures, controlOverflows, routes: ROUTES, wrongPages }, null, 2));
if (wrongPages.length) console.log("WRONG PAGES (these results are not valid): " + wrongPages.join("; "));
console.log(`total rule violations across ${results.length} page/theme runs: ${total}`);
ws.close(); stop(); process.exit(0);
