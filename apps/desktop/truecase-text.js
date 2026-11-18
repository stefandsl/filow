// Text side of the punctuation and capitals model (Horizon-Labs/multilingual-punctuation-truecase-small,
// Apache-2.0; docs/dictation/CLEANUP-MULTILINGUAL.md): what goes to the model and how its labels become
// text. Pure functions, no model here. The rules follow the model's own helper (truecase.py in its
// repository), written again in JavaScript, with Filow's limits on top:
// - the model only ever ADDS: a mark after a word, a capital on a word. No letter, digit or word of the
//   speaker is changed, removed or reordered, and a capital the recognizer wrote is never lowered;
// - when the pieces the model saw do not line up with the words, nothing is applied.

const CJK = /[぀-ヿ㐀-鿿豈-﫿]/;
const MARKS = /[.,;:!?。，、；：！？؟،¿¡…]/g;
const isDigit = (ch) => ch >= "0" && ch <= "9";

/** Marks out, except inside numbers (3.14, 1,000, 10:30); spaces single. The model's input is this, lowercased. */
function stripMarks(text) {
  const t = String(text || "");
  return t.replace(MARKS, (m, at) => (".,:".includes(m) && at > 0 && at < t.length - 1 && isDigit(t[at - 1]) && isDigit(t[at + 1]) ? m : "")).replace(/\s+/g, " ").trim();
}
/** Lower case, letter for letter (a letter whose lower case is longer stays as it is, so positions hold). */
function lowerKeepLength(text) {
  let out = "";
  for (const ch of text) { const l = ch.toLowerCase(); out += l.length === ch.length ? l : ch; }
  return out;
}
/** Does the text already carry sentence punctuation (outside numbers)? Then the recognizer wrote it. */
function hasMarks(text) {
  const t = String(text || "");
  return stripMarks(t).length !== t.replace(/\s+/g, " ").trim().length;
}

function applyCase(word, kase) {
  if (kase === "UPPER") { const u = word.toUpperCase(); return u.length === word.length ? u : word; }
  if (kase === "Cap") {
    for (let i = 0; i < word.length; i++) {
      const ch = word[i];
      if (ch.toLowerCase() !== ch.toUpperCase()) { const u = ch.toUpperCase(); return u.length === 1 ? word.slice(0, i) + u + word.slice(i + 1) : word; }
    }
  }
  return word;
}
/** The mark as it is written after `prev`: full-width in Chinese and Japanese text, "、" as the Japanese comma. */
function markFor(mark, prev, lang) {
  // Only the three marks the model is reliable on. Its colon and dash are "much less reliable" by its own
  // card, so Filow does not write them.
  if (mark !== "." && mark !== "," && mark !== "?") return "";
  if (CJK.test(prev)) return mark === "." ? "。" : mark === "?" ? "？" : lang === "ja" ? "、" : "，";
  return mark;
}

/**
 * Where each piece the model saw ends in `lower` (the model's input). Pieces use "▁" for a space.
 * Returns the end positions, or null when the pieces do not spell the input (then nothing is applied).
 */
function pieceEnds(lower, pieces) {
  const ends = [];
  let pos = 0;
  for (const piece of pieces) {
    const p = piece.replace(/▁/g, " ");
    let rest = p;
    // a space the piece starts with may be the one between two words, or none at the very start
    while (rest.startsWith(" ") && lower[pos] !== " ") rest = rest.slice(1);
    if (!lower.startsWith(rest, pos)) return null;
    pos += rest.length;
    ends.push(pos - (rest.length - rest.trimEnd().length));
  }
  return pos === lower.length ? ends : null;
}

/**
 * The text with the model's marks and capitals. `clean`: stripMarks(text); `pieces`: the tokenizer's
 * pieces of lowerKeepLength(clean); `labels`: one "<mark>|<case>" per piece ("0|lower", ".|Cap", ...).
 * A label counts only at the end of a word, or after any character in Chinese and Japanese text.
 * Returns null when the pieces do not line up.
 */
function applyLabels(clean, pieces, labels, lang) {
  const lower = lowerKeepLength(clean);
  const ends = pieceEnds(lower, pieces);
  if (!ends || ends.length !== labels.length) return null;
  const at = new Map();
  ends.forEach((e, i) => { if (e > 0) at.set(e, labels[i]); }); // the last piece that ends at a position wins
  let out = "";
  let prev = 0;
  for (const e of [...at.keys()].sort((a, b) => a - b)) {
    if (!(e === lower.length || lower[e] === " " || CJK.test(lower[e - 1]))) continue;
    const [mark, kase] = String(at.get(e)).includes("|") ? String(at.get(e)).split("|") : [String(at.get(e)), "lower"];
    const s = Math.max(prev, lower.lastIndexOf(" ", e - 1) + 1);
    out += clean.slice(prev, s) + applyCase(clean.slice(s, e), kase) + (mark === "0" ? "" : markFor(mark, lower[e - 1], lang));
    prev = e;
  }
  return out + clean.slice(prev);
}

