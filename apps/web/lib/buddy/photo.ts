// A question that plainly asks for a photo of a thing ("show me a picture of a heart", in the five
// languages) is answered with a card that carries the photo, without asking a model: small local
// models rarely write the [CARD] tag (measured: G:/FILOW/tmp/v17-parity/FINDINGS.md), and the card
// needs nothing a model knows. The photo itself comes from Wikipedia through /api/buddy/photo, which
// sends only the subject's name and only after the user's yes for Wikipedia.
import { answerLang, type BuddyLang } from "./lang";

export type PhotoAsk = { subject: string; lang: BuddyLang };

// Word edges that also hold for letters outside ASCII (Romanian, Russian): \b does not.
const START = String.raw`(?<![\p{L}\p{N}])`;
const END = String.raw`(?![\p{L}\p{N}])`;
const SUBJECT = String.raw`([\p{L}\p{N}][\p{L}\p{N}' -]{0,58}?)`;
const TAIL = String.raw`(?:\s+(?:please|per favore|te rog|пожалуйста))?[\s.!?。！？]*$`;

const EN_NOUN = "(?:pictures?|photos?|photographs?|images?|pics?)";
const IT_NOUN = "(?:foto|fotografi[ae]|immagin[ei])";
const RO_NOUN = "(?:poz[ăae]|fotografi[ei]|imagine|imagini)";
const RU_NOUN = "(?:фото|фотографи[юяи]|фотку|картинк[уаи]|изображени[ея])";

/** Each pattern captures the subject. The first one that matches wins. */
const PATTERNS: Array<{ lang: BuddyLang; re: RegExp }> = [
  // "show me a picture of a heart", "find a photo of the Eiffel Tower", "a picture of a rocket"
  { lang: "en", re: new RegExp(`^(?:(?:can|could) you\\s+)?(?:(?:please\\s+)?(?:show|find|get|give|pull up|bring up|search for)(?:\\s+me)?\\s+)?(?:an?|the|some)?\\s*(?:real\\s+)?${EN_NOUN}\\s+of\\s+(?:an?\\s+|the\\s+)?${SUBJECT}${TAIL}`, "iu") },
  // "show me a rocket photo"
  { lang: "en", re: new RegExp(`^(?:(?:can|could) you\\s+)?(?:please\\s+)?(?:show|find|get|give|pull up|bring up)(?:\\s+me)?\\s+(?:an?\\s+|the\\s+|some\\s+)?${SUBJECT}\\s+${EN_NOUN}${TAIL}`, "iu") },
  // "mostrami una foto di un cuore", "fammi vedere la foto del razzo", "una foto di un gatto"
  { lang: "it", re: new RegExp(`^(?:(?:mi\\s+)?(?:mostrami|mostra|fammi vedere|trovami|trova|cercami|cerca|puoi mostrarmi|mi fai vedere)\\s+)?(?:un'|una?|la|le|l'|delle)?\\s*${IT_NOUN}\\s+(?:dell'|(?:della|dello|delle|degli|dei|del|di)\\s+)(?:un'|una?\\s+|uno\\s+)?${SUBJECT}${TAIL}`, "iu") },
  // "arată-mi o poză cu o inimă", "găsește o fotografie a unei rachete"
  { lang: "ro", re: new RegExp(`^(?:(?:arat[ăa]-?mi|arat[ăa]|g[ăa]se[sș]te-?mi|g[ăa]se[sș]te|caut[ăa]|vreau)\\s+)?(?:o|un|ni[sș]te)?\\s*${RO_NOUN}\\s+(?:cu|a|al|de|unei|unui)\\s+(?:o\\s+|un\\s+|unei\\s+|unui\\s+)?${SUBJECT}${TAIL}`, "iu") },
  // "покажи фото сердца", "найди мне картинку ракеты"
  { lang: "ru", re: new RegExp(`^(?:(?:покажи|найди|дай|хочу)(?:\\s+мне)?\\s+)?${RU_NOUN}\\s+${SUBJECT}${TAIL}`, "iu") },
  // "ハートの写真を見せて", "ロケットの画像"
  { lang: "ja", re: /^([\p{L}\p{N}ー・ ]{1,40}?)の(?:写真|画像|フォト)(?:を)?(?:見せて|みせて|表示して|探して|出して)?(?:ください|下さい)?[\s。！？!?]*$/u },
];

/** The user means something on the screen or their own things, or asks how to do it: the normal answer takes it. */
const NOT_A_THING = new RegExp(
  [
    `${START}(?:this|that|these|those|here|my|your|our|it|screen|how|what|which|where|why|quest[oaie]|quell[oaie]|qui|mi[oaie]|schermo|come|cosa|dove|acest|aceast[ăa]|aici|meu|mea|ecran|cum|unde|эт(?:о|от|у|а|ого|ой)|здесь|мо(?:й|я|ё|ю|его|ей)|экран|как|где)${END}`,
    "この|これ|ここ|私の|画面|どう|どこ",
  ].join("|"),
  "iu",
);

/**
 * Whether the user plainly asks to see a photo of a thing, and of what. Only the user's own words
 * count: the first line (the panel adds the selected text and what was circled on the lines after
 * it). Null for everything else, and when in doubt.
 */
export function wantsPhoto(question: string): PhotoAsk | null {
  const q = question.normalize("NFKC").split("\n")[0].trim();
  if (!q || q.length > 120 || NOT_A_THING.test(q)) return null;
  for (const { lang, re } of PATTERNS) {
    const m = re.exec(q);
    const subject = m?.[1]?.trim().replace(/\s+/g, " ");
    if (!subject || subject.length < 2) continue;
    // The pattern says which language the words are in; the answer language may still be set by the user.
    return { subject, lang: lang === "en" ? (answerLang(q) === "en" ? "en" : lang) : lang };
  }
  return null;
}

/** "it/cuore": the subject with the Wikipedia it is looked up in, as the card carries it. English has no prefix. */
export const photoLookup = (ask: PhotoAsk): string => (ask.lang === "en" ? ask.subject : `${ask.lang}/${ask.subject}`);

const WIKIS: Record<BuddyLang, string> = { en: "en", it: "it", ru: "ru", ro: "ro", ja: "ja" };
/** Splits a card's photo subject into the Wikipedia to ask (English unless prefixed) and the name. */
export function parsePhotoLookup(q: string): { wiki: string; name: string } {
  const m = /^(it|ru|ro|ja)\/\s*(.+)$/i.exec(q.trim());
  return m ? { wiki: WIKIS[m[1].toLowerCase() as BuddyLang], name: m[2].trim() } : { wiki: "en", name: q.trim() };
}

/** The whole answer to a photo request: one spoken sentence and the card. `said` has {subject} in it. */
export function photoAnswer(ask: PhotoAsk, said: string): string {
  const clean = ask.subject.replace(/[[\]|:]/g, " ").replace(/\s+/g, " ").trim();
  return `${said.replace("{subject}", clean)} [CARD:500,400:${clean}||${photoLookup({ ...ask, subject: clean })}]`;
}
