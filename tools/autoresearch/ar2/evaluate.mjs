// AR-2 FIXED evaluator: overlay pointer motion and model leader routes. The experimenting agent must never
// edit this file or qa.cjs. The one editable file is apps/web/lib/buddy/overlay-motion-params.ts.
// See ../program.md.
//
//   node tools/autoresearch/ar2/evaluate.mjs [--no-build] > run.log 2>&1
//
// Builds apps/web (production), starts its standalone server on 127.0.0.1:4961, runs the hidden Electron
// driver qa.cjs (offscreen windows, permissions denied, no desktop input, no network beyond 4961), then
// measures the rendered frames with the overlay round 2B numbers and prints one weighted score.
// No model, no paid call. Kills only the processes it started.
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const WORK = "G:/FILOW/tmp/autoresearch/ar2";
const PORT = 4961;
const BASE = `http://127.0.0.1:${PORT}`;
const KILL_MS = 10 * 60_000;

// ---- Measures (port of G:/FILOW/tmp/overlay-r2b/driver/analyze-rework4.py) ----
const dist = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
const orient = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
const seg = (a, b, c, d) => (orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0 ? 0 : Math.min(dist(a, c, d), dist(b, c, d), dist(c, a, b), dist(d, a, b)));
function clip(a, b, anchors, radius = 8) {
  const dx = b[0] - a[0], dy = b[1] - a[1], A = dx * dx + dy * dy;
  if (A < 1e-12) return [];
  let ranges = [[0, 1]];
  for (const p of anchors) {
    const B = 2 * ((a[0] - p[0]) * dx + (a[1] - p[1]) * dy), C = (a[0] - p[0]) ** 2 + (a[1] - p[1]) ** 2 - radius ** 2, D = B * B - 4 * A * C;
    if (D <= 0) continue;
    const lo = (-B - Math.sqrt(D)) / (2 * A), hi = (-B + Math.sqrt(D)) / (2 * A), out = [];
    for (const [l, h] of ranges) { if (hi <= l || lo >= h) out.push([l, h]); else { if (lo > l) out.push([l, lo]); if (hi < h) out.push([hi, h]); } }
    ranges = out;
  }
  return ranges.map(([l, h]) => [[a[0] + dx * l, a[1] + dy * l], [a[0] + dx * h, a[1] + dy * h]]);
}
export function measure(lines) {
  let crossings = 0, clearance = Infinity;
  for (let i = 0; i < lines.length; i++) for (const q of lines.slice(i + 1)) {
    const p = lines[i]; let ds = Infinity, cs = Infinity;
    for (let s = 0; s + 1 < p.length; s++) for (let u = 0; u + 1 < q.length; u++) {
      ds = Math.min(ds, seg(p[s], p[s + 1], q[u], q[u + 1]));
      for (const [a, b] of clip(p[s], p[s + 1], [p[0], q[0]])) for (const [c, d] of clip(q[u], q[u + 1], [p[0], q[0]])) cs = Math.min(cs, seg(a, b, c, d));
    }
    if (ds < 1e-6) crossings++;
    clearance = Math.min(clearance, cs);
  }
  return { crossings, clearance };
}
// Oracle sanity checks, as in the round 2B analyser: crossing, touching bend, collinear run, separated lines.
if (measure([[[0, 0], [20, 20]], [[0, 20], [20, 0]]]).crossings !== 1) throw Error("oracle: crossing");
if (measure([[[0, 0], [10, 10], [20, 0]], [[0, 10], [20, 10]]]).crossings !== 1) throw Error("oracle: touching bend");
if (measure([[[0, 0], [20, 0]], [[5, 0], [15, 0]]]).crossings !== 1) throw Error("oracle: collinear");
if (Math.abs(measure([[[0, 0], [100, 0]], [[0, 12], [100, 12]]]).clearance - 12) > 1e-6) throw Error("oracle: clearance");

