// Text utilities shared by the lexical gate stage (gate.ts) and the claim guard (guard.ts):
// accent folding, tokens with offsets, Italian and English stop words, fuzzy token similarity,
// sentences, and quantities (numbers in digits or words, with their unit). Pure, no dependencies.

export type Token = {
  /** folded form: lower case, no accents; digits keep their separators */
  norm: string;
  start: number;
  end: number;
};

/** Lower case without accents ("Perché" becomes "perche"). */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Words, numbers (with their "." or "," separators) and the symbols that carry meaning for a claim
 * (% € $ £). English "n't" becomes its own "not" token, so "didn't" reads as "did not".
 */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const re = /\d+(?:[.,]\d+)*|[\p{L}]+|[%€$£]/gu;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const norm = fold(m[0]);
    // English contraction: "didn" + "'t" / "won" + "'t"; the "t" after an apostrophe is the negation.
    if (norm === "t" && start > 0 && /['’]/.test(text[start - 1]) && /n$/i.test(text.slice(0, start - 1))) {
      const prev = out[out.length - 1];
      if (prev && prev.norm.endsWith("n") && prev.end === start - 1) {
        // "didn" -> "did" + "not"; "can" + "'t" stays "can" + "not"; "won" -> "will"
        if (prev.norm === "won") prev.norm = "will";
        else if (prev.norm !== "can") prev.norm = prev.norm.slice(0, -1);
        out.push({ norm: "not", start: start - 1, end });
        continue;
      }
    }
    out.push({ norm, start, end });
  }
  return out;
}

// Function words (folded). Content is what is left: the words that say what a point is about.
const STOP_WORDS = `
a ad al allo ai agli alla alle anche ancora che chi ci col come con contro cosi cui da dal dallo dai dagli dalla dalle
del dello dei degli della delle di dove e ed fra gli ha hanno ho hai il in io la le lei li lo loro lui ma mi mio
mia miei mie ne nei negli nel nello nella nelle noi nostro nostra nostri nostre o od per perche piu po poi qua qual
quale quali quando quanto quel quella quelle quelli quello questa queste questi questo qui se sei si sia siamo
siete sono sta stato stata stati su sua sue sui sul sullo sulla sulle suo suoi ti tra tu tua tue tuo tuoi un una
uno vi voi vostro vostra e era erano essere fa fare fatto abbiamo avete avere aver aveva avevamo c d l s un ne
the a an and or but if of to in on at by for from with without as is are was were be been being am do does did
done have has had having it its this that these those there here we us our ours you your they them their i me my
he him his she her what which who whom whose when where why how so than then too very can could will would shall
should may might must just also into onto over under about up down out off again once all any both each few more
most other some such only own same s t ll re ve d m o y let lets
`;
export const STOP = new Set(STOP_WORDS.split(/\s+/).filter(Boolean));

/** Words that carry no topic but change truth: kept out of content, read by the guard. */
export const NEGATIONS = new Set(["non", "mai", "nessun", "nessuno", "nessuna", "niente", "nulla", "not", "no", "never", "none", "nothing", "nobody", "nor", "cannot", "failed", "fail", "fails", "unable"]);

/** Content tokens of a text: no stop words, no negations, no numbers or number words, at least 2 letters. */
export function contentTokens(text: string): string[] {
  const toks = tokenize(text);
  const numberIdx = new Set<number>();
  for (const q of quantitiesFromTokens(toks)) for (let i = q.tokenStart; i < q.tokenEnd; i++) numberIdx.add(i);
  return toks
    .filter((t, i) => !numberIdx.has(i) && /^\p{L}{2,}$/u.test(t.norm) && !STOP.has(t.norm) && !NEGATIONS.has(t.norm) && !UNIT_WORDS.has(t.norm))
    .map((t) => t.norm);
}

