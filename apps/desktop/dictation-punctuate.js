// Full stops, commas, question marks and capitals for dictations in Italian, Russian, Romanian and
// Japanese, added on this PC by a small model that labels words (it writes no text of its own):
// Horizon-Labs/multilingual-punctuation-truecase-small, Apache-2.0. Measurements and the decision per
// language: docs/dictation/CLEANUP-MULTILINGUAL.md. English has its own cleanup (dictation-cleanup.js).
//
// It runs only where the recognizer left the sentence open (no full stop or question mark at the end):
// a recognizer that punctuates by itself (Parakeet) is left alone. It can only add: a mark where there
// was none, a capital where there was a small letter. The words, their order, every letter and digit and
// every mark and capital the recognizer wrote stay as they are; if that cannot be shown, the dictation
// is typed as it was.
const tc = require("./truecase-text");

/** Languages where the numbers support it (CLEANUP-MULTILINGUAL.md). English goes to S1-mini by Superwhisper. */
const LANGS = ["it", "ru", "ro", "ja"];
const BUDGET_MS = 400;
const SENTENCE_END = /[.?!。？！…]["')」』]?$/u;

/** May this dictation get marks and capitals? Says why not in a few words (log and report; never the words). */
function wanted(text, { enabled = true, language = "auto", spokenLanguage = "" } = {}) {
  if (!enabled) return { ok: false, reason: "off", lang: "" };
  const lang = language !== "auto" ? language : spokenLanguage || "";
  if (!LANGS.includes(lang)) return { ok: false, reason: `language ${lang || "unknown"}`, lang };
  const t = String(text || "").trim();
  if (!t) return { ok: false, reason: "empty", lang };
  if (SENTENCE_END.test(t)) return { ok: false, reason: "already punctuated", lang };
  return { ok: true, reason: "", lang };
}

/**
 * The dictation with the model's labels applied, or null when it is not provably the same words.
 * `said`: what the recognizer wrote (after Filow's own text step); `pieces`, `labels`: the model's answer
 * for tc.lowerKeepLength(tc.stripMarks(said)).
 */
function combine(said, pieces, labels, lang) {
  const original = String(said || "").replace(/\s+/g, " ").trim();
  const restored = tc.applyLabels(tc.stripMarks(original), pieces, labels, lang);
  if (restored === null) return null;
  // A recognizer that writes capitals itself keeps its own casing inside the sentence.
  const merged = tc.merge(original, restored, { sentenceStartsOnly: /\p{Lu}/u.test(original) });
  if (merged === null || tc.skeleton(merged) !== tc.skeleton(original)) return null;
  // Japanese is written without spaces: the gap the recognizer left between two phrases goes when a mark fills it.
  return lang === "ja" ? merged.replace(/([。、？]) (?=[぀-ヿ㐀-鿿])/g, "$1") : merged;
}

/**
 * deps: { run(lower, signal) -> Promise<{ pieces, labels }>, ready() -> { ok, reason }, budgetMs?(), now? }
 * punctuate() never throws and never returns less than it was given: { text, used, ms, reason, asked }.
 */
function createPunctuator(deps) {
  const now = deps.now || (() => Date.now());
  let late = 0;
  let resting = false;
  async function punctuate(said, opts = {}) {
    const w = wanted(said, opts);
    const keep = (reason, ms = 0, asked = false) => ({ text: said, used: false, ms, reason, asked });
    if (!w.ok) return keep(w.reason);
    if (resting) return keep("resting: too slow on this computer");
    const r = deps.ready();
    if (!r.ok) return keep(r.reason);
    const budget = deps.budgetMs ? deps.budgetMs() : BUDGET_MS;
    const t0 = now();
    const ac = new AbortController();
    let timer;
    try {
      const lower = tc.lowerKeepLength(tc.stripMarks(said));
      const answer = await Promise.race([
        deps.run(lower, ac.signal),
        new Promise((_resolve, reject) => { timer = setTimeout(() => { ac.abort(); reject(new Error("late")); }, budget); }),
      ]);
      const ms = now() - t0;
      late = 0;
      const text = combine(said, answer.pieces, answer.labels, w.lang);
      if (text === null) return keep("not the same words", ms, true);
      return { text, used: true, ms, reason: "", asked: true };
    } catch (err) {
      const ms = now() - t0;
      if (err && err.message === "late") {
        // Three late answers in a row: this computer is too slow for it; dictations stop waiting until Filow restarts.
        if (++late >= 3) resting = true;
        return keep(`slower than ${budget} ms`, ms, true);
      }
      return keep(`failed: ${String((err && err.message) || err).slice(0, 60)}`, ms, true);
    } finally { clearTimeout(timer); }
  }
  return { punctuate, get resting() { return resting; } };
}

module.exports = { LANGS, BUDGET_MS, wanted, combine, createPunctuator };