const area = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
function reversals(path, axis) {
  let direction = 0, extreme = path[0][axis], n = 0;
  for (const point of path.slice(1)) {
    const x = point[axis];
    if (direction === 0) { if (Math.abs(x - extreme) > 1) { direction = x > extreme ? 1 : -1; extreme = x; } }
    else if ((x - extreme) * direction >= 0) extreme = x;
    else if (Math.abs(x - extreme) > 1) { n++; direction = -direction; extreme = x; }
  }
  return n;
}
export function sceneNumbers(s) {
  const fs_ = s.frames;
  if (s.scene === "model") {
    const ms = fs_.filter(f => f.lines.length).map(f => measure(f.lines));
    const labelOverlaps = Math.max(0, ...fs_.map(f => { let n = 0; f.labels.forEach((a, i) => f.labels.slice(i + 1).forEach(b => { n += area(a, b) > 0; })); return n; }));
    const first = fs_.find(f => f.identities.length)?.identities ?? [];
    const identityChanges = fs_.reduce((sum, f) => sum + f.identities.reduce((k, id, i) => k + (JSON.stringify(id) !== JSON.stringify(first[i])), 0), 0);
    return { frames: fs_.length, poses: new Set(fs_.filter(f => Number.isInteger(f.pose)).map(f => f.pose)).size,
      crossingsMax: Math.max(0, ...ms.map(m => m.crossings)), clearanceMin: Math.min(...ms.map(m => m.clearance)), labelOverlaps, identityChanges };
  }
  const p = fs_.filter(f => f.tip);
  const steps = p.slice(1).map((f, i) => Math.hypot(f.tip[0] - p[i].tip[0], f.tip[1] - p[i].tip[1]));
  const moving = steps.map((d, i) => [d, i]).filter(([d]) => d > 0.01).map(([, i]) => i);
  if (!moving.length) throw Error("the pointer never moved");
  const flight = p.slice(moving[0], moving.at(-1) + 2), route = flight.map(f => f.tip);
  const length = route.slice(1).reduce((sum, q, i) => sum + Math.hypot(q[0] - route[i][0], q[1] - route[i][1]), 0);
  const straight = Math.hypot(route.at(-1)[0] - route[0][0], route.at(-1)[1] - route[0][1]);
  const glyph = f => ({ left: f.tip[0], top: f.tip[1], right: f.tip[0] + 17 * 36 / 23, bottom: f.tip[1] + 18 * 36 / 23 });
  const textOverlap = Math.max(0, ...p.map(f => [glyph(f), f.pill].filter(Boolean).reduce((sum, r) => sum + s.avoid.reduce((k, t) => k + area(r, t), 0), 0)));
  const end = route.at(-1);
  const rings = fs_.filter(f => f.ring && f.ring.opacity === 1).map(f => f.ring.rect);
  const ringOffset = rings.length ? Math.max(...rings.map(r => Math.hypot((r.left + r.right) / 2 - end[0], (r.top + r.bottom) / 2 - end[1]))) : Infinity;
  return { frames: fs_.length, reversals: reversals(route, 0) + reversals(route, 1), pathRatio: length / straight, maxStep: Math.max(...steps),
    flightMs: flight.at(-1).t - flight[0].t, textOverlap, ringOffset };
}
// One weighted score, 0..100, higher is better. Worst case over the dark and light themes.
export const WEIGHTS = { crossings: 25, clearance: 15, labelOverlaps: 10, identity: 10, textOverlap: 10, maxStep: 10, flight: 5, reversals: 5, pathRatio: 5, ring: 5 };
const clamp01 = x => Math.max(0, Math.min(1, x));
export function scoreOf(m) {
  const part = {
    crossings: 1 / (1 + m.crossingsMax), clearance: clamp01(m.clearanceMin / 14), labelOverlaps: 1 / (1 + m.labelOverlaps),
    identity: 1 / (1 + m.identityChanges), textOverlap: 1 / (1 + m.textOverlap / 100), maxStep: clamp01(1 - (m.maxStep - 10) / 40),
    flight: clamp01((1000 - m.flightMs) / 400), reversals: 1 / (1 + m.reversals), pathRatio: clamp01(1 - (m.pathRatio - 1) / 0.5), ring: clamp01(1 - m.ringOffset / 8),
  };
  return { part, score: Object.entries(WEIGHTS).reduce((sum, [k, w]) => sum + w * part[k], 0) };
}
export function worst(scenes) {
  const nums = scenes.map(s => ({ ...sceneNumbers(s), scene: s.scene, theme: s.theme }));
  const model = nums.filter(n => n.scene === "model"), pointer = nums.filter(n => n.scene === "pointer");
  const max = (xs, k) => Math.max(...xs.map(x => x[k])), min = (xs, k) => Math.min(...xs.map(x => x[k]));
  return { nums, m: { crossingsMax: max(model, "crossingsMax"), clearanceMin: min(model, "clearanceMin"), labelOverlaps: max(model, "labelOverlaps"),
    identityChanges: max(model, "identityChanges"), textOverlap: max(pointer, "textOverlap"), maxStep: max(pointer, "maxStep"), flightMs: max(pointer, "flightMs"),
    reversals: max(pointer, "reversals"), pathRatio: max(pointer, "pathRatio"), ringOffset: max(pointer, "ringOffset") } };
}

async function portFree(port) {
  const s = createServer();
  try { await new Promise((ok, no) => { s.once("error", no); s.listen(port, "127.0.0.1", ok); }); return true; } catch { return false; } finally { await new Promise(r => s.close(() => r())); }
}
const killTree = pid => { if (pid) { try { execFileSync("taskkill.exe", ["/pid", String(pid), "/t", "/f"], { windowsHide: true, timeout: 15000, stdio: "ignore" }); } catch { /* exited */ } } };
const run = (cmd, args, opts, ms) => new Promise(resolve => {
  const p = spawn(cmd, args, { windowsHide: true, ...opts });
  const timer = setTimeout(() => { killTree(p.pid); resolve(-1); }, ms);
  p.once("error", () => { clearTimeout(timer); resolve(-2); });
  p.once("exit", code => { clearTimeout(timer); resolve(code); });
});

