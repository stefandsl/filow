// AR-1 FIXED evaluator. The experimenting agent must never edit this file, measure.ar1.ts,
// vitest.ar1.config.ts, build-questions.mjs or questions.json. See ../program.md.
//
//   node tools/autoresearch/ar1/evaluate.mjs [--split dev|heldout] [--record-baseline] > run.log 2>&1
//
// Starts its own Ollama on 127.0.0.1:11435 with the tool's model store (G:/FILOW/tmp/latency/ollama-std,
// lfm3-vl, CPU only), asks the selected questions through the product path, stops Ollama and prints one
// summary block. Never touches the owner's Ollama on 11434. No online calls.
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const WORK = "G:/FILOW/tmp/autoresearch/ar1";
const PORT = 11435;
const LANGS = ["en", "it", "ru", "ro", "ja"];
// Budget: the dev split (30 per language) is subsampled evenly to DEV_PER_LANG per language, so one
// experiment takes about 5 minutes on this PC. The held-out split always runs in full (30 per language).
const DEV_PER_LANG = 6;
const KILL_MS = 10 * 60_000;
const HELDOUT_KILL_MS = 40 * 60_000;

const args = process.argv.slice(2);
const split = args.includes("--split") ? args[args.indexOf("--split") + 1] : "dev";
if (split !== "dev" && split !== "heldout") throw Error("--split must be dev or heldout");
// --smoke: one dev question per language, only to check the harness runs. Never a result.
const smoke = args.includes("--smoke");
const recordBaseline = args.includes("--record-baseline") && !smoke;

export function selectItems(questions, which, perLang = DEV_PER_LANG) {
  const pool = questions.items.filter(q => q.split === which).sort((a, b) => a.id - b.id);
  const chosen = which === "dev" ? Array.from({ length: perLang }, (_, i) => pool[Math.floor(i * pool.length / perLang)]) : pool;
  // Interleave languages so a slow drift in machine load hits all languages alike.
  return chosen.flatMap(q => LANGS.map(lang => ({ id: q.id, screen: q.screen, element: q.element, kind: q.kind, lang, text: q.text[lang] })));
}

// Model-written words in the question's language. The on-screen label (English) is removed first.
const WORDS = {
  en: "the is here this that button field it to you your click on of and at can find located lets used shows enter where for top bottom right left next press",
  it: "il lo gli le è qui ecco pulsante campo del della dello di per questo questa si trova che serve clicca puoi nel nella sul sulla basso alto destra sinistra inserire usato mostra premi dove sono con una uno al alla ti permette",
  ro: "este aici butonul câmpul campul pentru acest această aceasta află afla și în din cu poți apasă apasa folosește foloseste folosit arată arata unde sunt care jos sus dreapta stânga introduce butonului câmpului îți permite",
};
const SETS = Object.fromEntries(Object.entries(WORDS).map(([k, v]) => [k, new Set(v.split(" "))]));
export function inLanguage(text, lang, label) {
  const s = String(text ?? "").replace(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
  const latin = (s.match(/\p{Script=Latin}/gu) ?? []).length;
  const cyr = (s.match(/\p{Script=Cyrillic}/gu) ?? []).length;
  const cjk = (s.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu) ?? []).length;
  if (lang === "ja") return cjk >= 2 && cjk * 2 >= latin && cyr === 0;
  if (lang === "ru") return cyr >= 3 && cyr >= latin && cjk === 0;
  if (latin < 3 || cjk > 0 || cyr > latin * 0.1) return false;
  const words = s.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  const count = Object.fromEntries(Object.keys(SETS).map(k => [k, words.filter(w => SETS[k].has(w)).length + (k === "ro" ? words.filter(w => /[ăâîșțşţ]/u.test(w)).length : 0)]));
  return count[lang] > 0 && Object.keys(count).every(k => k === lang || count[lang] > count[k]);
}

