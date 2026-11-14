// Offline generation only. Start an owned, manifest-verified llama-server first.
// node tools/eval/g2-generate.mjs <task root> <frozen model id> <development|heldout>
// Held-out factual/preference scoring intentionally does not exist in this program.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { blindRecord, repairBudget, requireFrozen, requireModel, sha256 } from './g2-protocol.mjs';

const [root, modelId, split] = process.argv.slice(2);
if (!root || !['development', 'heldout'].includes(split)) throw new Error('Expected task root, model id and split');
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const frozen = requireFrozen(root, source);
const model = frozen.models.find((m) => m.id === modelId);
if (!model) throw new Error('Model is not frozen');
requireModel(model);
const smoke = JSON.parse(fs.readFileSync(path.join(root, `smoke-${modelId}.json`), 'utf8'));
if (!smoke.passed) throw new Error('Runtime smoke did not pass');
const bundle = path.join(root, 'temp', 'generation.cjs');
buildSync({ stdin: { contents: 'export * from "./apps/web/lib/whiteboard/generate"; export * from "./apps/web/lib/whiteboard/lesson";', resolveDir: source }, bundle: true, platform: 'node', format: 'cjs', outfile: bundle, alias: { '@': path.join(source, 'apps/web') } });
const { generateLocal, validateLesson, texOk } = createRequire(import.meta.url)(bundle);
let topics = frozen.development;
let key;
if (split === 'heldout') {
  // The topics belong to the orchestrator; the arm mapping stays outside the blind tree.
  if (sha256(frozen.heldout.path) !== frozen.heldout.sha256) throw new Error('Held-out topics changed after freeze');
  const supplied = JSON.parse(fs.readFileSync(frozen.heldout.path, 'utf8').replace(/^\uFEFF/, ''));
  topics = Array.isArray(supplied) ? supplied : supplied.topics;
  if (!Array.isArray(topics) || topics.length !== 20) throw new Error('Expected 20 supplied held-out topics');
  key = JSON.parse(fs.readFileSync(frozen.heldout.mapping, 'utf8'));
}
topics = topics.map((topic) => ({ ...topic, question: topic.question ?? topic.topic }));
if (topics.some((topic) => typeof topic.question !== 'string' || !topic.question.trim())) throw new Error('A topic has no question');
const outRoot = path.join(root, split);
fs.mkdirSync(outRoot, { recursive: true });
for (const topic of topics) {
  if (!/^[a-zA-Z0-9_-]+$/.test(topic.id)) throw new Error('Unsafe topic id');
  const arm = split === 'heldout' ? key[topic.id]?.[modelId] : modelId;
  if (!arm || !/^[a-zA-Z0-9_-]+$/.test(arm)) throw new Error('Missing independent arm assignment');
  const out = path.join(outRoot, topic.id, arm);
  if (fs.existsSync(path.join(out, 'result.json'))) throw new Error('Refusing to replace a sample');
  fs.mkdirSync(out, { recursive: true });
  const start = performance.now();
  const limit = AbortSignal.timeout(frozen.generation.lessonTimeoutMs);
  const budget = repairBudget();
  const calls = [], events = [];
  let firstMeaningfulStepMs = null, repairMs = 0, error = null;
  const ask = async (call) => {
    if (limit.aborted) throw new Error('Lesson timed out');
    const before = budget.used;
    budget.visit(call);
    const repair = budget.used > before;
    const began = performance.now();
    const response = await fetch('http://127.0.0.1:5011/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.any([limit, AbortSignal.timeout(call.timeoutMs)]),
      body: JSON.stringify({ model: 'local', messages: [{ role: 'system', content: call.system }, { role: 'user', content: call.user }], max_tokens: call.maxTokens, temperature: call.temperature ?? 0.2, seed: 42, stream: false, cache_prompt: false, chat_template_kwargs: { enable_thinking: false }, ...(call.format ? { response_format: { type: 'json_schema', json_schema: { name: 'lesson', schema: call.format } } } : {}) }),
    });
    if (!response.ok) throw new Error(`Local inference failed: ${response.status}`);
    const responseBody = await response.json();
    const elapsed = performance.now() - began;
    if (repair) repairMs += elapsed;
    const text = responseBody.choices?.[0]?.message?.content ?? '';
    calls.push({ request: call, text, elapsedMs: elapsed, repair, usage: responseBody.usage, timings: responseBody.timings });
    return text;
  };
  try {
    await generateLocal(ask, { ...frozen.generation.request, question: topic.question, lang: topic.lang }, (event) => {
      events.push(event);
      if (event.type === 'step' && event.step.say && event.step.items.length && firstMeaningfulStepMs === null) firstMeaningfulStepMs = performance.now() - start;
    });
  } catch (e) { error = String(e); }
  const outline = events.find((e) => e.type === 'outline');
  const steps = events.filter((e) => e.type === 'step').map((e) => e.step);
  const lesson = outline ? validateLesson({ title: outline.title, scene: outline.scene, steps }, { maxSteps: 4, texOk }) : null;
  const result = { lesson, validity: Boolean(lesson && events.some((e) => e.type === 'done') && !error), repairUsed: budget.used > 0, repairMs, firstMeaningfulStepMs, totalMs: performance.now() - start, memoryPeakBytes: null, error };
  // Full raw evidence is always outside the blind tree.
  const rawDir = path.join(root, 'raw', split, topic.id);
  fs.mkdirSync(rawDir, { recursive: true });
  fs.writeFileSync(path.join(rawDir, `${modelId}.json`), JSON.stringify({ topic, calls, events, result }, null, 2));
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(split === 'heldout' ? blindRecord(result) : result, null, 2));
  if (lesson) fs.writeFileSync(path.join(out, 'lesson.json'), JSON.stringify(lesson, null, 2));
  console.log(`${topic.id}: valid=${result.validity}, firstStepMs=${firstMeaningfulStepMs}, totalMs=${result.totalMs}`);
}