/**
 * Fuzzy similarity of two folded tokens, 0..1: equal is 1; otherwise the better of the edit-distance
 * ratio and a shared-stem ratio (a common prefix of at least 5 letters over the shorter word), so
 * "tagliato" ~ "tagliati" and "presentazioni" ~ "presentare" pass 0.8 while "server" ~ "servizio" does not.
 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  if (/\d/.test(a) || /\d/.test(b)) return 0;
  const lev = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  // a shared stem of 5+ letters leaving at most 3 letters of ending: "tagliare" ~ "tagliato", "reduce" ~ "reduced"
  const short = Math.min(a.length, b.length);
  const stem = p >= 5 ? (short - p <= 3 ? Math.max(0.85, p / short) : p / short) : 0;
  return Math.max(lev, stem);
}

export const FUZZY_MIN = 0.8;

function levenshtein(a: string, b: string): number {
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

export type Sentence = { text: string; start: number; end: number };

const CHUNK_TOKENS = 24;

/**
 * Sentences of a text with their offsets: split after . ! ? ; followed by a space or the end, and at
 * line breaks, never inside a number ("1.200", "3.5"). Unpunctuated text (some STT output) is cut
 * into overlapping chunks of at most 24 tokens, so a claim is never read against a whole minute of
 * speech.
 */
export function sentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  const re = /[\s\S]*?(?:[.!?;]+(?=\s|$)|\n|$)/g;
  for (const m of text.matchAll(re)) {
    if (!m[0]) {
      if ((m.index ?? 0) >= text.length) break;
      continue;
    }
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const s = (m.index ?? 0) + lead;
    const t = raw.trim();
    if (!t) continue;
    const toks = tokenize(t);
    if (toks.length <= CHUNK_TOKENS + 6) {
      out.push({ text: t, start: s, end: s + t.length });
      continue;
    }
    const step = CHUNK_TOKENS / 2;
    for (let i = 0; i < toks.length; i += step) {
      const last = Math.min(toks.length, i + CHUNK_TOKENS) - 1;
      out.push({ text: t.slice(toks[i].start, toks[last].end), start: s + toks[i].start, end: s + toks[last].end });
      if (last === toks.length - 1) break;
    }
  }
  return out;
}

// ---- quantities ---------------------------------------------------------------------------------

/**
 * A number in a text with what it counts. `kind` is the comparison class: two quantities are only
 * compared within a class. Durations are in seconds, so "2 ore" equals "120 minuti". Years
 * (1900 to 2100 with no unit) are their own class.
 */
export type Quantity = {
  kind: "percent" | "duration" | "count" | "year" | `currency:${string}`;
  value: number;
  /** the number as said, before the unit conversion (2 for "2 ore") */
  raw: number;
  /** said with a hedge ("circa", "oltre", "about", "una decina") */
  approx: boolean;
  tokenStart: number;
  tokenEnd: number;
};

const IT_UNITS: Record<string, number> = {
  uno: 1, un: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9,
  dieci: 10, undici: 11, dodici: 12, tredici: 13, quattordici: 14, quindici: 15, sedici: 16, diciassette: 17,
  diciotto: 18, diciannove: 19, venti: 20, vent: 20, trenta: 30, trent: 30, quaranta: 40, quarant: 40,
  cinquanta: 50, cinquant: 50, sessanta: 60, sessant: 60, settanta: 70, settant: 70, ottanta: 80, ottant: 80,
  novanta: 90, novant: 90,
};
const IT_MORPHEMES = [...Object.keys(IT_UNITS), "cento", "cent", "mille", "mila"].sort((a, b) => b.length - a.length);

/** Italian number word, compounds included ("quattrocentocinquanta", "duemilaventicinque"). */
function parseItalianWord(w: string): number | null {
  if (!w || w === "un" || w === "una" || w === "uno") return null; // articles; only inside compounds ("ventuno")
  let total = 0;
  let cur = 0;
  let i = 0;
  let parts = 0;
  while (i < w.length) {
    const m = IT_MORPHEMES.find((x) => w.startsWith(x, i));
    if (!m) return null;
    if (m === "cento" || m === "cent") cur = (cur || 1) * 100;
    else if (m === "mille") total += 1000;
    else if (m === "mila") {
      total += (cur || 1) * 1000;
      cur = 0;
    } else cur += IT_UNITS[m];
    i += m.length;
    parts++;
  }
  // a bare elided form ("vent", "cent") is not a word on its own
  if (parts === 1 && /^(vent|trent|quarant|cinquant|sessant|settant|ottant|novant|cent)$/.test(w)) return null;
  return total + cur;
}

