import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import daily from "../../../apps/desktop/day-by-day.js";
import disk from "../../../apps/desktop/day-by-day-store.js";

export const digest = bytes => createHash("sha256").update(bytes).digest("hex");

// Exercise the real controller, confirmation and journal. Only the acoustic model is replaced.
export async function trial(tasks, c, dir) {
  const store = disk.openDailyStore(dir);
  const worker = { ready: true, context: 0, worker: { postMessage(m) { worker.context = m.context; } },
    start: async () => ({ model: "text replay" }), dispose() {}, feed() {} };
  const app = daily.createDaily({ store, recognizer: () => worker });
  let v = app.control("open");
  const ids = [];
  for (const [i, text] of tasks.entries()) {
    v = app.control("create", { ...v, text, op: randomUUID() });
    ids.push(v.ack.id);
    if (c.completed?.includes(i)) v = app.control("complete", { ...v, ...v.ack, op: randomUUID() });
  }
  const initial = v.version;
  const capture = randomUUID();
  await app.control("arm", { ...v, capture });
  app.feed({ session: v.session, capture }, new Float32Array(1600));
  const event = { context: worker.context, sequence: 1, committed: c.utterance };
  if (c.source && c.source !== "daily") app.control("disarm", { ...v, capture });
  worker.onResult(c.partial ? { ...event, committed: "", partial: c.utterance } : event);
  worker.onResult(event.committed && !c.partial ? event : { ...event, committed: "" });
  v = app.control("state", v);
  assert.ok(!v.review || v.review.type === "create", "Speech without Gemma can only draft a task");
  if (!v.review && !c.partial && (!c.source || c.source === "daily")) {
    v = app.control("review", { ...v, text: c.utterance, op: randomUUID() });
  }
  const unconfirmed = v.version - initial;
  const r = v.review;
  let ack = null;
  let duplicates = 0;
  if (r) {
    const target = r.targets.length === 1 ? r.targets[0] : null;
    // Apply the same choice policy to every report, without consulting its label or expected ID.
    if ((r.type === "create" && c.interaction === "saveDraft") || target) {
      const input = { token: r.token, id: target?.id, text: r.text };
      v = app.control("confirm", { ...v, ...input });
      ack = v.ack;
      if (app.control("confirm", { ...v, ...input }).ack) duplicates++;
    } else app.control("dismiss", { ...v, token: r.token });
  }
  const saved = disk.openDailyStore(dir).view();
  app.close();
  const row = saved.tasks.find(t => t.id === ack?.id);
  return { unconfirmed, mutations: saved.version - initial, duplicates, which: Boolean(r?.which),
    type: r?.type, target: ids.indexOf(ack?.id), done: row?.done, evidence: row?.evidence === c.utterance };
}

export async function score(input, temp = os.tmpdir()) {
  const languages = input.languages || { [input.language]: input };
  assert.ok(Object.keys(languages).length);
  const results = {};
  for (const [language, suite] of Object.entries(languages)) {
    assert.ok(["en", "it"].includes(language) && Array.isArray(suite.tasks) && suite.cases?.length, "Missing language, tasks or cases");
    const m = { cases: 0, clearCases: 0, tickCases: 0, correctTicks: 0, negativeCases: 0, wrongMutations: 0,
      misses: 0, clarificationOnClear: 0, correctionCases: 0, correctionsRecovered: 0, duplicateAcknowledgements: 0,
      unexpectedUnconfirmed: 0, ordinarySpeechSeconds: null, failed: [] };
    for (const [i, c] of suite.cases.entries()) {
      assert.ok(typeof c.utterance === "string" && [0, 1].includes(c.expectedMutations), "Invalid case");
      const dir = fs.mkdtempSync(path.join(temp, "daily-score-"));
      let r;
      try { r = await trial(c.tasks || suite.tasks, c, dir); }
      finally { fs.rmSync(dir, { recursive: true, force: true }); }
      m.cases++;
      const expected = c.expectedMutations;
      const repair = c.kind === "correction";
      const draft = c.interaction === "saveDraft";
      if (expected && !draft) assert.ok(Number.isInteger(c.target) && c.target >= 0 && c.target < (c.tasks || suite.tasks).length, "Expected target index required");
      const correct = expected && r.mutations === 1 && (draft ? r.type === "create" : r.target === c.target && r.done === !repair && r.evidence);
      if (!expected) m.negativeCases++;
      else if (repair) { m.correctionCases++; if (correct) m.correctionsRecovered++; }
      else if (!draft) { m.tickCases++; if (correct) m.correctTicks++; }
      if (!c.expectPersonQuestion) { m.clearCases++; if (r.which) m.clarificationOnClear++; }
      m.unexpectedUnconfirmed += r.unconfirmed;
      m.duplicateAcknowledgements += r.duplicates;
      if (r.mutations && !correct) m.wrongMutations += r.mutations;
      if (expected && !correct) m.misses++;
      if (r.unconfirmed || r.duplicates || (expected ? !correct : r.mutations !== 0) || r.which !== Boolean(c.expectPersonQuestion)) m.failed.push(c.id ?? i);
    }
    results[language] = m;
  }
  return { route: "no-model speech drafts and typed reports with explicit confirmation", n06: "unqualified", input: "text",
    verdict: Object.values(results).every(m => !m.failed.length) ? "PASS" : "HOLD", languages: results };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const bytes = fs.readFileSync(process.argv[2] || new URL("./n05-dev-cases.json", import.meta.url));
  const result = await score(JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")));
  console.log(JSON.stringify({ ...result, inputSha256: digest(bytes), scorerSha256: digest(fs.readFileSync(fileURLToPath(import.meta.url))) }));
  if (result.verdict !== "PASS") process.exitCode = 1;
}
