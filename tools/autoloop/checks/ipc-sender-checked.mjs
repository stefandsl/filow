// SEC-05: every ipcMain.handle/on/once in apps/desktop validates its sender. Accepted in the handler
// line or the 3 lines after it: a guard()/ourSender()/assertSender()/uiSender() check, senderFrame, or
// an explicit `.sender === / !==` comparison. Handlers registered through appHandle()/appOn() (which
// check uiSender) do not match `ipcMain.` and are covered by their helper.
// 2026-11-09 review: uiSender and `.sender ===` were missing, so checked handlers counted as unchecked.
import fs from "node:fs";
const ok = /guard\(|ourSender\(|assertSender\(|uiSender\(|senderFrame|\.sender [!=]== /;
let total = 0; const bad = [];
for (const f of fs.readdirSync("apps/desktop").filter((n) => n.endsWith(".js") && !n.includes("preload"))) {
  const lines = fs.readFileSync(`apps/desktop/${f}`, "utf8").split("\n");
  lines.forEach((l, i) => {
    if (/ipcMain\.(handle|on|once)\(/.test(l)) {
      total++;
      if (!ok.test(lines.slice(i, i + 4).join("\n"))) bad.push(`${f}:${i + 1}`);
    }
  });
}
console.log(`${total - bad.length}/${total} handlers check the sender`);
if (bad.length) { console.log(bad.slice(0, 40).join("\n")); process.exit(1); }