const EN_SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const EN_TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES: Record<string, number> = {
  hundred: 100, thousand: 1000, million: 1e6, millions: 1e6, billion: 1e9, billions: 1e9,
  milione: 1e6, milioni: 1e6, miliardo: 1e9, miliardi: 1e9, mila: 1000, k: 1000, m: 1e6, mln: 1e6, mld: 1e9, bn: 1e9,
};

/** "1.200" and "1,200" are 1200; "3,5" and "3.5" are 3.5 (a separator followed by exactly 3 digits groups thousands). */
function parseDigits(s: string): number {
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ""));
  return Number(s.replace(",", "."));
}

const HEDGES = new Set(["circa", "quasi", "oltre", "almeno", "intorno", "sopra", "sotto", "about", "around", "almost", "nearly", "over", "roughly", "approximately", "some", "least", "under"]);
const HEDGE_PAIRS = new Set(["piu di", "meno di", "more than", "less than", "fewer than", "up to", "fino a"]);
const APPROX_NOUNS: Record<string, number> = { decina: 10, ventina: 20, trentina: 30, quarantina: 40, cinquantina: 50, centinaio: 100, centinaia: 100, migliaio: 1000, migliaia: 1000, dozen: 12, dozens: 12 };

const DURATION_UNITS: Record<string, number> = {
  secondo: 1, secondi: 1, second: 1, seconds: 1, sec: 1,
  minuto: 60, minuti: 60, minute: 60, minutes: 60, min: 60,
  ore: 3600, ora: 3600, hour: 3600, hours: 3600, h: 3600,
  giorno: 86400, giorni: 86400, day: 86400, days: 86400,
  settimana: 604800, settimane: 604800, week: 604800, weeks: 604800,
  mese: 2629800, mesi: 2629800, month: 2629800, months: 2629800,
  anno: 31557600, anni: 31557600, year: 31557600, years: 31557600,
};
const CURRENCY_WORDS: Record<string, string> = {
  "€": "eur", euro: "eur", eur: "eur", "$": "usd", dollaro: "usd", dollari: "usd", dollar: "usd", dollars: "usd", usd: "usd",
  "£": "gbp", sterlina: "gbp", sterline: "gbp", pound: "gbp", pounds: "gbp", gbp: "gbp",
};
const PERCENT_WORDS = new Set(["%", "percento", "percent", "pct", "percentuale", "percentuali"]);
/** Unit words are not content: "2 ore" and "due giorni" talk about the same thing. */
export const UNIT_WORDS = new Set([...Object.keys(DURATION_UNITS).filter((w) => w.length > 3), ...Object.keys(CURRENCY_WORDS).filter((w) => /^\p{L}+$/u.test(w)), ...PERCENT_WORDS, "cento", "cent"]);

/** Value of a single number token (digits, an Italian word, an English number word), or null. */
function wordValue(norm: string): { value: number; kind: "digits" | "it" | "en" } | null {
  if (/^\d/.test(norm)) return { value: parseDigits(norm), kind: "digits" };
  if (norm in EN_SMALL) return { value: EN_SMALL[norm], kind: "en" };
  if (norm in EN_TENS) return { value: EN_TENS[norm], kind: "en" };
  const it = parseItalianWord(norm);
  return it === null ? null : { value: it, kind: "it" };
}

/** Quantities of a text, in order. */
export function quantities(text: string): Quantity[] {
  return quantitiesFromTokens(tokenize(text));
}

