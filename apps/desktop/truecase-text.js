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

module.exports = { stripMarks, lowerKeepLength, hasMarks, applyCase, markFor, pieceEnds, applyLabels, merge, skeleton, CJK };