const ADDED = /[.,?。、，？]/;
const isMark = (ch) => { MARKS.lastIndex = 0; return MARKS.test(ch); };
/**
 * The recognizer's own text with what the model adds laid over it. `original`: what the recognizer wrote
 * (spaces single); `restored`: applyLabels() of its stripped form. Everything the recognizer wrote stays:
 * its marks win over the model's at the same place, its capitals are never lowered. The model adds a mark
 * only where there was none and raises a letter only to a capital. Returns null when the two do not
 * spell the same words (then the caller types the original).
 */
function merge(original, restored, { sentenceStartsOnly = false } = {}) {
  const o = String(original || "");
  const m = String(restored || "");
  let out = "";
  let i = 0, j = 0;
  while (i < o.length || j < m.length) {
    const a = o[i], b = m[j];
    if (a !== undefined && b !== undefined && (a === b || a.toLowerCase() === b.toLowerCase())) {
      // Raised by the model, or the recognizer's own letter. Not raised: the first letter of a word that
      // follows a comma. The model writes "comma, Capital" where it wanted a sentence end (its card names
      // this), and where the recognizer wrote the comma the model's full stop is not there to justify it.
      // A whole word in capitals (an acronym) is still raised.
      const afterComma = /[,;:、，] $/.test(out) && !(m[j + 1] !== undefined && m[j + 1] !== " " && m[j + 1] === m[j + 1].toUpperCase() && m[j + 1] !== m[j + 1].toLowerCase());
      // sentenceStartsOnly: the recognizer writes capitals itself (names, acronyms), so the model may only
      // raise the first letter of a sentence; its other capitals were wrong more often than right there.
      const blocked = afterComma || (sentenceStartsOnly && !/(^|[.?!。？！…] ?)$/.test(out));
      out += a !== b && b === a.toUpperCase() && !blocked ? b : a;
      i++; j++;
    } else if (a !== undefined && isMark(a)) {
      out += a; i++;
    } else if (b !== undefined && ADDED.test(b)) {
      // a mark of the model's where the recognizer wrote none; right after one of the recognizer's, that one stands
      if (!(out.length && isMark(out[out.length - 1]))) out += b;
      j++;
    } else return null;
  }
  return out;
}

/** The letters and digits of a text, in order, lower case: what must be the same before and after. */
const skeleton = (text) => lowerKeepLength(String(text || "")).replace(/[^\p{L}\p{N}]/gu, "");

// ---- the first letter of a sentence ----
// The model sometimes ends a sentence and leaves the next word small. This raises that one letter, by
// rule, and only where the sentence start is certain: a missed capital is acceptable, a wrong one is not.
// Only inside the text, after a sentence end: the first word of the dictation is the model's alone (it may
// go on in the middle of a sentence already in the field, and the rule cannot see that). Nothing else
// changes: no letter is lowered, no mark or space is added, moved or removed, every character stays
// where it was.
const SPACE = /[ \u00a0\u202f\t\r\n]/;
const SENTENCE_MARK = /[.?!…]/; // the full-width marks of Japanese and Chinese start no capital
const OPENING = /["'([{«„“‘‹¿¡]/;
const DASH = /[-\u2013\u2014]/; // opens a line of dialogue when a space follows it
const CASED = /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}]/u;
// A word that is not plain text: a number, an address, a path, a file name, a time, a name like "iPhone".
const NOT_A_WORD = /[\p{N}/\\@_]|[.:][\p{L}\p{N}]|\p{Ll}\p{Lu}/u;
// Words written with a full stop that does not end the sentence. Short on purpose: everyday dictation.
// "ecc." and "etc." can also end a sentence; the rule cannot know, so the next word stays as it is.
const ITALIAN_MONTHS = new Set("gen feb mar apr mag giu lug ago set sett ott nov dic".split(" "));
const ITALIAN_DATE_DAYS = new Set((
  "primo uno due tre quattro cinque sei sette otto nove dieci undici dodici tredici quattordici quindici " +
  "sedici diciassette diciotto diciannove venti ventuno ventidue ventitré ventitre ventiquattro venticinque " +
  "ventisei ventisette ventotto ventinove trenta trentuno lunedì martedì mercoledì giovedì venerdì sabato domenica"
).split(" "));
const ABBREVIATIONS = {
  en: "mr mrs ms dr prof st vs etc no inc ltd jr sr approx",
  it: "sig dott dr prof ing avv ecc etc pag art tel ca es cfr cap fig max nr sec min vol rif " + [...ITALIAN_MONTHS].join(" "),
  ro: "dl dna dvs dv dr prof univ ing nr str bl ap sc et bd com etc pag art cap fig jud ex tel aprox cca",
  ru: "г гг в вв ул д кв стр рис им др проф руб коп долл тыс млн млрд см ч мин сек мес нед шт чел ст гр напр ок",
};
// Any other language name (also one that is a property of every object, like "constructor"): all the lists.
const abbreviationsOf = (lang) => new Set((Object.hasOwn(ABBREVIATIONS, lang) ? ABBREVIATIONS[lang] : Object.values(ABBREVIATIONS).join(" ")).split(" "));

