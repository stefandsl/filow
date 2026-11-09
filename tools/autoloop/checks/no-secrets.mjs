// SUP-05: no secrets in tracked files or in the newest packaged build (app.asar is scanned as bytes).
// Patterns: OpenRouter/OpenAI/Anthropic keys, GitHub and Slack tokens, AWS access keys, Google API keys,
// ElevenLabs-style 32-hex keys assigned to *_KEY, and private key blocks. Test fixtures that only contain
// obviously fake values (FAKE, test, example, xxx) are allowed.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PATTERNS = [
  ["openrouter key", /sk-or-v1-[0-9a-f]{40,}/g],
  ["openai/anthropic key", /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}/g],
  ["github token", /\bgh[pousr]_[A-Za-z0-9]{36,}/g],
  ["slack token", /\bxox[abpr]-[A-Za-z0-9-]{20,}/g],
  ["aws access key", /\bAKIA[0-9A-Z]{16}\b/g],
  ["google api key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["hex key assignment", /[A-Z_]*API_KEY\s*[=:]\s*["']?[0-9a-f]{32,}\b/g],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
];
const FAKE = /fake|test|example|xxx|dummy|placeholder/i;

function scan(name, text, hits) {
  for (const [kind, re] of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const around = text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40);
      if (!FAKE.test(around)) hits.push(`${name}: ${kind} (${m[0].slice(0, 12)}...)`);
    }
  }
}

const hits = [];
const files = execSync("git ls-files -z", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);
for (const f of files) {
  if (/\.(png|jpe?g|gif|webp|ico|icns|onnx|wasm|woff2?|ttf|mp3|wav|zip|bz2|pdf|lock)$/i.test(f) || f.endsWith("package-lock.json")) continue;
  let text;
  try { if (fs.statSync(f).size > 5 * 1024 * 1024) continue; text = fs.readFileSync(f, "utf8"); } catch { continue; }
  scan(f, text, hits);
}
// Untracked new files in the work tree count too (they are about to be committed).
for (const f of execSync("git ls-files -z --others --exclude-standard", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean)) {
  try { if (fs.statSync(f).size < 5 * 1024 * 1024 && !/\.(png|jpe?g|onnx|wasm|zip)$/i.test(f)) scan(f, fs.readFileSync(f, "utf8"), hits); } catch { /* unreadable */ }
}
const builds = fs.readdirSync(".").filter((d) => /^release-autoloop/.test(d) && fs.existsSync(path.join(d, "win-unpacked", "resources", "app.asar")));
builds.sort((a, b) => fs.statSync(path.join(b, "win-unpacked", "resources", "app.asar")).mtimeMs - fs.statSync(path.join(a, "win-unpacked", "resources", "app.asar")).mtimeMs);
if (builds[0]) scan(`${builds[0]}/app.asar`, fs.readFileSync(path.join(builds[0], "win-unpacked", "resources", "app.asar")).toString("latin1"), hits);

console.log(`${hits.length} possible secrets`);
if (hits.length) { console.log(hits.slice(0, 30).join("\n")); process.exit(1); }
