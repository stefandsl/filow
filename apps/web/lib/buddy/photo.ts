// A question that plainly asks to be shown a photo of a thing ("show me a picture of a heart", in the
// five languages) is answered with a card that carries the photo, without asking a model: small local
// models rarely write the [CARD] tag (measured: G:/FILOW/tmp/v17-parity/FINDINGS.md), and the card
// needs nothing a model knows. The photo itself comes from Wikipedia through /api/buddy/photo, which
// sends only the subject's name and only after the user's yes for Wikipedia.
//
// It must be plain: a verb that asks to see or find, the word for a photo, and a thing. A photo of the
// user's own (their files, their screen, "me", "yesterday") is not something Wikipedia has: every
// such question keeps the normal answer. When in doubt it is not a photo request.
import type { BuddyLang } from "./lang";

export type PhotoAsk = { subject: string; lang: BuddyLang };

// Word edges that also hold for letters outside ASCII (Romanian, Russian): \b does not.
const START = String.raw`(?<![\p{L}\p{N}])`;
const END = String.raw`(?![\p{L}\p{N}])`;
const SUBJECT = String.raw`([\p{L}\p{N}][\p{L}\p{N}' -]{0,58}?)`;
const TAIL = String.raw`[\s.!?。！？]*$`;

// One photo, not a set of them: "find duplicate photos" and "show me the docker images" are about files.
const EN_NOUN = "(?:picture|photo|photograph|image|pic)";
const IT_NOUN = "(?:foto|fotografia|immagine)";
const RO_NOUN = "(?:poz[ăa]|fotografie|imagine)";
const RU_NOUN = "(?:фото|фотографию|фотку|картинку|изображение)";
const EN_VERB = "(?:(?:can|could|will|would) you\\s+)?(?:(?:show|find|get|give)(?:\\s+me)?|pull up|bring up|search for|look up|(?:i want|i would like|i'd like|let me) to see|let me see)";

/** Each pattern captures the subject. The first one that matches wins. */
const PATTERNS: Array<{ lang: BuddyLang; re: RegExp }> = [
  // "show me a picture of a heart", "can you find a photo of the Eiffel Tower?"
  { lang: "en", re: new RegExp(`^${EN_VERB}\\s+(?:an?\\s+|the\\s+|some\\s+)?(?:real\\s+)?${EN_NOUN}\\s+of\\s+(?:an?\\s+|the\\s+)?${SUBJECT}${TAIL}`, "iu") },
  // "show me a rocket photo", "pull up a heart image"
  { lang: "en", re: new RegExp(`^${EN_VERB}\\s+an?\\s+${SUBJECT}\\s+${EN_NOUN}${TAIL}`, "iu") },
  // "mostrami una foto di un cuore", "fammi vedere la foto del razzo"
  { lang: "it", re: new RegExp(`^(?:(?:mi\\s+)?(?:mostrami|mostra|fammi vedere|trovami|trova|cercami|cerca|puoi mostrarmi|mi fai vedere|voglio vedere)\\s+)(?:un'|una?|la|l')?\\s*${IT_NOUN}\\s+(?:dell'|(?:della|dello|delle|degli|dei|del|di)\\s+)(?:un'|una?\\s+|uno\\s+)?${SUBJECT}${TAIL}`, "iu") },
  // "arată-mi o poză cu o inimă", "găsește o fotografie a unei rachete"
  { lang: "ro", re: new RegExp(`^(?:(?:arat[ăa]-?mi|arat[ăa]|g[ăa]se[sș]te-?mi|g[ăa]se[sș]te|caut[ăa]|vreau s[ăa] v[ăa]d)\\s+)(?:o|un)?\\s*${RO_NOUN}\\s+(?:cu|a|al|de|unei|unui)\\s+(?:o\\s+|un\\s+|unei\\s+|unui\\s+)?${SUBJECT}${TAIL}`, "iu") },
  // "покажи фото сердца", "найди мне картинку ракеты"
  { lang: "ru", re: new RegExp(`^(?:(?:покажи|найди|хочу увидеть)(?:\\s+мне)?\\s+)${RU_NOUN}\\s+${SUBJECT}${TAIL}`, "iu") },
  // "ハートの写真を見せて", "ロケットの画像を表示してください"
  { lang: "ja", re: /^([\p{L}\p{N}ー・ ]{1,40}?)の(?:写真|画像|フォト)を?(?:見せて|みせて|表示して)(?:ください|下さい)?[\s。！？!?]*$/u },
];

