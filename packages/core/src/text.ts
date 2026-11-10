// Text utilities shared by the lexical gate stage (gate.ts) and the claim guard (guard.ts):
// accent folding, tokens with offsets, stop words, fuzzy token similarity, sentences, and quantities
// (numbers in digits or words, with their unit). Pure, no dependencies.
//
// Languages: Italian, English, Russian, Romanian and Japanese (docs/stt/LANGUAGES.md). The engine
// passes no language, so everything here is driven by the script of the text itself: a talk that
// mixes languages is read the same way as one that does not.

export type Token = {
  /** folded form: lower case, no accents; digits keep their separators */
  norm: string;
  start: number;
  end: number;
};

const isStressMark = (mark: string) => mark.codePointAt(0) === 0x300 || mark.codePointAt(0) === 0x301;

/**
 * Lower case in one spelling ("Perché" becomes "perche"):
 * - Latin letters lose their accents, so Romanian reads the same typed with or without diacritics
 *   ("și", the legacy "şi" and "si" are one word);
 * - Cyrillic loses only the stress accents dictionaries print; "й" stays apart from "и", "ё" reads as "е";
 * - full-width letters and digits and half-width katakana take their usual form (Unicode NFKC).
 */
export function fold(text: string): string {
  return text
    .normalize("NFKC")
    .normalize("NFD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .replace(/(\p{Script=Cyrillic})(\p{M}+)/gu, (_, letter: string, marks: string) => letter + Array.from(marks).filter((m) => !isStressMark(m)).join(""))
    .normalize("NFC")
    .toLowerCase()
    .replace(/ё/g, "е");
}

/** Japanese is written without spaces: a run of letters holding one of these characters is cut into words. */
const JAPANESE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
/** A word written only in hiragana: a particle or an ending far more often than a word a point is about. */
const HIRAGANA_ONLY = /^[\p{Script=Hiragana}ー]+$/u;

const JA_DIGITS: Record<string, number> = { "〇": 0, "零": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
const JA_SMALL_UNITS: Record<string, number> = { "十": 10, "百": 100, "千": 1000 };
const JA_BIG_UNITS: Record<string, number> = { "万": 1e4, "億": 1e8 };
const JA_NUMERALS = /^[〇零一二三四五六七八九十百千万億]+/;
/** What a number counts when it is written glued to it ("二人", "三つ", "十分"). "番" is left out: "一番" is "the most". */
const JA_COUNTERS = new Set([
  "人", "つ", "月", "日", "年", "時", "分", "秒", "回", "個", "件", "社", "円", "名", "台", "本", "枚", "倍", "割", "位", "度", "歳", "才",
  "週間", "時間", "か月", "ヶ月", "カ月", "ヵ月", "年間", "日間", "分間", "番目", "人目", "パーセント",
]);
/** Words written only with numerals that are not numbers ("万一": by any chance). */
const JA_NOT_NUMBERS = new Set(["万一"]);

type Piece = Token & { /** kanji numerals still to be read as a number */ numerals?: string };

let segmenter: Intl.Segmenter | null | undefined;

/** Words of a Japanese run with their offsets in it (Intl.Segmenter; script boundaries where the runtime has none). */
function japaneseWords(run: string): Array<{ text: string; index: number }> {
  if (segmenter === undefined) segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("ja", { granularity: "word" }) : null;
  if (!segmenter) {
    return Array.from(run.matchAll(/\p{Script=Han}+|[\p{Script=Katakana}ー]+|\p{Script=Hiragana}+|[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+/gu), (m) => ({ text: m[0], index: m.index ?? 0 }));
  }
  const out: Array<{ text: string; index: number }> = [];
  // "〇" (zero in "二〇二四") is a numeral to Unicode, not a word: keep it
  for (const s of segmenter.segment(run)) if (s.isWordLike || /^〇+$/.test(s.segment)) out.push({ text: s.segment, index: s.index });
  return out;
}

/** Tokens of a Japanese run starting at `offset`: words, with kanji numerals and their counter set apart. */
function japaneseTokens(run: string, offset: number): Piece[] {
  const out: Piece[] = [];
  for (const w of japaneseWords(run)) {
    const start = offset + w.index;
    const numerals = JA_NOT_NUMBERS.has(w.text) ? "" : (w.text.match(JA_NUMERALS)?.[0] ?? "");
    const rest = w.text.slice(numerals.length);
    if (numerals && (!rest || JA_COUNTERS.has(rest))) {
      out.push({ norm: numerals, start, end: start + numerals.length, numerals });
      if (rest) out.push({ norm: fold(rest), start: start + numerals.length, end: start + w.text.length });
    } else {
      out.push({ norm: fold(w.text), start, end: start + w.text.length });
    }
  }
  return out;
}

/**
 * Kanji numerals become one digit token, so a spoken "三十" meets a written "30": pieces that touch are
 * read together ("四百" + "五十" is 450), digits before a unit too ("1200" + "万" is 12000000), and a run
 * without units is positional ("二〇二四" is 2024).
 */
function mergeJapaneseNumbers(pieces: Piece[]): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < pieces.length) {
    const p = pieces[i];
    const next = pieces[i + 1];
    const digitsBeforeUnit = p.numerals === undefined && /^\d/.test(p.norm) && next?.numerals !== undefined && next.start === p.end && /^[十百千万億]/.test(next.numerals);
    if (p.numerals === undefined && !digitsBeforeUnit) {
      out.push({ norm: p.norm, start: p.start, end: p.end });
      i++;
      continue;
    }
    let total = 0;
    let section = 0;
    let current = digitsBeforeUnit ? parseDigits(p.norm) : 0;
    let j = digitsBeforeUnit ? i + 1 : i;
    let end = p.end;
    while (j < pieces.length && pieces[j].numerals !== undefined && (j === i || pieces[j].start === pieces[j - 1].end)) {
      for (const ch of pieces[j].numerals as string) {
        if (ch in JA_DIGITS) current = current * 10 + JA_DIGITS[ch];
        else if (ch in JA_SMALL_UNITS) {
          section += (current || 1) * JA_SMALL_UNITS[ch];
          current = 0;
        } else {
          total += (section + current || 1) * JA_BIG_UNITS[ch];
          section = 0;
          current = 0;
        }
      }
      end = pieces[j].end;
      j++;
    }
    out.push({ norm: String(total + section + current), start: p.start, end });
    i = j;
  }
  return out;
}

/**
 * Words, numbers (with their "." or "," separators) and the symbols that carry meaning for a claim
 * (% € $ £ ¥). English "n't" becomes its own "not" token, so "didn't" reads as "did not". Japanese
 * text is cut into words, and its kanji numerals are written as digits.
 */
export function tokenize(text: string): Token[] {
  const out: Piece[] = [];
  let japanese = false;
  const re = /[\d０-９]+(?:[.,．，][\d０-９]+)*|[\p{L}〇][\p{L}\p{M}〇]*|[%％€$£¥￥]/gu;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (JAPANESE.test(m[0])) {
      const pieces = japaneseTokens(m[0], start);
      japanese ||= pieces.some((p) => p.numerals !== undefined);
      out.push(...pieces);
      continue;
    }
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
  return japanese ? mergeJapaneseNumbers(out) : out;
}

// Function words (folded). Content is what is left: the words that say what a point is about.
// Romanian words are listed only where the folded form is not also an Italian or English word
// or a common acronym ("care", "sub", "te", "sa", "va", and "eu", "pe" for EU, PE are left out):
// a Romanian function word that slips through costs a little precision in the lexical score, a
// wrongly dropped Italian or English word costs recall.
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
и в во на я с со как а то все она так его но да ты к у же вы за бы по ее мне было вот от меня еще о об из ему теперь
когда даже если уже или быть был была были будет будут до вас там потом себя ей может они тут где есть для мы тебя их
чем без тогда кто этот эта это эти того этого этой этом этих тем чтобы что всех при после над под тот та те через нас
про них наш наша наше наши мой моя мои свой своя свои который которая которое которые также тоже очень только лишь ли
он оно им ими вам нам вами нами себе около примерно почти более менее
de din au sau dar iar este sunt suntem fost cu prin pentru spre catre despre dupa intre acest aceasta acesti aceste
acel acea acei acele foarte isi imi iti vom vor doar deci daca atunci aici acolo toti toate fiecare unei unui niste
cel cea cei cele lor el ea ele avem aveti fiind decat insa
`;
export const STOP = new Set(STOP_WORDS.split(/\s+/).filter(Boolean));

/**
 * Words that carry no topic but change truth: kept out of content, read by the guard. Russian and
 * Romanian negate before the verb, like Italian and English. Japanese negates in the verb ending
 * ("ません", "ない"): those endings are hiragana, so never content, and the guard reads them itself.
 */
export const NEGATIONS = new Set([
  "non", "mai", "nessun", "nessuno", "nessuna", "niente", "nulla", "not", "no", "never", "none", "nothing", "nobody", "nor", "cannot", "failed", "fail", "fails", "unable",
  "не", "нет", "ни", "никогда", "никто", "ничего", "нельзя",
  "nu", "nici", "nimic", "nimeni", "niciodata",
]);

/**
 * Content tokens of a text: no stop words, no negations, no numbers or number words, at least 2
 * letters. In Japanese a word needs a kanji or a katakana letter: single kanji and words written only
 * in hiragana are left to the embedding stage of the gate.
 */
export function contentTokens(text: string): string[] {
  const toks = tokenize(text);
  const numberIdx = new Set<number>();
  for (const q of quantitiesFromTokens(toks)) for (let i = q.tokenStart; i < q.tokenEnd; i++) numberIdx.add(i);
  return toks
    .filter((t, i) => !numberIdx.has(i) && /^\p{L}{2,}$/u.test(t.norm) && !HIRAGANA_ONLY.test(t.norm) && !STOP.has(t.norm) && !NEGATIONS.has(t.norm) && !UNIT_WORDS.has(t.norm))
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
  const short = Math.min(a.length, b.length);
  // The stem of Latin "-dere / -de" verbs ends in d in the verb and in s in its noun and participle:
  // chiudere ~ chiusura, decidere ~ decisione, concludere ~ conclusione, decide ~ decision,
  // conclude ~ conclusion. After 4 shared letters that d/s pair counts as one more shared letter.
  if (p >= 4 && short >= 6 && ((a[p] === "d" && b[p] === "s") || (a[p] === "s" && b[p] === "d"))) p++;
  // a shared stem of 5+ letters leaving at most 3 letters of ending: "tagliare" ~ "tagliato", "reduce" ~ "reduced"
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
 * Sentences of a text with their offsets: split after . ! ? ; followed by a space or the end, after
 * the Japanese 。！？ (no space follows those), and at line breaks, never inside a number
 * ("1.200", "3.5"). Japanese is written without spaces and its STT output without punctuation, so a
 * space between two Japanese characters is where the recogniser closed a phrase: a sentence ends
 * there too. Other unpunctuated text is cut into overlapping chunks of at most 24 tokens, so a claim
 * is never read against a whole minute of speech.
 */
export function sentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  const re = /[\s\S]*?(?:[.!?;]+(?=\s|$)|[。！？]+|(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\d])|\n|$)/gu;
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

// Russian number words (folded: "ё" is "е"). Streaming recognizers spell numbers out, so a spoken
// "тридцать процентов" has to meet a written "30%". Genitive forms ("пяти", "тридцати") are derived.
const RU_BASE: Record<string, number> = {
  ноль: 0, нуль: 0, один: 1, одна: 1, одно: 1, одного: 1, одной: 1, одну: 1, два: 2, две: 2, двух: 2, двум: 2, двумя: 2, три: 3, трех: 3, трем: 3, тремя: 3,
  четыре: 4, четырех: 4, четырем: 4, четырьмя: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, восьми: 8, девять: 9, десять: 10,
  одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14, пятнадцать: 15, шестнадцать: 16, семнадцать: 17,
  восемнадцать: 18, девятнадцать: 19, двадцать: 20, тридцать: 30, сорок: 40, сорока: 40, пятьдесят: 50, пятидесяти: 50,
  шестьдесят: 60, шестидесяти: 60, семьдесят: 70, семидесяти: 70, восемьдесят: 80, восьмидесяти: 80, девяносто: 90, девяноста: 90,
  сто: 100, ста: 100, двести: 200, двухсот: 200, триста: 300, трехсот: 300, четыреста: 400, четырехсот: 400,
  пятьсот: 500, пятисот: 500, шестьсот: 600, шестисот: 600, семьсот: 700, семисот: 700, восемьсот: 800, восьмисот: 800,
  девятьсот: 900, девятисот: 900,
};
const RU_NUMBERS: Record<string, number> = { ...RU_BASE };
for (const [w, v] of Object.entries(RU_BASE)) if (w.endsWith("ь")) RU_NUMBERS[`${w.slice(0, -1)}и`] ??= v;

// Romanian number words, folded ("șase" is "sase"). "un", "o" and "mie" are left out: the first two are
// articles, and "mie" is also Italian for "my" ("o mie" for 1000 is therefore not read; "doua mii" is).
const RO_NUMBERS: Record<string, number> = {
  unu: 1, doi: 2, doua: 2, trei: 3, patru: 4, cinci: 5, sase: 6, sapte: 7, opt: 8, noua: 9, zece: 10,
  unsprezece: 11, doisprezece: 12, douasprezece: 12, treisprezece: 13, paisprezece: 14, cincisprezece: 15, saisprezece: 16,
  saptesprezece: 17, optsprezece: 18, nouasprezece: 19, douazeci: 20, treizeci: 30, patruzeci: 40, cincizeci: 50,
  saizeci: 60, saptezeci: 70, optzeci: 80, nouazeci: 90,
};
/** "hundred" multiplies what came before it; so do the Romanian "suta" and "sute". */
const HUNDREDS = new Set(["hundred", "suta", "sute"]);
/** After English "opt" these make it the verb ("opt out"), not the Romanian 8. */
const OPT_PARTICLES = new Set(["", "in", "out", "for", "into", "to", "against", "instead", "not"]);
/** "one" and its Russian and Romanian forms are a number only before a scale: alone they are a pronoun. */
const PRONOUN_ONES = new Set(["one", "один", "одна", "одно", "одного", "одной", "одну", "unu"]);
/** Russian scales that mean one of themselves when no number comes before ("тысяча клиентов"). */
const BARE_SCALES = new Set(["тысяча", "тысячу", "миллион", "миллиард"]);

const SCALES: Record<string, number> = {
  hundred: 100, thousand: 1000, million: 1e6, millions: 1e6, billion: 1e9, billions: 1e9,
  milione: 1e6, milioni: 1e6, miliardo: 1e9, miliardi: 1e9, mila: 1000, k: 1000, m: 1e6, mln: 1e6, mld: 1e9, bn: 1e9,
  тысяча: 1000, тысячи: 1000, тысяч: 1000, тысячу: 1000, тыс: 1000, миллион: 1e6, миллиона: 1e6, миллионов: 1e6, млн: 1e6,
  миллиард: 1e9, миллиарда: 1e9, миллиардов: 1e9, млрд: 1e9,
  mii: 1000, milion: 1e6, milioane: 1e6, miliard: 1e9, miliarde: 1e9,
};

/** "1.200" and "1,200" are 1200; "3,5" and "3.5" are 3.5 (a separator followed by exactly 3 digits groups thousands). */
function parseDigits(s: string): number {
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ""));
  return Number(s.replace(",", "."));
}

const HEDGES = new Set([
  "circa", "quasi", "oltre", "almeno", "intorno", "sopra", "sotto", "about", "around", "almost", "nearly", "over", "roughly", "approximately", "some", "least", "under",
  "около", "примерно", "почти", "более", "свыше", "менее", "aproximativ", "aproape", "peste", "cam", "約",
]);
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
  секунда: 1, секунды: 1, секунд: 1, секунду: 1, минута: 60, минуты: 60, минут: 60, минуту: 60, час: 3600, часа: 3600, часов: 3600,
  день: 86400, дня: 86400, дней: 86400, неделя: 604800, недели: 604800, недель: 604800, неделю: 604800,
  месяц: 2629800, месяца: 2629800, месяцев: 2629800, год: 31557600, года: 31557600, лет: 31557600,
  secunda: 1, secunde: 1, minut: 60, zi: 86400, zile: 86400, saptamana: 604800, saptamani: 604800, luna: 2629800, luni: 2629800, ani: 31557600,
  // "日" after a number is a day whether it dates ("4日") or lasts ("4日間"): both sides read it the same way
  "秒": 1, "分": 60, "分間": 60, "時間": 3600, "日": 86400, "日間": 86400, "週間": 604800, "か月": 2629800, "ヶ月": 2629800, "カ月": 2629800, "ヵ月": 2629800, "年間": 31557600,
};
const CURRENCY_WORDS: Record<string, string> = {
  "€": "eur", euro: "eur", eur: "eur", "$": "usd", dollaro: "usd", dollari: "usd", dollar: "usd", dollars: "usd", usd: "usd",
  "£": "gbp", sterlina: "gbp", sterline: "gbp", pound: "gbp", pounds: "gbp", gbp: "gbp",
  евро: "eur", доллар: "usd", доллара: "usd", долларов: "usd", рубль: "rub", рубля: "rub", рублей: "rub", руб: "rub",
  ron: "ron", "¥": "jpy", "円": "jpy",
};
const PERCENT_WORDS = new Set(["%", "percento", "percent", "pct", "percentuale", "percentuali", "процент", "процента", "процентов", "проценту", "процентом", "проценты", "процентам", "процентами", "процентах", "procent", "procente", "パーセント"]);
/** Unit words are not content: "2 ore" and "due giorni" talk about the same thing. */
export const UNIT_WORDS = new Set([...Object.keys(DURATION_UNITS).filter((w) => w.length > 3), ...Object.keys(CURRENCY_WORDS).filter((w) => /^\p{L}+$/u.test(w)), ...PERCENT_WORDS, "cento", "cent"]);

/** Value of a single number token (digits, or a number word in Italian, English, Russian or Romanian), or null. */
function wordValue(norm: string): { value: number; kind: "digits" | "it" | "en" | "ru" | "ro" } | null {
  if (/^\d/.test(norm)) return { value: parseDigits(norm), kind: "digits" };
  if (norm in EN_SMALL) return { value: EN_SMALL[norm], kind: "en" };
  if (norm in EN_TENS) return { value: EN_TENS[norm], kind: "en" };
  const it = parseItalianWord(norm);
  if (it !== null) return { value: it, kind: "it" };
  if (Object.hasOwn(RU_NUMBERS, norm)) return { value: RU_NUMBERS[norm], kind: "ru" };
  if (Object.hasOwn(RO_NUMBERS, norm)) return { value: RO_NUMBERS[norm], kind: "ro" };
  return null;
}

/** A unit right at token k: what makes an ambiguous word before it a number ("noua la suta", "noua luni"). */
function unitAt(toks: Token[], k: number): boolean {
  const u = toks[k]?.norm ?? "";
  return PERCENT_WORDS.has(u) || Object.hasOwn(CURRENCY_WORDS, u) || Object.hasOwn(DURATION_UNITS, u) || (u === "la" && toks[k + 1]?.norm === "suta");
}

/** Quantities of a text, in order. */
export function quantities(text: string): Quantity[] {
  return quantitiesFromTokens(tokenize(text));
}

/** Words after which a bare 1900-2100 number is a year ("nel 2025", "since 2019", "rispetto al 2024"). */
const YEAR_PREPS = new Set(["nel", "nell", "dal", "dall", "al", "all", "del", "dell", "entro", "anno", "in", "since", "by", "until", "from", "year", "of", "в", "с", "до", "от", "к", "din", "pana", "anul"]);
/** Words between two numbers of a range ("dal 20 al 25%", "from 20 to 25 percent", "tra 2 e 3 ore"). */
const RANGE_WORDS = new Set(["al", "a", "ai", "alle", "to", "e", "and", "fino", "through"]);
/** A word right after a 1900-2100 number that makes it a year: Russian "год" forms, Japanese 年. */
const YEAR_SUFFIXES = new Set(["год", "года", "году", "годом", "годе", "年"]);
/** "un milione", "a million", "one hundred", "un milion": the article stands for 1 before a scale. */
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
  // Russian and Romanian number words only compound with words of their own language: "two hundred opt
  // out" is 200 and a verb, not 208. Italian and English words keep mixing as they always did.
  let family: "ru" | "ro" | "other" | null = null;
  const familyOf = (kind: string): "ru" | "ro" | "other" => (kind === "ru" || kind === "ro" ? kind : "other");
  const scaleNext = (k: number) => Object.hasOwn(SCALES, at(k)) || HUNDREDS.has(at(k));
  if (ONE_BEFORE_SCALE.has(at(j)) && (at(j + 1) in SCALES || at(j + 1) === "hundred") && !ADJACENT_SCALES.has(at(j + 1))) {
    cur = 1;
    j++;
  } else if (at(j) === "o" && at(j + 1) === "suta") {
    cur = 1; // "o suta": the Romanian article stands for 1
    family = "ro";
    j++;
  } else if (BARE_SCALES.has(at(j))) {
    cur = 1; // "тысяча клиентов": the loop below multiplies by the scale
    family = "ru";
  } else {
    const first = wordValue(at(j));
    if (!first) return null;
    cur = first.value;
    words = first.kind !== "digits";
    if (words) family = familyOf(first.kind);
    j++;
    if (at(i) === "one" && !(at(j) in SCALES) && at(j) !== "hundred") return null; // "one small group": a pronoun
    if (at(i) !== "one" && PRONOUN_ONES.has(at(i)) && !scaleNext(j) && !unitAt(toks, j)) return null; // "один из них"
    if (at(i) === "opt" && OPT_PARTICLES.has(at(j))) return null; // "customers opt out": the English verb
    // Romanian "noua" is also "the new one": alone it is 9 only before a scale or a unit
    if (at(i) === "noua" && !scaleNext(j) && !unitAt(toks, j) && !(at(j) === "de" && unitAt(toks, j + 1))) return null;
  }
  let lastScale = Infinity;
  for (;;) {
    const w = at(j);
    const next = words ? wordValue(w) : null;
    if (next && isWordNumber(next) && family !== null && familyOf(next.kind) !== family) break;
    if (HUNDREDS.has(w) && words) {
      cur = (cur || 1) * 100;
      j++;
    } else if (w === "si" && words && family === "ro" && cur % 100 >= 20 && cur % 10 === 0 && Object.hasOwn(RO_NUMBERS, at(j + 1)) && RO_NUMBERS[at(j + 1)] < 10) {
      j++; // "treizeci si cinci": the unit is added on the next turn
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
      family ??= familyOf(wordValue(w)!.kind);
      j++;
    } else break;
  }
  let value = total + cur;
  // decimals said in words: "tre virgola cinque", "three point five", "tre virgola 05", "trei virgula cinci"
  if ((at(j) === "virgola" || at(j) === "point" || at(j) === "virgula") && wordValue(at(j + 1))) {
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
    let num: { value: number; end: number; plainYearToken: boolean } | null;
    let approx = false;
    if (/^[$€£¥]$/.test(at(i)) && /^\d/.test(at(i + 1))) {
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
    // unit after the number (skipping "di", "d'", "of", and the Romanian "de" of "20 de minute")
    let raw = value;
    let kind: Quantity["kind"] = "count";
    let factor = 1;
    let k = j;
    if (at(k) === "di" || at(k) === "d" || at(k) === "of" || at(k) === "de") k++;
    const u = at(k);
    const u2 = `${u} ${at(k + 1)}`;
    const yearValue = num.plainYearToken && Number.isInteger(value) && value >= 1900 && value <= 2100;
    if (currency) {
      kind = `currency:${currency}`;
    } else if (yearValue && YEAR_SUFFIXES.has(u)) {
      kind = "year"; // "2024 года", "2024年": a year, not a span of two thousand years
      j = k + 1;
    } else if (PERCENT_WORDS.has(u)) {
      kind = "percent";
      j = k + 1;
    } else if (u2 === "per cento" || u2 === "per cent" || u2 === "punti percentuali" || u2 === "la suta") {
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
    } else if (yearValue && (YEAR_PREPS.has(at(start - 1)) || !/^\p{L}/u.test(at(j)))) {
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
