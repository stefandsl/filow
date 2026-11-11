// Packaged check for script translation on this PC (docs/TRANSLATE-LOCAL.md).
//   node tools/autoloop/e2e/translate.mjs --exe <dir with Filow.exe> --out <dir> --ollama <http://127.0.0.1:port>
// It drives a QA package over CDP on its own profile and ports (FILOW_E2E_PORT, FILOW_E2E_DEVTOOLS),
// in Italian, with a real Ollama that has one of the translation models installed:
//   1. The editor says where Translate will run before it is pressed ("on this PC", with the model).
//   2. Translate: the real local model translates a 3-section, 13-point Italian outline into English;
//      the structure and the time targets are kept, and no outbound notice or signal ever shows.
//   3. axe (WCAG 2.2 A and AA) on the editor: dark and light, 1264 and 360 px wide, no sideways scroll.
//   4. The cloud is a choice: picking it names who gets the script, pressing Translate shows the
//      notice first, "keep it here" sends nothing; the choice is remembered when the editor reopens.
//   5. Ollama not running: the editor says so, offers "Use the cloud" and "Open Local models", and
//      a press sends nothing anywhere; "Use the cloud" shows the notice.
//   6. Offline mode: the same outline is translated on this PC.
// The cloud is never reached: there is no key, and every cloud step stops at the notice.
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const exeDir = arg("exe", "");
const outDir = arg("out", "");
const OLLAMA = arg("ollama", "");
if (!exeDir || !outDir || !OLLAMA || !fs.existsSync(path.join(exeDir, "Filow.exe"))) {
  console.error("usage: translate.mjs --exe <dir with Filow.exe> --out <dir> --ollama <url of an Ollama with a translation model>");
  process.exit(2);
}
const PORT = Number(process.env.FILOW_E2E_PORT || 4821), DEVTOOLS = Number(process.env.FILOW_E2E_DEVTOOLS || 9396);
const profile = path.join(outDir, "profile");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 1500) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${String(detail).slice(0, 600)}` : ""}`);
};

const OUTLINE = `<!-- target: 12 min -->
# Perché nasce Filow (3 min)
- Buongiorno a tutti, sono Marta Bianchi e lavoro in Helinext dal 2019
- Ogni relatore perde il filo almeno una volta: succede anche ai più esperti
- Un gobbo classico scorre da solo e ti costringe a inseguirlo
- Filow ascolta la tua voce e spunta i punti man mano che li dici

# Come funziona (5 min)
- Il riconoscimento vocale gira sul tuo PC, senza inviare l'audio a nessuno
- Scrivi la scaletta in Markdown: un titolo per sezione, un trattino per punto
- Se salti un punto, Filow lo tiene in evidenza finché non lo recuperi
- Il timer ti dice se sei in anticipo o in ritardo rispetto ai 12 minuti previsti
- Funziona anche con PowerPoint: le slide avanzano quando chiudi la sezione

# Prossimi passi (4 min)
- La versione 1.8 arriva a gennaio con la traduzione in locale
- Il 70% dei tester ha chiesto il supporto per il giapponese
- Scriveteci a supporto@filow.app per provare la beta
- Grazie dell'attenzione: ci sono domande?`;

fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });
const settingsFile = path.join(profile, "settings.json");
fs.writeFileSync(settingsFile, JSON.stringify({ welcomeCompleted: true, localAiOffered: true, firewallOffered: true, pptAsked: true, remoteShareChosen: true, remoteShare: false, lang: "it", theme: "dark" }));
/** The theme is the app's own setting: written before a launch, then read back from the page. */
const setTheme = (theme) => fs.writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(settingsFile, "utf8")), theme }));
const themeNow = `document.documentElement.dataset.theme`;

