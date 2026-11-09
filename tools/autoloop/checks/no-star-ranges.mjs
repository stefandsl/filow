// SUP-01: no "*" or "latest" dependency ranges in any workspace package.json.
import fs from "node:fs";
const files = ["package.json", ...["apps", "packages"].flatMap((d) => fs.readdirSync(d).map((n) => `${d}/${n}/package.json`))].filter((f) => fs.existsSync(f));
const bad = [];
for (const f of files) {
  const p = JSON.parse(fs.readFileSync(f, "utf8"));
  for (const k of ["dependencies", "devDependencies", "optionalDependencies"]) for (const [n, v] of Object.entries(p[k] || {})) if ((v === "*" || v === "latest") && !n.startsWith("@filow/")) bad.push(`${f}: ${n}@${v}`);
}
if (bad.length) { console.log(bad.join("\n")); process.exit(1); }
