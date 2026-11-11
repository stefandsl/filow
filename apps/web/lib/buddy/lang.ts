// OK Filow answers in the language of the question unless the user set a spoken language. The
// language travels with the answer as `lang` (one of en, it, ru, ro, ja) so the voice can pick a
// matching one. Detection is by script first (kana/kanji, Cyrillic), then by Romanian letters, then
// by the commonest short words, which is enough for a spoken question of a few words.

import { detectLanguage, SPOKEN_LANGS, spokenLang, type SpokenLang } from "@filow/core";

/** The spoken languages and their detector live in packages/core/src/spoken.ts; these are OK Filow's names for them. */
export const BUDDY_LANGS = SPOKEN_LANGS;
export type BuddyLang = SpokenLang;
export { detectLanguage };

export const BUDDY_LANG_NAMES: Record<BuddyLang, string> = { en: "English", it: "Italian", ru: "Russian", ro: "Romanian", ja: "Japanese" };

/** "ja-JP" is "ja"; anything else that is not one of the five is null. */
export const buddyLang = spokenLang;

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
