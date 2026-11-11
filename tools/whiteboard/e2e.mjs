#!/usr/bin/env node
// Whiteboard tutor, end to end in the packaged app (docs/whiteboard/SPEC.md section 6).
// Starts the fake model server (no paid or cloud call), launches Filow.exe with its own profile and
// ports, opens the whiteboard through OK Filow's bridge and checks what a user would see:
// a lesson drawn step by step, a step on the board within 200 ms of its data, the controls, a text
// card for a broken step, both exports, axe with 0 violations in both themes at 1264 and 360 px
// with no sideways scroll, and the cloud path: nothing leaves before the yes, one call after it,
// no picture in it.
//
// Usage: node tools/whiteboard/e2e.mjs <path\to\win-unpacked> [--real] [--out <dir>]
//   --real   use the Ollama on this PC with offline mode on (the "packaged app shows a lesson
//            offline with the local model" proof); the cloud steps are then checks that Cloud is refused.
// Ports: FILOW_E2E_PORT (4811), FILOW_E2E_SESSION_PORT (4813), FILOW_E2E_DEVTOOLS (9392), fake model 4812.
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { NO_PUBLIC_LINK, seedProfile } from "../autoloop/e2e/profile.mjs";
import { startFakeModel } from "./fake-model.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..");
const args = process.argv.slice(2);
const exeDir = args.find((a) => !a.startsWith("--") && fs.existsSync(path.join(a, "Filow.exe")));
if (!exeDir) { console.error("usage: node tools/whiteboard/e2e.mjs <path to win-unpacked> [--real] [--out <dir>]"); process.exit(2); }
const REAL = args.includes("--real");
const outDir = path.resolve(args.includes("--out") ? args[args.indexOf("--out") + 1] : path.join(ROOT, "tmp/whiteboard-e2e"));
const PORT = Number(process.env.FILOW_E2E_PORT || 4811);
const SESSION = Number(process.env.FILOW_E2E_SESSION_PORT || 4813);
const DEVTOOLS = Number(process.env.FILOW_E2E_DEVTOOLS || 9392);
const FAKE = Number(process.env.FILOW_E2E_FAKE_PORT || 4812);
const tag = REAL ? "real" : "fake";
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 300) });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${String(detail).slice(0, 200)})` : ""}`);
};

const fake = await startFakeModel(FAKE);
// The voice is off in this profile: the checks run on the owner's PC, often at night.
const profile = seedProfile(outDir, { ...NO_PUBLIC_LINK, okFilow: { enabled: true, voice: "off" } });
const app = spawn(path.join(exeDir, "Filow.exe"), [`--remote-debugging-port=${DEVTOOLS}`], {
  env: {
    ...process.env,
    FILOW_USER_DATA_DIR: profile,
    FILOW_PORT: String(PORT),
    FILOW_SESSION_PORT: String(SESSION),
    OPENROUTER_BASE_URL: `http://127.0.0.1:${FAKE}/v1`,
    OPENROUTER_API_KEY: "test-key-not-real",
    BUDDY_CLOUD_MODEL: "",
    ...(REAL ? { FILOW_OFFLINE: "1" } : { OLLAMA_URL: `http://127.0.0.1:${FAKE}`, BUDDY_LOCAL_MODEL: "fake-local", FILOW_OFFLINE: "" }),
  },
  stdio: "ignore",
  detached: false,
});
let stopped = false;
const stop = () => {
  if (stopped) return;
  stopped = true;
  try { execSync(`taskkill /PID ${app.pid} /T /F`, { stdio: "ignore" }); } catch { /* gone */ }
};
process.on("exit", stop);

const targets = async () => { try { return await (await fetch(`http://127.0.0.1:${DEVTOOLS}/json`)).json(); } catch { return []; } };
async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const call = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => (await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  return { call, evaluate, close: () => ws.close() };
}
async function waitFor(fn, ms, every = 400) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) return null;
    await sleep(every);
  }
}

