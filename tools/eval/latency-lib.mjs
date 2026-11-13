// The speed baseline's pure parts (docs/perf/LATENCY-2026-11.md, tools/eval/latency.mjs): reading the
// timing lines, the spans, the statistics, the validity rules, the judge and the Phase 2b ranking.
// No I/O here: everything is tested in latency-lib.test.ts.
import { wavData } from "../autoloop/e2e/launch.mjs";

/** The canary every synthetic screen shows: it must never appear in a log, a result or the report. */
export const CANARY = "QUOKKA-4417";

// ---------- the lines ----------
const NUM = "-?\\d+";
/** `okfilow: timings run 7 voice done t0 1731456000123: micOpen -2410, release 0, ... ms; afterStop 0` */
export const TIMINGS_LINE = new RegExp(`^okfilow: timings run (\\d+g?|-) (voice|typed|warm) (done|stopped|superseded|error|agent|whiteboard|dismissed) t0 (\\d+): ((?:[a-zA-Z]+ ${NUM}(?:, )?)*) ms(?:; ((?:[a-zA-Z]+ \\d+(?:, )?)+))?$`);
/** `okfilow: server run 7 main: received 0, ... ms; load 0, promptEval 2710 ms, prompt 1840 tok, eval 96 tok; images 1; model lfm3-vl` */
export const SERVER_LINE = new RegExp(`^okfilow: server run (\\d+g?|-) (main|ground): ((?:[a-zA-Z]+ ${NUM}(?:, )?)*) ms; ((?:load ${NUM}(?:, )?)?(?:promptEval ${NUM} ms(?:, )?)?(?:prompt ${NUM} tok(?:, )?)?(?:eval ${NUM} tok)?); images (\\d+); model ([a-z0-9.:_-]{1,40})$`);

/** The message of a startup.log line (after its ISO time stamp). */
export const message = (line) => String(line).replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z /, "");

const pairs = (s) => Object.fromEntries(String(s || "").split(", ").filter(Boolean).map((p) => { const [k, v] = p.split(" "); return [k, Number(v)]; }));

/** A timings line, or null when it is not one (or breaks the numbers-only grammar). */
export function parseTimings(line) {
  const m = TIMINGS_LINE.exec(message(line));
  if (!m) return null;
  return { run: m[1], kind: m[2], end: m[3], t0: Number(m[4]), marks: pairs(m[5]), counts: pairs(m[6]) };
}

/** A server line, or null. */
export function parseServer(line) {
  const m = SERVER_LINE.exec(message(line));
  if (!m) return null;
  const work = {};
  for (const [, k, v] of m[4].matchAll(/(load|promptEval|prompt|eval) (-?\d+)/g)) work[k] = Number(v);
  return { run: m[1], role: m[2], marks: pairs(m[3]), loadMs: work.load, promptEvalMs: work.promptEval, promptTokens: work.prompt, evalTokens: work.eval, images: Number(m[5]), model: m[6] };
}

/** Every new `okfilow: timings` and `okfilow: server` line holds numbers and fixed names only (the grammar above). */
export function grammarBreaks(lines) {
  return lines.map(message).filter((l) => (l.startsWith("okfilow: timings") && !TIMINGS_LINE.test(l)) || (l.startsWith("okfilow: server") && !SERVER_LINE.test(l)));
}

/** Where the canary shows up, by the name of each text given ({ name: text }). */
export const canaryHits = (texts) => Object.entries(texts).filter(([, t]) => String(t ?? "").includes(CANARY)).map(([name]) => name);

// ---------- spans ----------
/**
 * Each span maps to one piece of code (design note section 3). `from`/`to`: marks of the timings line
 * (relative to t0 = 0; "t0" is 0), or `server.` marks (relative to the server's `received`).
 */
