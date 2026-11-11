// The languages Filow understands when spoken, and how it tells them apart in a text. One list and
// one word table for every reader: speech-to-text, the natural voice, OK Filow's answers, dictation
// and the rehearsal report (the desktop shell reads this file through vendor/spoken.js).

export const SPOKEN_LANGS = ["en", "it", "ru", "ro", "ja"] as const;
export type SpokenLang = (typeof SPOKEN_LANGS)[number];

/** "ja-JP" is "ja"; anything that is not one of the five is null. */
export function spokenLang(value: unknown): SpokenLang | null {
  const code = typeof value === "string" ? value.trim().toLowerCase().slice(0, 2) : "";
  return (SPOKEN_LANGS as readonly string[]).includes(code) ? (code as SpokenLang) : null;
}

export type LatinLang = "en" | "it" | "ro";
export const LATIN_LANGS: readonly LatinLang[] = ["en", "it", "ro"];

// How the three Latin-script languages are told apart. Evidence, strongest first:
//   OWN    a frequent word only one of them uses ("the", "che", "pentru"), a letter only one of them
//          writes, or a contraction only one of them makes ("mi-e", "l'ho", "don't");
//   SHARED a frequent word two of them use ("am" and "are" are English and Romanian, "e", "la" and
//          "un" are Italian and Romanian, "come" is English and Italian): it counts for both, so it
//          settles nothing alone and decides together with other evidence;
//   SHAPE  the spelling of a word none of the lists knows ("th", a doubled consonant before a final
//          vowel, the article "-ul" at the end).
// Words are compared without their accents, so Romanian typed or transcribed without diacritics reads
// the same. A tie stays a tie: the callers treat it as "cannot tell".
const OWN = 3;
const SHARED = 2;
const SHAPE = 1;
const words = (list: string) => list.split(/\s+/).filter(Boolean);
const OWN_WORDS: Record<LatinLang, string[]> = {
  en: words(`the and is of to that this these those we you he she they it was were with for what where when how who why which
    does did can could would should will my your his her our their them us on at by from or if not be been have has had but
    than then there here about today very just some any all one two up out now please thanks thank yes hello hi get got go
    going let make take give tell see know think want need like look say said new next back again more much many too also
    into over after before off only still yet well right try done good far later click button open choose sure`),
  it: words(`il lo gli uno di con su per tra fra del dello della dei degli delle al allo alla agli alle dal dalla nel nella nei
    nello sul sulla sui che chi cosa dove quando quanto quanta quanti quale quali qual perche ed non sono sei siamo siete ho
    ha abbiamo avete hanno io lei loro mio mia miei tuo tua suo sua nostro questo questa questi queste quello quella qui
    qua anche ancora gia piu molto molti molta poco po tutto tutti tutta tutte ogni sempre adesso oggi domani bene grazie
    prego ciao buongiorno buonasera certo posso puoi puo possiamo potete devo devi deve dobbiamo voglio vuoi vuole vogliamo
    fare faccio fai facciamo vado vai andiamo ecco poi allora quindi pero cioe ci vi cosi senza dopo sera tempo favore
    pulsante clicco clic apri scegli`),
  ro: words(`este sunt suntem sunteti esti avem aveti au eu el ea ei ele meu mea mei mele tau lor nostru acest aceasta acesta
    acestea asta astea acum aici acolo unde cand cum cat cati cate cata cine cineva ceva nimic nimeni tot toti toate foarte
    prea doar numai sau dar iar daca ca pentru despre fara intre dupa pana prin spre langa vreau vrei vrea vrem poti poate
    putem trebuie fac faci facem bine bun buna multumesc salut sigur imi iti isi fi fost fie azi astazi maine rog zi ziua ce
    cu pe de din nu apoi atunci deci chiar inca deja mereu asa gata mult multe multi putin timp vom
    apasa apas alege deschide meniul fisier butonul`),
};
const SHARED_WORDS: [LatinLang, LatinLang, string[]][] = [
  ["en", "ro", words("am are pot face care sub an as minute")],
  ["en", "it", words("i come no me fine due so do male")],
  ["it", "ro", words(`e o la le li un una mi ti si se ne ma mai da sa va fa sta stai ai hai dai tu lui noi voi ieri pare ora prima
    mare il`)],
];
const WORD_EVIDENCE = new Map<string, Partial<Record<LatinLang, number>>>();
for (const l of LATIN_LANGS) for (const w of OWN_WORDS[l]) WORD_EVIDENCE.set(w, { [l]: OWN });
for (const [a, b, list] of SHARED_WORDS) for (const w of list) WORD_EVIDENCE.set(w, { [a]: SHARED, [b]: SHARED });

// Contractions. Romanian hangs its short pronouns and its article on a hyphen ("mi-e", "i-am",
// "da-mi", "slide-ul"); Italian elides with an apostrophe ("l'ho", "dov'è"); English shortens its
// verbs with one ("don't", "it's").
const RO_HYPHEN = /^(?:mi|ti|i|l|s|n|m|v|c|ne|le|te|se|ma|ce|sa|nu|de|ca|pe|si|intr|dintr|printr)-\p{L}|\p{L}-(?:o|l|i|mi|ti|ma|te|ne|le|va|ul|uri|urile|ului|urilor|lea)$/u;
const IT_ELISION = /^(?:l|un|dell|all|nell|sull|dall|c|dov|com|quest|quell|d|n|m|t|s|v|bell|cos|quant|anch|buon|quand|senz|mezz|tutt|null|qualcos)'\p{L}/u;
const EN_CONTRACTION = /\p{L}'(?:s|t|re|ll|ve|m|d)$/u;
// "O să" before a verb is the Romanian future; Italian has "o" and "sa", never the pair.
const RO_PAIRS = new Set(["o sa"]);

