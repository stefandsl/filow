#!/usr/bin/env node
// The whiteboard lesson proof (docs/whiteboard/SPEC.md section 6): runs concepts through the real
// lesson route of a running Filow server (so the real prompts, schema, validation and the model the
// setup chose), then scores each lesson. Nothing here is paid: the route's local path talks to the
// Ollama on this PC. The cloud path is never used (provider is always "local").
//
// Usage: node tools/whiteboard/bench.mjs [--base http://127.0.0.1:4811] [--out <dir>] [--setup auto]
//        [--only 3] [--concepts "a|b|c"] [--lang-test]
// Writes <out>/lesson-<n>.json (events + lesson + score) and <out>/summary.md.
// The machine checks are: the lesson arrived, how many steps have a drawing, and no layout problem
// (overlap, off the board, cut label, arrow through a box) on any step of either board shape.
// "Correct and in order" is read by a person from summary.md: this script does not judge it.
import { buildSync } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..");
const base = arg("base", "http://127.0.0.1:4811");
const out = path.resolve(arg("out", path.join(ROOT, "tmp/whiteboard-bench")));
const setup = arg("setup", "auto");
const CONCEPTS = (arg("concepts", "") || [
  "How does photosynthesis work?",
  "Prove the Pythagorean theorem",
  "How does the TCP three-way handshake work?",
  "What is compound interest?",
  "How does a neural network learn?",
  "How does binary search work?",
  "The Krebs cycle in outline",
  "Supply and demand: how is a price set?",
  "Ohm's law",
  "What is recursion?",
].join("|")).split("|").map((s) => s.trim()).filter(Boolean);
const only = Number(arg("only", "0"));

fs.mkdirSync(out, { recursive: true });
const bundle = path.join(out, "layout.cjs");
buildSync({ entryPoints: [path.join(ROOT, "apps/web/lib/whiteboard/layout.ts")], bundle: true, platform: "node", format: "cjs", outfile: bundle, logLevel: "silent", alias: { "@": path.join(ROOT, "apps/web") } });
const { layoutBoard, layoutProblems } = (await import(pathToFileURL(bundle).href)).default;

async function runOne(question) {
  const t0 = Date.now();
  const events = [];
  let res;
  try {
    res = await fetch(`${base}/api/whiteboard/lesson`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, provider: "local", setup }) });
  } catch (e) {
    return { question, error: `server not reachable: ${e.message}`, events };
  }
  if (!res.ok) return { question, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, events };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) events.push({ ms: Date.now() - t0, ...JSON.parse(line) });
    }
  }
  const start = events.find((e) => e.type === "start");
  const outline = events.find((e) => e.type === "outline");
  const steps = events.filter((e) => e.type === "step").map((e) => e.step);
  const failure = events.find((e) => e.type === "error");
  const done = events.find((e) => e.type === "done");
  if (!outline || !steps.length) return { question, error: failure?.message ?? "no lesson", events, model: start?.model };
  const lesson = { title: outline.title, scene: outline.scene, steps };
  const problems = [];
  for (const shape of ["wide", "tall"]) for (let i = 0; i < steps.length; i++) for (const p of layoutProblems(layoutBoard(lesson, i, shape))) problems.push(`${shape} step ${i + 1}: ${p}`);
  const drawn = steps.filter((s) => !s.card).length;
  return {
    question,
    model: start?.model,
    lang: start?.lang,
    lite: start?.lite,
    lesson,
    events,
    msOutline: outline.ms,
    msFirstStep: events.find((e) => e.type === "step")?.ms,
    msTotal: events[events.length - 1].ms,
    steps: steps.length,
    drawn,
    stalled: Boolean(done?.stalled),
    problems: [...new Set(problems)],
    // the machine part of the verdict; a person adds "correct and in order"
    machinePass: !failure && steps.length >= 3 && drawn >= steps.length - 1 && drawn >= 3 && problems.length === 0,
  };
}

const describe = (it) =>
  it.kind === "node" ? `[${it.text}]` : it.kind === "edge" ? `${it.from}->${it.to}${it.text ? `(${it.text})` : ""}` : it.kind === "formula" ? `$${it.tex}$` : it.kind === "plot" ? `plot(${it.expr}, ${it.xmin}..${it.xmax})` : it.kind === "note" ? `note:"${it.text}"` : it.kind === "mark" ? `mark:${it.target}` : it.kind;

const rows = [];
const detail = [];
const list = only ? CONCEPTS.slice(only - 1, only) : CONCEPTS;
for (const [i, question] of list.entries()) {
  const n = only || i + 1;
  const r = await runOne(question);
  fs.writeFileSync(path.join(out, `lesson-${n}.json`), JSON.stringify(r, null, 1));
  if (r.error) {
    rows.push(`| ${n} | ${question} | ${r.model ?? "?"} | - | FAIL | ${r.error} |`);
    detail.push(`## ${n}. ${question}\n\nFAILED: ${r.error}\n`);
  } else {
    rows.push(`| ${n} | ${question} | ${r.model} | ${r.drawn}/${r.steps} | ${r.machinePass ? "pass" : "FAIL"} | ${r.problems.length ? r.problems.slice(0, 3).join("; ") : r.stalled ? "stalled" : "no layout problem"}; outline ${r.msOutline} ms, first step ${r.msFirstStep} ms, all ${r.msTotal} ms |`);
    detail.push(`## ${n}. ${question}\n\nTitle: ${r.lesson.title} (${r.lesson.scene}, ${r.lang})\n\n${r.lesson.steps.map((s, k) => `${k + 1}. ${s.say}\n   ${s.card ? "(text card)" : s.items.map(describe).join("  ")}`).join("\n")}\n`);
  }
  console.log(rows[rows.length - 1]);
}
const passed = rows.filter((r) => r.includes("| pass |")).length;
const summary = [`# Whiteboard lesson proof (machine checks)`, "", `Server ${base}, setup "${setup}", ${new Date().toISOString()}`, "", "| # | Concept | Model | Steps with a drawing | Machine checks | Notes |", "|---|---|---|---|---|---|", ...rows, "", `Machine pass: ${passed} of ${rows.length}`, "", ...detail].join("\n");
fs.writeFileSync(path.join(out, "summary.md"), summary);
console.log(`machine pass ${passed}/${rows.length}; details in ${path.join(out, "summary.md")}`);