export const SPANS = Object.freeze([
  { name: "release->sttStop", from: "release", to: "sttStop", kinds: ["voice"] },
  { name: "sttStop->heard", from: "sttStop", to: "heard", kinds: ["voice"] },
  { name: "heard->agentChecked", from: "heard", to: "agentChecked", kinds: ["voice"] },
  { name: "asked->agentChecked", from: "asked", to: "agentChecked", kinds: ["typed"] },
  { name: "agentChecked->captured", from: "agentChecked", to: "captured", kinds: ["voice", "typed"] },
  { name: "captured->recipients", from: "captured", to: "recipients", kinds: ["voice", "typed"] },
  { name: "recipients->fetchStart", from: "recipients", to: "fetchStart", kinds: ["voice", "typed"] },
  { name: "fetchStart->firstToken", from: "fetchStart", to: "firstToken", kinds: ["voice", "typed"] },
  { name: "firstToken->text", from: "firstToken", to: "text", kinds: ["voice", "typed"] },
  { name: "text->sentence", from: "text", to: "sentence", kinds: ["voice", "typed"] },
  { name: "sentence->synth", from: "sentence", to: "synth", kinds: ["voice", "typed"] },
  { name: "synth->voice", from: "synth", to: "voice", kinds: ["voice", "typed"] },
  { name: "text->mark", from: "text", to: "mark", kinds: ["voice", "typed"] },
  { name: "t0->fetchStart", from: "t0", to: "fetchStart", kinds: ["voice", "typed"] },
  { name: "t0->firstToken", from: "t0", to: "firstToken", kinds: ["voice", "typed"] },
  { name: "t0->voice", from: "t0", to: "voice", kinds: ["voice", "typed"] },
  { name: "t0->mark", from: "t0", to: "mark", kinds: ["voice", "typed"] },
  { name: "server received->helperResolved", from: "server.received", to: "server.helperResolved", kinds: ["voice", "typed"] },
  { name: "server helperResolved->ollamaSent", from: "server.helperResolved", to: "server.ollamaSent", kinds: ["voice", "typed"] },
  { name: "server ollamaSent->ollamaFirstByte", from: "server.ollamaSent", to: "server.ollamaFirstByte", kinds: ["voice", "typed"] },
  { name: "ollama load", from: "ollama.loadMs", to: null, kinds: ["voice", "typed"] },
  { name: "ollama promptEval", from: "ollama.promptEvalMs", to: null, kinds: ["voice", "typed"] },
  { name: "stopAt->stopHeard", from: "stopAt", to: "stopHeard", kinds: ["stop"] },
  { name: "stopAt->silent", from: "stopAt", to: "silent", kinds: ["stop"] },
]);

/** A mark of a sample: "t0" is 0, `server.x` and `ollama.x` from the run's server line. */
export function markOf(sample, name) {
  if (name === "t0") return 0;
  if (name.startsWith("server.")) return sample.server?.marks?.[name.slice(7)];
  if (name.startsWith("ollama.")) return sample.server?.[name.slice(7)];
  return sample.timings?.marks?.[name];
}

/** The span's value for a sample (ms), or undefined when a mark is missing. */
export function spanValue(sample, span) {
  const a = markOf(sample, span.from);
  if (span.to === null) return Number.isFinite(a) ? a : undefined;
  const b = markOf(sample, span.to);
  return Number.isFinite(a) && Number.isFinite(b) ? b - a : undefined;
}

// ---------- statistics ----------
const sorted = (xs) => xs.filter(Number.isFinite).sort((a, b) => a - b);
/** The median: the middle value, or the mean of the two middle values. */
export function median(xs) {
  const s = sorted(xs);
  if (!s.length) return NaN;
  const h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}
/** Nearest rank: sorted[ceil(p * n) - 1]. */
export function quantile(xs, p) {
  const s = sorted(xs);
  if (!s.length) return NaN;
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
}
/** The order statistics that bound the median at about 95% for n = 20 and n = 40 (1-based ranks). */
export const MEDIAN_RANKS = Object.freeze({ 20: [6, 15], 40: [14, 27] });
export function medianInterval(xs) {
  const s = sorted(xs);
  const r = MEDIAN_RANKS[s.length];
  return r ? [s[r[0] - 1], s[r[1] - 1]] : [NaN, NaN];
}
/** A seeded generator (mulberry32): the bootstrap gives the same interval on every run. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Resamples each cell with replacement and joins the cells (the cell-wise bootstrap of the note). */
function resample(cells, next) {
  const out = [];
  for (const cell of cells) for (let i = 0; i < cell.length; i++) out.push(cell[Math.floor(next() * cell.length)]);
  return out;
}
/**
 * 95% interval of `stat(A) op stat(B)` (op: "diff" = A - B, "ratio" = A / B), A and B each given as
 * cells (arrays of values), resampled within their cells. 10,000 resamples, fixed seed.
 */
export function bootstrapInterval(cellsA, cellsB, { op = "diff", stat = median, resamples = 10_000, seed = 20261113 } = {}) {
  const next = rng(seed);
  const values = [];
  for (let i = 0; i < resamples; i++) {
    const a = stat(resample(cellsA, next));
    const b = stat(resample(cellsB, next));
    values.push(op === "ratio" ? a / b : a - b);
  }
  values.sort((x, y) => x - y);
  return [values[Math.floor(0.025 * resamples)], values[Math.ceil(0.975 * resamples) - 1]];
}
/** Groups values by cell key: [[...], [...]] in a fixed order. */
export function cellsOf(samples, value, cell) {
  const map = new Map();
  for (const s of samples) {
    const v = value(s);
    if (!Number.isFinite(v)) continue;
    const k = cell(s);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(v);
  }
  return [...map.keys()].sort().map((k) => map.get(k));
}

