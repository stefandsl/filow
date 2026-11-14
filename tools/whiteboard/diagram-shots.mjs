#!/usr/bin/env node
// Pictures and machine checks of saved lessons (tools/whiteboard/bench.mjs runs): each board of a
// lesson is drawn by Filow's own layout, scene and Excalidraw export in a headless Edge with its own
// profile (nothing on the desktop, nothing loaded from the internet), light and dark. Boards of one
// lesson are stacked into one picture. Writes <out>/t<NN>-light.png, t<NN>-dark.png and metrics.json.
//
// Usage: node tools/whiteboard/diagram-shots.mjs --run <bench run dir> --out <dir> [--cdp 9681] [--port 5083] [--profile <dir>]
import { spawn, execSync } from "node:child_process";
import { buildSync } from "esbuild";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import sharp from "sharp";

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..");
const RUN = path.resolve(arg("run", ""));
const OUT = path.resolve(arg("out", ""));
const CDP = Number(arg("cdp", "9681"));
const PORT = Number(arg("port", "5083"));
const PROFILE = path.resolve(arg("profile", path.join(OUT, "..", "edge-profile")));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!fs.existsSync(RUN) || !arg("out", "")) { console.error("usage: --run <bench run dir> --out <dir>"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

const work = path.join(OUT, ".harness");
fs.mkdirSync(work, { recursive: true });
buildSync({ entryPoints: [path.join(ROOT, "tools/whiteboard/diagram-harness.js")], bundle: true, format: "iife", platform: "browser", outfile: path.join(work, "bundle.js"), logLevel: "silent", alias: { "@": path.join(ROOT, "apps/web") }, define: { "process.env.NODE_ENV": '"production"', "process.env.IS_PREACT": '"false"' }, conditions: ["production"], loader: { ".woff2": "file", ".ttf": "file", ".css": "empty" } });
fs.writeFileSync(path.join(work, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><script>window.EXCALIDRAW_ASSET_PATH=location.origin+"/excalidraw/";</script></head><body><script src="/bundle.js"></script></body></html>`);
const fontsDir = path.join(ROOT, "node_modules/@excalidraw/excalidraw/dist/prod/fonts");
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const file = url.startsWith("/excalidraw/fonts/") ? path.join(fontsDir, url.slice("/excalidraw/fonts/".length)) : path.join(work, url === "/" ? "index.html" : url.slice(1));
  if (!file.startsWith(fontsDir) && !file.startsWith(work)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "Content-Type": file.endsWith(".html") ? "text/html" : file.endsWith(".js") ? "text/javascript" : file.endsWith(".woff2") ? "font/woff2" : "application/octet-stream" }).end(data);
  });
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const EDGE = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"].find((p) => fs.existsSync(p));
const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=${PROFILE}`, "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-sync", "--disable-extensions", "--disable-background-networking", "--disable-component-update", "about:blank"], { stdio: "ignore" });
const stop = () => { try { execSync(`taskkill /PID ${edge.pid} /T /F`, { stdio: "ignore" }); } catch { /* gone */ } server.close(); };
process.on("exit", stop);

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
const evaluate = async (expression) => { const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600)); return r.result?.result?.value; };
await call("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
for (let i = 0; i < 120 && !(await evaluate("window.harnessReady === true")); i++) await sleep(250);

const files = fs.readdirSync(RUN).filter((f) => /^lesson-\d+\.json$/.test(f)).sort((a, b) => parseInt(a.slice(7), 10) - parseInt(b.slice(7), 10));
const metrics = {};
const stack = async (b64s) => {
  const imgs = b64s.map((b) => Buffer.from(b, "base64"));
  if (imgs.length === 1) return imgs[0];
  const metas = await Promise.all(imgs.map((b) => sharp(b).metadata()));
  const width = Math.max(...metas.map((m) => m.width));
  let top = 0;
  const parts = imgs.map((input, k) => { const at = top; top += metas[k].height + 12; return { input, top: at, left: 0 }; });
  return sharp({ create: { width, height: top - 12, channels: 4, background: "#888888" } }).composite(parts).png().toBuffer();
};
for (const f of files) {
  const n = parseInt(f.slice(7), 10);
  const tag = `t${String(n).padStart(2, "0")}`;
  const r = JSON.parse(fs.readFileSync(path.join(RUN, f), "utf8"));
  if (!r.lesson) { metrics[tag] = { question: r.question, error: r.error ?? "no lesson" }; console.log(tag, "no lesson"); continue; }
  const pages = JSON.parse(await evaluate(`window.renderLesson(${JSON.stringify(r.lesson)})`));
  fs.writeFileSync(path.join(OUT, `${tag}-light.png`), await stack(pages.map((p) => p.light)));
  fs.writeFileSync(path.join(OUT, `${tag}-dark.png`), await stack(pages.map((p) => p.dark)));
  const sum = (k) => pages.reduce((a, p) => a + p[k], 0);
  metrics[tag] = { question: r.question, boards: pages.length, overlaps: sum("overlaps"), edgeCrossings: sum("edgeCrossings"), arrowThroughBox: sum("arrowThroughBox"), overflow: sum("overflow"), offscreen: sum("offscreen"), reopen: pages.every((p) => p.reopen), problems: pages.flatMap((p) => p.problems) };
  console.log(tag, JSON.stringify(metrics[tag]));
}
fs.writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify(metrics, null, 1));
ws.close();
process.exit(0);
