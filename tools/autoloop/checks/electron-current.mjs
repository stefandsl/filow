// SEC-10: Electron is one of the 3 newest stable majors and on the newest patch of its major (patches
// carry Chromium security fixes). Needs the npm registry; when offline it reports and passes nothing.
import { execSync } from "node:child_process";
import fs from "node:fs";

const installed = JSON.parse(fs.readFileSync("node_modules/electron/package.json", "utf8")).version;
const pinned = JSON.parse(fs.readFileSync("apps/desktop/package.json", "utf8")).build?.electronVersion;
let tags;
try {
  tags = JSON.parse(execSync("npm view electron dist-tags --json --cache G:/caches/npm", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
} catch {
  console.log("registry unreachable");
  process.exit(1);
}
const latestMajor = Number(tags.latest.split(".")[0]);
const major = Number(installed.split(".")[0]);
const newestPatch = tags[`${major}-x-y`] || (major === latestMajor ? tags.latest : null);
const problems = [];
if (major < latestMajor - 2) problems.push(`Electron ${installed} is outside the 3 supported majors (${latestMajor - 2}-${latestMajor})`);
if (newestPatch && newestPatch !== installed) problems.push(`Electron ${installed} is behind the newest ${major}.x patch ${newestPatch}`);
if (pinned && pinned !== installed) problems.push(`build.electronVersion ${pinned} differs from installed ${installed}`);
console.log(problems.length ? problems.join("\n") : `Electron ${installed} is current (latest ${tags.latest})`);
process.exit(problems.length ? 1 : 0);
