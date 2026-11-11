// Measures the punctuation and capitals model (Horizon-Labs/multilingual-punctuation-truecase-small,
// onnx/model_quantized.onnx) on Filow's samples, on the CPU, with the same text code the app would use
// (apps/desktop/truecase-text.js).
//
// usage: node tools/dictation/truecase-measure.mjs <model dir> <out.json> [--threads N]
//          [--samples tools/dictation/cleanup-multi-samples.json]   text samples: the expected text with
//                                                                    marks and capitals taken out goes in
//          [--engine <engine-output.json>]                           or: what a speech engine really wrote
// Verdict per text sample against the expected text:
//   exact       the expected text, character for character
//   acceptable  only commas differ (one more or one fewer)
//   incomplete  something is still missing (a capital on a name or an acronym, a question mark written
//               as a full stop, a full stop inside) but nothing wrong was added
//   harmful     something wrong was added: a capital on an ordinary word, a sentence end in the middle
//               of a sentence, a question mark on a statement
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ort = require("onnxruntime-node");
const { Tokenizer } = require("@huggingface/tokenizers");
const tc = require("../../apps/desktop/truecase-text.js");
const punct = require("../../apps/desktop/dictation-punctuate.js"); // the same decision and combination the app makes

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i < 0 ? dflt : args[i + 1]; };
const [modelDir, outFile] = args;
const threads = Number(opt("threads", "4"));
const read = (f) => JSON.parse(fs.readFileSync(path.join(modelDir, f), "utf8"));
const config = read("config.json");
const tokenizer = new Tokenizer(read("tokenizer.json"), read("tokenizer_config.json"));
const t0 = performance.now();
const session = await ort.InferenceSession.create(path.join(modelDir, "onnx", "model_quantized.onnx"), { intraOpNumThreads: threads, executionProviders: ["cpu"] });
const loadMs = Math.round(performance.now() - t0);

async function restore(text, lang) {
  const clean = tc.stripMarks(text);
  const lower = tc.lowerKeepLength(clean);
  const pieces = tokenizer.tokenize(lower, { add_special_tokens: false });
  const ids = tokenizer.encode(lower, { add_special_tokens: false }).ids;
  if (ids.length !== pieces.length) return { text: null, why: "pieces and ids differ" };
  const input = [config.cls_token_id, ...ids, config.sep_token_id ?? config.eos_token_id];
  const feeds = { input_ids: new ort.Tensor("int64", BigInt64Array.from(input.map(BigInt)), [1, input.length]) };
  if (session.inputNames.includes("attention_mask")) feeds.attention_mask = new ort.Tensor("int64", BigInt64Array.from(input.map(() => 1n)), [1, input.length]);
  const out = await session.run(feeds);
  const logits = out[session.outputNames[0]];
  const n = logits.dims[2];
  const labels = [];
  for (let i = 1; i < input.length - 1; i++) {
    let best = 0;
    for (let k = 1; k < n; k++) if (logits.data[i * n + k] > logits.data[i * n + best]) best = k;
    labels.push(config.id2label[best]);
    if (process.env.TC_DEBUG && best !== 0) {
      let sum = 0;
      for (let k = 0; k < n; k++) sum += Math.exp(logits.data[i * n + k] - logits.data[i * n + best]);
      console.log(`      ${pieces[i - 1]} ${config.id2label[best]} p=${(1 / sum).toFixed(2)}`);
    }
  }
  const done = punct.combine(text, pieces, labels, lang);
  return done === null ? { text: null, why: "not the same words" } : { text: done, pieces: pieces.length };
}