/** Where the user wants it shown or where it is to come from: not part of the thing. */
const WHERE = /[,\s]+(?:on (?:my|the) (?:screen|desktop)|from (?:the )?(?:web|internet|wikipedia)|online|sullo schermo|sul (?:mio )?schermo|dal web|da internet|pe ecran|de pe (?:web|internet)|на экране|из интернета|画面に)\s*(?=[.!?。！？\s]*$)/iu;
/** Polite words, wherever they stand. */
const POLITE = /[,\s]*(?<![\p{L}\p{N}])(?:please|per favore|per piacere|te rog|пожалуйста)(?![\p{L}\p{N}]),?/giu;

/** The user means something on the screen or their own things, or asks how to do it: the normal answer takes it. */
const NOT_A_THING = new RegExp(
  [
    `${START}(?:this|that|these|those|here|my|mine|your|our|it|screen|desktop|file|files|folder|window|page|document|download|downloads|error|message|yesterday|today|how|what|which|where|why|quest[oaie]|quell[oaie]|qui|mi[oaie]|schermo|sfondo|cartella|errore|ieri|oggi|come|cosa|dove|acest|aceast[ăa]|aici|meu|mea|ecran|fundal|dosar|eroare|azi|cum|unde|эт(?:о|от|у|а|ого|ой)|здесь|мо(?:й|я|ё|ю|его|ей)|меня|экран(?:а|е)?|папк(?:а|и|е|у)|файл(?:а|ы|ов)?|ошибк(?:а|и|у)|вчера|сегодня|как|где|не)${END}`,
    "この|これ|ここ|私|画面|昨日|今日|旅行|フォルダ|ファイル|どう|どこ",
  ].join("|"),
  "iu",
);

/** A person in the conversation or everything at once is not a thing to look up ("find a picture of me"). */
const NOT_A_SUBJECT = /^(?:me|us|you|him|her|them|myself|yourself|all|everything|everyone|te|noi|voi|lui|lei|loro|tutto|tine|el|ea|ei|tot|меня|тебя|нас|вас|его|её|их|всё|все)$/iu;

/**
 * Whether the user plainly asks to be shown a photo of a thing, and of what. Only the user's own
 * words count: the first line (the panel adds the selected text and what was circled on the lines
 * after it). Null for everything else, and when in doubt.
 */
export function wantsPhoto(question: string): PhotoAsk | null {
  const q = question.normalize("NFKC").split("\n")[0].replace(POLITE, " ").replace(WHERE, "").replace(/\s+/g, " ").trim();
  if (!q || q.length > 120 || NOT_A_THING.test(q)) return null;
  for (const { lang, re } of PATTERNS) {
    const subject = re.exec(q)?.[1]?.trim();
    if (subject && subject.length >= 2 && !NOT_A_SUBJECT.test(subject)) return { subject, lang };
  }
  return null;
}

/**
 * The photo request that the card alone answers: no model and no provider see the question. The ask
 * route and the panel both decide with this, so the panel never shows the cloud's notice for a
 * question that stays on this PC. A request to draw is a drawing, and a continuation after Stop
 * carries on with the answer it was given, so neither is a photo request.
 */
export function photoOnly(question: string, o: { drawing?: boolean; resume?: boolean } = {}): PhotoAsk | null {
  return o.drawing || o.resume ? null : wantsPhoto(question);
}

/** "it/cuore": the subject with the Wikipedia it is looked up in, as the card carries it. English has no prefix. */
export const photoLookup = (ask: PhotoAsk): string => (ask.lang === "en" ? ask.subject : `${ask.lang}/${ask.subject}`);

/** Splits a card's photo subject into the Wikipedia to ask (English unless prefixed) and the name. */
export function parsePhotoLookup(q: string): { wiki: "en" | "it" | "ru" | "ro" | "ja"; name: string } {
  const m = /^(it|ru|ro|ja)\/\s*(.+)$/i.exec(q.trim());
  return m ? { wiki: m[1].toLowerCase() as "it" | "ru" | "ro" | "ja", name: m[2].trim() } : { wiki: "en", name: q.trim() };
}

/** The whole answer to a photo request: one spoken sentence and the card. `said` has {subject} in it. */
export function photoAnswer(ask: PhotoAsk, said: string): string {
  const clean = ask.subject.replace(/[[\]|:]/g, " ").replace(/\s+/g, " ").trim();
  return `${said.replace("{subject}", clean)} [CARD:500,400:${clean}||${photoLookup({ ...ask, subject: clean })}]`;
}
