#!/usr/bin/env node
// One round of the Excalidraw whiteboard comparison (G:\FILOW\tmp\excalidraw-research\PLAN.md):
// for each of the ten hard concepts, "ours" is the real whiteboard page of a running Filow web
// server explaining it with the local model (Ollama on this PC; nothing paid, nothing online), and
// "bar" is the scene written by following excalidraw-mcp's read_me cheat sheet, drawn by
// excalidraw-mcp's own render path (tools/whiteboard/bar-harness.js). Both are photographed by a
// headless Edge with its own profile under G:\FILOW\tmp; nothing touches the desktop.
//
// Usage: node tools/whiteboard/excalidraw-round.mjs --round 1 [--base http://127.0.0.1:4861]
//        [--only photosynthesis,ohms-law] [--skip-ours] [--skip-bar] [--out G:\FILOW\tmp\excalidraw-shots]
// Writes round-N/ours/<concept>.png and .json, round-N/bar/<concept>.png and round-N/metrics.json.
import { spawn, execSync } from "node:child_process";
import { buildSync } from "esbuild";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..");
const round = arg("round", "1");
const base = arg("base", "http://127.0.0.1:4861");
const OUT = path.join(arg("out", "G:\\FILOW\\tmp\\excalidraw-shots"), `round-${round}`);
const WORK = arg("work", "G:\\FILOW\\tmp\\excalidraw-work\\round");
const BAR_SCENES = arg("bar-scenes", "G:\\FILOW\\tmp\\excalidraw-shots\\bar-scenes");
const CDP = Number(arg("cdp", "9461"));
const HARNESS_PORT = Number(arg("harness-port", "4871"));
const LESSON_TIMEOUT_MS = Number(arg("timeout", String(15 * 60_000)));
const CONCEPTS = [
  ["photosynthesis", "How does photosynthesis work?"],
  ["pythagoras", "Prove the Pythagorean theorem"],
  ["tcp-handshake", "How does the TCP three-way handshake work?"],
  ["compound-interest", "What is compound interest?"],
  ["neural-network", "How does a neural network learn?"],
  ["binary-search", "How does binary search work?"],
  ["krebs-cycle", "The Krebs cycle in outline"],
  ["supply-demand", "Supply and demand: how is a price set?"],
  ["ohms-law", "Ohm's law"],
  ["recursion", "What is recursion?"],
];
const only = arg("only", "").split(",").filter(Boolean);
const todo = CONCEPTS.filter(([slug]) => !only.length || only.includes(slug));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const d of [OUT, path.join(OUT, "ours"), path.join(OUT, "bar"), WORK]) fs.mkdirSync(d, { recursive: true });

// ---- the code check, the same one the page runs ----
const checkBundle = path.join(WORK, "check.cjs");
buildSync({ entryPoints: [path.join(ROOT, "apps/web/lib/whiteboard/check.ts")], bundle: true, platform: "node", format: "cjs", outfile: checkBundle, logLevel: "silent", alias: { "@": path.join(ROOT, "apps/web") } });
const { checkScene, countProblems } = (await import(pathToFileURL(checkBundle).href)).default;

// ---- the bar's page: excalidraw-mcp's render path, fonts from this disk ----
const harnessDir = path.join(WORK, "harness");
fs.mkdirSync(harnessDir, { recursive: true });
buildSync({ entryPoints: [path.join(ROOT, "tools/whiteboard/bar-harness.js")], bundle: true, format: "iife", platform: "browser", outfile: path.join(harnessDir, "bundle.js"), logLevel: "silent", define: { "process.env.NODE_ENV": '"production"', "process.env.IS_PREACT": '"false"' }, conditions: ["production"], alias: { "react-dom": path.join(ROOT, "apps/web/node_modules/react-dom") }, loader: { ".woff2": "file", ".ttf": "file", ".css": "empty" } });
fs.writeFileSync(path.join(harnessDir, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}#host{width:1024px;height:768px;background:#fff}#host svg{display:block}</style><script>window.EXCALIDRAW_ASSET_PATH=location.origin+"/excalidraw/";</script></head><body><div id="host"></div><script src="/bundle.js"></script></body></html>`);
const fontsDir = path.join(ROOT, "node_modules/@excalidraw/excalidraw/dist/prod/fonts");
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const file = url.startsWith("/excalidraw/fonts/") ? path.join(fontsDir, url.slice("/excalidraw/fonts/".length)) : path.join(harnessDir, url === "/" ? "index.html" : url.slice(1));
  if (!file.startsWith(fontsDir) && !file.startsWith(harnessDir)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "Content-Type": file.endsWith(".html") ? "text/html" : file.endsWith(".js") ? "text/javascript" : file.endsWith(".woff2") ? "font/woff2" : "application/octet-stream" }).end(data);
  });
});
await new Promise((r) => server.listen(HARNESS_PORT, "127.0.0.1", r));

// ---- a headless Edge with its own profile ----
const EDGE = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"].find((p) => fs.existsSync(p));
const profile = path.join("G:\\FILOW\\tmp", "excalidraw-edge");
const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, "--window-size=1400,1000", "--no-first-run", "--no-default-browser-check", "--disable-sync", "--disable-extensions", "--disable-background-networking", "--disable-component-update", "about:blank"], { stdio: "ignore" });
const stop = () => { try { execSync(`taskkill /PID ${edge.pid} /T /F`, { stdio: "ignore" }); } catch { /* gone */ } server.close(); };
process.on("exit", stop);
process.on("SIGINT", () => process.exit(130));