// ---------- the voice files and the heard check ----------
/** Adds the room noise floor take.mjs adds (about -60 dBFS) to 16-bit PCM, in place; returns the buffer. */
export function addNoiseFloor(buf, seed = 1) {
  const { offset, length } = wavData(buf);
  let s = seed;
  for (let o = offset; o + 1 < offset + length; o += 2) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, buf.readInt16LE(o) + ((s % 65) - 32))), o);
  }
  return buf;
}
/** The time (ms) of the last sample above -40 dBFS (|x| > 0.01) of a 16 kHz 16-bit mono WAV. */
export function speechEndMs(buf, rate = 16000) {
  const { offset, length } = wavData(buf);
  const limit = Math.round(0.01 * 32768);
  for (let o = offset + length - 2; o >= offset; o -= 2) if (Math.abs(buf.readInt16LE(o)) > limit) return Math.round((((o - offset) / 2 + 1) / rate) * 1000);
  return 0;
}
/** NFKC, lower case, anything but letters and digits to spaces, collapsed: the words. */
export const words = (s) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
/** Edit distance in words. */
export function wordDistance(a, b) {
  const x = words(a), y = words(b);
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[y.length];
}
/** The question was heard: word distance 0, or at most 1 when the keys went up 200 ms early. */
export const heardOk = (expected, heard, offsetMs) => wordDistance(expected, heard) <= (offsetMs < 0 ? 1 : 0);

// ---------- the schedule ----------
/**
 * The fixed schedule of a voice condition: `n` samples over the questions (equal numbers each, in
 * order), each question's offsets taken in turn from a start that moves one offset per question, so
 * the question x offset cells are as equal as `n` allows. The same on every run.
 */
export function voiceSchedule(questions, offsets, n) {
  const per = Math.floor(n / questions);
  if (per * questions !== n) throw new Error(`n ${n} is not a multiple of ${questions} questions`);
  const out = [];
  for (let q = 0; q < questions; q++) for (let k = 0; k < per; k++) out.push({ question: q, offset: offsets[(q + k) % offsets.length] });
  return out;
}

// ---------- validity ----------
/**
 * Why a sample does not count ([] when it does). `sample`: { kind: "voice"|"typed"|"stop", timings,
 * server, heardOk, mode, ttsLevels, tooSlow, interference, split, timedOut }; `tier`: { picture, model, split }.
 */
export function invalidReasons(sample, tier) {
  const r = [];
  const t = sample.timings;
  if (!t) return sample.timedOut ? ["no timing line in time"] : ["no timing line"];
  if (sample.kind === "voice" && sample.heardOk === false) r.push("heard check");
  if (sample.kind === "stop" ? t.end !== "stopped" : t.end !== "done") r.push(`end ${t.end}`);
  const required = sample.kind === "stop" ? ["stopAt", "silent"]
    : sample.kind === "voice" ? ["micOpen", "release", "sttStop", "heard", "agentChecked", "captured", "recipients", "fetchStart", "firstToken", "text", "sentence", "synth", "voice", "mark"]
      : ["asked", "agentChecked", "captured", "recipients", "fetchStart", "firstToken", "text", "sentence", "synth", "voice", "mark"];
  const missing = required.filter((m) => !Number.isFinite(t.marks[m]));
  if (missing.length) r.push(`missing ${missing.join("+")}`);
  if (sample.kind !== "stop") {
    if (!sample.server) r.push("no server line");
    else {
      if (tier.picture && !(sample.server.images > 0)) r.push("images 0");
      if (sample.server.model !== tier.model) r.push("model");
    }
  }
  if (sample.mode === "error") r.push("mode error");
  if ((sample.ttsLevels || []).some((l) => l !== "standard") || sample.tooSlow) r.push("tts level");
  if (sample.interference) r.push("interference");
  if (sample.split && sample.split !== tier.split) r.push("processor split");
  return r;
}

// ---------- the judge ----------
/**
 * The 1000 ms judge (design note section 10). `plain`, `delayed`: valid typed samples ({ question,
 * timings, server }). Pass when the delay shows in fetchStart -> firstToken (within [850, 1150]), not
 * before the fetch (contains 0, within +-150) and in t0 -> voice (at least 850).
 */
export function judgeVerdict(plain, delayed, opts = {}) {
  const spans = opts.spans ?? SPANS;
  const byName = (n) => spans.find((s) => s.name === n);
  const cell = (s) => String(s.question);
  const interval = (name) => bootstrapInterval(cellsOf(delayed, (s) => spanValue(s, byName(name)), cell), cellsOf(plain, (s) => spanValue(s, byName(name)), cell), opts);
  const fetch = interval("fetchStart->firstToken");
  const before = interval("t0->fetchStart");
  const voice = interval("t0->voice");
  const checks = {
    fetch: { interval: fetch, pass: fetch[0] >= 850 && fetch[1] <= 1150 },
    before: { interval: before, pass: before[0] <= 0 && before[1] >= 0 && before[0] >= -150 && before[1] <= 150 },
    voice: { interval: voice, pass: voice[0] >= 850 },
  };
  return { pass: Object.values(checks).every((c) => c.pass), checks, n: { plain: plain.length, delayed: delayed.length } };
}

