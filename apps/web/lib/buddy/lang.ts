// OK Filow answers in the language of the question unless the user set a spoken language. The
// language travels with the answer as `lang` (one of en, it, ru, ro, ja) so the voice can pick a
// matching one. Detection is by script first (kana/kanji, Cyrillic), then by Romanian letters, then
// by the commonest short words, which is enough for a spoken question of a few words.

export const BUDDY_LANGS = ["en", "it", "ru", "ro", "ja"] as const;
export type BuddyLang = (typeof BUDDY_LANGS)[number];

export const BUDDY_LANG_NAMES: Record<BuddyLang, string> = { en: "English", it: "Italian", ru: "Russian", ro: "Romanian", ja: "Japanese" };

/** "ja-JP" is "ja"; anything else that is not one of the five is null. */
export function buddyLang(value: unknown): BuddyLang | null {
  const code = typeof value === "string" ? value.trim().toLowerCase().slice(0, 2) : "";
  return (BUDDY_LANGS as readonly string[]).includes(code) ? (code as BuddyLang) : null;
}

// Short, frequent words that tell the three Latin-script languages apart in a question. Words that
// two of them share ("a", "e", "in", "la", "un") are left out.
const WORDS: Record<"en" | "it" | "ro", string[]> = {
  en: ["the", "what", "where", "how", "is", "are", "do", "does", "can", "this", "that", "i", "you", "my", "to", "of", "and", "it", "why", "which", "with", "on", "for", "should", "click", "button"],
  it: ["il", "lo", "gli", "che", "cosa", "dove", "come", "perché", "perche", "questo", "questa", "sono", "è", "non", "per", "di", "del", "della", "mi", "posso", "devo", "qui", "qual", "quale", "pulsante", "clicco"],
  ro: ["ce", "cum", "unde", "este", "sunt", "și", "nu", "pe", "cu", "de", "din", "acest", "aceasta", "asta", "pot", "trebuie", "eu", "meu", "mea", "aici", "care", "butonul", "apăs", "apas", "fac"],
};

/** The language a question is written in, or null when it cannot tell (empty, numbers, a single shared word). */
export function detectLanguage(text: string): BuddyLang | null {
  const s = text.normalize("NFC");
  if (/[぀-ヿㇰ-ㇿｦ-ﾟ]/.test(s)) return "ja"; // hiragana, katakana
  const han = (s.match(/[一-鿿]/g) ?? []).length;
  const cyrillic = (s.match(/[Ѐ-ӿ]/g) ?? []).length;
  const latin = (s.match(/[a-zà-ɏ]/gi) ?? []).length;
  if (cyrillic > 0 && cyrillic >= latin) return "ru";
  if (han > 0 && han >= latin) return "ja"; // kanji only: Filow knows no other Han-script language
  if (/[ășțşţâî]/i.test(s)) return "ro";
  const words = s.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  const score = { en: 0, it: 0, ro: 0 };
  for (const w of words) for (const l of ["en", "it", "ro"] as const) if (WORDS[l].includes(w)) score[l]++;
  const best = (["en", "it", "ro"] as const).reduce((a, b) => (score[b] > score[a] ? b : a));
  const tie = (["en", "it", "ro"] as const).filter((l) => score[l] === score[best]).length > 1;
  return score[best] > 0 && !tie ? best : null;
}

/**
 * The language of the answer: the spoken language the user set, else the language of the question,
 * else the interface language when it is one of the five, else null ("the language of the question").
 */
export function answerLanguage(question: string, setting?: unknown, uiLang?: unknown): BuddyLang | null {
  return buddyLang(setting) ?? detectLanguage(question) ?? buddyLang(uiLang);
}

/** The `lang` sent with every answer: always one of the five, English when nothing tells. */
export function answerLang(question: string, setting?: unknown, uiLang?: unknown): BuddyLang {
  return answerLanguage(question, setting, uiLang) ?? "en";
}
