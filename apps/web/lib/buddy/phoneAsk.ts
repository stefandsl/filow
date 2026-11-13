// A question typed on a paired phone (the mirror's "Ask OK Filow" box) on its way to OK Filow.
// Phone: sends { type: "askOkFilow", text } over the session it paired into; the session server lets
// only a phone it accepted as a controller send commands (apps/server/src/server.ts). Computer: the
// main window, which holds the session, hands the question to OK Filow's panel (useSession.ts), which
// asks it like any other question: the same consent notice, the same provider, the same signal when
// something leaves the PC. The answer stays on the computer.
import { PHONE_QUESTION_MAX, type CommandResult, type I18nKey } from "@filow/core";
import { okFilowSettingsBridge, type OkFilowSettingsBridge } from "@/lib/buddy/bridge";

/** What the desktop app said about a phone's question. */
export type PhoneAskAnswer = "asked" | "off" | "busy" | "empty" | "unavailable";
/** The errors a phone can get back, one per reason, so it can say which in words. */
export const PHONE_ASK_ERRORS = ["okfilow:off", "okfilow:busy", "okfilow:unavailable", "okfilow:empty"] as const;
export type PhoneAskError = (typeof PHONE_ASK_ERRORS)[number];

/** The question as it is handed on: text only, one line, at most PHONE_QUESTION_MAX characters; null when nothing is left. */
export function phoneQuestion(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.replace(/\s+/g, " ").trim().slice(0, PHONE_QUESTION_MAX).trim();
  return q || null;
}

/** The computer's side: a phone's question to OK Filow, answered with the ack the phone receives. */
export async function answerPhoneAsk(
  raw: unknown,
  bridge: Pick<OkFilowSettingsBridge, "askFromPhone"> | null = okFilowSettingsBridge(),
): Promise<CommandResult> {
  const question = phoneQuestion(raw);
  if (!question) return { ok: false, error: "okfilow:empty" };
  if (!bridge?.askFromPhone) return { ok: false, error: "okfilow:unavailable" };
  let said: unknown;
  try {
    said = await bridge.askFromPhone(question);
  } catch {
    return { ok: false, error: "okfilow:unavailable" };
  }
  if (said === "asked") return { ok: true };
  if (said === "off" || said === "busy" || said === "empty") return { ok: false, error: `okfilow:${said}` };
  return { ok: false, error: "okfilow:unavailable" };
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
