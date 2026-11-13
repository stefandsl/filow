// The session server's copy of packages/core/src/phone-ask.ts (this package builds without @filow/core at
// run time). phone-ask.test.ts keeps both equal on the same inputs.
export const PHONE_QUESTION_MAX = 300;
export const PHONE_QUESTION_RAW_MAX = 4096;
export const PHONE_ASK = {
  off: "okfilow:phone-off",
  notAllowed: "okfilow:not-allowed",
  bad: "okfilow:bad-question",
  busy: "okfilow:busy",
  disabled: "okfilow:off",
  unavailable: "okfilow:unavailable",
} as const;

export function cleanPhoneQuestion(raw: unknown, strict = false): string | null {
  if (typeof raw !== "string" || raw.length > PHONE_QUESTION_RAW_MAX) return null;
  const text = raw.normalize("NFC").replace(/\s+/gu, " ").replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/ {2,}/g, " ").trim();
  const points = Array.from(text);
  if (!points.length || (strict && points.length > PHONE_QUESTION_MAX)) return null;
  return points.slice(0, PHONE_QUESTION_MAX).join("").trim() || null;
}

export function cleanDeviceName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return Array.from(raw.slice(0, 200).normalize("NFC").replace(/\s+/gu, " ").replace(/[\p{Cc}\p{Cf}]/gu, "").trim()).slice(0, 40).join("").trim();
}

/** A phone's question command, exactly { type: "askOkFilow", text }: the cleaned text, or null when it is anything else. */
export function phoneAskText(cmd: unknown): string | null {
  if (typeof cmd !== "object" || cmd === null || Array.isArray(cmd)) return null;
  const keys = Object.keys(cmd);
  if (keys.length !== 2 || !keys.includes("type") || !keys.includes("text")) return null;
  return cleanPhoneQuestion((cmd as { text: unknown }).text, true);
}
