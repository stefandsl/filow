// Word error rate (and character error rate for Japanese) between a reference transcript and what a
// recognizer wrote. Used by tools/stt-bench to compare speech models per language
// (docs/stt/LANGUAGES.md). Pure, no dependencies, erasable syntax only (Node runs it with
// --experimental-strip-types).

export type ScoreUnit = "word" | "char";

export type ErrorCount = {
  /** Units in the reference after normalisation. */
  units: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  /** substitutions + deletions + insertions */
  errors: number;
  /** errors / units; 0 for two empty texts, 1 per inserted unit when only the reference is empty. */
  rate: number;
  unit: ScoreUnit;
};

/** Languages written without spaces between words are scored by character. */
export function scoreUnit(lang: string): ScoreUnit {
  return /^(ja|zh|yue|th|ko)\b/i.test(lang) ? "char" : "word";
}

/** Katakana letters with a hiragana twin 0x60 code points below them (U+30A1 to U+30F6). */
const isKatakana = (code: number) => code >= 0x30a1 && code <= 0x30f6;

/**
 * The units compared: lower-case words without punctuation, or single characters for Japanese.
 * Normalisation, so that spelling conventions do not count as recognition errors:
 * - every language: Unicode NFKC (full-width digits and Latin letters, half-width katakana), lower
 *   case, punctuation and symbols removed, apostrophes dropped ("don't" = "dont", "l'acqua" = "lacqua");
 * - Romanian: the legacy cedilla letters (ş ţ) count as the comma-below ones (ș ț);
 * - Russian: ё counts as е;
 * - Japanese: katakana counts as hiragana and all spaces go (models differ in where they put them).
 * Diacritics are kept (a Romanian "si" for "și" is an error) unless `foldDiacritics` is set.
 */
export function scoringUnits(text: string, lang: string, opts: { foldDiacritics?: boolean } = {}): string[] {
  let s = text.normalize("NFKC").toLowerCase();
  s = s.replace(/['’ʼ`]/g, "");
  if (/^ro\b/i.test(lang)) s = s.replace(/ş/g, "ș").replace(/ţ/g, "ț");
  if (/^ru\b/i.test(lang)) s = s.replace(/ё/g, "е");
  if (opts.foldDiacritics && scoreUnit(lang) === "word") s = s.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
  // Everything that is not a letter, a combining mark or a digit separates words.
  s = s.replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
  if (scoreUnit(lang) === "char") {
    return Array.from(s.replace(/\s+/g, ""), (c) => (isKatakana(c.charCodeAt(0)) ? String.fromCharCode(c.charCodeAt(0) - 0x60) : c));
  }
  return s ? s.split(/\s+/) : [];
}

/** Levenshtein alignment of two unit lists, with the three error kinds counted apart. */
export function alignErrors(reference: string[], hypothesis: string[]): { substitutions: number; deletions: number; insertions: number } {
  const n = reference.length;
  const m = hypothesis.length;
  // cost[i][j]: fewest edits turning reference[0..i) into hypothesis[0..j).
  const cost: Uint32Array[] = [];
  for (let i = 0; i <= n; i++) {
    cost.push(new Uint32Array(m + 1));
    cost[i][0] = i;
  }
  for (let j = 1; j <= m; j++) cost[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const same = reference[i - 1] === hypothesis[j - 1];
      cost[i][j] = Math.min(cost[i - 1][j - 1] + (same ? 0 : 1), cost[i - 1][j] + 1, cost[i][j - 1] + 1);
    }
  }
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && reference[i - 1] === hypothesis[j - 1] && cost[i][j] === cost[i - 1][j - 1]) { i--; j--; }
    else if (i > 0 && j > 0 && cost[i][j] === cost[i - 1][j - 1] + 1) { substitutions++; i--; j--; }
    else if (i > 0 && cost[i][j] === cost[i - 1][j] + 1) { deletions++; i--; }
    else { insertions++; j--; }
  }
  return { substitutions, deletions, insertions };
}

/** Error rate of one hypothesis against its reference (WER, or CER where `scoreUnit` says "char"). */
export function errorRate(reference: string, hypothesis: string, lang: string, opts: { foldDiacritics?: boolean } = {}): ErrorCount {
  const ref = scoringUnits(reference, lang, opts);
  const hyp = scoringUnits(hypothesis, lang, opts);
  const e = alignErrors(ref, hyp);
  const errors = e.substitutions + e.deletions + e.insertions;
  return { ...e, errors, units: ref.length, rate: ref.length ? errors / ref.length : errors, unit: scoreUnit(lang) };
}

/** Error rate over a set of clips: total errors over total reference units (not the mean of the rates). */
export function corpusErrorRate(pairs: Array<{ reference: string; hypothesis: string }>, lang: string, opts: { foldDiacritics?: boolean } = {}): ErrorCount {
  const total: ErrorCount = { units: 0, substitutions: 0, deletions: 0, insertions: 0, errors: 0, rate: 0, unit: scoreUnit(lang) };
  for (const p of pairs) {
    const e = errorRate(p.reference, p.hypothesis, lang, opts);
    total.units += e.units;
    total.substitutions += e.substitutions;
    total.deletions += e.deletions;
    total.insertions += e.insertions;
    total.errors += e.errors;
  }
  total.rate = total.units ? total.errors / total.units : total.errors;
  return total;
}