/** Words after which a bare 1900-2100 number is a year ("nel 2025", "since 2019", "rispetto al 2024"). */
const YEAR_PREPS = new Set(["nel", "nell", "dal", "dall", "al", "all", "del", "dell", "entro", "anno", "in", "since", "by", "until", "from", "year", "of"]);
/** Words between two numbers of a range ("dal 20 al 25%", "from 20 to 25 percent", "tra 2 e 3 ore"). */
const RANGE_WORDS = new Set(["al", "a", "ai", "alle", "to", "e", "and", "fino", "through"]);
/** "un milione", "a million", "one hundred": the article stands for 1 before a scale. */
const ONE_BEFORE_SCALE = new Set(["un", "uno", "una", "a", "an", "one"]);
/** Scale words that count only written right after the digits ("1.2m", "30k"). */
const ADJACENT_SCALES = new Set(["m", "k"]);

const isWordNumber = (v: ReturnType<typeof wordValue>) => v !== null && v.kind !== "digits";

/** A number that fits after `cur` in a spoken compound: "twenty two", "two hundred fifty", "mille cinquecento". */
function fitsAfter(cur: number, v: number): boolean {
  if (v <= 0 || cur <= 0) return false;
  const place = 10 ** String(Math.trunc(v)).length;
  return cur % place === 0;
}

/**
 * Reads one number starting at token i: digits or words, compounds ("sixty-two", "two thousand five
 * hundred", "mille e cinquecento", "one million two hundred thousand"), scales ("tre milioni", "30k"),
 * halves ("two and a half") and spoken decimals ("tre virgola cinque", "three point 05").
 */
function readNumber(toks: Token[], i: number): { value: number; end: number; plainYearToken: boolean } | null {
  const at = (k: number) => toks[k]?.norm ?? "";
  let j = i;
  let total = 0;
  let cur: number;
  let words = true;
  if (ONE_BEFORE_SCALE.has(at(j)) && (at(j + 1) in SCALES || at(j + 1) === "hundred") && !ADJACENT_SCALES.has(at(j + 1))) {
    cur = 1;
    j++;
  } else {
    const first = wordValue(at(j));
    if (!first) return null;
    cur = first.value;
    words = first.kind !== "digits";
    j++;
    if (at(i) === "one" && !(at(j) in SCALES) && at(j) !== "hundred") return null; // "one small group": a pronoun
  }
  let lastScale = Infinity;
  for (;;) {
    const w = at(j);
    if (w === "hundred" && words) {
      cur = (cur || 1) * 100;
      j++;
    } else if (w in SCALES && w !== "hundred" && SCALES[w] < lastScale && (!ADJACENT_SCALES.has(w) || toks[j].start === toks[j - 1].end)) {
      total += (cur || 1) * SCALES[w];
      lastScale = SCALES[w];
      cur = 0;
      j++;
    } else if ((w === "and" && at(j + 1) === "a" && at(j + 2) === "half") || (w === "e" && (at(j + 1) === "mezzo" || at(j + 1) === "mezza"))) {
      if (cur === 0 && total === 0) break;
      cur += 0.5;
      j += w === "and" ? 3 : 2;
      break;
    } else if ((w === "and" || w === "e") && words && isWordNumber(wordValue(at(j + 1))) && (total > 0 || cur >= 100) && (cur === 0 || fitsAfter(cur, wordValue(at(j + 1))!.value))) {
      j++; // "two hundred and fifty", "mille e cinquecento"
    } else if (words && isWordNumber(wordValue(w)) && wordValue(w)!.value > 0 && ((cur === 0 && total > 0 && wordValue(w)!.value < lastScale) || fitsAfter(cur, wordValue(w)!.value))) {
      cur += wordValue(w)!.value;
      j++;
    } else break;
  }
  let value = total + cur;
  // decimals said in words: "tre virgola cinque", "three point five", "tre virgola 05"
  if ((at(j) === "virgola" || at(j) === "point") && wordValue(at(j + 1))) {
    const d = at(j + 1);
    value = Number(`${value}.${/^\d+$/.test(d) ? d : wordValue(d)!.value}`);
    j += 2;
  }
  const plainYearToken = j === i + 1 && (/^\d{4}$/.test(at(i)) || !/\d/.test(at(i)));
  return { value, end: j, plainYearToken };
}