// The spelling of a word no list knows.
const EN_SHAPE = /th|wh|sh|ck|ght|[wy]|ing$|tion$/;
const IT_SHAPE = /([bcdfglmnprstvz])\1\p{L}*[aio]$|^\p{L}{4,}[^aeiou]o$|(?:zione|mente|iamo)$/u;
const RO_SHAPE = /[^f]ul$|ului$|ilor$|elor$|esc$|eaza$|\p{L}{2}ez$|\p{L}ii$|^\p{L}{4,}[^n]ea$/u;
const KANA = /[぀-ヿㇰ-ㇿｦ-ﾟ]/g;
const HAN = /[一-鿿]/g;
const CYRILLIC = /[Ѐ-ӿ]/g;
const LATIN = /[a-zÀ-ɏ]/gi;
const RO_LETTERS = /[ăâîşșţț]/g;
const IT_LETTERS = /[àèéìòù]/g;
const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;

/** How many letters of each script a text has. */
export function scriptCounts(text: string): { kana: number; han: number; cyrillic: number; latin: number } {
  return { kana: count(text, KANA), han: count(text, HAN), cyrillic: count(text, CYRILLIC), latin: count(text, LATIN) };
}

/** A word without its accents and diacritics: "să" and "sa", "perché" and "perche" are one entry. */
const bare = (word: string) => word.normalize("NFD").replace(/\p{M}/gu, "");

/** Word, letter and contraction evidence, and the spelling evidence apart (see the table above). */
function latinEvidence(text: string): { told: Record<LatinLang, number>; shape: Record<LatinLang, number> } {
  const lower = text.normalize("NFC").toLowerCase().replace(/[’ʼ]/g, "'").replace(/[‐‑]/g, "-");
  const told = { en: 0, it: 0, ro: 0 };
  const shape = { en: 0, it: 0, ro: 0 };
  told.ro += OWN * count(lower, RO_LETTERS);
  told.it += SHARED * count(lower, IT_LETTERS);
  let before = "";
  for (const raw of lower.match(/\p{L}[\p{L}'-]*/gu) ?? []) {
    const token = bare(raw).replace(/['-]+$/, "");
    if (RO_HYPHEN.test(token)) told.ro += OWN;
    if (IT_ELISION.test(token)) told.it += OWN;
    if (EN_CONTRACTION.test(token)) told.en += OWN;
    for (const w of token.split(/['-]/)) {
      if (!w) continue;
      if (RO_PAIRS.has(`${before} ${w}`)) told.ro += OWN;
      before = w;
      const known = WORD_EVIDENCE.get(w);
      if (known) for (const l of LATIN_LANGS) told[l] += known[l] ?? 0;
      else if (w.length > 2) {
        if (EN_SHAPE.test(w)) shape.en += SHAPE;
        if (IT_SHAPE.test(w)) shape.it += SHAPE;
        if (RO_SHAPE.test(w)) shape.ro += SHAPE;
      }
    }
  }
  return { told, shape };
}

/** Evidence for English, Italian and Romanian in a Latin-script text: words, letters, contractions and spelling together. */
export function latinScores(text: string): Record<LatinLang, number> {
  const { told, shape } = latinEvidence(text);
  return { en: told.en + shape.en, it: told.it + shape.it, ro: told.ro + shape.ro };
}

/**
 * The Latin-script languages the text could be: one when the evidence tells, several on a tie, all
 * three when it says nothing. Spelling settles a tie between languages the words point to; alone it
 * names no language (a product name or a single unknown word is not a sentence in a language).
 */
export function latinWinners(text: string): LatinLang[] {
  const { told, shape } = latinEvidence(text);
  if (told.en + told.it + told.ro === 0) return [...LATIN_LANGS];
  const score = (l: LatinLang) => told[l] + shape[l];
  const best = Math.max(...LATIN_LANGS.map(score));
  return LATIN_LANGS.filter((l) => score(l) === best);
}
/**
 * The language a short text (a question, a sentence) is written in, or null when it cannot tell
 * (empty, numbers, a tie). Any kana, Cyrillic or kanji wins over Latin letters: a question names
 * products in Latin script ("Где кнопка Export в Adobe Premiere Pro?"), while an English, Italian or
 * Romanian sentence practically never contains those scripts. Filow knows no other Han-script language.
 */
export function detectLanguage(text: string): SpokenLang | null {
  const s = text.normalize("NFC");
  const scripts = scriptCounts(s);
  if (scripts.kana) return "ja";
  if (scripts.cyrillic) return "ru";
  if (scripts.han) return "ja";
  const winners = latinWinners(s);
  return winners.length === 1 ? winners[0] : null;
}

/**
 * The language of a longer text that may mix scripts (a transcript, an answer to read aloud): the
 * script that carries most of it, then the Latin-script evidence. `fallback` decides when the text
 * gives no hint or a tie it is part of; without one a tie is null.
 */
export function detectDominantLanguage(text: string, fallback?: SpokenLang): SpokenLang | null {
  const s = text.normalize("NFC");
  const { kana, han, cyrillic, latin } = scriptCounts(s);
  if (kana + han + cyrillic + latin === 0) return fallback ?? null;
  if ((kana + han) * 2 > latin + cyrillic) return "ja";
  if (cyrillic > latin) return "ru";
  const winners = latinWinners(s);
  if (winners.length === 1) return winners[0];
  if (!fallback) return null;
  // A tie: the fallback when it is one of the tied languages; else the first tied one, and English
  // for Latin letters that say nothing (never Russian or Japanese for a Latin-script text).
  if ((winners as string[]).includes(fallback)) return fallback;
  return winners.length === LATIN_LANGS.length ? "en" : winners[0];
}
