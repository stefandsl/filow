// A question typed on a paired phone for OK Filow ({ type: "askOkFilow", text }).
// The same cleaning runs in three places, each before anything else touches the text: the session
// server (apps/server/src/phone-ask.ts), the window holding the session (apps/web/lib/buddy/phoneAsk.ts)
// and the desktop app (apps/desktop/okfilow-phone.js). Tests keep the three copies equal.

/** The longest question a phone may send, in code points (after cleaning). */
export const PHONE_QUESTION_MAX = 300;
/** Longer raw text is refused before any work is done on it (UTF-16 units). */
export const PHONE_QUESTION_RAW_MAX = 4096;

/** Every answer a phone's question can get, one per reason, so the phone can say which in words. */
export const PHONE_ASK = {
  /** Kept for the phones of the release that had it switched off. */
  off: "okfilow:phone-off",
  /** The presenter has not allowed this device to ask (a permission given on the PC, off by default). */
  notAllowed: "okfilow:not-allowed",
  /** Not a question: wrong shape, empty, or longer than PHONE_QUESTION_MAX after cleaning. */
  bad: "okfilow:bad-question",
  /** OK Filow is answering, listening or waiting for the presenter: a phone never interrupts it. */
  busy: "okfilow:busy",
  /** OK Filow is switched off on the computer. */
  disabled: "okfilow:off",
  /** No OK Filow on the computer (a browser holds the session, or the app is not running it). */
  unavailable: "okfilow:unavailable",
} as const;
/** Kept as the name the switched-off release used. */
export const PHONE_ASK_OFF = PHONE_ASK.off;

/**
 * The question as it is handed on, or null when it is not one: text only, at most PHONE_QUESTION_RAW_MAX
 * units raw; normalised to NFC; whitespace (line breaks included) made one space; control and format
 * characters (\p{Cc}, \p{Cf}: bidi overrides, zero-width joiners) removed; then at most
 * PHONE_QUESTION_MAX code points. `strict`: longer than that is refused instead of cut (the server).
 */
export function cleanPhoneQuestion(raw: unknown, strict = false): string | null {
  if (typeof raw !== "string" || raw.length > PHONE_QUESTION_RAW_MAX) return null;
  const text = raw.normalize("NFC").replace(/\s+/gu, " ").replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/ {2,}/g, " ").trim();
  const points = Array.from(text);
  if (!points.length || (strict && points.length > PHONE_QUESTION_MAX)) return null;
  return points.slice(0, PHONE_QUESTION_MAX).join("").trim() || null;
}

/** A device name as the PC shows it ("from phone <name>"): cleaned like a question, at most 40 code points. */
export function cleanDeviceName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return Array.from(raw.slice(0, 200).normalize("NFC").replace(/\s+/gu, " ").replace(/[\p{Cc}\p{Cf}]/gu, "").trim()).slice(0, 40).join("").trim();
}

/**
 * The question as the model reads it: a quote from someone else, never an instruction from the
 * presenter. The guillemets inside are taken out so the quote cannot be closed early.
 */
export function phoneQuestionForModel(question: string): string {
  return `A person on a paired phone asks: «${question.replace(/[«»]/g, "\"")}»`;
}