export function quantitiesFromTokens(toks: Token[]): Quantity[] {
  const out: Quantity[] = [];
  const at = (k: number) => toks[k]?.norm ?? "";
  let i = 0;
  while (i < toks.length) {
    let start = i;
    let currency: string | null = null;
    let num: { value: number; end: number; plainYearToken: boolean } | null = null;
    let approx = false;
    if ((at(i) === "$" || at(i) === "€" || at(i) === "£") && /^\d/.test(at(i + 1))) {
      currency = CURRENCY_WORDS[at(i)];
      num = readNumber(toks, i + 1);
    } else if (at(i) in APPROX_NOUNS && (at(i - 1) === "una" || at(i - 1) === "un" || at(i - 1) === "a")) {
      num = { value: APPROX_NOUNS[at(i)], end: i + 1, plainYearToken: false }; // "una decina", "a dozen"
      approx = true;
      start = i - 1;
    } else {
      num = readNumber(toks, i);
    }
    if (!num || !Number.isFinite(num.value)) {
      i++;
      continue;
    }
    let { value, end: j } = num;
    // hedges right before the number
    if (HEDGES.has(at(start - 1)) || HEDGE_PAIRS.has(`${at(start - 2)} ${at(start - 1)}`)) approx = true;
    // unit after the number (skipping "di", "d'", "of")
    let raw = value;
    let kind: Quantity["kind"] = "count";
    let factor = 1;
    let k = j;
    if (at(k) === "di" || at(k) === "d" || at(k) === "of") k++;
    const u = at(k);
    const u2 = `${u} ${at(k + 1)}`;
    if (currency) {
      kind = `currency:${currency}`;
    } else if (PERCENT_WORDS.has(u)) {
      kind = "percent";
      j = k + 1;
    } else if (u2 === "per cento" || u2 === "per cent" || u2 === "punti percentuali") {
      kind = "percent";
      j = k + 2;
    } else if (u === "punti" && PERCENT_WORDS.has(at(k + 1))) {
      kind = "percent";
      j = k + 2;
    } else if (u in CURRENCY_WORDS) {
      kind = `currency:${CURRENCY_WORDS[u]}`;
      j = k + 1;
    } else if (u in DURATION_UNITS && ((u !== "ora" && u !== "h" && u !== "min" && u !== "sec") || k === j)) {
      kind = "duration";
      factor = DURATION_UNITS[u];
      j = k + 1;
      // "due ore e mezza", "two hours and a half"
      if (at(j) === "e" && (at(j + 1) === "mezzo" || at(j + 1) === "mezza")) {
        raw += 0.5;
        j += 2;
      } else if (at(j) === "and" && at(j + 1) === "a" && at(j + 2) === "half") {
        raw += 0.5;
        j += 3;
      }
      value = raw * factor;
    } else if (num.plainYearToken && Number.isInteger(value) && value >= 1900 && value <= 2100 && (YEAR_PREPS.has(at(start - 1)) || !/^\p{L}/u.test(at(j)))) {
      kind = "year";
    }
    // a range takes its unit from its second number: "dal 20 al 25 per cento" is 20% to 25%
    const prev = out[out.length - 1];
    if (prev && prev.kind === "count" && kind !== "count" && kind !== "year") {
      const gap = toks.slice(prev.tokenEnd, start).map((t) => t.norm);
      if (gap.length >= 1 && gap.length <= 2 && gap.every((g) => RANGE_WORDS.has(g))) {
        prev.kind = kind;
        prev.value = prev.raw * factor;
      }
    }
    out.push({ kind, value, raw, approx, tokenStart: start, tokenEnd: j });
    i = Math.max(j, i + 1);
  }
  return out;
}

/** Same quantity: same class and value (within 15% when either side is hedged); currencies must match. */
export function sameQuantity(a: Quantity, b: Quantity): boolean {
  if (a.kind !== b.kind) return false;
  const m = Math.max(Math.abs(a.value), Math.abs(b.value));
  if (m === 0) return true;
  const rel = Math.abs(a.value - b.value) / m;
  return rel < 1e-9 || ((a.approx || b.approx) && rel <= 0.15);
}
