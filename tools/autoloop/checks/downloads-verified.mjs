// SEC-15: every download in the desktop shell is verified before it is used: a call to download( or
// downloadWithProgress( must be followed, within 8 lines, by verifyDownload(, verifyAuthenticode(,
// verifyArchive(, a codesign check, or a call to a function of the same file whose own body makes one of
// those checks (localai.js installMacApp). Function definitions are skipped.
import fs from "node:fs";

const VERIFY = /verifyDownload\(|verifyAuthenticode\(|verifyArchive\(|"codesign"/;
const bad = [];
let total = 0;
for (const f of fs.readdirSync("apps/desktop").filter((n) => n.endsWith(".js"))) {
  const lines = fs.readFileSync(`apps/desktop/${f}`, "utf8").split("\n");
  // Top-level functions whose body (up to the closing brace at column 0) makes a verifying call.
  const verifiers = [];
  lines.forEach((l, i) => {
    const m = l.match(/^(?:async\s+)?function\s+(\w+)\(/);
    if (!m) return;
    const end = lines.findIndex((x, j) => j > i && /^\}/.test(x));
    if (VERIFY.test(lines.slice(i + 1, end < 0 ? undefined : end).join("\n"))) verifiers.push(m[1]);
  });
  const verified = verifiers.length ? new RegExp(`${VERIFY.source}|\\b(${verifiers.join("|")})\\(`) : VERIFY;
  lines.forEach((l, i) => {
    if (!/\b(download|downloadWithProgress)\(/.test(l) || /function\s+(download|downloadWithProgress)\(/.test(l) || /^\s*\/\//.test(l)) return;
    // A redirect inside the helper calls itself with the Location header; that is not a new download.
    if (/(download|downloadWithProgress)\((new URL\()?res\.headers\.location/.test(l)) return;
    total++;
    const after = lines.slice(i, i + 9).join("\n");
    if (!verified.test(after)) bad.push(`${f}:${i + 1}`);
  });
}
console.log(`${total - bad.length}/${total} downloads verified`);
if (bad.length) { console.log(bad.join("\n")); process.exit(1); }
