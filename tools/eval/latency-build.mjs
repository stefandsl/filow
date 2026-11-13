#!/usr/bin/env node
// Builds the speed baseline's QA package (design note section 5): from a clean tree, the root build, then the
// Windows package with the QA marker and the source sha in the app's package.json, into
// G:\FILOW\tmp\latency\build-<sha7>, and build-info.json beside win-unpacked (latency.mjs refuses anything else).
// Usage: node tools/eval/latency-build.mjs
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..");
const LAT = "G:\\FILOW\\tmp\\latency";
const git = (...args) => execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8" }).trim();

if (git("status", "--porcelain")) { console.error("latency-build: the tree is not clean; commit first"); process.exit(2); }
const sha = git("rev-parse", "HEAD");
const out = path.join(LAT, `build-${sha.slice(0, 7)}`);
const env = {
  ...process.env,
  npm_config_cache: "G:/caches/npm", ELECTRON_CACHE: "G:/caches/electron", ELECTRON_BUILDER_CACHE: "G:\\caches\\electron-builder",
  TEMP: path.join(LAT, "tmp"), TMP: path.join(LAT, "tmp"),
};
fs.mkdirSync(env.TEMP, { recursive: true });
const run = (cmd) => { console.log(`latency-build: ${cmd}`); execSync(cmd, { cwd: ROOT, env, stdio: "inherit" }); };
run("npm run build");
// predist:win runs `vendor` first
run(`npm run dist:win -w apps/desktop -- -c.extraMetadata.filowQa=true -c.extraMetadata.sourceSha=${sha} -c.directories.output=${out}`);
if (!fs.existsSync(path.join(out, "win-unpacked", "Filow.exe"))) { console.error("latency-build: no win-unpacked\\Filow.exe"); process.exit(1); }
fs.writeFileSync(path.join(out, "build-info.json"), JSON.stringify({ sha, filowQa: true, builtAt: new Date().toISOString(), node: process.version }, null, 2));
// the build may touch tracked files (licence texts): put them back so the tree stays clean
try { git("checkout", "--", "apps/desktop/build/license_en.txt", "apps/desktop/build/license_it.txt"); } catch { /* not touched */ }
console.log(`latency-build: ${path.join(out, "win-unpacked")}`);
