// Packaged check for FreeLLMAPI as an answer source (docs/okfilow/OUTBOUND.md, rows 16 to 19).
// A fake router (fake-freellm.mjs) stands in for FreeLLMAPI; no provider and no real key.
//   node tools/autoloop/e2e/freellm.mjs --exe <dir with Filow.exe> --out <dir for screenshots and result.json>
// It drives a QA package over CDP on its own profile and ports (FILOW_E2E_PORT, FILOW_E2E_DEVTOOLS):
//   1. Settings > FreeLLMAPI: type the address and the key, "Check connection" answers; the key is
//      encrypted in secrets.json and in no other file of the profile.
//   2. OK Filow, "Answers from: FreeLLMAPI": a typed question waits for the notice, "Send" sends the
//      question and the screenshot to the router, the signal names FreeLLMAPI, the answer shows.
//   3. A router without a vision model, and one with its quotas used up: the reason is shown, nothing
//      else is tried.
//   4. Offline mode: the same question does not reach the router.
// Ollama is pointed at a dead loopback address that Filow does not count as "the Ollama on this PC",
// so nothing here touches, or starts, a real Ollama.
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { startFakeFreeLlm } from "./fake-freellm.mjs";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const exeDir = arg("exe", "");
const outDir = arg("out", "");
if (!exeDir || !outDir || !fs.existsSync(path.join(exeDir, "Filow.exe"))) {
  console.error("usage: freellm.mjs --exe <dir with Filow.exe> --out <dir>");
  process.exit(2);
}
const PORT = Number(process.env.FILOW_E2E_PORT || 4803), DEVTOOLS = Number(process.env.FILOW_E2E_DEVTOOLS || 9380);
const profile = path.join(outDir, "profile");
// Built from pieces so no key-shaped string sits in a tracked file.
const KEY = "freellmapi-" + "e2e0fake".repeat(3);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 1500) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${String(detail).slice(0, 1500)}` : ""}`);
};

fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });
const seed = (extra = {}) => {
  const file = path.join(profile, "settings.json");
  const now = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  fs.writeFileSync(file, JSON.stringify({ ...now, welcomeCompleted: true, localAiOffered: true, firewallOffered: true, pptAsked: true, remoteShareChosen: true, remoteShare: false, lang: "en", theme: "dark", ...extra }, null, 2));
};
seed({ okFilow: { enabled: true, onboarded: true, voice: "off", voiceChosen: true, provider: "local" } });

const fake = await startFakeFreeLlm({ port: Number(arg("router-port", "3999")), key: KEY, delayMs: 2500 });
const chats = () => fake.log.filter((r) => r.path === "/v1/chat/completions");

/** One CDP connection to a page target. */
async function connect(match, tries = 120) {
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
          setTimeout(() => { if (waiting.delete(n)) rej(new Error(`no reply to ${method} from ${target.url}`)); }, 30000);
        });
        const evaluate = async (expression) => {
          const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
          if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "evaluate failed");
          return r.result?.result?.value;
        };
        const shot = async (name) => {
          // a hidden window may never answer a capture: the picture is evidence, not a check
          const r = await Promise.race([call("Page.captureScreenshot", { format: "png" }).catch(() => ({})), sleep(8000).then(() => ({}))]);
          if (r.result?.data) fs.writeFileSync(path.join(outDir, name), Buffer.from(r.result.data, "base64"));
        };
        const until = async (expression, ms = 20000) => {
          const end = Date.now() + ms;
          for (;;) {
            const v = await evaluate(expression).catch(() => null);
            if (v) return v;
            if (Date.now() > end) return null;
            await sleep(200);
          }
        };
        return { call, evaluate, shot, until, close: () => ws.close(), url: target.url };
      }
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error("page did not come up");
}

/** Types into a React-controlled field and lets React see it. */
const typeInto = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  return true;
})()`;
const clickText = (scope, text) => `(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(scope)})].find((b) => b.textContent.trim() === ${JSON.stringify(text)});
  if (!el || el.disabled) return false;
  el.click();
  return true;
})()`;

function launch(extraEnv = {}) {
  const app = spawn(path.join(exeDir, "Filow.exe"), [`--remote-debugging-port=${DEVTOOLS}`], {
    env: { ...process.env, FILOW_USER_DATA_DIR: profile, FILOW_PORT: String(PORT), FILOW_SESSION_PORT: String(PORT + 1), FILOW_HTTPS_PORT: String(PORT + 2),
      OLLAMA_URL: "http://127.0.0.2:9", FILOW_OKF_QA: "1", FREELLMAPI_API_KEY: "", FREELLMAPI_BASE_URL: "", OPENROUTER_API_KEY: "", ...extraEnv },
    stdio: "ignore",
  });
  return app;
}
const stop = (app) => { try { execSync(`taskkill /PID ${app.pid} /T /F`, { stdio: "ignore" }); } catch { /* gone */ } };
const mainPage = (u) => u.startsWith(`http://127.0.0.1:${PORT}/`) && !u.includes("/okfilow/");
const panelPage = (u) => u.includes("/okfilow/panel");