// ---- verdict ----
const WORD_MARK = /[.,?:。、，？：]/;
function units(text, lang) {
  // [{ w: the word (or, in Japanese, one character), m: the marks after it }]
  const out = [];
  if (lang === "ja") {
    for (const ch of text) { if (WORD_MARK.test(ch) || ch === " ") { if (out.length && ch !== " ") out[out.length - 1].m += ch; } else out.push({ w: ch, m: "" }); }
    return out;
  }
  for (const raw of text.split(" ").filter(Boolean)) {
    if (raw === "-") continue;
    const m = /^(.*?)([.,?:!;]*)$/.exec(raw);
    out.push({ w: m[1], m: m[2] });
  }
  return out;
}
const END = /[.?。？]/;
const COMMA = /[,、，]/;
function verdict(got, expected, lang) {
  if (got === expected) return { verdict: "exact", notes: [] };
  const g = units(got, lang), e = units(expected, lang);
  if (g.length !== e.length || g.some((u, i) => u.w.toLowerCase() !== e[i].w.toLowerCase())) return { verdict: "harmful", notes: ["the words changed"] };
  const added = [], missing = [], commas = [];
  const split = new Set(); // words that start a sentence because a comma was written as a full stop: their capital is right
  g.forEach((u, i) => {
    const x = e[i];
    const next = g[i + 1];
    if (lang !== "ja" && next && END.test(u.m) && COMMA.test(x.m) && !END.test(x.m) && next.w[0] !== next.w[0].toLowerCase()) split.add(i + 1);
  });
  g.forEach((u, i) => {
    const x = e[i];
    if (split.has(i + 1)) { commas.push(`a sentence end for the comma after "${u.w}"`); return; }
    if (split.has(i) && u.w.toLowerCase() === x.w.toLowerCase() && u.w.slice(1) === x.w.slice(1) && u.m === x.m) return;
    // a comma followed by a capital the text does not have there: the model's known weak spot
    if (lang !== "ja" && g[i + 1] && COMMA.test(u.m) && !END.test(u.m) && END.test(x.m)) { added.push(`a comma, then a capital, for the sentence end after "${u.w}"`); return; }
    if (u.w !== x.w) {
      const moreCaps = [...u.w].filter((c, k) => c !== x.w[k] && c === c.toUpperCase()).length > 0;
      (moreCaps ? added : missing).push(`capital: "${u.w}" for "${x.w}"`);
    }
    if (u.m !== x.m) {
      const gEnd = END.test(u.m), xEnd = END.test(x.m);
      const last = i === g.length - 1;
      if (gEnd && !xEnd) added.push(`sentence end after "${u.w}"`);
      else if (!gEnd && xEnd) missing.push(`no ${x.m} after "${x.w}"`);
      else if (gEnd && xEnd) (/[?？]/.test(u.m) ? added : missing).push(`${u.m} for ${x.m} after "${u.w}"${last ? "" : " (inside)"}`);
      else if (COMMA.test(u.m) || COMMA.test(x.m)) commas.push(`comma ${COMMA.test(u.m) ? "added" : "left out"} after "${u.w}"`);
      else (u.m ? added : missing).push(`"${u.m}" for "${x.m}" after "${u.w}"`);
    }
  });
  if (added.length) return { verdict: "harmful", notes: [...added, ...missing, ...commas] };
  if (missing.length) return { verdict: "incomplete", notes: [...missing, ...commas] };
  return { verdict: "acceptable", notes: commas };
}

const rows = [];
const times = [];
if (opt("engine")) {
  for (const r of JSON.parse(fs.readFileSync(opt("engine"), "utf8"))) {
    const w = punct.wanted(r.typed, { language: r.lang });
    if (!w.ok) { rows.push({ id: r.id, lang: r.lang, model: r.model, expected: r.expected, before: r.typed, after: r.typed, skipped: w.reason, sameLetters: true, ms: 0 }); continue; }
    const t = performance.now();
    const res = await restore(r.typed, r.lang);
    const ms = performance.now() - t;
    times.push(ms);
    // what the app would type: the recognizer's own text with the model's marks and capitals laid over it
    const after = res.text ?? r.typed;
    rows.push({ id: r.id, lang: r.lang, model: r.model, expected: r.expected, before: r.typed, after, sameLetters: tc.skeleton(after) === tc.skeleton(r.typed), ms: Math.round(ms), why: res.why });
  }
} else {
  const samples = JSON.parse(fs.readFileSync(opt("samples", "tools/dictation/cleanup-multi-samples.json"), "utf8"));
  await restore("warm up the model once", "en");
  for (const s of samples) {
    const before = tc.lowerKeepLength(tc.stripMarks(s.text));
    const t = performance.now();
    const res = await restore(before, s.lang);
    const ms = performance.now() - t;
    times.push(ms);
    const after = res.text ?? before;
    rows.push({ id: s.id, lang: s.lang, class: s.class, expected: s.text, before, after, ...verdict(after, s.text, s.lang), sameLetters: tc.skeleton(after) === tc.skeleton(before), ms: Math.round(ms), why: res.why });
  }
}
times.sort((a, b) => a - b);
const summary = { threads, loadMs, medianMs: Math.round(times[Math.floor(times.length / 2)]), p90Ms: Math.round(times[Math.floor(times.length * 0.9)]), maxMs: Math.round(times.at(-1)), rssMb: Math.round(process.memoryUsage().rss / 1048576), byLang: {} };
for (const r of rows) if (r.verdict) { const b = (summary.byLang[r.lang] ||= { exact: 0, acceptable: 0, incomplete: 0, harmful: 0 }); b[r.verdict]++; }
fs.writeFileSync(outFile, JSON.stringify({ summary, rows }, null, 2));
console.log(JSON.stringify(summary));
for (const r of rows) console.log(`${r.id} ${r.verdict ?? r.skipped ?? ""} ${r.ms} ms${r.sameLetters ? "" : " LETTERS CHANGED"}\n   in : ${r.before}\n   out: ${r.after}${r.notes?.length ? `\n   (${r.notes.join("; ")})` : ""}`);