async function connect() {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${CDP}/json`)).json()).find((t) => t.type === "page"); } catch { /* starting */ }
    if (!target) await sleep(500);
  }
  if (!target) throw new Error("headless Edge did not start");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const call = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => (await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  return { call, evaluate };
}
const page = await connect();
await page.call("Page.enable");
await page.call("Emulation.setDeviceMetricsOverride", { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
async function go(url) {
  await page.call("Page.navigate", { url });
  for (let i = 0; i < 120; i++) { if ((await page.evaluate("document.readyState")) === "complete") return; await sleep(250); }
}
async function waitFor(expr, ms, every = 500) {
  const until = Date.now() + ms;
  for (;;) { const v = await page.evaluate(expr); if (v) return v; if (Date.now() > until) return null; await sleep(every); }
}
async function shoot(selector, file) {
  const rect = await page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({ block: "start" }); const r = e.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }; })()`);
  if (!rect) return false;
  const shot = await page.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { ...rect, scale: 1 } });
  fs.writeFileSync(file, Buffer.from(shot.result.data, "base64"));
  return true;
}

const metricsFile = path.join(OUT, "metrics.json");
const metrics = fs.existsSync(metricsFile) ? JSON.parse(fs.readFileSync(metricsFile, "utf8").replace(/^\uFEFF/, "")) : { round, model: "local (Ollama, the route's own choice)", concepts: {} };

// ---- the bar ----
if (!args.includes("--skip-bar")) {
  await go(`http://127.0.0.1:${HARNESS_PORT}/`);
  await waitFor("window.barReady === true", 30_000, 200);
  for (const [slug] of todo) {
    const file = path.join(BAR_SCENES, `${slug}.json`);
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, "utf8");
    await go(`http://127.0.0.1:${HARNESS_PORT}/`);
    await waitFor("window.barReady === true", 30_000, 200);
    const info = await page.evaluate(`window.renderBar(${raw}).then((r) => JSON.stringify(r))`);
    await sleep(900);
    await shoot("#host", path.join(OUT, "bar", `${slug}.png`));
    // the bar's elements as drawn, for the same code check
    const els = JSON.parse((await page.evaluate("JSON.stringify(window.lastEls ?? [])")) || "[]");
    const counts = countProblems(checkScene({ elements: els, files: {} }));
    metrics.concepts[slug] = { ...(metrics.concepts[slug] ?? {}), bar: { render: info ? JSON.parse(info) : null, checks: counts } };
    console.log(`bar ${slug}: ${info}`);
  }
}

// ---- ours: the real page, the local model ----
if (!args.includes("--skip-ours")) {
  await go(`${base}/okfilow/whiteboard?voice=off`);
  await page.evaluate(`localStorage.setItem("filow.whiteboard.look", "light"); true`);
  for (const [slug, question] of todo) {
    const started = Date.now();
    await go(`${base}/okfilow/whiteboard?voice=off&q=${encodeURIComponent(question)}`);
    const firstStroke = await waitFor(`document.querySelector("main")?.dataset.firstStrokeMs ?? null`, 60_000, 100);
    const done = await waitFor(`(() => { const m = document.querySelector("main"); return m && (m.dataset.player === "done" || m.dataset.phase === "error" || document.querySelector(".wb-alert")) ? m.dataset.phase : null; })()`, LESSON_TIMEOUT_MS, 1000);
    // the last look and its tidying
    await sleep(2500);
    const data = await page.evaluate(`JSON.stringify(document.querySelector("main")?.dataset ?? {})`);
    const d = JSON.parse(data || "{}");
    const shot = await shoot(".wb-ex", path.join(OUT, "ours", `${slug}.png`));
    const saved = await page.evaluate(`localStorage.getItem("filow.whiteboard.board")`);
    const source = await page.evaluate(`document.querySelector(".wb-chip")?.textContent ?? ""`);
    if (saved) fs.writeFileSync(path.join(OUT, "ours", `${slug}.json`), saved);
    const [overflow, overlap, crossing, offscreen] = (d.checks ?? "").split(",").map(Number);
    metrics.concepts[slug] = {
      ...(metrics.concepts[slug] ?? {}),
      ours: {
        question,
        source,
        ended: done,
        lessonSeconds: Math.round((Date.now() - started) / 1000),
        firstStrokeMs: d.firstStrokeMs ? Number(d.firstStrokeMs) : null,
        firstModelStrokeMs: d.firstModelStrokeMs ? Number(d.firstModelStrokeMs) : null,
        checksAfterFix: d.checks ? { overflow, overlap, crossing, offscreen } : null,
        fixed: d.fixed ? Number(d.fixed) : 0,
        vision: d.vision ?? null,
        photographed: shot,
      },
    };
    fs.writeFileSync(metricsFile, JSON.stringify(metrics, null, 2));
    console.log(`ours ${slug}: ${JSON.stringify(metrics.concepts[slug].ours)}`);
    void firstStroke;
  }
}
fs.writeFileSync(metricsFile, JSON.stringify(metrics, null, 2));
stop();
process.exit(0);
