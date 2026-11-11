// Dictation: cleaning up what was said with S1-mini by Superwhisper, on this PC (docs/dictation/S1-MINI.md).
// S1-mini is a small text model (not a speech model): it takes the recognizer's raw words and writes them
// as text: fillers out, self-corrections resolved, numbers, dates and e-mail addresses written out.
// It knows English only (release v1), so only English dictations go through it; every other language keeps
// Filow's own cleanup and is never shown to the model (it could damage or translate the words).
// This file is the pure part: the request exactly as the model card asks for it, the decision whether a
// dictation may be cleaned, and the checks the answer must pass before it replaces the raw words.
// The runtime that answers the request is s1-runtime.js.

/** The model card: "Use this exact system prompt." */
const SYSTEM = "You are a text normalizer for speech-to-text transcripts. The input begins with a control line specifying the styling, structure, and context settings; clean the transcript to match those settings and output only the cleaned text.";
const STYLES = ["casual", "semi-casual", "semi-formal", "formal"];
const NAME = "S1-mini by Superwhisper"; // the licence's naming clause: this name, this capitalization

/** `[Styling: semi-formal] [Structure: prose] [Context: general]`: only values the model was trained on. */
function controlLine({ style, lists, email } = {}) {
  return `[Styling: ${STYLES.includes(style) ? style : "semi-formal"}] [Structure: ${lists ? "lists" : "prose"}] [Context: ${email ? "email" : "general"}]`;
}

/** A rough token count (the model card sizes the answer to the input: 1.3 x input tokens + 32). */
const tokens = (text) => Math.ceil(String(text).length / 3);
const maxTokens = (text) => Math.min(1024, Math.ceil(1.3 * tokens(text)) + 32);

/** The body for the runtime's chat endpoint (llama-server /v1/chat/completions), as the model card shows it. */
function buildRequest(transcript, opts = {}) {
  return {
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `${controlLine(opts)}\n${transcript}` },
    ],
    temperature: 0,
    max_tokens: maxTokens(transcript),
    chat_template_kwargs: { enable_thinking: false },
    stream: false,
  };
}

/**
 * May this dictation go through the model? Only when the switch is on and the dictation is known to be
 * English: the language chosen for dictation, or (when that is "auto") the language the recognizer
 * listened in. Undecided is "no". Longer than the model's comfortable input is "no" too.
 */
