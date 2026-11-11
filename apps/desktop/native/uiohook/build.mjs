// Rebuilds the Windows binary of uiohook-napi with Filow's one change (see README.md in this folder):
// when Windows refuses the low-level hooks for the library's own DLL (error 126), register them for the
// program itself. Run on Windows with the Visual Studio C++ build tools and Python installed:
//   node apps/desktop/native/uiohook/build.mjs [--arch x64|arm64] [--work <folder>]
// It copies the library's sources from node_modules to the work folder (default: tmp/uiohook-build in the
// repository), applies the change, builds with node-gyp and puts the result in
// prebuilds/win32-<arch>/uiohook-napi.node next to this file. N-API: one binary serves Node and Electron.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { patchInputHook } from "./patch.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const arch = arg("--arch", process.arch);
const work = path.resolve(arg("--work", path.join(root, "tmp", "uiohook-build")));
const source = path.join(root, "node_modules", "uiohook-napi");

if (process.platform !== "win32") throw new Error("The patched binary is for Windows only; run this on Windows.");
const version = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8")).version;
const dir = path.join(work, `uiohook-napi-${version}-${arch}`);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
for (const name of ["binding.gyp", "package.json", "LICENSE", "src", "libuiohook"]) fs.cpSync(path.join(source, name), path.join(dir, name), { recursive: true });

const file = path.join(dir, "libuiohook", "src", "windows", "input_hook.c");
fs.writeFileSync(file, patchInputHook(fs.readFileSync(file, "utf8")));

execFileSync("npx", ["--yes", "node-gyp@11", "rebuild", `--arch=${arch}`], { cwd: dir, stdio: "inherit", shell: true });

const out = path.join(here, "prebuilds", `win32-${arch}`);
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(dir, "build", "Release", "uiohook_napi.node"), path.join(out, "uiohook-napi.node"));
fs.writeFileSync(path.join(here, "prebuilds", `win32-${arch}`, "BUILT-FROM.txt"), `uiohook-napi ${version} + Filow patch (apps/desktop/native/uiohook/patch.mjs)\n`);
console.log(`built ${path.join(out, "uiohook-napi.node")} from uiohook-napi ${version}`);