/** One CDP connection to a page target. */
async function connect(match, tries = 160) {
  for (let i = 0; i < tries; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEVTOOLS}/json`)).json();
      const target = list.find((t) => t.type === "page" && match(t.url));
      if (target) {
        const ws = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        let id = 0;
        const waiting = new Map();
        ws.onmessage = (m) => {
          const msg = JSON.parse(m.data);
          if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
        };
        const call = (method, params = {}) => new Promise((res, rej) => {
          const n = ++id;
          waiting.set(n, res);
          ws.send(JSON.stringify({ id: n, method, params }));
          setTimeout(() => { if (waiting.delete(n)) rej(new Error(`no reply to ${method}`)); }, 60000);
        });
        const evaluate = async (expression) => {
          const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
          if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "evaluate failed");
          return r.result?.result?.value;
        };
        const shot = async (name) => {
          const r = await Promise.race([call("Page.captureScreenshot", { format: "png" }).catch(() => ({})), sleep(8000).then(() => ({}))]);
          if (r.result?.data) fs.writeFileSync(path.join(outDir, name), Buffer.from(r.result.data, "base64"));
        };
        const until = async (expression, ms = 20000) => {
          const end = Date.now() + ms;
          for (;;) {
            const v = await evaluate(expression).catch(() => null);
            if (v) return v;
            if (Date.now() > end) return null;
            await sleep(250);
          }
        };
        return { call, evaluate, shot, until, close: () => ws.close() };
      }
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error("page did not come up");
}

function launch(extraEnv = {}) {
  return spawn(path.join(exeDir, "Filow.exe"), [`--remote-debugging-port=${DEVTOOLS}`], {
    env: { ...process.env, FILOW_USER_DATA_DIR: profile, FILOW_PORT: String(PORT), FILOW_SESSION_PORT: String(PORT + 1), FILOW_HTTPS_PORT: String(PORT + 2),
      OLLAMA_URL: OLLAMA, FILOW_OFFLINE: "", OPENROUTER_API_KEY: "", FREELLMAPI_API_KEY: "", FREELLMAPI_BASE_URL: "", TRANSLATE_LOCAL_MODEL: "", ...extraEnv },
    stdio: "ignore",
  });
}
const stop = async (app) => {
  try { execSync(`taskkill /PID ${app.pid} /T /F`, { stdio: "ignore" }); } catch { /* gone */ }
  await sleep(2500);
};
const mainPage = (u) => u.startsWith(`http://127.0.0.1:${PORT}/`) && !u.includes("/okfilow/") && !u.includes("/settings/");

const Q = (testid) => `document.querySelector('[data-testid="${testid}"]')`;
const setTextarea = (value) => `(() => {
  const el = document.querySelector("dialog textarea, [role=dialog] textarea, .dialog textarea, textarea");
  if (!el) return false;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
})()`;
const setSelect = (testid, value) => `(() => {
  const el = ${Q(testid)};
  if (!el) return false;
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
})()`;
const editorText = `(document.querySelector("textarea")?.value || "")`;
/** What the outbound parts of the page show now: the notice, the "sending" pill. */
const outboundNow = `JSON.stringify({ notice: document.querySelector(".okf-notice")?.innerText || "", pill: document.querySelector(".okf-out")?.innerText || "" })`;

async function openEditor(page) {
  await page.until(`document.querySelector(".edit-points") ? 1 : 0`, 60000);
  await page.evaluate(`document.querySelector(".edit-points").click(); true`);
  return page.until(`${Q("translate-where")} ? 1 : 0`, 15000);
}
async function closeEditor(page) {
  await page.evaluate(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Annulla"); if (b) b.click(); return true; })()`);
  await sleep(500);
}
const counts = (text) => ({ sections: (text.match(/^# /gm) || []).length, points: (text.match(/^- /gm) || []).length });

/** Presses Translate and waits for the end; reports whether a notice or a "sending" pill ever showed. */
async function pressAndWatch(page, ms) {
  await page.evaluate(`${Q("translate-go")}.click(); true`);
  const started = Date.now();
  let sawNotice = "", sawPill = "";
  for (;;) {
    const now = JSON.parse(await page.evaluate(outboundNow));
    if (now.notice) sawNotice = now.notice;
    if (now.pill) sawPill = now.pill;
    const busy = await page.evaluate(`${Q("translate-go")}?.disabled && !${Q("translate-where-hint")} ? 1 : 0`);
    if (!busy && Date.now() - started > 1500) break;
    if (sawNotice || Date.now() - started > ms) break;
    await sleep(300);
  }
  return { seconds: (Date.now() - started) / 1000, sawNotice, sawPill };
}

const axeSource = fs.readFileSync(path.join(ROOT, "node_modules", "axe-core", "axe.min.js"), "utf8");
async function axe(page) {
  await page.evaluate(axeSource + ";true");
  return page.evaluate(`axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"] })
    .then((res) => res.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) })))`);
}

let app = launch();
try {
  // ---- 1. where it will run, before the press
  let page = await connect(mainPage);
  await page.call("Page.enable");
  await page.call("Emulation.setDeviceMetricsOverride", { width: 1264, height: 800, deviceScaleFactor: 1, mobile: false });
  check("the editor opens with the translation controls", await openEditor(page));
  const hint = await page.until(`(() => { const h = ${Q("translate-where-hint")}; return h && h.dataset.blocked === "0" && /PC/.test(h.innerText) && !/Controllo/.test(h.innerText) ? h.innerText : ""; })()`, 20000);
  const whereValue = await page.evaluate(`${Q("translate-where")}.value`);
  check("before the press the editor says the translation runs on this PC, with the model", whereValue === "local" && /su questo PC con \S+/.test(hint || "") && /Niente esce/.test(hint || ""), `${whereValue} | ${hint}`);
  const options = await page.evaluate(`[...${Q("translate-where")}.options].map((o) => o.textContent).join(" | ")`);
  check("the choice next to the language names this PC and who the cloud is", /^Su questo PC \| Cloud: .*OpenRouter/.test(options || ""), options);
  await page.shot("1-editor-where-local-1264-dark.png");

  // ---- 2. the real local model translates
  await page.evaluate(setTextarea(OUTLINE));
  await page.evaluate(setSelect("translate-to", "en")).catch(() => {});
  const run = await pressAndWatch(page, 15 * 60_000);
  const note = await page.until(`${Q("translate-note")}?.innerText || ""`, 5000);
  const out = await page.evaluate(editorText);
  fs.writeFileSync(path.join(outDir, "translated-en.md"), out || "", "utf8");
  const c = counts(out || "");
  check("the outline comes back translated, with its 3 sections and 13 points", c.sections === 3 && c.points === 13 && out !== OUTLINE && /\b(the|your|and)\b/i.test(out), `${JSON.stringify(c)} in ${run.seconds.toFixed(1)} s`);
  check("the time targets and the names are as they were", out.startsWith("<!-- target: 12 min -->") && /\(3 min\)/.test(out) && /\(5 min\)/.test(out) && /\(4 min\)/.test(out) && out.includes("Marta Bianchi") && out.includes("Helinext") && out.includes("1.8"));
  check("the editor says it was translated on this PC and that nothing left", /Tradotto su questo PC con/.test(note || "") && /Niente è uscito/.test(note || ""), note);
  check("no outbound notice and no sending signal showed during the local translation", !run.sawNotice && !run.sawPill, JSON.stringify(run));
  check("no placeholder in the result", !/\[[A-Z][A-Z_]+(?:_\d+)?\]/.test(out || ""));
  await page.shot("2-translated-local-1264-dark.png");

  // ---- 3. axe and widths, in the theme the app was started in (dark here, light in step 6)
  const axePass = async (page, theme) => {
    check(`the app is in the ${theme} theme`, (await page.evaluate(themeNow)) === theme, await page.evaluate(themeNow));
    for (const width of [1264, 360]) {
      await page.call("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
      await sleep(700);
      const v = await axe(page);
      check(`axe: no violation in the editor (${theme}, ${width} px)`, Array.isArray(v) && v.length === 0, JSON.stringify(v));
      const overflow = await page.evaluate(`(() => { const d = document.documentElement; return Math.max(0, d.scrollWidth - d.clientWidth); })()`);
      check(`no sideways scroll (${theme}, ${width} px)`, overflow === 0, `${overflow} px`);
      const clipped = await page.evaluate(`(() => { const vw = document.documentElement.clientWidth; return [...document.querySelectorAll('[data-testid^="translate-"]')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > vw + 1); }).map((el) => el.dataset.testid).join(","); })()`);
      check(`the translation controls are inside the window (${theme}, ${width} px)`, clipped === "", clipped);
      await page.shot(`3-editor-${theme}-${width}.png`);
    }
    await page.call("Emulation.setDeviceMetricsOverride", { width: 1264, height: 800, deviceScaleFactor: 1, mobile: false });
  };
  await axePass(page, "dark");

  // ---- 4. the cloud is a choice, with the notice, and remembered
  await page.evaluate(setSelect("translate-where", "cloud"));
  const cloudHint = await page.until(`(() => { const h = ${Q("translate-where-hint")}; return h && h.dataset.where === "cloud" ? h.innerText : ""; })()`, 5000);
  check("with the cloud picked, the editor names who gets the script before the press", /cloud/i.test(cloudHint || "") && /OpenRouter/.test(cloudHint || ""), cloudHint);
  const before = await page.evaluate(editorText);
  const cloudRun = await pressAndWatch(page, 20000);
  check("pressing Translate with the cloud picked shows the notice first", /OpenRouter/.test(cloudRun.sawNotice), cloudRun.sawNotice.slice(0, 200));
  await page.shot("4-cloud-notice.png");
  await page.evaluate(`document.querySelector(".okf-notice-keep")?.click(); true`);
  await sleep(1200);
  check("keeping it here sends nothing and changes nothing", (await page.evaluate(editorText)) === before && !JSON.parse(await page.evaluate(outboundNow)).pill);
  await closeEditor(page);
  await openEditor(page);
  await sleep(600);
  check("the choice is remembered when the editor opens again", (await page.evaluate(`${Q("translate-where")}.value`)) === "cloud");
  await closeEditor(page);
  // the page's storage reaches the disk some seconds after a write; the probe kills the app, a user quits it
  await sleep(7000);
  page.close();
  await stop(app);

  // ---- 5. Ollama not running (an address that is not this PC's Ollama, so nothing is started), light theme
  setTheme("light");
  app = launch({ OLLAMA_URL: "http://127.0.0.2:9" });
  page = await connect(mainPage);
  await page.call("Page.enable");
  await page.call("Emulation.setDeviceMetricsOverride", { width: 1264, height: 800, deviceScaleFactor: 1, mobile: false });
  await openEditor(page);
  await sleep(600);
  const kept = await page.evaluate(`localStorage.getItem("filow.translate.where") + " | " + ${Q("translate-where")}.value`);
  check("the choice survives a restart of the app", kept === "cloud | cloud", kept);
  await page.evaluate(setSelect("translate-where", "local"));
  await sleep(500);
  const back = await page.evaluate(`${Q("translate-where")}.value + " | " + localStorage.getItem("filow.translate.where")`);
  check("choosing On this PC again is stored", back === "local | local", back);
  const blocked = await page.until(`(() => { const h = ${Q("translate-where-hint")}; return h && h.dataset.blocked === "1" ? h.innerText : ""; })()`, 20000);
  check("Ollama not running: the editor says why it cannot translate here", /Ollama/.test(blocked || "") && /non è in esecuzione/.test(blocked || ""), blocked);
  const ways = await page.evaluate(`[${Q("translate-use-cloud")}?.innerText || "", ${Q("translate-open-local")}?.innerText || "", ${Q("translate-open-local")}?.getAttribute("href") || ""].join(" | ")`);
  check("it offers the cloud and Local models", ways === "Usa il cloud | Apri Modelli locali | /settings/local#setup", ways);
  await page.evaluate(setTextarea(OUTLINE));
  const stuck = await pressAndWatch(page, 30000);
  await sleep(800);
  check("a press then translates nothing and sends nothing: no notice, no signal, the text as it was", !stuck.sawNotice && !stuck.sawPill && (await page.evaluate(editorText)) === OUTLINE && (await page.evaluate(`${Q("translate-where")}.value`)) === "local", JSON.stringify(stuck));
  check("and it says so within 15 seconds, without waiting for an Ollama nobody is starting", stuck.seconds < 15, `${stuck.seconds.toFixed(1)} s`);
  await page.shot("5-ollama-down-1264.png");
  await page.call("Emulation.setDeviceMetricsOverride", { width: 360, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  const v5 = await axe(page);
  check("axe: no violation with the reason and the two buttons showing (360 px)", Array.isArray(v5) && v5.length === 0, JSON.stringify(v5));
  check("no sideways scroll with the reason showing (360 px)", (await page.evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)) <= 0);
  await page.shot("5-ollama-down-360.png");
  await page.call("Emulation.setDeviceMetricsOverride", { width: 1264, height: 800, deviceScaleFactor: 1, mobile: false });
  await page.evaluate(`${Q("translate-use-cloud")}.click(); true`);
  const viaButton = await page.until(`document.querySelector(".okf-notice")?.innerText || ""`, 15000);
  check("Use the cloud shows the notice that names who gets the script", /OpenRouter/.test(viaButton || ""), (viaButton || "").slice(0, 200));
  await page.evaluate(`document.querySelector(".okf-notice-keep")?.click(); true`);
  await sleep(800);
  check("and keeping it here leaves the text as it was", (await page.evaluate(editorText)) === OUTLINE);
  await page.evaluate(setSelect("translate-where", "local"));
  await sleep(7000);
  page.close();
  await stop(app);

  // ---- 6. offline mode translates on this PC
  app = launch({ FILOW_OFFLINE: "1" });
  page = await connect(mainPage);
  await page.call("Page.enable");
  await page.call("Emulation.setDeviceMetricsOverride", { width: 1264, height: 800, deviceScaleFactor: 1, mobile: false });
  await openEditor(page);
  await sleep(600);
  await page.evaluate(setSelect("translate-where", "local"));
  await page.until(`(() => { const h = ${Q("translate-where-hint")}; return h && h.dataset.blocked === "0" && /Niente esce/.test(h.innerText) ? 1 : 0; })()`, 20000);
  await page.evaluate(setTextarea(OUTLINE.split("\n\n")[0]));
  const off = await pressAndWatch(page, 10 * 60_000);
  const offOut = await page.evaluate(editorText);
  const oc = counts(offOut || "");
  check("offline mode: the section is translated on this PC", oc.sections === 1 && oc.points === 4 && offOut !== OUTLINE.split("\n\n")[0] && !off.sawNotice && !off.sawPill, `${JSON.stringify(oc)} in ${off.seconds.toFixed(1)} s`);
  await page.shot("6-offline-translated.png");
  await axePass(page, "light");
  page.close();
} catch (err) {
  check("the probe ran to the end", false, err.stack || String(err));
} finally {
  await stop(app);
}
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify({ at: new Date().toISOString(), ollama: OLLAMA, passed: results.length - failed.length, failed: failed.length, results }, null, 2));
console.log(`${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