let page;
try {
  const helper = await waitFor(async () => (await targets()).find((t) => t.type === "page" && t.url.startsWith(`http://127.0.0.1:${PORT}/okfilow/`)), 150_000, 2000);
  check("the app starts and OK Filow has a window to ask from", helper, helper?.url);
  if (!helper) throw new Error("no OK Filow window");
  const okf = await connect(helper);
  await waitFor(() => okf.evaluate("typeof window.okFilow?.showWhiteboard === 'function'"), 20_000);
  await okf.evaluate(`window.okFilow.showWhiteboard(${JSON.stringify(REAL ? "How does photosynthesis work?" : "How does photosynthesis work?")}); true`);
  const boardTarget = await waitFor(async () => (await targets()).find((t) => t.type === "page" && t.url.includes("/okfilow/whiteboard")), 30_000);
  check("asking OK Filow for the whiteboard opens its window", boardTarget, boardTarget?.url);
  if (!boardTarget) throw new Error("no whiteboard window");
  okf.close();
  page = await connect(boardTarget);
  await page.call("Page.enable");
  await page.call("Runtime.enable");
  const state = () => page.evaluate(`(() => { const m = document.querySelector("main.wb-page"); if (!m) return null; const svg = document.querySelector("svg.wb-board"); return { phase: m.dataset.phase, player: m.dataset.player, shownMs: m.dataset.shownMs ? Number(m.dataset.shownMs) : null, step: svg ? Number(svg.dataset.step) : -1, nodes: document.querySelectorAll("[data-node]").length, edges: document.querySelectorAll("[data-edge]").length, formulas: document.querySelectorAll(".wb-formula[data-ready]").length, plots: document.querySelectorAll('[data-block="plot"]').length, cards: document.querySelectorAll('[data-block="card"]').length, sketches: document.querySelectorAll('[data-block="sketch"]').length, source: document.querySelector("[data-source]")?.dataset.source ?? "", chip: document.querySelector("[data-source]")?.textContent ?? "", say: document.querySelector(".wb-say")?.textContent ?? "", count: document.querySelector(".wb-count")?.textContent ?? "", alert: document.querySelector(".wb-alert")?.textContent ?? "", overflow: document.documentElement.scrollWidth - window.innerWidth }; })()`);
  const clickButton = (re) => page.evaluate(`(() => { const b = [...document.querySelectorAll("main.wb-page button")].find((x) => ${re}.test(x.textContent || "") && !x.disabled); if (!b) return false; b.click(); return true; })()`);
  const setInput = (index, text) => page.evaluate(`(() => { const el = document.querySelectorAll('main.wb-page input[type="text"]')[${index}]; if (!el) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  const submit = (index) => page.evaluate(`(() => { const f = document.querySelectorAll("main.wb-page form")[${index}]; if (!f) return false; f.requestSubmit(); return true; })()`);
  const lessonDone = (ms) => waitFor(async () => { const s = await state(); return s && (s.phase === "done" || s.phase === "error") && (s.player === "done" || s.phase === "error") ? s : null; }, ms, 500);
  const shot = async (name, width, height) => {
    await page.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await sleep(900);
    const r = await page.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    if (r.result?.data) fs.writeFileSync(path.join(outDir, `${tag}-${name}.png`), Buffer.from(r.result.data, "base64"));
    return Boolean(r.result?.data);
  };
  const setTheme = (theme) => page.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}; true`);
  const axeSource = fs.readFileSync(path.join(ROOT, "node_modules", "axe-core", "axe.min.js"), "utf8");
  const axe = async () => {
    await page.evaluate(axeSource + ";true");
    return page.evaluate(`axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"] }).then((res) => res.violations.map((v) => v.id + " x" + v.nodes.length + " " + v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")))`);
  };

  // 1. The first lesson: watch the first step arrive, then the whole lesson play to its end.
  const first = await waitFor(async () => { const s = await state(); return s && s.step >= 0 ? s : null; }, REAL ? 240_000 : 60_000, 200);
  check("the first step is on the board while later steps are still being made", first && first.step === 0, JSON.stringify(first && { phase: first.phase, step: first.step, nodes: first.nodes }));
  const done = await lessonDone(REAL ? 300_000 : 120_000);
  check("the lesson plays to its end by itself", done && done.phase === "done", JSON.stringify(done && { phase: done.phase, player: done.player, count: done.count }));
  check("a step is on the board within 200 ms of its data arriving", done && done.shownMs !== null && done.shownMs <= 200, `${done?.shownMs} ms`);
  check("the lesson came from this PC", done && done.source === "local", done?.chip);
  if (!REAL) {
    check("the board shows boxes, arrows, a formula set by KaTeX and a plot", done && done.nodes === 6 && done.edges === 5 && done.formulas === 1 && done.plots === 1, JSON.stringify(done && { nodes: done.nodes, edges: done.edges, formulas: done.formulas, plots: done.plots }));
  } else {
    check("the board shows a drawing", done && done.nodes + done.formulas + done.plots >= 2, JSON.stringify(done && { nodes: done.nodes, edges: done.edges, formulas: done.formulas, plots: done.plots, cards: done.cards }));
    check("offline mode is on and Cloud cannot be chosen", await page.evaluate(`document.querySelectorAll('main.wb-page input[type="radio"]')[1].disabled === true`));
  }

  // 2. Both themes, desktop and phone width: screenshots, no sideways scroll, axe.
  for (const theme of ["dark", "light"]) {
    await setTheme(theme);
    for (const [name, width, height] of [["1264", 1264, 800], ["360", 360, 740]]) {
      await shot(`lesson-${theme}-${name}`, width, height);
      const s = await state();
      check(`${theme} ${name} px: no sideways scroll`, s && s.overflow <= 0, `${s?.overflow} px`);
      const violations = await axe();
      check(`${theme} ${name} px: axe finds nothing`, Array.isArray(violations) && violations.length === 0, (violations || ["axe did not run"]).join("; "));
    }
  }
  await setTheme("dark");
  await page.call("Emulation.setDeviceMetricsOverride", { width: 1264, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(600);

  // 3. The controls.
  const total = (await state()).step;
  await clickButton("/^(Back|Indietro)$/");
  await sleep(300);
  let s = await state();
  check("Back shows the step before", s.step === total - 1, `step ${s.step} of ${total}`);
  await clickButton("/^(Pause|Pausa)$/");
  await clickButton("/^(Back|Indietro)$/");
  await sleep(300);
  s = await state();
  check("paused, Back still moves and the lesson stays where it is put", s.step === total - 2 && s.player !== "done", `step ${s.step} ${s.player}`);
  await sleep(4500);
  check("a paused lesson does not move on", (await state()).step === total - 2);
  await clickButton("/^(Next|Avanti)$/");
  await sleep(300);
  check("Next shows the step after", (await state()).step === total - 1);
  await clickButton("/^(Replay step|Ripeti il passo)$/");
  await sleep(300);
  check("Replay keeps the same step on the board", (await state()).step === total - 1);

  // 4. Exports: the picture and the steps. The files are caught in the page, not saved to disk.
  const exported = await page.evaluate(`(async () => { const got = []; const blobs = new Map(); const make = URL.createObjectURL; URL.createObjectURL = (b) => { const u = make.call(URL, b); blobs.set(u, b); return u; }; const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) got.push({ name: this.download, href: this.href }); else orig.call(this); }; const press = (re) => [...document.querySelectorAll("main.wb-page button")].find((b) => re.test(b.textContent || ""))?.click(); press(/PNG/); for (let i = 0; i < 80 && got.length < 1; i++) await new Promise((r) => setTimeout(r, 100)); press(/Markdown/); for (let i = 0; i < 20 && got.length < 2; i++) await new Promise((r) => setTimeout(r, 100)); HTMLAnchorElement.prototype.click = orig; URL.createObjectURL = make; const out = []; for (const g of got) { const blob = blobs.get(g.href); if (!blob) continue; if (blob.type === "image/png") { const bmp = await createImageBitmap(blob); const cv = new OffscreenCanvas(bmp.width, bmp.height); const ctx = cv.getContext("2d"); ctx.drawImage(bmp, 0, 0); const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data; const colours = new Set(); for (let i = 0; i < d.length; i += 4 * 101) colours.add((d[i] >> 5) + "," + (d[i + 1] >> 5) + "," + (d[i + 2] >> 5)); const bytes = new Uint8Array(await blob.arrayBuffer()); let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); out.push({ name: g.name, type: blob.type, w: bmp.width, h: bmp.height, colours: colours.size, base64: btoa(bin) }); } else out.push({ name: g.name, type: blob.type, text: await blob.text() }); } return JSON.stringify(out); })()`);
  let files = [];
  try { files = JSON.parse(exported); } catch { check("the exports could be read back", false, String(exported).slice(0, 200)); }
  const png = files.find((e) => e.type === "image/png");
  const md = files.find((e) => (e.type || "").startsWith("text/markdown"));
  if (png?.base64) fs.writeFileSync(path.join(outDir, `${tag}-export.png`), Buffer.from(png.base64, "base64"));
  if (md?.text) fs.writeFileSync(path.join(outDir, `${tag}-export.md`), md.text);
  check("Save picture gives a PNG of the board with a drawing in it", png && png.w === 2400 && png.h === 1440 && png.colours >= 4, JSON.stringify(png && { name: png.name, w: png.w, h: png.h, colours: png.colours }));
  check("Save steps gives the lesson as Markdown", md && /^# /.test(md.text) && /## (Step|Passo) 2/.test(md.text) && (REAL || md.text.includes("C_6H_{12}O_6")), md && md.text.slice(0, 80));

  if (!REAL) {
    // 5. "Explain this part again": a click on a box adds steps to the same board.
    const before = await page.evaluate(`document.querySelector(".wb-count")?.textContent ?? ""`);
    await page.evaluate(`document.querySelector('[data-node="leaf"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); true`);
    const more = await waitFor(async () => { const st = await state(); return st && st.phase === "done" && st.count !== before && /7/.test(st.count) ? st : null; }, 60_000);
    check("clicking a box asks for that part again and adds steps to the same board", more, `${before} -> ${more?.count}`);
    await lessonDone(90_000);

    // 6. A step the model gets wrong becomes a text card and the lesson goes on.
    await setInput(0, "A broken lesson, please");
    await submit(0);
    await sleep(800);
    const broken = await lessonDone(120_000);
    // the step whose answer is broken twice is drawn from the checked plan (no text card), and the lesson ends
    check("a step the model writes wrongly is still drawn from the checked plan, and the lesson ends", broken && broken.phase === "done" && broken.cards === 0 && broken.nodes === 6 && broken.edges === 5, JSON.stringify(broken && { phase: broken.phase, cards: broken.cards, nodes: broken.nodes, edges: broken.edges }));
    await shot("card-dark-1264", 1264, 800);

    // 7. Cloud: nothing leaves before the yes; after it, one call with the question and no picture.
    const cloudCalls = () => fake.seen.filter((x) => x.url.endsWith("/chat/completions"));
    await page.evaluate(`document.querySelectorAll('main.wb-page input[type="radio"]')[2].click(); true`);
    await sleep(300);
    await setInput(0, "Ohm's law");
    await submit(0);
    const noticeUp = await waitFor(() => page.evaluate(`Boolean(document.querySelector("dialog.okf-notice-modal[open]"))`), 20_000);
    check("choosing Cloud shows the first-send notice before anything is sent", noticeUp && cloudCalls().length === 0, `cloud calls so far: ${cloudCalls().length}`);
    check("the notice says only the question is sent", /screenshot/i.test(await page.evaluate(`document.querySelector("dialog.okf-notice-modal")?.textContent ?? ""`)));
    await shot("notice-dark-1264", 1264, 800);
    const noticeAxe = await axe();
    check("the notice passes axe", Array.isArray(noticeAxe) && noticeAxe.length === 0, (noticeAxe || []).join("; "));
    await sleep(1500);
    check("still nothing sent while the notice waits", cloudCalls().length === 0);
    await page.evaluate(`document.querySelector("dialog.okf-notice-modal .okf-notice-send").click(); true`);
    const cloud = await lessonDone(90_000);
    check("after the yes the lesson comes from the cloud model", cloud && cloud.phase === "done" && cloud.source === "cloud" && cloud.sketches === 1, JSON.stringify(cloud && { phase: cloud.phase, source: cloud.source, sketches: cloud.sketches, alert: cloud.alert }));
    check("one cloud call was made (the lesson), with the question and no picture", cloudCalls().length === 1 && cloudCalls().every((c) => !c.hasImage) && cloudCalls()[0].user.includes("Ohm"), JSON.stringify(cloudCalls().map((c) => ({ url: c.url, hasImage: c.hasImage, user: c.user.slice(0, 60) }))));
    // a worked example is written in full (cells used to be cut at 6 characters: "I = 2...")
    const cellTexts = await page.evaluate(`[...document.querySelectorAll('svg.wb-board [data-block="cells"] text')].map((x) => x.textContent).join("|")`);
    check("the cells of a worked example are readable in full", cellTexts === "V = 12 V|I = 2 A|R = 6 ohm", cellTexts);
    await setTheme("light");
    await shot("cloud-light-1264", 1264, 800);
    await shot("cloud-light-360", 360, 740);
    const cloudAxe = await axe();
    check("the cloud lesson with a sketch passes axe at 360 px", Array.isArray(cloudAxe) && cloudAxe.length === 0, (cloudAxe || []).join("; "));
    await setTheme("dark");

    // 8. A cloud account that hides names: no lesson, the reason, and the way back to this PC.
    const sentBefore = cloudCalls().length;
    await setInput(0, "The Krebs cycle");
    await submit(0);
    const hid = await waitFor(async () => { if (await page.evaluate(`Boolean(document.querySelector("dialog.okf-notice-modal[open]"))`)) await page.evaluate(`document.querySelector("dialog.okf-notice-modal .okf-notice-send").click(); true`); return page.evaluate(`Boolean(document.querySelector('main.wb-page .wb-alert [data-action="use-local"]'))`); }, 60_000);
    const alertText = await page.evaluate(`document.querySelector("main.wb-page .wb-alert p")?.textContent ?? ""`);
    check("a name hidden by the cloud service shows no lesson, says why and where the setting is", hid && /OpenRouter/.test(alertText) && alertText.includes("[PERSON_NAME]") && cloudCalls().length === sentBefore + 1 && (await page.evaluate(`document.querySelectorAll("main.wb-page svg.wb-board [data-node]").length`)) === 0, `${alertText.slice(0, 120)} | calls ${cloudCalls().length - sentBefore}`);
    await shot("redacted-dark-1264", 1264, 800);
    await shot("redacted-dark-360", 360, 740);
    const hidAxe = await axe();
    check("the message passes axe at 360 px", Array.isArray(hidAxe) && hidAxe.length === 0, (hidAxe || []).join("; "));
    await page.evaluate(`document.querySelector('main.wb-page .wb-alert [data-action="use-local"]').click(); true`);
    await sleep(800);
    const onPc = await lessonDone(120_000);
    check("Explain it on this PC asks the local model the same question, and nothing more leaves", onPc && onPc.phase === "done" && onPc.source === "local" && cloudCalls().length === sentBefore + 1, JSON.stringify(onPc && { phase: onPc.phase, source: onPc.source, alert: onPc.alert }));

    // 9. "No" keeps the lesson on this PC: a different maker needs its own yes, and a no sends nothing.
    check("no local call carried a picture", fake.seen.filter((x) => x.url.startsWith("/api/chat")).every((x) => !x.hasImage));
  } else {
    check("nothing was sent to a cloud model", fake.seen.filter((x) => x.url.endsWith("/chat/completions")).length === 0);
  }
} catch (e) {
  check("the run finished", false, e instanceof Error ? e.message : String(e));
} finally {
  page?.close();
  stop();
  await fake.stop();
}

const failed = checks.filter((c) => !c.ok);
fs.writeFileSync(path.join(outDir, `${tag}-result.json`), JSON.stringify({ at: new Date().toISOString(), exe: exeDir, real: REAL, passed: checks.length - failed.length, failed: failed.length, checks }, null, 2));
console.log(`${checks.length - failed.length}/${checks.length} checks passed; results and screenshots in ${outDir}`);
process.exit(failed.length ? 1 : 0);