/** Asks a typed question in the panel; returns what the panel shows once the answer or an error is in. */
async function askTyped(panel, question, { expectNotice }) {
  await panel.evaluate(typeInto(".okf-type input", question));
  await panel.evaluate(`document.querySelector(".okf-type").requestSubmit(); true`);
  let notice = null;
  if (expectNotice) {
    notice = await panel.until(`document.querySelector(".okf-notice")?.innerText || ""`, 30000);
    await panel.shot(`panel-notice-${expectNotice}.png`);
    const before = chats().length;
    await sleep(1200);
    check(`nothing reaches the router while the notice waits (${expectNotice})`, chats().length === before, `${chats().length} chat requests`);
    await panel.evaluate(clickText(".okf-notice button", "Send"));
  }
  const pill = await panel.until(`document.querySelector(".okf-out")?.innerText || ""`, 15000);
  if (pill) await panel.shot(`panel-signal-${question.length}.png`);
  const done = await panel.until(`(() => { const a = document.querySelector(".okf-a")?.innerText, e = document.querySelector(".okf-err")?.innerText; return a || e ? JSON.stringify({ a: a || "", e: e || "" }) : ""; })()`, 60000);
  return { notice, pill, ...(done ? JSON.parse(done) : { a: "", e: "" }) };
}

/** Opens Settings at the FreeLLMAPI section once the window has finished loading its first page. */
async function goSettings(p) {
  await p.until(`document.readyState === "complete" ? "yes" : ""`, 40000);
  await sleep(1500);
  await p.evaluate(`location.href = "http://127.0.0.1:${PORT}/settings/local#freellm"; true`).catch(() => {});
  await sleep(1500);
}

