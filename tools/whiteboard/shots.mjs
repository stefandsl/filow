#!/usr/bin/env node
// Pictures of finished lessons, so the drawing quality can be judged at a glance: for each
// lesson-<n>.json of a bench run (tools/whiteboard/bench.mjs) the final board is drawn by the real
// whiteboard page in the packaged app, in the light theme, and saved as a PNG; then one contact
// sheet of all of them. No model is called: the app is pointed at the fake model server and the
// saved lesson is handed to the page (it validates it like any model output).
//
// Usage: node tools/whiteboard/shots.mjs <path\to\win-unpacked> <bench run dir> <out dir>
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { NO_PUBLIC_LINK, seedProfile } from "../autoloop/e2e/profile.mjs";
import { startFakeModel } from "./fake-model.mjs";

const [exeDir, runDir, outDir] = process.argv.slice(2);
if (!exeDir || !runDir || !outDir || !fs.existsSync(path.join(exeDir, "Filow.exe"))) {
  console.error("usage: node tools/whiteboard/shots.mjs <path to win-unpacked> <bench run dir> <out dir>");
  process.exit(2);
}
const PORT = Number(process.env.FILOW_E2E_PORT || 4811);
const SESSION = Number(process.env.FILOW_E2E_SESSION_PORT || 4813);
const DEVTOOLS = Number(process.env.FILOW_E2E_DEVTOOLS || 9392);
const FAKE = Number(process.env.FILOW_E2E_FAKE_PORT || 4812);
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const lessons = fs.readdirSync(runDir).filter((f) => /^lesson-\d+\.json$/.test(f)).sort((a, b) => parseInt(a.slice(7), 10) - parseInt(b.slice(7), 10))
  .map((f) => ({ n: parseInt(f.slice(7), 10), ...JSON.parse(fs.readFileSync(path.join(runDir, f), "utf8")) })).filter((r) => r.lesson);
if (!lessons.length) { console.error(`no lessons in ${runDir}`); process.exit(2); }

const fake = await startFakeModel(FAKE);
const profile = seedProfile(path.join(outDir, "profile"), { ...NO_PUBLIC_LINK, okFilow: { enabled: true, voice: "off" } });
const app = spawn(path.join(exeDir, "Filow.exe"), [`--remote-debugging-port=${DEVTOOLS}`], {
  env: { ...process.env, FILOW_USER_DATA_DIR: profile, FILOW_PORT: String(PORT), FILOW_SESSION_PORT: String(SESSION), OLLAMA_URL: `http://127.0.0.1:${FAKE}`, BUDDY_LOCAL_MODEL: "fake-local", FILOW_OFFLINE: "1" },
  stdio: "ignore",
});
const stop = () => { try { execSync(`taskkill /PID ${app.pid} /T /F`, { stdio: "ignore" }); } catch { /* gone */ } };
process.on("exit", stop);

const targets = async () => { try { return await (await fetch(`http://127.0.0.1:${DEVTOOLS}/json`)).json(); } catch { return []; } };
async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const call = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => (await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  return { call, evaluate, close: () => ws.close() };
}
async function waitFor(fn, ms, every = 400) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) return null;
    await sleep(every);
  }
}

const saved = [];
try {
  const helper = await waitFor(async () => (await targets()).find((t) => t.type === "page" && t.url.startsWith(`http://127.0.0.1:${PORT}/okfilow/`)), 150_000, 2000);
  if (!helper) throw new Error("the app did not come up");
  const okf = await connect(helper);
  await waitFor(() => okf.evaluate("typeof window.okFilow?.showWhiteboard === 'function'"), 20_000);
  await okf.evaluate('window.okFilow.showWhiteboard(""); true');
  const boardTarget = await waitFor(async () => (await targets()).find((t) => t.type === "page" && t.url.includes("/okfilow/whiteboard")), 30_000);
  if (!boardTarget) throw new Error("the whiteboard window did not open");
  okf.close();
  const page = await connect(boardTarget);
  await page.call("Page.enable");
  await page.call("Emulation.setDeviceMetricsOverride", { width: 1264, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const item of lessons) {
    await page.evaluate(`window.sessionStorage.setItem("filow.whiteboard.replay", ${JSON.stringify(JSON.stringify(item.lesson))}); window.location.reload(); true`);
    const last = item.lesson.steps.length - 1;
    const shown = await waitFor(() => page.evaluate(`(() => { const svg = document.querySelector("svg.wb-board"); return svg && Number(svg.dataset.step) === ${last} ? true : false; })()`), 30_000, 300);
    if (!shown) { console.log(`lesson ${item.n}: the board did not reach its last step`); continue; }
    await page.evaluate('document.documentElement.dataset.theme = "light"; true');
    await sleep(2200); // strokes finish drawing, formulas are set
    const clip = await page.evaluate('(() => { const r = document.querySelector("svg.wb-board").getBoundingClientRect(); return { x: r.x, y: r.y + window.scrollY, width: r.width, height: r.height, scale: 1 }; })()');
    const shot = await page.call("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true });
    if (!shot.result?.data) { console.log(`lesson ${item.n}: no picture`); continue; }
    const file = path.join(outDir, `lesson-${String(item.n).padStart(2, "0")}.png`);
    fs.writeFileSync(file, Buffer.from(shot.result.data, "base64"));
    saved.push({ file, title: item.question });
    console.log(`lesson ${item.n}: ${file}`);
  }
  page.close();
} finally {
  stop();
  await fake.stop();
}

// The contact sheet: every board at the same width, five to a row.
if (saved.length) {
  const cell = { w: 620, h: 372, gap: 14 };
  const cols = Math.min(5, saved.length);
  const rows = Math.ceil(saved.length / cols);
  const tiles = await Promise.all(saved.map(async (s, i) => ({
    input: await sharp(s.file).resize(cell.w, cell.h, { fit: "contain", background: "#ffffff" }).png().toBuffer(),
    left: cell.gap + (i % cols) * (cell.w + cell.gap),
    top: cell.gap + Math.floor(i / cols) * (cell.h + cell.gap),
  })));
  const sheet = path.join(outDir, "contact-sheet.png");
  await sharp({ create: { width: cell.gap + cols * (cell.w + cell.gap), height: cell.gap + rows * (cell.h + cell.gap), channels: 3, background: "#d9dde3" } }).composite(tiles).png().toFile(sheet);
  console.log(`contact sheet: ${sheet}`);
}
console.log(`${saved.length} of ${lessons.length} boards saved in ${outDir}`);
process.exit(saved.length === lessons.length ? 0 : 1);