// ---------- Phase 2b ----------
/**
 * The realistic saving of each Phase 2b candidate on the standard tier's warm voice samples (median of
 * the per-sample saving, ms; design note section 13). `extra`: { tokensSmall } (prompt tokens of one
 * picture at the smaller width, measured once), `fast`: the fast tier's warm voice samples (text -> mark).
 */
export function rank2b(samples, extra = {}, fast = []) {
  const per = (f) => median(samples.map(f).filter(Number.isFinite));
  const m = (s, k) => s.timings?.marks?.[k];
  const sv = (s, k) => s.server?.marks?.[k];
  const synthFloor = quantile(samples.map((s) => m(s, "synth") - m(s, "sentence")), 0.1);
  const list = [
    { id: "tail", name: "Tail wait loop in stopListening (150 ms floor, up to 1500 ms)", saving: per((s) => m(s, "heard") - m(s, "sttLast") - 50), formula: "heard - sttLast - 50 ms" },
    { id: "agent", name: "Agent check b.agents.start before the capture (off the critical path)", saving: per((s) => m(s, "agentChecked") - m(s, "heard")), formula: "agentChecked - heard" },
    { id: "recipients", name: "out.recipients() on the local route", saving: per((s) => m(s, "recipients") - m(s, "captured")), formula: "recipients - captured" },
    { id: "helper", name: "resolveLocalHelper on the server (/api/tags, gpuInfo), cached", saving: per((s) => sv(s, "helperResolved") - sv(s, "received") - 5), formula: "helperResolved - received - 5 ms" },
    {
      id: "promptEval", name: "Prompt evaluation on the CPU (image tokens), smaller picture",
      saving: extra.tokensSmall ? per((s) => s.server?.promptEvalMs * (1 - extra.tokensSmall / s.server?.promptTokens)) : NaN,
      formula: `promptEvalMs x (1 - t1 / t0), t1 = ${extra.tokensSmall ?? "?"} tokens${extra.smallWidth ? ` at ${extra.smallWidth} px` : ""}`,
    },
    { id: "firstSentence", name: "Generation to the first sentence (voice may start at the first clause)", saving: Number.isFinite(extra.clauseShare) ? per((s) => (m(s, "sentence") - m(s, "firstToken")) * (1 - extra.clauseShare)) : NaN, formula: `(sentence - firstToken) x (1 - share of the first clause${Number.isFinite(extra.clauseShare) ? ` = ${extra.clauseShare}` : ", not measured"})` },
    { id: "synth", name: "Synthesis and playback start", saving: per((s) => m(s, "voice") - m(s, "sentence") - synthFloor), formula: `voice - sentence - synth floor (${Math.round(synthFloor)} ms, 10th percentile of sentence -> synth)` },
    { id: "mark", name: "Text to mark (fast tier, reference only)", saving: fast.length ? median(fast.map((s) => m(s, "mark") - m(s, "text")).filter(Number.isFinite)) : NaN, formula: "mark - text (fast tier)", reference: true },
  ];
  const ranked = list.filter((c) => !c.reference && Number.isFinite(c.saving) && c.saving >= 100).sort((a, b) => b.saving - a.saving);
  const dropped = list.filter((c) => !c.reference && !ranked.includes(c));
  const total = median(samples.map((s) => m(s, "voice") - m(s, "release")));
  const top2 = ranked.slice(0, 2).reduce((a, c) => a + c.saving, 0);
  return { candidates: list, ranked, dropped, top2, total, share: total > 0 ? top2 / total : NaN, gateToOwner: !(total > 0 && top2 / total >= 0.2) };
}

// ---------- the harness's own source ----------
/** Calls that start `ollama` outside ollamaCli() in latency.mjs's source (the note's source-scan rule). */
export function ollamaCallsOutsideCli(source) {
  const src = String(source);
  const start = src.indexOf("function ollamaCli(");
  let end = -1;
  if (start >= 0) {
    let depth = 0;
    // the body starts at the brace after the parameter list (a parameter may be destructured)
    for (let i = src.indexOf(") {", start) + 2; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) { end = i; break; }
    }
  }
  const hits = [];
  for (const m of src.matchAll(/\b(spawn|spawnSync|execFile|execFileSync|exec|execSync)\s*\(\s*([^,)]*)/g)) {
    if (!/ollama/i.test(m[2]) && !/OLLAMA_EXE/.test(m[2])) continue;
    if (start >= 0 && m.index > start && m.index < end) continue;
    hits.push(m[0]);
  }
  return hits;
}