let app = launch();
try {
  // ---- 1. Settings > FreeLLMAPI
  const page = await connect(mainPage);
  await page.call("Page.enable");
  await page.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await goSettings(page);
  const section = await page.until(`document.querySelector("#freellm") ? "yes" : ""`, 40000);
  check("Settings shows the FreeLLMAPI section", section === "yes");
  await page.evaluate(`document.querySelector("#freellm").scrollIntoView({ block: "start" }); true`);
  await sleep(400);
  await page.shot("settings-empty-dark-or-system.png");
  const personal = await page.evaluate(`document.querySelector("#freellm").innerText`);
  check("the settings say it is for personal use and that the provider may keep or train on the content", /personal use/.test(personal) && /train/.test(personal) && /Schools and companies/.test(personal));
  await page.evaluate(typeInto("#freellm input[type=url]", "https://example.com/v1"));
  const refusedUrl = await page.until(`document.querySelector("#freellm input[type=url]").getAttribute("aria-invalid") === "true" && document.querySelector("#freellm .btn.primary").disabled ? "yes" : ""`, 3000);
  check("an address on the internet is refused in the form", refusedUrl === "yes");
  await page.evaluate(typeInto("#freellm input[type=url]", fake.url));
  await page.evaluate(typeInto("#freellm input[type=password]", KEY));
  await page.evaluate(`document.querySelector("#freellm [data-act=check]").click(); true`);
  const connected = await page.until(`(() => { const n = document.querySelector("#freellm .freellm-note")?.innerText || ""; return /Connected|FreeLLMAPI/.test(n) ? n : ""; })()`, 20000);
  check("Check connection reaches the router with the saved key", /^Connected\. 2 models are ready now\.$/.test(connected || ""), connected);
  check("the check asked the router for its models, with the right key", fake.log.some((r) => r.path === "/v1/models" && r.keyOk) && chats().length === 0);
  await page.evaluate(`document.querySelector("#freellm").scrollIntoView({ block: "start" }); true`);
  await sleep(300);
  await page.shot("settings-connected-1280.png");
  await page.evaluate(typeInto("#freellm select", "auto:fast"));
  await page.evaluate(`document.querySelector("#freellm [data-act=save]").click(); true`);
  await sleep(800);
  const secrets = fs.existsSync(path.join(profile, "secrets.json")) ? fs.readFileSync(path.join(profile, "secrets.json"), "utf8") : "";
  check("the key is in the encrypted store", /FREELLMAPI_API_KEY/.test(secrets) && !secrets.includes(KEY));
  const saved = JSON.parse(fs.readFileSync(path.join(profile, "settings.json"), "utf8")).freellm;
  check("the address and the strategy are saved", saved?.baseUrl === fake.url && saved?.model === "auto:fast", JSON.stringify(saved));
  const leaks = [];
  for (const f of fs.readdirSync(profile)) {
    const full = path.join(profile, f);
    if (fs.statSync(full).isFile() && fs.statSync(full).size < 5_000_000 && fs.readFileSync(full, "utf8").includes(KEY)) leaks.push(f);
  }
  check("the key is in clear text in no file of the profile (settings, logs, .env)", leaks.length === 0, leaks.join(", "));
  const pageKey = await page.evaluate(`window.filow.freeLlm.status().then((s) => JSON.stringify(s))`);
  check("the page cannot read the key back", !pageKey.includes(KEY) && /"hasKey":true/.test(pageKey), pageKey.replace(KEY, "<KEY>"));
  // looks: light theme, phone width, 150% scaling
  await page.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await page.evaluate(`document.documentElement.dataset.theme = "light"; document.querySelector("#freellm").scrollIntoView({ block: "start" }); true`);
  await sleep(300);
  await page.shot("settings-light-1280.png");
  await page.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 800, deviceScaleFactor: 2, mobile: true });
  await page.evaluate(`document.querySelector("#freellm").scrollIntoView({ block: "start" }); true`);
  await sleep(300);
  await page.shot("settings-light-390.png");
  // the section itself: the rest of the page is not this check's business
  const overflow = await page.evaluate(`(() => { const w = document.documentElement.clientWidth; return [...document.querySelectorAll("#freellm, #freellm *")].filter((e) => e.getBoundingClientRect().right > w + 1).map((e) => e.tagName + "." + e.className).slice(0, 5).join(" "); })()`);
  check("the FreeLLMAPI section fits a phone width", overflow === "", overflow);
  const pageOverflow = await page.evaluate(`(() => { const w = document.documentElement.clientWidth; return [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > w + 1 && !e.closest("#freellm")).map((e) => e.tagName + "." + e.className).slice(0, 4).join(" "); })()`);
  console.log(`note: elements outside the section wider than the phone viewport: ${pageOverflow || "none"}`);
  await page.call("Emulation.setDeviceMetricsOverride", { width: 853, height: 480, deviceScaleFactor: 1.5, mobile: false });
  await page.evaluate(`document.documentElement.dataset.theme = "dark"; document.querySelector("#freellm").scrollIntoView({ block: "start" }); true`);
  await sleep(300);
  await page.shot("settings-dark-150pct.png");
  await page.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  const axeSource = fs.readFileSync(path.resolve("node_modules", "axe-core", "axe.min.js"), "utf8");
  for (const theme of ["dark", "light"]) {
    await page.evaluate(`document.documentElement.dataset.theme = "${theme}"; true`);
    await sleep(200);
    await page.evaluate(axeSource + ";true");
    const v = await page.evaluate(`axe.run(document.querySelector("#freellm"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"] }).then((r) => JSON.stringify(r.violations.map((x) => ({ id: x.id, n: x.nodes.length, t: x.nodes.map((n) => n.html.slice(0, 60) + " :: " + (n.any[0]?.message || "").slice(0, 110)).join(" | ").slice(0, 1400) }))))`);
    check(`axe: 0 violations in the FreeLLMAPI section (${theme})`, v === "[]", v);
  }

  // ---- 2. OK Filow through the router
  const panel = await connect(panelPage);
  await panel.call("Page.enable");
  await panel.evaluate(typeInto(".okf-settings select:has(option[value=freellm])", "freellm"));
  const picked = await panel.until(`document.querySelector(".okf-settings select:has(option[value=freellm])")?.value === "freellm" && /FreeLLMAPI/.test(document.querySelector(".okf-settings")?.innerText || "") ? "yes" : ""`, 5000);
  check("Answers from offers FreeLLMAPI and the panel says what goes where", picked === "yes");
  fake.log.length = 0;
  const first = await askTyped(panel, "What is two plus two?", { expectNotice: "first" });
  check("the notice names the router and warns that the provider may keep or train on it", /FreeLLMAPI router/.test(first.notice || "") && /train/.test(first.notice || ""), first.notice);
  check("the signal shows while the question is out, naming FreeLLMAPI", /Going outside/.test(first.pill || "") && /FreeLLMAPI \(a free provider it chooses\)/.test(first.pill || ""), first.pill);
  check("a typed question is answered through the router", first.a === "The fake router answered.", first.a || first.e);
  // the panel asks twice per question: the answer, then where on the screen to point (groundAnswer)
  check("the question went to the router only, with the screenshot, the key and the chosen strategy", chats().length >= 1 && chats().length <= 2 && chats().every((c) => c.image === true && c.keyOk && c.model === "auto:fast"), JSON.stringify(chats()).slice(0, 250));
  await panel.shot("panel-answer.png");
  const second = await askTyped(panel, "What is on my screen right now?", { expectNotice: "" });
  check("a screen question is answered without asking again", second.a === "The fake router answered." && !second.notice && chats().length >= 2 && chats().every((c) => c.image === true), second.a || second.e);
  const panelAxe = async (p, theme) => {
    await p.evaluate(axeSource + ";true");
    const v = await p.evaluate(`axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"] }).then((r) => JSON.stringify(r.violations.map((x) => ({ id: x.id, n: x.nodes.length, t: x.nodes.map((n) => n.html.slice(0, 60) + " :: " + (n.any[0]?.message || "").slice(0, 110)).join(" | ").slice(0, 1400) }))))`);
    check(`axe: 0 violations in the OK Filow panel (${theme})`, v === "[]", v);
  };
  await panelAxe(panel, "dark");
  await panel.shot("panel-settings.png");

  // ---- 3. failures
  fake.setMode("no_vision");
  const blind = await askTyped(panel, "Which button do I press?", { expectNotice: "" });
  check("a router without a vision model: the user is told, with the next step", /can read pictures/.test(blind.e) && /Fallback Chain/.test(blind.e) && !blind.a, blind.e || blind.a);
  await panel.shot("panel-no-vision.png");
  fake.setMode("quota");
  const spent = await askTyped(panel, "And now what do I do?", { expectNotice: "" });
  check("quotas used up: the user is told, and nothing else is tried", /used up the free quotas/.test(spent.e) && !spent.a, spent.e || spent.a);
  await panel.shot("panel-quota.png");
  fake.setMode("ok");
  const stoppedAt = chats().length;
  await fake.close();
  const down = await askTyped(panel, "Is anybody there at all?", { expectNotice: "" });
  check("router not running: the user is told to start it, with the download link", /is not answering at http:\/\/127\.0\.0\.1/.test(down.e) && /Get FreeLLMAPI/.test(down.e), down.e || down.a);
  await panel.shot("panel-not-running.png");
  panel.close();
  page.close();
  stop(app);
  await sleep(1500);

  // ---- 4. Offline mode
  const fake2 = await startFakeFreeLlm({ port: fake.port, key: KEY });
  // this launch runs in the light theme, so the panel is checked as a light-theme user sees it
  seed({ theme: "light" });
  app = launch({ FILOW_OFFLINE: "1" });
  const offPanel = await connect(panelPage);
  await offPanel.call("Page.enable");
  const sel = await offPanel.until(`(() => { const s = document.querySelector(".okf-settings select:has(option[value=freellm])"); return s ? JSON.stringify({ value: s.value, disabled: s.disabled }) : ""; })()`, 40000);
  check("offline: Answers from shows This PC and cannot be changed", sel === JSON.stringify({ value: "local", disabled: true }), sel);
  await offPanel.evaluate(`document.querySelector(".okf-settings")?.scrollIntoView(); true`);
  await panelAxe(offPanel, "light");
  await offPanel.shot("panel-light-offline-settings.png");
  const off = await askTyped(offPanel, "What is two plus two?", { expectNotice: "" });
  await sleep(1500);
  check("offline: the question does not reach the router", fake2.log.length === 0 && off.a !== "The fake router answered.", `${fake2.log.length} requests; ${off.e || off.a}`);
  await offPanel.shot("panel-offline.png");
  const offPage = await connect(mainPage);
  await offPage.call("Page.enable");
  await offPage.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await goSettings(offPage);
  const offNote = await offPage.until(`(() => { const s = document.querySelector("#freellm"); return s && /Offline mode is on/.test(s.innerText) && s.querySelector(".btn.primary").disabled ? "yes" : ""; })()`, 40000);
  check("offline: Settings says nothing goes to FreeLLMAPI and the connection check is off", offNote === "yes");
  await offPage.evaluate(`document.querySelector("#freellm")?.scrollIntoView({ block: "start" }); true`);
  await sleep(300);
  await offPage.shot("settings-offline.png");
  check("offline: the router heard nothing at all", fake2.log.length === 0, `${fake2.log.length} requests`);
  offPanel.close();
  offPage.close();
  await fake2.close();
  void stoppedAt;
} catch (e) {
  check("the run finished", false, e instanceof Error ? e.stack || e.message : String(e));
} finally {
  stop(app);
}
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify({ at: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results }, null, 2));
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