function decide({ enabled, language, spokenLanguage, text }) {
  if (!enabled) return { clean: false, reason: "off" };
  const lang = language && language !== "auto" ? language : spokenLanguage || "";
  if (lang !== "en") return { clean: false, reason: lang ? `language ${String(lang).slice(0, 5)}` : "language not known" };
  // Letters outside Latin script in a dictation said to be English: the recognizer heard another language.
  if (/[\p{Script=Cyrillic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return { clean: false, reason: "not English text" };
  if (tokens(text) > 900) return { clean: false, reason: "too long" };
  if (!String(text).trim()) return { clean: false, reason: "empty" };
  return { clean: true, reason: "" };
}

const words = (text) => (String(text).toLowerCase().replace(/['’]/g, "").match(/[\p{L}]+/gu) || []);
// Words a register change may add without the speaker having said them ("gonna" -> "going to", "can't" -> "cannot").
const REGISTER = new Set(["am", "is", "are", "not", "cannot", "will", "would", "have", "has", "had", "going", "to", "want", "got", "do", "does", "did", "us", "let", "it", "i", "you", "we", "they", "he", "she", "that", "there", "what", "who", "them", "because", "and", "pm", "st", "nd", "rd", "th"]);

// ---- numbers: every figure in the answer must be one the speaker said ----
// Measured on 2026-11-11: "it costs nineteen dollars and ninety nine cents" came back as "It costs $1.99."
// A wrong amount is the worst thing a cleanup can do, so the figures are checked on their own: each run
// of digits in the answer must be the value of some stretch of the number words that were said (or of
// two stretches written side by side, as in years and times, or of digits said one by one).
const UNITS = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, twentieth: 20, thirtieth: 30, fortieth: 40, fiftieth: 50, sixtieth: 60, seventieth: 70, eightieth: 80, ninetieth: 90 };
const SCALES = { thousand: 1000, million: 1000000, billion: 1000000000 };
const isNumberWord = (w) => w in UNITS || w in TENS || w in SCALES || w === "hundred" || w === "hundredth" || w === "thousandth";

/** The value of a stretch of number words ("twenty three thousand four hundred fifty" -> 23450), or null when it is not one number. */
function numberValue(ws) {
  let total = 0, cur = 0, last = "start";
  for (const w of ws) {
    if (w in UNITS) { if (!["start", "tens", "hundred", "scale"].includes(last) || (last === "tens" && UNITS[w] > 9)) return null; cur += UNITS[w]; last = "unit"; }
    else if (w in TENS) { if (!["start", "hundred", "scale"].includes(last)) return null; cur += TENS[w]; last = "tens"; }
    else if (w === "hundred" || w === "hundredth") { if (last !== "unit" || cur > 99) return null; cur *= 100; last = "hundred"; }
    else if (w in SCALES || w === "thousandth") { if (cur === 0) return null; total += cur * (SCALES[w] || 1000); cur = 0; last = "scale"; }
    else return null;
  }
  return total + cur;
}

/** Every figure the speaker may have meant, as digit strings. */
function saidFigures(text) {
  const out = new Set();
  const toks = String(text).toLowerCase().replace(/['’]/g, "").match(/[\p{L}]+|\d+/gu) || [];
  // Runs of number words; "and" inside a run is skipped ("two hundred and fifty").
  const runs = [];
  let run = [];
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i];
    if (/^\d+$/.test(w)) { out.add(String(Number(w))); out.add(w); if (run.length) runs.push(run); run = []; continue; }
    if (isNumberWord(w)) run.push(w);
    else if (w === "and" && run.length && isNumberWord(toks[i + 1] || "")) continue;
    else { if (run.length) runs.push(run); run = []; }
    if (w === "half") out.add("30");
    if (w === "quarter") { out.add("15"); out.add("45"); }
    if (w === "noon" || w === "midnight") out.add("12");
  }
  if (run.length) runs.push(run);
  for (const r of runs) {
    const n = Math.min(r.length, 12);
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j <= Math.min(r.length, i + n); j++) {
      const v = numberValue(r.slice(i, j));
      if (v !== null) out.add(String(v));
      // two numbers written side by side: years ("twenty twenty six"), and a unit after a round ten ("nine oh five")
      for (let k = i + 1; k < j; k++) {
        const a = numberValue(r.slice(i, k)), b = numberValue(r.slice(k, j));
        if (a !== null && b !== null) { out.add(`${a}${b}`); out.add(`${a}${String(b).padStart(2, "0")}`); }
      }
      // digits said one by one ("four five six seven")
      const each = r.slice(i, j).map((w) => (w in UNITS && UNITS[w] < 10 ? String(UNITS[w]) : null));
      if (each.every((d) => d !== null)) out.add(each.join(""));
    }
  }
  return out;
}

/** The first figure in the answer that was not said, or "" when every figure holds. */
function strangeFigure(raw, cleaned) {
  const said = saidFigures(raw);
  // "23,450" and "1,250" are one figure each; other marks (. : / -) separate figures.
  const groups = String(cleaned).replace(/(\d),(?=\d{3}(\D|$))/g, "$1").match(/\d+/g) || [];
  for (const g of groups) if (!said.has(g) && !said.has(String(Number(g)))) return g;
  return "";
}

/**
 * Is the model's answer safe to type instead of the raw words? It must be the same message, cleaned:
 *   empty        nothing came back although something was said
 *   echo         the control line, the system prompt or template marks came back
 *   too long     more text than the speaker said
 *   too short    most of what was said is gone (self-corrections and numbers shrink a text, but not that far)
 *   new words    words the speaker did not say (numbers, e-mail addresses and register words excepted)
 *   layout       line breaks where prose was asked for
 *   numbers      a figure that is not one the speaker said
 */
function acceptCleaned(raw, cleaned, { lists = false, email = false } = {}) {
  const out = String(cleaned == null ? "" : cleaned).trim();
  const inp = String(raw || "").trim();
  if (!out) return { ok: false, reason: "empty answer" };
  if (/\[(Styling|Structure|Context):|<\/?think>|<\|im_(start|end)\|>|text normalizer for speech-to-text/i.test(out)) return { ok: false, reason: "echo" };
  if (out.length > inp.length * 1.25 + 16) return { ok: false, reason: "too long" };
  if (out.length < inp.length * 0.2) return { ok: false, reason: "too short" };
  if (!lists && !email && /\n/.test(out)) return { ok: false, reason: "layout" };
  if (strangeFigure(inp, out)) return { ok: false, reason: "numbers" };
  const said = new Set(words(inp));
  const got = words(out);
  const fresh = got.filter((w) => !said.has(w) && !REGISTER.has(w) && ![...said].some((s) => s.length > 3 && (s.startsWith(w) || w.startsWith(s))));
  if (fresh.length > Math.max(2, Math.floor(got.length * 0.2))) return { ok: false, reason: "new words" };
  return { ok: true, reason: "", text: out };
}

/**
 * @param {{ run: (body: object, signal: AbortSignal) => Promise<string>, ready?: () => { ok: boolean, reason?: string },
 *           budgetMs?: () => number, now?: () => number }} o
 * clean(raw, opts) -> { used, text, reason, ms }: `text` is the cleaned text when `used`, else undefined (the
 * caller types its own cleanup of the raw words). Never throws.
 */
function createCleaner(o) {
  const now = o.now || Date.now;
  async function clean(raw, opts = {}) {
    const d = decide({ enabled: opts.enabled !== false, language: opts.language, spokenLanguage: opts.spokenLanguage, text: raw });
    if (!d.clean) return { used: false, reason: d.reason, ms: 0, asked: false };
    const state = o.ready ? o.ready() : { ok: true };
    if (!state.ok) return { used: false, reason: state.reason || "not installed", ms: 0, asked: false };
    const budget = Math.max(100, Number(o.budgetMs ? o.budgetMs() : 700) || 700);
    const started = now();
    const abort = new AbortController();
    let timer;
    try {
      const late = new Promise((resolve) => { timer = setTimeout(() => resolve({ late: true }), budget); });
      const answer = await Promise.race([o.run(buildRequest(raw, opts), abort.signal).then((text) => ({ text })), late]);
      const ms = now() - started;
      if (answer.late) { abort.abort(); return { used: false, reason: `slower than ${budget} ms`, ms, asked: true }; }
      const check = acceptCleaned(raw, answer.text, opts);
      if (!check.ok) return { used: false, reason: check.reason, ms, asked: true };
      return { used: true, text: check.text, reason: "", ms, asked: true };
    } catch (e) {
      return { used: false, reason: `runtime error: ${String((e && e.message) || e).replace(/[^\w .:()-]/g, "").slice(0, 60)}`, ms: now() - started, asked: true };
    } finally {
      clearTimeout(timer);
    }
  }
  return { clean };
}

module.exports = { SYSTEM, STYLES, NAME, controlLine, buildRequest, maxTokens, decide, acceptCleaned, createCleaner, saidFigures, strangeFigure, numberValue };
