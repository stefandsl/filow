// SUP-03: every production dependency has a license compatible with GPL-3.0-or-later, and the packaged
// app ships THIRD_PARTY_NOTICES.md. Reads the CycloneDX SBOM (npm run sbom -> tmp/sbom.cdx.json; it is
// regenerated when missing or older than 24 h). Usage: node licenses.mjs [sbom.json] (a path lets a
// mutated SBOM prove the check can fail).
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// MIT-0 (MIT without the attribution clause, nodemailer in apps/cloud) is as permissive as MIT, so GPL-compatible.
const ALLOWED = new Set(["MIT", "MIT-0", "ISC", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "Apache-2.0", "MPL-2.0", "Zlib", "CC0-1.0",
  "CC-BY-4.0", "Unlicense", "Python-2.0", "BlueOak-1.0.0", "LGPL-2.1-or-later", "LGPL-3.0-or-later", "GPL-3.0-or-later", "GPL-3.0-only"]);
// Packages whose package.json names no license although they ship one: the license file was read by a person.
// Pinned to the version that was read, so a new version is checked again.
const READ_FROM_FILE = new Map([["khroma@2.1.0", "MIT"]]); // node_modules/khroma/license, via mermaid in @excalidraw/excalidraw
const sbomPath = process.argv[2] || "tmp/sbom.cdx.json";
if (!process.argv[2] && (!fs.existsSync(sbomPath) || Date.now() - fs.statSync(sbomPath).mtimeMs > 24 * 3.6e6)) {
  execSync("npm run sbom --silent", { stdio: "ignore" });
}
const sbom = JSON.parse(fs.readFileSync(sbomPath, "utf8"));
const bad = [];
const ok = (expr) => {
  // "(MIT OR GPL-3.0-or-later)": one allowed option is enough; "A AND B": every part must be allowed.
  const e = expr.replace(/[()]/g, "").trim();
  if (/ OR /.test(e)) return e.split(/ OR /).some((x) => ok(x));
  if (/ AND /.test(e)) return e.split(/ AND /).every((x) => ok(x));
  return ALLOWED.has(e.trim());
};
const walk = (arr) => {
  for (const c of arr || []) {
    const listed = (c.licenses || []).map((l) => l.license?.id || l.license?.name || l.expression).filter(Boolean);
    const ls = listed.length ? listed : [READ_FROM_FILE.get(`${c.name}@${c.version}`)].filter(Boolean);
    if (!ls.length || !ls.every(ok)) bad.push(`${c.name}@${c.version}: ${ls.join(" | ") || "no license"}`);
    walk(c.components);
  }
};
walk(sbom.components);

const builds = fs.readdirSync(".").filter((d) => /^release-autoloop/.test(d) && fs.existsSync(path.join(d, "win-unpacked", "Filow.exe")));
builds.sort((a, b) => fs.statSync(path.join(b, "win-unpacked", "Filow.exe")).mtimeMs - fs.statSync(path.join(a, "win-unpacked", "Filow.exe")).mtimeMs);
const notices = builds[0] && path.join(builds[0], "win-unpacked", "resources", "THIRD_PARTY_NOTICES.md");
if (!notices || !fs.existsSync(notices)) bad.push(`THIRD_PARTY_NOTICES.md missing from ${builds[0] || "the packaged build"}`);

console.log(`${bad.length} license problems`);
if (bad.length) { console.log(bad.slice(0, 30).join("\n")); process.exit(1); }
