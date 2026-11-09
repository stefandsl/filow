// I18N-01: every language has every key of the English dictionary, with the same {placeholders}.
// Reads packages/core/src/i18n.ts through esbuild (already a dependency), so it sees the real objects.
import { buildSync } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const out = path.resolve("tmp/autoloop/i18n.cjs");
fs.mkdirSync(path.dirname(out), { recursive: true });
buildSync({ entryPoints: ["packages/core/src/i18n.ts"], bundle: true, platform: "node", format: "cjs", outfile: out, logLevel: "silent" });
const { DICTIONARIES } = (await import(pathToFileURL(out).href)).default;
const en = DICTIONARIES.en;
const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const problems = [];
for (const [lang, dict] of Object.entries(DICTIONARIES)) {
  if (lang === "en") continue;
  for (const k of Object.keys(en)) {
    if (!(k in dict)) problems.push(`${lang}: missing ${k}`);
    else if (ph(dict[k]) !== ph(en[k])) problems.push(`${lang}: placeholders differ in ${k}`);
  }
  for (const k of Object.keys(dict)) if (!(k in en)) problems.push(`${lang}: extra ${k}`);
}
console.log(`${problems.length} i18n problems`);
if (problems.length) {
  console.log(problems.slice(0, 30).join("\n"));
  process.exit(1);
}
