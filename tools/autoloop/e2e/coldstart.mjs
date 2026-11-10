#!/usr/bin/env node
// PERF-01 (docs/autoloop/STANDARDS.md): cold start of the packaged app. Launches it N times on its own
// profile and ports and measures, from process spawn, when startup.log says "splash shown" and "main
// window shown". Writes tmp/autoloop/coldstart.json (median and p95). Budget: splash <= 0.5 s,
// main window <= 3 s at the median, on this PC.
//
// Usage: node tools/autoloop/e2e/coldstart.mjs [win-unpacked dir] [runs=5]
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { seedProfile } from "./profile.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../../..");
function newestBuild() {
  const dirs = fs.readdirSync(ROOT).filter((d) => /^release-autoloop/.test(d) && fs.existsSync(path.join(ROOT, d, "win-unpacked", "Filow.exe")));
  dirs.sort((a, b) => fs.statSync(path.join(ROOT, b, "win-unpacked", "Filow.exe")).mtimeMs - fs.statSync(path.join(ROOT, a, "win-unpacked", "Filow.exe")).mtimeMs);
  return path.join(ROOT, dirs[0], "win-unpacked");
}
const exeDir = process.argv[2] || newestBuild();
const runs = Number(process.argv[3] || 5);
// Ports can be moved when another session is using the defaults (FILOW_E2E_PORT).
const PORT = Number(process.env.FILOW_E2E_PORT || 4787);
const profile = seedProfile(ROOT);
const log = path.join(profile, "startup.log");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

const splash = [], main = []; let invalid = 0;
for (let i = 0; i < runs; i++) {
  fs.writeFileSync(log, "");
  const t0 = Date.now();
  const app = spawn(path.join(exeDir, "Filow.exe"), [], {
    env: { ...process.env, FILOW_USER_DATA_DIR: profile, FILOW_PORT: String(PORT), FILOW_SESSION_PORT: String(PORT + 1) }, stdio: "ignore",
  });
  let s = null, m = null;
  for (let w = 0; w < 120 && m == null; w++) {
    await sleep(250);
    const text = fs.readFileSync(log, "utf8");
    const at = (needle) => { const line = text.split("\n").find((l) => l.includes(needle)); return line ? Date.parse(line.slice(0, 24)) - t0 : null; };
    s = s ?? at("splash shown");
    m = at("main window shown");
    // A start that failed sits behind an error box: stop the whole run with the reason.
    const failed = text.split(/\r?\n/).find((l) => l.includes("startup failed"));
    if (failed) {
      try { execSync(`taskkill /PID ${app.pid} /T /F`, { stdio: "ignore" }); } catch { /* gone */ }
      console.error("the app failed to start: " + failed.slice(25, 400));
      process.exit(2);
    }
  }
  try { execSync(`taskkill /PID ${app.pid} /T /F`, { stdio: "ignore" }); } catch { /* gone */ }
  await sleep(3000);
  // Every run counts. The window no longer waits for the public link (owner decision D2), so a link
  // that failed is a start like any other: the rule that left such runs out hid a 2.5 s freeze in
  // exactly that case (2026-11-10). The count is kept as information.
  const tunnelFailed = /public link: error/.test(fs.readFileSync(log, "utf8"));
  if (s != null) splash.push(s);
  if (m != null) main.push(m);
  if (tunnelFailed) invalid++;
  console.log(`run ${i + 1}: splash ${s} ms, main window ${m} ms${tunnelFailed ? " (public link failed)" : ""}`);
}
const out = {
  at: new Date().toISOString(), build: exeDir, runs, linkFailedRuns: invalid,
  splashMedian: splash.length ? pct(splash, 0.5) : null, mainMedian: main.length ? pct(main, 0.5) : null,
  mainP95: main.length ? pct(main, 0.95) : null, splash, main,
};
fs.writeFileSync(path.join(ROOT, "tmp", "autoloop", "coldstart.json"), JSON.stringify(out, null, 2));
console.log(`splash median ${out.splashMedian} ms, main window median ${out.mainMedian} ms, p95 ${out.mainP95} ms`);
