// Builds Filow's dictation target helper for Windows (README.md in this folder). Run on Windows with the
// Visual Studio C++ build tools and Python installed:
//   node apps/desktop/native/target/build.mjs [--arch x64|arm64] [--work <folder>]
// The sources are copied to the work folder (default: tmp/target-build in the repository), built with
// node-gyp, and the result goes to prebuilds/win32-<arch>/filow-target.node next to this file.
// N-API: one binary serves Node and Electron.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const arch = arg("--arch", process.arch);
const work = path.resolve(arg("--work", path.join(root, "tmp", "target-build")));

if (process.platform !== "win32") throw new Error("This helper is for Windows only; run the build on Windows.");
const dir = path.join(work, `filow-target-${arch}`);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
for (const name of ["binding.gyp", "src"]) fs.cpSync(path.join(here, name), path.join(dir, name), { recursive: true });
fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "filow-target", version: "1.0.0", private: true }));

execFileSync("npx", ["--yes", "node-gyp@11", "rebuild", `--arch=${arch}`], { cwd: dir, stdio: "inherit", shell: true });

const out = path.join(here, "prebuilds", `win32-${arch}`);
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(dir, "build", "Release", "filow_target.node"), path.join(out, "filow-target.node"));
// The test compares this with the source, so a changed source without a rebuilt binary is noticed.
const sha = crypto.createHash("sha256").update(fs.readFileSync(path.join(here, "src", "target.cc"), "utf8").replace(/\r\n/g, "\n")).digest("hex");
const bin = crypto.createHash("sha256").update(fs.readFileSync(path.join(out, "filow-target.node"))).digest("hex");
fs.writeFileSync(path.join(out, "BUILT-FROM.txt"), `apps/desktop/native/target/src/target.cc sha256 ${sha}\nfilow-target.node sha256 ${bin}\n`);
console.log(`built ${path.join(out, "filow-target.node")}`);
