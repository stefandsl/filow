// SEC-16: no PowerShell or cmd command line built by string interpolation in apps/desktop. Values must
// travel as separate arguments or through -EncodedCommand / environment variables, never spliced into
// a -Command string.
import fs from "node:fs";
const bad = [];
for (const f of fs.readdirSync("apps/desktop").filter((n) => n.endsWith(".js"))) {
  const lines = fs.readFileSync(`apps/desktop/${f}`, "utf8").split("\n");
  lines.forEach((l, i) => {
    if (/spawn(Sync)?\(\s*["'](powershell(\.exe)?|cmd(\.exe)?)["']/i.test(l) && /`[^`]*\$\{/.test(l)) bad.push(`${f}:${i + 1}`);
    if (/["']-Command["']\s*,\s*`[^`]*\$\{/.test(l)) bad.push(`${f}:${i + 1}`);
  });
}
console.log(`${bad.length} interpolated shell commands`);
if (bad.length) { console.log([...new Set(bad)].join("\n")); process.exit(1); }
