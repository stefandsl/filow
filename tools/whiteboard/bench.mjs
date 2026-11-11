#!/usr/bin/env node
// The whiteboard lesson proof (docs/whiteboard/SPEC.md section 6): runs concepts through the real
// lesson route of a running Filow server (so the real prompts, schema, validation and the model the
// setup chose), then scores each lesson. Nothing here is paid: the route's local path talks to the
// Ollama on this PC. The cloud path is used only with --cloud and the recipient named on the command line.
//
// Usage: node tools/whiteboard/bench.mjs [--base http://127.0.0.1:4811] [--out <dir>] [--setup auto]
//        [--only 3] [--concepts "a|b|c"] [--set heldout] [--cloud --yes-send-to <recipient id>]
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
const HELD_OUT = [
  "The Doppler effect",
  "How do vaccines train the immune system?",
  "Bayes' rule",
  "How does a DNS lookup work?",
  "The derivative as a slope",
  "The water cycle",
  "How does public-key encryption work?",
  "Natural selection",
  "Kirchhoff's laws",
  "How does quicksort work?",
];
// --cloud: the same concepts through the cloud path of the server (its OPENROUTER_API_KEY). This is
// a paid call that sends the ten questions to the company the server names, so it only runs when
// the command itself names that recipient: --cloud --yes-send-to <recipient id>. Without the id
// the script prints who would receive the questions and stops.
const cloud = args.includes("--cloud");
let consent = "";
if (cloud) {
  const who = await (await fetch(`${arg("base", "http://127.0.0.1:4811")}/api/buddy/recipients`)).json();
  const id = who?.ask?.id;
  if (!id || arg("yes-send-to", "") !== id) {
    console.error(`The cloud run would send ten questions to: ${(who?.ask?.names ?? ["unknown"]).join(", ")} (recipient id "${id}").\nNothing was sent. To run it, repeat the command with: --cloud --yes-send-to ${id}`);
    process.exit(3);
  }
  consent = `ask:${id}`;
}
const CONCEPTS = (arg("concepts", "") || (arg("set", "first") === "heldout" ? HELD_OUT : [
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
]).join("|")).split("|").map((s) => s.trim()).filter(Boolean);
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
    res = await fetch(`${base}/api/whiteboard/lesson`, { method: "POST", headers: { "Content-Type": "application/json", ...(consent ? { "x-filow-consent": consent } : {}) }, body: JSON.stringify({ question, provider: cloud ? "cloud" : "local", setup }) });
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
    // drawing coverage: steps that draw something, relations of the checked plan that ended on the board, text cards
    cards: steps.length - drawn,
    planRelations: done?.relations ?? 0,
    planDrawn: done?.drawn ?? 0,
    problems: [...new Set(problems)],
    // the machine part of the verdict; a person adds "correct and in order"
    machinePass: !failure && steps.length >= 3 && drawn >= steps.length - 1 && drawn >= 3 && problems.length === 0,
  };
}

const describe = (it) =>
  it.kind === "node" ? `[${it.text}]` : it.kind === "edge" ? `${it.from}->${it.to}${it.text ? `(${it.text})` : ""}` : it.kind === "formula" ? `$${it.tex}$` : it.kind === "plot" ? `plot(${it.expr}, ${it.xmin}..${it.xmax})` : it.kind === "note" ? `note:"${it.text}"` : it.kind === "mark" ? `mark:${it.target}` : it.kind === "cells" ? `cells[${it.values.map((v, k) => (k === it.pointer ? `>${v}<` : v)).join(" ")}]` : it.kind;

/** The board at the end of the lesson, in words: what a reader of the picture would see. */
function finalBoard(lesson) {
  const names = new Map();
  const arrows = [];
  const other = [];
  for (const s of lesson.steps) for (const it of s.items) {
    if (it.kind === "node") names.set(it.id, it.text);
    else if (it.kind === "edge") arrows.push(it);
    else if (it.kind === "formula") other.push(`formula $${it.tex}$`);
    else if (it.kind === "plot") other.push(`plot of y = ${it.expr} for x from ${it.xmin} to ${it.xmax}`);
    else if (it.kind === "cells") other.push(`row of cells [${it.values.join(", ")}]${it.pointer >= 0 ? ` with a pointer under ${it.values[it.pointer]}` : ""}`);
    else if (it.kind === "note") other.push(`note "${it.text}"`);
  }
  const cards = lesson.steps.filter((s) => s.card).length;
  return [
    `Boxes (${names.size}): ${[...names.values()].join(", ") || "none"}.`,
    `Arrows (${arrows.length}): ${arrows.map((e) => `${names.get(e.from) ?? e.from} --${e.text || "(no label)"}--> ${names.get(e.to) ?? e.to}`).join("; ") || "none"}.`,
    `Also on the board: ${other.join("; ") || "nothing else"}.`,
    `Layout: ${lesson.scene}. Steps shown only as their sentence (text cards): ${cards} of ${lesson.steps.length}.`,
  ].join("\n");
}

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
    rows.push(`| ${n} | ${question} | ${r.model} | ${r.drawn}/${r.steps}, relations ${r.planDrawn}/${r.planRelations} | ${r.machinePass ? "pass" : "FAIL"} | ${r.problems.length ? r.problems.slice(0, 3).join("; ") : r.stalled ? "stalled" : "no layout problem"}; outline ${r.msOutline} ms, first step ${r.msFirstStep} ms, all ${r.msTotal} ms |`);
    detail.push(`## ${n}. ${question}\n\nTitle: ${r.lesson.title} (${r.lesson.scene}, ${r.lang})\n\n${r.lesson.steps.map((s, k) => `${k + 1}. ${s.say}\n   ${s.card ? "(text card)" : s.items.map(describe).join("  ")}`).join("\n")}\n\nFinal board:\n${finalBoard(r.lesson)}\n`);
  }
  console.log(rows[rows.length - 1]);
}
const passed = rows.filter((r) => r.includes("| pass |")).length;
const results = fs.readdirSync(out).filter((f) => /^lesson-\d+\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(out, f), "utf8"))).filter((r) => r.lesson);
const sum = (k) => results.reduce((a, r) => a + (r[k] || 0), 0);
const coverage = `Drawing coverage: ${sum("drawn")} of ${sum("steps")} steps draw something (${sum("cards")} text cards); ${sum("planDrawn")} of ${sum("planRelations")} relations of the checked plans are on the final boards.`;
console.log(coverage);
const summary = [`# Whiteboard lesson proof (machine checks)`, "", `Server ${base}, setup "${setup}", ${new Date().toISOString()}`, "", "| # | Concept | Model | Steps with a drawing | Machine checks | Notes |", "|---|---|---|---|---|---|", ...rows, "", `Machine pass: ${passed} of ${rows.length}`, "", coverage, "", ...detail].join("\n");
fs.writeFileSync(path.join(out, "summary.md"), summary);
console.log(`machine pass ${passed}/${rows.length}; details in ${path.join(out, "summary.md")}`);
