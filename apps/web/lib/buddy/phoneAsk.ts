// A question typed on a paired phone for OK Filow ({ type: "askOkFilow", text }).
// Switched off until it is secured (per-question yes on the PC, words only, a devices list with
// revoke): the session server refuses it (apps/server/src/server.ts), the window holding the session
// refuses it too (sessionCommand below), the desktop app's handler answers "off" without touching
// OK Filow, and the panel asks only plain text handed by its own shell (askTextQuestion).
import { PHONE_ASK_OFF, PHONE_QUESTION_MAX, type Command, type CommandResult, type I18nKey } from "@filow/core";

/** The errors a phone can get back, one per reason, so it can say which in words. */
export const PHONE_ASK_ERRORS = ["okfilow:off", "okfilow:busy", "okfilow:unavailable", "okfilow:empty"] as const;
export type PhoneAskError = (typeof PHONE_ASK_ERRORS)[number];

/** The question as it is handed on: text only, one line, at most PHONE_QUESTION_MAX characters; null when nothing is left. */
export function phoneQuestion(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.replace(/\s+/g, " ").trim().slice(0, PHONE_QUESTION_MAX).trim();
  return q || null;
}

/**
 * A command a paired device sent over the session, as the window holding the session answers it:
 * a question for OK Filow is refused (PHONE_ASK_OFF) and never reaches OK Filow or the engine;
 * everything else is the engine's.
 */
export function sessionCommand(cmd: Command, dispatch: (cmd: Command) => CommandResult): CommandResult {
  if ((cmd as { type?: unknown }).type === "askOkFilow") return { ok: false, error: PHONE_ASK_OFF };
  return dispatch(cmd);
}

/**
 * What the panel asks when its shell hands it a question ("okfilow:askText", today: the selection's
 * "Ask about this"): plain text only. Anything else, a question tagged as coming from a phone among
 * them, is ignored.
 */
export function askTextQuestion(payload: unknown): string | null {
  if (typeof payload !== "string") return null;
  const q = payload.trim();
  return q || null;
}

/** The phone's side: the line it shows after sending. Anything else (a viewer phone, no answer) is a plain failure. */
export function phoneAskLine(r: { ok: boolean; error?: string }): { key: I18nKey; error?: string } {
  if (r.ok) return { key: "mirror.ask.sent" };
  switch (r.error) {
    case "okfilow:off": return { key: "mirror.ask.off" };
    case "okfilow:busy": return { key: "mirror.ask.busy" };
    case "okfilow:unavailable": return { key: "mirror.ask.unavailable" };
    case "okfilow:empty": return { key: "mirror.ask.empty" };
    default: return { key: "mirror.ask.failed", error: r.error ?? "" };
  }
}