async function main() {
  const started = Date.now();
  const noBuild = process.argv.includes("--no-build");
  for (const d of ["runs", "tmp", "profile", "logs"]) fs.mkdirSync(`${WORK}/${d}`, { recursive: true });
  const commit = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = `${WORK}/runs/${stamp}-${commit}.json`;
  const env = { ...process.env, TEMP: `${WORK}/tmp`, TMP: `${WORK}/tmp`, NEXT_TELEMETRY_DISABLED: "1", FILOW_OFFLINE: "1",
    OPENROUTER_API_KEY: "", OPENAI_API_KEY: "", FREELLMAPI_API_KEY: "", OLLAMA_URL: "http://127.0.0.1:4965", PORT: String(PORT), HOSTNAME: "127.0.0.1",
    AR2_WORK: WORK, AR2_OUT: out, AR2_REPO: REPO, AR2_BASE: BASE };
  delete env.ELECTRON_RUN_AS_NODE;
  const log = fs.openSync(`${WORK}/logs/${stamp}-${commit}.log`, "w");
  let crashed = null, server = null, buildSeconds = 0;
  const deadline = setTimeout(() => { crashed = "time budget exceeded"; killTree(server?.pid); }, KILL_MS);
  try {
    if (!(await portFree(PORT))) throw Error(`port ${PORT} is busy`);
    if (!noBuild) {
      const b = Date.now();
      // The steps of apps/web's "build" script, run directly so no shell is needed.
      for (const step of [["../../scripts/copy-ort.js"], [path.join(REPO, "node_modules/next/dist/bin/next"), "build"], ["../../scripts/prepare-standalone.js"]]) {
        const code = await run(process.execPath, step, { cwd: path.join(REPO, "apps/web"), env, stdio: ["ignore", log, log] }, KILL_MS);
        if (code !== 0) throw Error(`web build step ${path.basename(step[0])} exit ${code}`);
      }
      buildSeconds = (Date.now() - b) / 1000;
    }
    const standalone = path.join(REPO, "apps/web/.next/standalone/apps/web");
    server = spawn(process.execPath, [path.join(standalone, "server.js")], { cwd: standalone, env, windowsHide: true, stdio: ["ignore", log, log] });
    server.once("error", e => { crashed ??= `web server: ${e.message}`; });
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) { try { ready = (await fetch(`${BASE}/okfilow/overlay`, { signal: AbortSignal.timeout(1000) })).ok; } catch { await new Promise(r => setTimeout(r, 500)); } }
    if (!ready) throw Error("web server did not start");
    const code = await run(path.join(REPO, "node_modules/electron/dist/electron.exe"), [path.join(HERE, "qa.cjs")], { cwd: REPO, env, stdio: ["ignore", log, log] }, 4 * 60_000);
    if (code !== 0) throw Error(`driver exit ${code}`);
  } catch (e) { crashed ??= e.message; } finally { clearTimeout(deadline); killTree(server?.pid); fs.closeSync(log); }
  let result = null;
  if (!crashed) {
    try {
      const w = worst(JSON.parse(fs.readFileSync(out, "utf8")).scenes);
      result = { ...w, ...scoreOf(w.m) };
      if (w.nums.some(n => n.scene === "model" && n.poses !== 24)) crashed = "model poses missing";
    } catch (e) { crashed = `measure: ${e.message}`; }
  }
  console.log("---");
  console.log(`status:        ${crashed ? "crash" : "ok"}${crashed ? `\nreason:        ${crashed}` : ""}`);
  console.log(`score:         ${crashed ? "0.00" : result.score.toFixed(2)}`);
  if (result) {
    const m = result.m;
    console.log(`crossings_max: ${m.crossingsMax}`);
    console.log(`clearance_px:  ${m.clearanceMin.toFixed(3)} (lane spacing outside 8 px anchor discs)`);
    console.log(`label_overlap: ${m.labelOverlaps}`);
    console.log(`identity_chg:  ${m.identityChanges}`);
    console.log(`text_overlap:  ${m.textOverlap.toFixed(1)} px2`);
    console.log(`max_step_px:   ${m.maxStep.toFixed(3)}`);
    console.log(`flight_ms:     ${m.flightMs.toFixed(1)}`);
    console.log(`reversals:     ${m.reversals}`);
    console.log(`path_ratio:    ${m.pathRatio.toFixed(4)}`);
    console.log(`ring_offset:   ${m.ringOffset.toFixed(2)} px`);
    console.log(`parts:         ${Object.entries(result.part).map(([k, v]) => `${k} ${v.toFixed(3)}`).join(", ")}`);
  }
  console.log(`build_seconds: ${buildSeconds.toFixed(0)}`);
  console.log(`seconds:       ${((Date.now() - started) / 1000).toFixed(1)}`);
  console.log(`commit:        ${commit}`);
  console.log(`raw:           ${out}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
