// SEC-13: every QA/test switch (flag file or fake-mic env) is unreachable in packaged release builds.
// Accepted gates within the 3 lines before a use: app.isPackaged or isQaBuild (apps/desktop/qa.js,
// a build-time marker). A flag file next to the exe is never an accepted gate. Comment lines are skipped.
// 2026-11-09 review: isQaBuild was added as the accepted gate; comment lines no longer count.
import fs from "node:fs";
const bad = [];
for (const f of fs.readdirSync("apps/desktop").filter((n) => n.endsWith(".js"))) {
  const lines = fs.readFileSync(`apps/desktop/${f}`, "utf8").split("\n");
  lines.forEach((l, i) => {
    if (/^\s*\/\//.test(l)) return;
    if (/qa\.flag/.test(l)) bad.push(`${f}:${i + 1} (flag file)`);
    else if (/FILOW_OKF_FAKE_MIC/.test(l)) {
      const ctx = lines.slice(Math.max(0, i - 3), i + 1).join("\n");
      if (!/isPackaged|isQaBuild\(/.test(ctx)) bad.push(`${f}:${i + 1}`);
    }
  });
}
if (bad.length) { console.log(bad.join("\n")); process.exit(1); }
