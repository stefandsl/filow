import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createRequire, Module } from "node:module";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

import { privatePath } from "./n06-eval.mjs";

const hash = v => createHash("sha256").update(v).digest("hex");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value), { flag: "wx" });
const allowance = 1000000; // integer micro-euros, shared by both arms

// Each reservation is durable and non-refundable. An interrupted lock or incomplete record holds sends.
export function reserve(folder, id, microEur) {
  assert.match(id, /^[a-f0-9-]{36}$/);
  assert.ok(Number.isSafeInteger(microEur) && microEur > 0, "Unknown worst-case cost");
  const lock = path.join(folder, "reserve.lock");
  fs.mkdirSync(lock);
  try {
    let total = microEur;
    for (const file of fs.readdirSync(folder).filter(f => f.endsWith(".charge"))) {
      const paid = read(path.join(folder, file));
      assert.ok(Number.isSafeInteger(paid) && paid > 0, "Invalid reservation");
      total += paid;
    }
    assert.ok(total <= allowance, "Cumulative EUR 1 allowance exhausted");
    const fd = fs.openSync(path.join(folder, id + ".charge"), "wx");
    try { fs.writeFileSync(fd, JSON.stringify(microEur)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    return total;
  } finally { fs.rmdirSync(lock); }
}

function armTools(root) {
  const load = createRequire(path.resolve(root, "package.json"));
  const { buildSync } = load("esbuild");
  const web = path.join(root, "apps/web"), directory = path.join(web, "lib/whiteboard");
  const bundle = (contents, browser) => buildSync({ stdin: { contents, resolveDir: directory }, absWorkingDir: root,
    alias: { "@": web }, bundle: true, write: false, logLevel: "silent", platform: browser ? "browser" : "node",
    format: browser ? "iife" : "cjs", ...(browser ? {
      loader: { ".css": "empty", ".woff2": "dataurl", ".woff": "dataurl", ".ttf": "dataurl", ".svg": "dataurl" },
      define: { "process.env.NODE_ENV": '"production"' }
    } : { packages: "external" }) }).outputFiles[0].text;
  const filename = path.join(web, "n06-arm.cjs"), module = new Module(filename);
  module.filename = filename; module.paths = Module._nodeModulePaths(web);
  // Bundle aliases but let the pinned installation resolve npm packages.
  module._compile(bundle('export {generateCloud,texOk} from "./generate";export {validateLesson} from "./lesson";export {layoutBoard} from "./layout";export {sceneFromLayout,boardLesson} from "./scene";', false), filename);
  return { ...module.exports, browser: () => bundle('import {prepareScene,sceneSvg} from "./excalidraw"; window.renderN06=async scene=>{const s=await prepareScene(scene);return (await sceneSvg(s.elements,s.files,{dark:false})).outerHTML};', true) };
}

export async function trial(spec, topic, ledger, exchange, api) {
  const calls = [], events = [];
  const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" + spec.model + ":generateContent";
  assert.match(spec.model, /^gemini-[a-z0-9.-]*flash[a-z0-9.-]*$/);
  const ask = async call => {
    const id = randomUUID(), promptHash = hash(JSON.stringify(call));
    const quote = await exchange({ type: "quote", id, endpoint, model: spec.model, promptHash, call });
    assert.equal(quote.id, id);
    reserve(ledger, id, quote.maxMicroEur);
    const reservation = { id, trial: spec.trialId, sha: spec.sha, promptHash, model: spec.model, maxMicroEur: quote.maxMicroEur };
    save(path.join(ledger, id + ".request"), reservation);
    calls.push(reservation);
    const reply = await exchange({ type: "send-once", id, promptHash, endpoint });
    assert.ok(reply.id === id && reply.endpoint === endpoint && reply.model === spec.model && typeof reply.text === "string");
    return reply.text;
  };
  await api.generateCloud(ask, { question: topic, lang: spec.locale, maxSteps: spec.maxSteps, audit: false }, e => events.push(e));
  const outline = events.find(e => e.type === "outline"), steps = events.filter(e => e.type === "step").map(e => e.step);
  const lesson = outline && events.at(-1)?.type === "done" && api.validateLesson({ ...outline, steps }, { maxSteps: spec.maxSteps, texOk: api.texOk, sketch: true });
  if (!lesson) return { calls, delivered: false, renderFailure: false };
  const scenes = lesson.steps.map((_, i) => api.sceneFromLayout(api.layoutBoard(api.boardLesson(lesson), i, "wide")));
  // The operator runs the supplied arm's renderN06(scene) in an isolated browser and returns the SVGs.
  const rendered = await exchange({ type: "render", script: api.browser(), scenes });
  if (!Array.isArray(rendered.svg) || rendered.svg.length !== scenes.length ||
      !rendered.svg.every(s => typeof s === "string" && /^<svg\b/.test(s) && /<(?:path|text|g)\b/.test(s))) {
    return { calls, delivered: false, renderFailure: true };
  }
  return { calls, delivered: true, renderFailure: false, lesson, svg: rendered.svg, renderHash: hash(JSON.stringify([lesson, rendered.svg])) };
}

export function grades(receipts, reviews) {
  assert.ok(receipts.every(r => r.topicHash === receipts[0].topicHash && r.model === receipts[0].model), "Mixed topics or models");
  const ids = new Set(receipts.map(r => r.id));
  assert.equal(ids.size, receipts.length);
  const graded = new Map(reviews.map(r => [r.id, r]));
  assert.equal(graded.size, reviews.length);
  assert.ok(reviews.every(g => ids.has(g.id)));
  const arms = [];
  for (const sha of new Set(receipts.map(r => r.sha))) {
    const rows = receipts.filter(r => r.sha === sha);
    const totals = { sha, attempted: 0, delivered: 0, renderFailures: 0, graded: 0, criticalErrors: 0, auditReplays: 0 };
    for (const r of rows) {
      if (r.auditReplay) { totals.auditReplays++; continue; }
      totals.attempted++;
      if (r.renderFailure) totals.renderFailures++;
      if (!r.delivered) { assert.ok(!graded.has(r.id)); continue; }
      assert.ok(r.lesson?.steps?.length && r.svg?.length === r.lesson.steps.length && r.svg.every(s => typeof s === "string" && /^<svg\b/.test(s)));
      assert.equal(r.renderHash, hash(JSON.stringify([r.lesson, r.svg])), "Rendered material changed");
      totals.delivered++;
      const g = graded.get(r.id);
      if (!g) continue;
      assert.ok(g.renderHash === r.renderHash && Number.isSafeInteger(g.criticalErrors) && g.criticalErrors >= 0);
      totals.graded++; totals.criticalErrors += g.criticalErrors;
    }
    arms.push({ ...totals, factualBar: totals.graded >= 20 && totals.graded === totals.delivered && totals.criticalErrors === 0 && totals.renderFailures === 0 });
  }
  return arms;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [verb, ...args] = process.argv.slice(2);
  const [specFile, topicFile, ledger, receiptFile] = args.map(privatePath);
  if (verb === "grade") console.log(JSON.stringify(grades(read(specFile), read(topicFile))));
  else if (verb === "freeze") {
    const settings = read(specFile);
    assert.ok(settings.armShas?.length === 2 && new Set(settings.armShas).size === 2 && settings.armShas.every(s => /^[a-f0-9]{40}$/.test(s)));
    assert.ok(settings.armShas.includes("a21db5ad9a08e081baa8cb6b04921eb5450404fe"), "Missing pinned base");
    assert.ok(settings.gradedTrials >= 20 && Number.isInteger(settings.gradedTrials));
    assert.match(settings.questionHash, /^[0-9a-f]{64}$/);
    save(path.join(topicFile, "lesson-freeze.json"), settings);
  }
  else {
    assert.equal(verb, "generate");
    const spec = read(specFile), topic = read(topicFile);
    assert.ok(typeof topic === "string" && topic.trim(), "Pass only the frozen question");
    assert.equal(hash(Buffer.from(topic)), spec.questionHash);
    assert.ok(Number.isInteger(spec.maxSteps) && spec.maxSteps >= 2 && spec.maxSteps <= 7);
    assert.match(spec.sha, /^[0-9a-f]{40}$/);
    assert.equal(execFileSync("git", ["-C", spec.root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), spec.sha);
    assert.equal(execFileSync("git", ["--no-optional-locks", "-C", spec.root, "status", "--porcelain"], { encoding: "utf8" }).trim(), "");
    const frozen = read(path.join(ledger, "lesson-freeze.json"));
    for (const key of ["questionHash","model","locale","maxSteps"]) assert.equal(spec[key], frozen[key], "Different arm settings");
    assert.ok(frozen.armShas.includes(spec.sha));
    assert.ok(Number.isInteger(spec.trial) && spec.trial >= 1 && spec.trial <= frozen.gradedTrials);
    const id = randomUUID();
    save(path.join(ledger, spec.sha + "-" + spec.trial + ".attempt"), id);
    spec.trialId = id;
    const started = { id, sha: spec.sha, model: spec.model, topicHash: spec.questionHash, start: new Date().toISOString() };
    save(receiptFile + ".start", started);
    const channel = createInterface({ input: process.stdin, terminal: false });
    const lines = channel[Symbol.asyncIterator]();
    const deadline = Date.now() + 24 * 60000;
    const exchange = async msg => {
      process.stdout.write(JSON.stringify(msg) + "\n");
      let timer;
      const expired = new Promise((_, reject) => { timer = setTimeout(() => reject(Error("Operator exchange timed out")), Math.max(1, Math.min(240000, deadline - Date.now()))); });
      let line;
      try { line = await Promise.race([lines.next(), expired]); } finally { clearTimeout(timer); }
      assert.ok(!line.done, "Operator transport interrupted");
      return JSON.parse(line.value);
    };
    try {
      const result = await trial(spec, topic, ledger, exchange, armTools(path.resolve(spec.root)));
      save(receiptFile, { ...started, ...result, end: new Date().toISOString() });
    } catch (error) {
      if (!fs.existsSync(receiptFile)) save(receiptFile, { ...started, delivered: false, interrupted: true, end: new Date().toISOString() });
      throw error;
    } finally { channel.close(); }
  }
}
