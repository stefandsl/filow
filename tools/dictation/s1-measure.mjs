// Measures S1-mini by Superwhisper on Filow's own dictation samples (docs/dictation/S1-MINI.md).
//   node tools/dictation/s1-measure.mjs <llama-server url> [api key] [out.json]
// Start the server first, on this computer, as Filow does (apps/desktop/s1-runtime.js):
//   llama-server -m s1-mini-q4_k_m.gguf --host 127.0.0.1 --port 4824 --jinja
//                --chat-template-kwargs "{\"enable_thinking\":false}" --temp 0 --ctx-size 2048 --threads 4
// It sends every English sample through Filow's own request builder, decision and safety net
// (apps/desktop/dictation-cleanup.js), and reports per sample: exact / acceptable (same words, other
// punctuation or casing) / changed / refused by the safety net, with the time each took. The samples in
// other languages go through the decision only: none of them may be sent.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const cleanup = require(path.join(here, "../../apps/desktop/dictation-cleanup.js"));
const samples = JSON.parse(fs.readFileSync(path.join(here, "s1-samples.json"), "utf8"));
const [url, key, outFile] = process.argv.slice(2);
if (!url) { console.error("usage: node s1-measure.mjs <llama-server url> [api key] [out.json]"); process.exit(64); }

const sent = [];
const cleaner = cleanup.createCleaner({
  budgetMs: () => 60000, // no budget here: the time itself is what is measured
  run: async (body, signal) => {
    sent.push(body.messages[1].content);
    const r = await fetch(`${url}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body), signal });
    if (!r.ok) throw new Error(`server answered ${r.status}`);
    return (await r.json()).choices[0].message.content;
  },
});
const loose = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}@.$€%:]+/gu, " ").replace(/\.(?=\s|$)/g, "").trim();

const rows = [];
for (const s of samples.en) {
  const r = await cleaner.clean(s.said, { language: "en" });
  const got = r.used ? r.text : null;
  const verdict = got === null ? (s.want === "" && /empty/.test(r.reason) ? "exact" : `refused (${r.reason})`) : got === s.want ? "exact" : loose(got) === loose(s.want) ? "acceptable" : "changed";
  rows.push({ kind: s.kind, said: s.said, want: s.want, got, verdict, ms: r.ms });
  console.log(`${verdict.padEnd(24)} ${String(r.ms).padStart(5)} ms  ${s.said.slice(0, 50)}${got !== null && verdict !== "exact" ? `\n    got:  ${got}\n    want: ${s.want}` : ""}`);
}
const before = sent.length;
for (const lang of ["it", "ru", "ro", "ja"]) for (const said of samples[lang]) {
  await cleaner.clean(said, { language: lang });
  await cleaner.clean(said, { language: "auto", spokenLanguage: lang });
}
const leaked = sent.length - before;
const count = (v) => rows.filter((r) => r.verdict.startsWith(v)).length;
const times = rows.map((r) => r.ms).sort((a, b) => a - b);
const summary = { samples: rows.length, exact: count("exact"), acceptable: count("acceptable"), changed: count("changed"), refused: count("refused"), medianMs: times[Math.floor(times.length / 2)], p90Ms: times[Math.floor(times.length * 0.9)], maxMs: times.at(-1), otherLanguagesSent: leaked };
console.log(JSON.stringify(summary, null, 2));
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ summary, rows }, null, 2));
process.exit(leaked ? 1 : 0);
