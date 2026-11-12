// Builds OK Filow's screen names helper (okfilow-uia.cs next to this file) for the Windows package, with
// the C# compiler of the .NET Framework that ships with every Windows 10 and 11 (csc.exe): no SDK and
// nothing downloaded. The result, native/uia/bin/okfilow-uia.exe (about 15 KB, any CPU), is not kept in
// git; `npm run vendor` runs this before every build, and after-pack.js stops a Windows package without it.
//   node apps/desktop/native/uia/build.mjs [--out <folder>]
// Off Windows it does nothing: macOS and Linux point from the model's own coordinates.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };

/** The .NET Framework 4 folder that holds csc.exe and the assemblies the helper uses, or "" when there is none. */
export function frameworkDir(windir = process.env.SystemRoot || process.env.windir || "C:\\Windows", exists = fs.existsSync) {
  for (const bits of ["Framework64", "Framework"]) {
    const dir = path.join(windir, "Microsoft.NET", bits, "v4.0.30319");
    if (exists(path.join(dir, "csc.exe")) && exists(path.join(dir, "WPF", "UIAutomationClient.dll"))) return dir;
  }
  return "";
}

/** The compiler's arguments: a console program for any CPU, referencing UI Automation and MSAA only. */
export function cscArgs(fw, source, out) {
  return [
    "/nologo", "/target:exe", "/platform:anycpu", "/optimize+", "/utf8output",
    `/out:${out}`,
    `/r:${path.join(fw, "WPF", "UIAutomationClient.dll")}`,
    `/r:${path.join(fw, "WPF", "UIAutomationTypes.dll")}`,
    `/r:${path.join(fw, "WPF", "WindowsBase.dll")}`,
    `/r:${path.join(fw, "Accessibility.dll")}`,
    source,
  ];
}

export function build({ outDir = path.join(here, "bin"), log = console.log } = {}) {
  if (process.platform !== "win32") {
    log("okfilow-uia: not Windows, nothing to build (pointing uses the model's coordinates there)");
    return "";
  }
  const fw = frameworkDir();
  if (!fw) throw new Error("okfilow-uia: no .NET Framework 4 C# compiler (Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe) on this PC");
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, "okfilow-uia.exe");
  fs.rmSync(out, { force: true });
  execFileSync(path.join(fw, "csc.exe"), cscArgs(fw, path.join(here, "okfilow-uia.cs"), out), { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  // It must start and say it is ready, then end on "quit": a helper that cannot is not shipped.
  const run = spawnSync(out, [], { input: "quit\n", encoding: "utf8", timeout: 15_000, windowsHide: true });
  if (run.status !== 0 || !String(run.stdout).startsWith('{"ready":true}')) throw new Error(`okfilow-uia: the built helper did not start (status ${run.status}, ${String(run.stdout).slice(0, 80)})`);
  log(`okfilow-uia: built ${out} (${fs.statSync(out).size} bytes)`);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) build({ outDir: path.resolve(arg("--out", path.join(here, "bin"))) });