const median = xs => { const a = xs.filter(x => Number.isFinite(x)).sort((p, q) => p - q); if (!a.length) return NaN; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

export function summarize(rows, baselineTtft) {
  const per = {};
  for (const lang of LANGS) {
    const r = rows.filter(x => x.lang === lang);
    const ok = r.filter(x => x.strict && inLanguage(x.words, lang, x.element)).length;
    per[lang] = { n: r.length, score: r.length ? 100 * ok / r.length : 0,
      wordless: r.length ? 100 * r.filter(x => !/[\p{L}\p{N}]/u.test(x.words ?? "")).length / r.length : 0,
      inlang: r.length ? 100 * r.filter(x => inLanguage(x.words, lang, x.element)).length / r.length : 0,
      pointing: r.length ? 100 * r.filter(x => x.strict).length / r.length : 0,
      ttft: median(r.map(x => x.firstTokenMs)) };
  }
  const ttft = median(rows.map(x => x.firstTokenMs));
  const raw = LANGS.reduce((s, l) => s + per[l].score, 0) / LANGS.length;
  const penalty = Number.isFinite(baselineTtft) && ttft > 1.1 * baselineTtft ? 10 : 0;
  return { per, ttft, raw, penalty, score: raw - penalty };
}

async function portFree(port) {
  const s = createServer();
  try { await new Promise((ok, no) => { s.once("error", no); s.listen(port, "127.0.0.1", ok); }); return true; } catch { return false; } finally { await new Promise(r => s.close(() => r())); }
}
const killTree = pid => { if (pid) { try { execFileSync("taskkill.exe", ["/pid", String(pid), "/t", "/f"], { windowsHide: true, timeout: 15000, stdio: "ignore" }); } catch { /* exited */ } } };
const git = (...a) => execFileSync("git", a, { cwd: REPO, encoding: "utf8" }).trim();

async function main() {
  const started = Date.now();
  fs.mkdirSync(`${WORK}/runs`, { recursive: true });
  fs.mkdirSync(`${WORK}/ollama-home`, { recursive: true });
  const commit = git("rev-parse", "--short=7", "HEAD");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const items = selectItems(JSON.parse(fs.readFileSync(path.join(HERE, "questions.json"), "utf8")), split, smoke ? 1 : DEV_PER_LANG);
  const itemsFile = `${WORK}/runs/${stamp}-${commit}-${split}-items.json`;
  const outFile = `${WORK}/runs/${stamp}-${commit}-${split}.jsonl`;
  fs.writeFileSync(itemsFile, JSON.stringify(items));
  const load = Number(execFileSync("powershell.exe", ["-NoProfile", "-Command", "(Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average"], { encoding: "utf8", windowsHide: true }).trim());
  if (!(await portFree(PORT))) { console.log(`---\nstatus: crash\nreason: port ${PORT} is busy`); process.exitCode = 2; return; }
  const home = `${WORK}/ollama-home`;
  const log = fs.openSync(`${WORK}/ollama.log`, "a");
  const ollama = spawn(path.join(process.env.LOCALAPPDATA, "Programs/Ollama/ollama.exe"), ["serve"], { windowsHide: true, stdio: ["ignore", log, log], env: { ...process.env,
    OLLAMA_HOST: `127.0.0.1:${PORT}`, OLLAMA_MODELS: "G:/FILOW/tmp/latency/ollama-std", OLLAMA_NOPRUNE: "1",
    USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, TEMP: home, TMP: home, CUDA_VISIBLE_DEVICES: "-1", HIP_VISIBLE_DEVICES: "-1", ROCR_VISIBLE_DEVICES: "-1", GGML_VK_VISIBLE_DEVICES: "-1", OLLAMA_LLM_LIBRARY: "cpu" } });
  let worker = null; let crashed = null;
  const timer = setTimeout(() => { crashed = "time budget exceeded"; killTree(worker?.pid); }, split === "dev" ? KILL_MS : HELDOUT_KILL_MS);
  const stop = () => { killTree(worker?.pid); killTree(ollama.pid); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      try { ready = (await fetch(`http://127.0.0.1:${PORT}/api/version`, { signal: AbortSignal.timeout(1000) })).ok; } catch { await new Promise(r => setTimeout(r, 500)); }
    }
    if (!ready) throw Error("Ollama did not start");
    fs.mkdirSync(`${WORK}/tmp`, { recursive: true });
    const vitest = path.join(REPO, "node_modules/vitest/vitest.mjs");
    worker = spawn(process.execPath, [vitest, "run", "--root", REPO, "--config", path.join(HERE, "vitest.ar1.config.ts")], { cwd: REPO, windowsHide: true, stdio: "inherit",
      env: { ...process.env, AR1_BASE: `http://127.0.0.1:${PORT}`, AR1_ITEMS: itemsFile, AR1_OUT: outFile, TEMP: `${WORK}/tmp`, TMP: `${WORK}/tmp` } });
    const code =await new Promise(r => worker.once("exit", r));
    if (code !== 0 && !crashed) crashed = `worker exit ${code}`;
  } catch (e) { crashed = e.message; } finally { clearTimeout(timer); stop(); fs.closeSync(log); }
  const rows = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l)) : [];
  if (!crashed && rows.length !== items.length) crashed = `answers ${rows.length}/${items.length}`;
  const baseFile = `${WORK}/baseline-${split}.json`;
  const baseline = fs.existsSync(baseFile) ? JSON.parse(fs.readFileSync(baseFile, "utf8")) : null;
  const s = summarize(rows, baseline?.ttft_p50_ms);
  if (recordBaseline && !crashed) fs.writeFileSync(baseFile, JSON.stringify({ commit, ttft_p50_ms: s.ttft, at: new Date().toISOString() }) + "\n");
  console.log("---");
  console.log(`status:        ${crashed ? "crash" : "ok"}${crashed ? `\nreason:        ${crashed}` : ""}`);
  console.log(`score:         ${crashed ? "0.00" : s.score.toFixed(2)}`);
  console.log(`raw_score:     ${s.raw.toFixed(2)}`);
  console.log(`ttft_penalty:  ${s.penalty}`);
  console.log(`ttft_p50_ms:   ${Math.round(s.ttft)}`);
  console.log(`baseline_ttft: ${baseline ? Math.round(baseline.ttft_p50_ms) : "none"}`);
  for (const l of LANGS) { const p = s.per[l]; console.log(`${l}: score ${p.score.toFixed(1)} inlang ${p.inlang.toFixed(1)} pointing ${p.pointing.toFixed(1)} wordless ${p.wordless.toFixed(1)} ttft ${Math.round(p.ttft)} n ${p.n}`); }
  console.log(`wordless_rate: ${(LANGS.reduce((a, l) => a + s.per[l].wordless, 0) / LANGS.length).toFixed(1)}`);
  console.log(`pointing_rate: ${(LANGS.reduce((a, l) => a + s.per[l].pointing, 0) / LANGS.length).toFixed(1)}`);
  console.log(`split:         ${split} (${items.length} answers, seed 20261114, dev ${DEV_PER_LANG}/lang)`);
  console.log(`cpu_load_at_start: ${load}%${load > 30 ? " (other load: timing observational)" : ""}`);
  console.log(`seconds:       ${((Date.now() - started) / 1000).toFixed(1)}`);
  console.log(`commit:        ${commit}`);
  console.log(`raw:           ${outFile}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
