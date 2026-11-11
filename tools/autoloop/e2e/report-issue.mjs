// Report a problem, end to end on a packaged QA build (GitHub issue #5): the report window shows the
// "Open an issue on GitHub" button with its notice, passes axe in both themes, does not overflow at
// 150 % or 480 px, and a click hands the default browser one link, within the limit, made only of what
// the window showed. The link goes to a local stand-in page (FILOW_QA_ISSUE_PAGE, QA builds only), so
// nothing reaches GitHub. It opens one tab in the default browser: close it afterwards.
//
// Usage: node tools/autoloop/e2e/report-issue.mjs <win-unpacked dir> [out dir]
// Env: PROBE_LANG (en), FILOW_E2E_PORT (4808), FILOW_E2E_SESSION_PORT (port + 3), FILOW_E2E_ISSUE_PORT
// (port + 4), FILOW_E2E_DEVTOOLS (9388). Kills only the app it started. Exit 0 when every check holds.
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const exeDir = process.argv[2];
if (!exeDir) { console.error("usage: node report-issue.mjs <win-unpacked dir> [out dir]"); process.exit(64); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT = path.resolve(process.argv[3] || path.join(ROOT, "tmp/autoloop/report-issue"));
const lang = process.env.PROBE_LANG || "en";
const PORT = Number(process.env.FILOW_E2E_PORT || 4808);
const SESSION_PORT = Number(process.env.FILOW_E2E_SESSION_PORT || PORT + 3);
const ISSUE_PORT = Number(process.env.FILOW_E2E_ISSUE_PORT || PORT + 4);
const DEVTOOLS = Number(process.env.FILOW_E2E_DEVTOOLS || 9388);
const GITHUB = "https://github.com/stefandsl/filow/issues/new";
const LIMIT = 6000;
const profile = path.join(OUT, "profile");
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "shots"), { recursive: true });
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, "settings.json"), JSON.stringify({ welcomeCompleted: true, localAiOffered: true, firewallOffered: true, pptAsked: true, remoteShareChosen: true, remoteShare: false, lang }));
// a long start-up log with one line of things that must be masked, so the link has to be cut
const filler = Array.from({ length: 400 }, (_, i) => `[2026-11-10T10:00:00.000Z] old line ${i + 1} of the start-up log, long enough to fill the link quickly`).join("\n");
fs.writeFileSync(path.join(profile, "startup.log"), `${filler}\n[2026-11-10T10:00:01.000Z] phone joined via https://probe-words-here-now.trycloudflare.com/s/1 from 192.168.1.44 user mail someone@example.org\n`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
let failed = 0;
const log = (s) => { out.push(s); console.log(s); };
const check = (name, ok, detail = "") => { if (!ok) failed += 1; log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`); };

const got = [];
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/issues/new")) got.push(req.url);
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end("<title>Filow test</title><p>Filow test page (report-issue probe). You can close this tab.</p>");
});
await new Promise((r) => server.listen(ISSUE_PORT, "127.0.0.1", r));

const env = { ...process.env, FILOW_USER_DATA_DIR: profile, FILOW_PORT: String(PORT), FILOW_SESSION_PORT: String(SESSION_PORT), OPENROUTER_API_KEY: "test-not-a-key", FILOW_QA_ISSUE_PAGE: `http://127.0.0.1:${ISSUE_PORT}/issues/new` };
delete env.ELECTRON_RUN_AS_NODE;
const app = spawn(path.join(exeDir, "Filow.exe"), [`--remote-debugging-port=${DEVTOOLS}`], { env, stdio: "ignore" });
const stop = () => { try { execSync(`taskkill /PID ${app.pid} /T /F`, { stdio: "ignore" }); } catch { /* gone */ } };
process.on("exit", stop);
const finish = (code) => { fs.writeFileSync(path.join(OUT, `report-issue-${lang}.txt`), out.join("\n")); stop(); server.close(); process.exit(code); };

async function targets() { try { return await (await fetch(`http://127.0.0.1:${DEVTOOLS}/json`)).json(); } catch { return []; } }
async function connect(t) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const call = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => { const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
  const shot = async (name) => { const r = await call("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(OUT, "shots", name), Buffer.from(r.result.data, "base64")); };
  return { call, evaluate, shot };
}

let main;
for (let i = 0; i < 60 && !main; i++) {
  await sleep(2000);
  main = (await targets()).find((t) => t.type === "page" && t.url.startsWith(`http://127.0.0.1:${PORT}/`) && !t.url.includes("/okfilow/"));
}
if (!main) { check("the app came up", false); finish(2); }
for (let i = 0; i < 60; i++) { if (/main window shown/.test(fs.readFileSync(path.join(profile, "startup.log"), "utf8"))) break; await sleep(500); }
await sleep(1500);
const m = await connect(main);
await m.call("Runtime.enable");
await m.evaluate(`window.filow?.reportProblem?.()`);

let about;
for (let i = 0; i < 20 && !about; i++) { await sleep(500); about = (await targets()).find((t) => t.type === "page" && t.url.includes("about.html")); }
if (!about) { check("Report a problem opened its window", false); finish(3); }
const a = await connect(about);
await a.call("Runtime.enable"); await a.call("Page.enable");
await sleep(1500);
await a.evaluate(fs.readFileSync(path.join(ROOT, "node_modules", "axe-core", "axe.min.js"), "utf8") + ";true");
const axe = async () => a.evaluate(`axe.run(document, { runOnly: { type: "tag", values: ["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"] } }).then(r => r.violations.map(v => v.id + ":" + v.nodes.length))`);
const facts = async () => JSON.parse(await a.evaluate(`JSON.stringify((() => {
  const b = document.getElementById("open-issue"), n = document.getElementById("issue-notice");
  return { button: b?.textContent, disabled: b?.disabled, describedby: b?.getAttribute("aria-describedby"), notice: n?.textContent || "",
    noticeBeforeButton: Boolean(n && b && (n.compareDocumentPosition(b) & 4)), placeholders: document.querySelectorAll("mark.todo").length,
    brackets: /\\[\\[/.test(document.body.textContent), overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
})())`));
const f = await facts();
check("the button is there and ready", /GitHub/.test(f.button || "") && f.disabled === false, f.button);
check("the notice says issues are public, before the button, and the button points at it", /public|pubblic/.test(f.notice) && f.noticeBeforeButton && f.describedby === "issue-notice");
check("no empty placeholder is left", f.placeholders === 0 && !f.brackets);

await a.evaluate(`(() => { const t=document.getElementById("describe"); t.value="The points stopped ticking after slide 3.\\nIt's the 2nd time, with l'apostrofo and 日本語."; t.dispatchEvent(new Event("input",{bubbles:true})); })()`);
await sleep(800);
for (const theme of ["dark", "light"]) {
  await a.evaluate(`document.documentElement.dataset.theme = "${theme}"`);
  await a.evaluate(`document.getElementById("open-issue").scrollIntoView({block:"center"})`); await sleep(300);
  await a.shot(`report-issue-${lang}-${theme}.png`);
  const v = await axe();
  check(`axe, ${theme} theme`, Array.isArray(v) && v.length === 0, JSON.stringify(v));
}
for (const [name, metrics] of [["150pct", { width: 853, height: 480, deviceScaleFactor: 1.5 }], ["narrow", { width: 480, height: 720, deviceScaleFactor: 1 }]]) {
  await a.call("Emulation.setDeviceMetricsOverride", { ...metrics, mobile: false });
  await a.evaluate(`document.getElementById("open-issue").scrollIntoView({block:"center"})`); await sleep(300);
  await a.shot(`report-issue-${lang}-${name}.png`);
  check(`no sideways scroll, ${name}`, (await facts()).overflowX === 0);
}
await a.call("Emulation.clearDeviceMetricsOverride");

check("nothing was sent before the click", got.length === 0);
const preview = String(await a.evaluate(`document.getElementById("preview").textContent`));
await a.evaluate(`document.getElementById("open-issue").click()`);
for (let i = 0; i < 30 && !got.length; i++) await sleep(500);
await sleep(800);
check("the click opened one link in the browser", got.length === 1, `${got.length} requests`);
check("the page says the browser is opening", /GitHub/.test(String(await a.evaluate(`document.getElementById("status")?.textContent`))));
if (got.length) {
  const u = new URL(got[0], "http://127.0.0.1");
  const body = u.searchParams.get("body") || "";
  const length = GITHUB.length + got[0].length - "/issues/new".length;
  check("the link fits the limit and uses the room", length <= LIMIT && length > LIMIT - 500, `${length} of ${LIMIT}`);
  check("the title is the user's first line", /The points stopped ticking after slide 3\.$/.test(u.searchParams.get("title") || ""), u.searchParams.get("title"));
  check("the newest log line is in, the oldest is out, and a line says the report was cut", /phone joined via <public link>/.test(body) && !/old line 1 of/.test(body) && /save it|salvala/i.test(body.split("\n").at(-1)));
  check("nothing unmasked: no live link, LAN address, e-mail or user folder", !/trycloudflare|192\.168\.1\.44|someone@example\.org/.test(body) && !/Users[\\/][A-Za-z]/.test(body));
  const kept = body.split("\n").filter((l) => l.trim() && !l.startsWith("###") && !/^`+$/.test(l)).slice(0, -1);
  const strangers = kept.filter((l) => !preview.includes(l) && !/^\(.*\)$/.test(l));
  check("every line of the link was on screen in the report", strangers.length === 0, JSON.stringify(strangers.slice(0, 2)));
}
check("the start-up log records that a link was opened, without its text", /report: opened a new GitHub issue in the browser \(\d+ chars/.test(fs.readFileSync(path.join(profile, "startup.log"), "utf8")));
log(failed ? `${failed} check(s) failed` : "all checks hold");
finish(failed ? 1 : 0);
