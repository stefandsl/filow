// SEC-15: every download in the desktop shell is verified before it is used: a call to download( or
// downloadWithProgress( must be followed, within 8 lines, by verifyDownload(, verifyAuthenticode(,
// verifyArchive( or a codesign check. Function definitions are skipped.
import fs from "node:fs";
const bad = [];
let total = 0;
for (const f of fs.readdirSync("apps/desktop").filter((n) => n.endsWith(".js"))) {
  const lines = fs.readFileSync(`apps/desktop/${f}`, "utf8").split("\n");
  lines.forEach((l, i) => {
    if (!/\b(download|downloadWithProgress)\(/.test(l) || /function\s+(download|downloadWithProgress)\(/.test(l) || /^\s*\/\//.test(l)) return;
    // A redirect inside the helper calls itself with the Location header; that is not a new download.
    if (/(download|downloadWithProgress)\((new URL\()?res\.headers\.location/.test(l)) return;
    total++;
    const after = lines.slice(i, i + 9).join("\n");
    if (!/verifyDownload\(|verifyAuthenticode\(|verifyArchive\(|"codesign"/.test(after)) bad.push(`${f}:${i + 1}`);
  });
}
console.log(`${total - bad.length}/${total} downloads verified`);
if (bad.length) { console.log(bad.join("\n")); process.exit(1); }
