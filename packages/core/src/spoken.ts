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

// Short, frequent words that tell the three Latin-script languages apart. Words two of them share
// (a, e, o, in, la, un, se, te, mi, ma, mai, le) are left out on purpose.
const words = (list: string) => new Set(list.split(" "));
const LATIN_WORDS: Record<LatinLang, Set<string>> = {
  en: words("the and is are of to that this we you it was with for what where how do does can i my why which on should click button your at has then will open choose sure hello not be have from or if here there about today very"),
  it: words("il lo gli che cosa dove come perché perche questo questa sono è non per di del della posso devo qui qual quale pulsante clicco una con nel alla anche puoi più poi ecco fai faccio clic apri scegli sul sulla ciao grazie certo ed ha ho hai alle oggi molto parliamo siamo buongiorno attimo arrivo"),
  ro: words("și este sunt suntem de care pe nu cu acest această aceasta asta pentru poți vrei din să apoi unde iar sau ce cum dacă în apasă alege deschide bună buna ziua mulțumesc multumesc sigur meniul fișier ești esti pot trebuie eu el meu mea aici butonul apăs fac despre foarte astăzi astazi azi vom avem am că tuturor vorbim salut spus ieri cineva întrebări intrebari rog bine pare foame dreptate vedem când cât câte îmi"),
};

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

/** Evidence for English, Italian and Romanian in a Latin-script text: marker words and the letters only one of them has. */
export function latinScores(text: string): Record<LatinLang, number> {
  const lower = text.normalize("NFC").toLowerCase();
  const score = { en: 0, it: 0, ro: 0 };
  score.ro += 3 * count(lower, RO_LETTERS);
  score.it += 2 * count(lower, IT_LETTERS);
  for (const w of lower.match(/[\p{L}']+/gu) ?? []) for (const l of LATIN_LANGS) if (LATIN_WORDS[l].has(w)) score[l] += 2;
  return score;
}

/** The Latin-script languages with the highest score: one when the text tells, several on a tie, all three when it says nothing. */
export function latinWinners(text: string): LatinLang[] {
  const score = latinScores(text);
  const best = Math.max(score.en, score.it, score.ro);
  return LATIN_LANGS.filter((l) => score[l] === best);
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