/** Is the single full stop at `cp[dot]` one that does not end a sentence? Says yes when it cannot tell. */
function insideSentence(cp, dot, abbreviations) {
  let s = dot;
  while (s > 0 && !SPACE.test(cp[s - 1])) s--;
  const token = cp.slice(s, dot).join("").replace(/^["'([{«„“‘‹¿¡]+/, "");
  if (!token) return true;
  // One letter: an initial ("J. Rossi") or a short form ("n.", "p. es.", "т. е."). Not the Russian "я",
  // the one word of a single letter that often ends a sentence (written "Я" when it starts one).
  if (/^\p{L}$/u.test(token)) return token.toLowerCase() !== "я";
  const word = token.toLowerCase();
  if (abbreviations.has(word) && ITALIAN_MONTHS.has(word)) {
    // Ordinary words such as "ago" (needle) and "set" (tennis) can end a sentence.
    let end = s;
    while (end > 0 && SPACE.test(cp[end - 1])) end--;
    let start = end;
    while (start > 0 && /[\p{L}\dº°]/u.test(cp[start - 1])) start--;
    const day = cp.slice(start, end).join("").toLowerCase();
    return /^(?:0?[1-9]|[12]\d|3[01])[º°]?$/.test(day) || ITALIAN_DATE_DAYS.has(day);
  }
  // letters with full stops between them ("e.g.", "S.p.A."), or a listed abbreviation
  return /^\p{L}{1,2}(\.\p{L}{1,2})+$/u.test(token) || abbreviations.has(word);
}

/**
 * The text with a capital on each sentence start that has a small letter. `lang`: the language when it is
 * known; it picks the list of abbreviations (all of them when it is not known), and Japanese comes back
 * as it is. The first word is never touched. Works on whole characters, so the text keeps its length.
 */
function sentenceStarts(text, lang) {
  const t = String(text || "");
  if (lang === "ja") return t;
  const cp = [...t]; // read for every decision; the capitals go into `out`
  const out = cp.slice();
  const abbreviations = abbreviationsOf(lang);
  const space = (i) => i < cp.length && SPACE.test(cp[i]);
  /** Where the sentence would start from `i` on: after the spaces and the marks that open it. */
  const start = (i) => {
    while (space(i)) i++;
    for (;;) {
      if (i < cp.length && OPENING.test(cp[i])) i++;
      else if (i < cp.length && DASH.test(cp[i]) && space(i + 1)) { i++; while (space(i)) i++; }
      else return i;
    }
  };
  /** A digit, a capital, a letter without case or a symbol there: nothing, and no looking further along. */
  const raise = (i) => {
    const ch = cp[i];
    if (ch === undefined || !CASED.test(ch) || !/\p{Ll}/u.test(ch)) return;
    const up = ch.toUpperCase(); // not the locale's: the Turkish i must not touch other languages
    if ([...up].length !== 1) return; // "ß" would become two letters
    let end = i;
    while (end < cp.length && !space(end)) end++;
    const word = cp.slice(i, end).join("");
    if (NOT_A_WORD.test(word) || CJK.test(word)) return;
    out[i] = up;
  };
  for (let i = 0; i < cp.length; i++) {
    if (!SENTENCE_MARK.test(cp[i])) continue;
    const first = i;
    while (i + 1 < cp.length && SENTENCE_MARK.test(cp[i + 1])) i++;
    // No space after it: inside a number, an address or a file name, or a closing quote follows and the
    // sentence may go on ('"Vengo." disse lei').
    if (!space(i + 1)) continue;
    const run = cp.slice(first, i + 1).join("");
    // "..." and "…" are a pause more often than an end; "?" and "!" always end.
    if (!/[?!]/.test(run) && (run !== "." || insideSentence(cp, first, abbreviations))) continue;
    raise(start(i + 1));
  }
  return out.join("");
}

module.exports = { stripMarks, lowerKeepLength, hasMarks, applyCase, markFor, pieceEnds, applyLabels, merge, skeleton, sentenceStarts, CJK };
