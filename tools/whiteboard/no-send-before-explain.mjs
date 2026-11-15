#!/usr/bin/env node
// Owner report 14/11: on the whiteboard, a click on a sample topic, without "Explain", already showed
// "Leaving this PC: sending to OpenRouter and Anthropic". Nothing may leave the PC, and no signal may
// show, before the user starts the lesson.
//
// A hidden QA instance (qa-dev.mjs) with every model on a fake server on loopback: the online model is
// chosen and its yes given once (a first lesson), then the page is opened again and the checks run:
// a sample topic clicked, the topic edited: 0 calls and no signal; "Explain": the lesson calls, with the signal.
// Usage: node tools/whiteboard/no-send-before-explain.mjs [--work G:\FILOW\tmp\board-library\part0]
import fs from "node:fs";
import path from "node:path";
import { cloudCalls, launch, sleep, waitFor } from "./qa-dev.mjs";

const argv = process.argv.slice(2);
const work = path.resolve(argv.includes("--work") ? argv[argv.indexOf("--work") + 1] : "G:\\FILOW\\tmp\\board-library\\part0");
fs.rmSync(path.join(work, "profile"), { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 300) });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${String(detail).slice(0, 200)})` : ""}`);
};

const qa = await launch({ profile: path.join(work, "profile"), settings: { okFilow: { enabled: true, voice: "off" } } });
try {
  const page = await qa.openBoard();
  // Every time the going-outside signal is raised (OK Filow's own signal state, shown by the pill and the
  // pointer) or the notice is in the page, however briefly.
  // The signal is sent to OK Filow's panel and pointer: it is read in the panel's window.
  const watch = async () => {
    await qa.okf.evaluate(`(() => { window.__signal = 0; if (!window.__watching) { window.__watching = true; window.okFilow.outbound.onChange((s) => { if (s && s.active) window.__signal++; }); } return true; })()`);
    await page.evaluate(`(() => { window.__notice = 0; const look = () => { if (document.querySelector("dialog.okf-notice-modal[open]")) window.__notice++; }; new MutationObserver(look).observe(document.body, { subtree: true, childList: true, attributes: true }); look(); return true; })()`);
  };
  const seen = async () => ({ signal: await qa.okf.evaluate("window.__signal"), notice: await page.evaluate("window.__notice") });
  // what reached the fake server other than Ollama's own status polls (the local model's server on this PC)
  const sentOut = (from) => qa.fake.seen.slice(from).filter((x) => !/^\/api\/(ps|tags|version)/.test(x.url)).map((x) => x.url);
  const chooseCloud = () => waitFor(() => page.evaluate(`(() => { const r = document.querySelectorAll('main.wb-page input[name="wb-from"]')[2]; if (!r || r.disabled) return false; r.click(); return r.checked; })()`), 20_000);
  const setTopic = (text) => page.evaluate(`(() => { const el = document.querySelector('main.wb-page form.wb-ask input[type="text"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event("input", { bubbles: true })); return el.value; })()`);
  const phase = () => page.evaluate(`document.querySelector("main.wb-page")?.dataset.phase ?? ""`);
  const explain = () => page.evaluate(`(() => { document.querySelector("main.wb-page form.wb-ask").requestSubmit(); return true; })()`);
  const acceptNotice = () => waitFor(() => page.evaluate(`(() => { const b = document.querySelector("dialog.okf-notice-modal[open] .okf-notice-send"); if (!b) return false; b.click(); return true; })()`), 20_000);

  // 1. The yes is given once, as the owner had: a first lesson from the online model.
  check("the online model can be chosen", await chooseCloud());
  await setTopic("Ohm's law");
  await explain();
  check("the first send asks first", await acceptNotice());
  const first = await waitFor(async () => ((await phase()) === "done" ? "done" : null), 90_000);
  check("the first lesson comes from the online model", first && cloudCalls(qa.fake).length >= 1, `${cloudCalls(qa.fake).length} calls`);

  // 2. The page again, as the owner opened it: sample topics, the online model chosen, the yes already given.
  await page.call("Page.reload");
  await waitFor(() => page.evaluate(`Boolean(document.querySelector("main.wb-page .wb-try button"))`), 30_000);
  await watch();
  await chooseCloud();
  const before = cloudCalls(qa.fake).length;
  const allBefore = qa.fake.seen.length;
  const chip = await page.evaluate(`(() => { const b = document.querySelector("main.wb-page .wb-try button"); const text = b.textContent; b.click(); return text; })()`);
  await sleep(4000);
  const afterChip = { calls: cloudCalls(qa.fake).length - before, any: sentOut(allBefore), seen: await seen(), phase: await phase(), topic: await page.evaluate(`document.querySelector('main.wb-page form.wb-ask input[type="text"]').value`) };
  check("a click on a sample topic sends nothing and shows no signal or notice", afterChip.calls === 0 && afterChip.any.length === 0 && afterChip.seen.signal === 0 && afterChip.seen.notice === 0, JSON.stringify(afterChip));
  check("the sample topic is put in the field, ready for Explain", afterChip.topic === chip && afterChip.phase === "idle", `${afterChip.topic} | ${afterChip.phase}`);

  for (const text of ["How does a transis", "How does a transistor work?"]) { await setTopic(text); await sleep(600); }
  await sleep(2500);
  const afterEdit = { calls: cloudCalls(qa.fake).length - before, any: sentOut(allBefore), seen: await seen() };
  check("editing the topic sends nothing and shows no signal", afterEdit.calls === 0 && afterEdit.any.length === 0 && afterEdit.seen.signal === 0 && afterEdit.seen.notice === 0, JSON.stringify(afterEdit));

  // 3. Explain: the lesson calls, with the signal.
  await explain();
  const done = await waitFor(async () => ((await phase()) === "done" ? "done" : null), 90_000, 200);
  const sent = cloudCalls(qa.fake).slice(before);
  const afterExplain = await seen();
  check("Explain sends the lesson calls with the topic, and the signal shows", done && sent.length >= 1 && sent[0].user.includes("transistor") && afterExplain.signal > 0 && afterExplain.notice === 0, JSON.stringify({ calls: sent.map((c) => c.user.slice(0, 50)), seen: afterExplain }));
} catch (e) {
  check("the run completed", false, e.stack || e);
} finally {
  await qa.stop();
}
fs.writeFileSync(path.join(work, "result.json"), JSON.stringify(checks, null, 2));
const failed = checks.filter((c) => !c.ok).length;
console.log(`${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
