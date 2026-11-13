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

/** Why a device's command was refused, other than asking (packages/core REMOTE). */
export const REMOTE = {
  /** Auto-accepted on the Wi-Fi: this command waits until the presenter accepts the device on the PC. */
  approveFirst: "remote:approve-first",
  /** Too many commands in a short time. */
  tooMany: "remote:too-many",
} as const;

/**
 * A name the app uses for itself ("Filow window", "OK Filow", "Filow"): a device may not take it, in
 * any spelling (compatibility forms, case, spaces or marks between the letters).
 */
export function isAppLabel(name: string): boolean {
  const letters = name.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return letters.includes("filow");
}

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
