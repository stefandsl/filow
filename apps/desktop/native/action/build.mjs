// Builds Filow's Windows ActionDriver helper (filow-action.cs -> native/action/bin/filow-action.exe)
// using the .NET Framework 4 C# compiler (csc.exe) that ships with Windows. No SDK or downloads needed.
//   node apps/desktop/native/action/build.mjs [--out <folder>]
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };

export function frameworkDir(windir = process.env.SystemRoot || process.env.windir || "C:\\Windows", exists = fs.existsSync) {
  for (const bits of ["Framework64", "Framework"]) {
    const dir = path.join(windir, "Microsoft.NET", bits, "v4.0.30319");
    if (exists(path.join(dir, "csc.exe")) && exists(path.join(dir, "WPF", "UIAutomationClient.dll"))) return dir;
  }
  return "";
}

export function cscArgs(fw, source, out) {
  return [
    "/nologo", "/target:exe", "/platform:anycpu", "/optimize+", "/utf8output",
    `/out:${out}`,
    `/r:${path.join(fw, "System.Drawing.dll")}`,
    `/r:${path.join(fw, "System.Web.Extensions.dll")}`,
    `/r:${path.join(fw, "WPF", "UIAutomationClient.dll")}`,
    `/r:${path.join(fw, "WPF", "UIAutomationTypes.dll")}`,
    `/r:${path.join(fw, "WPF", "WindowsBase.dll")}`,
    source,
  ];
}

export function build({ outDir = path.join(here, "bin"), log = console.log } = {}) {
  if (process.platform !== "win32") {
    log("filow-action: not Windows, skipping native action helper build");
    return "";
  }
  const fw = frameworkDir();
  if (!fw) throw new Error("filow-action: no .NET Framework 4 C# compiler (csc.exe) found");
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, "filow-action.exe");
  fs.rmSync(out, { force: true });
  execFileSync(path.join(fw, "csc.exe"), cscArgs(fw, path.join(here, "filow-action.cs"), out), { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const run = spawnSync(out, [], { input: "quit\n", encoding: "utf8", timeout: 15_000, windowsHide: true });
  if (run.status !== 0 || !String(run.stdout).startsWith('{"ready":true}')) {
    throw new Error(`filow-action: built helper did not start (status ${run.status}, ${String(run.stdout).slice(0, 80)})`);
  }
  log(`filow-action: built ${out} (${fs.statSync(out).size} bytes)`);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build({ outDir: path.resolve(arg("--out", path.join(here, "bin"))) });
}
