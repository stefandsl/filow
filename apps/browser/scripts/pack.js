// After `vite build`: bundle the content script as one classic IIFE (content scripts cannot be
// ES modules with shared chunks), copy the manifest and icon, and zip dist/ per browser family.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const dist = path.join(root, "dist");
const esbuild = path.join(root, "..", "..", "node_modules", ".bin", process.platform === "win32" ? "esbuild.cmd" : "esbuild");

fs.mkdirSync(dist, { recursive: true });
execFileSync(esbuild, ["src/content.ts", "--bundle", "--format=iife", "--target=es2022", "--outfile=dist/content.js"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
manifest.version = require(path.join(root, "package.json")).version;
fs.writeFileSync(path.join(dist, "manifest.json"), JSON.stringify(manifest, null, 2));
fs.cpSync(path.join(root, "icons"), path.join(dist, "icons"), { recursive: true });

// Chromium family: one zip. Firefox: same files, manifest without the Chrome-only "side_panel" key
// (Firefox warns on unknown keys but loads; keeping both keys in one zip is fine for unpacked use).
const zips = path.join(root, "..", "..", "release");
fs.mkdirSync(zips, { recursive: true });
const name = `Filow-extension-${manifest.version}`;
try {
  if (process.platform === "win32") {
    execFileSync("powershell.exe", ["-NoProfile", "-Command", `Compress-Archive -Path '${dist}\\*' -DestinationPath '${path.join(zips, name)}.zip' -Force`], { stdio: "inherit" });
  } else {
    execFileSync("zip", ["-qr", path.join(zips, `${name}.zip`), "."], { cwd: dist, stdio: "inherit" });
  }
  console.log(`packed release/${name}.zip`);
} catch (err) {
  console.warn("zip skipped:", err.message);
}
