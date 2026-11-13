// A question typed on a paired phone for OK Filow ({ type: "askOkFilow", text }), end to end:
// 1. Phone (components/MirrorAsk.tsx): the box shows only on a controller the presenter allowed to ask.
// 2. Session server (apps/server/src/server.ts): relays it only from such a device, checked (shape,
//    300 code points, no control or format characters), with the device it came from (`from`).
// 3. The window holding the session (components/useSession.ts, sessionCommand below): checks the device
//    against its own devices list, then hands { text, device } to the desktop app.
// 4. Desktop (apps/desktop/okfilow-phone.js): "busy" unless OK Filow is idle; never interrupts an answer.
// 5. Panel (app/okfilow/panel/page.tsx, phonePlan below): a notice labelled "from phone <device>" asks
//    the presenter, every time (a standing yes counts for nothing here). Only after that yes is the
//    question asked: words only (no screenshot is even taken), never read aloud, never an agent or a
//    whiteboard command, wrapped as a quote from someone else, without the presenter's conversation; the
//    turn is kept in the history marked as the phone's and left out of what later questions send.
import { cleanPhoneQuestion, cleanDeviceName, phoneQuestionForModel, PHONE_ASK, type Command, type CommandFrom, type CommandResult, type I18nKey } from "@filow/core";
import type { BuddyTurn } from "./prompt";

/** What the desktop app says about a phone's question it was handed. */
export type PhoneAskAnswer = "asked" | "off" | "busy" | "bad" | "unavailable";

/** The question as the phone's box sends it: cleaned and cut to 300 code points; null when nothing is left. */
export function phoneQuestion(raw: unknown): string | null {
  return cleanPhoneQuestion(raw);
}

export type SessionCommandDeps = {
  dispatch(cmd: Command): CommandResult;
  /** The devices list says this pairing may ask OK Filow (the presenter's choice on the PC). */
  mayAsk(pairingId: string): boolean;
  /** The desktop app's channel (preload askFromPhone); absent in a browser or an older app. */
  askFromPhone?: (payload: { text: string; device: string }) => Promise<unknown>;
};

/**
 * A command a paired device sent, as the window holding the session answers it. A question for OK
 * Filow is checked again here (the device, the text) and handed to the desktop app; it never reaches
 * the engine. Everything else is the engine's.
 */
export async function sessionCommand(cmd: Command, from: CommandFrom | undefined, deps: SessionCommandDeps): Promise<CommandResult> {
  if ((cmd as { type?: unknown }).type !== "askOkFilow") return deps.dispatch(cmd);
  if (!from || !from.id || !deps.mayAsk(from.id)) return { ok: false, error: PHONE_ASK.notAllowed };
  const text = cleanPhoneQuestion((cmd as { text?: unknown }).text, true);
  if (!text) return { ok: false, error: PHONE_ASK.bad };
  if (!deps.askFromPhone) return { ok: false, error: PHONE_ASK.unavailable };
  let said: unknown;
  try {
    said = await deps.askFromPhone({ text, device: cleanDeviceName(from.device) || "phone" });
  } catch {
    return { ok: false, error: PHONE_ASK.unavailable };
  }
  switch (said) {
    case "asked": return { ok: true };
    case "busy": return { ok: false, error: PHONE_ASK.busy };
    case "off": return { ok: false, error: PHONE_ASK.disabled };
    case "bad": return { ok: false, error: PHONE_ASK.bad };
    default: return { ok: false, error: PHONE_ASK.unavailable };
  }
}

/**
 * What the panel asks when its own shell hands it a question ("okfilow:askText": the selection's "Ask
 * about this"): plain text only. A phone's question never comes this way (it has its own channel).
 */
export function askTextQuestion(payload: unknown): string | null {
  if (typeof payload !== "string") return null;
  const q = payload.trim();
  return q || null;
}

/** The panel's side: what the desktop app handed it on the phone channel, or null when it is not a phone question. */
export function phonePrompt(payload: unknown): { question: string; device: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { text?: unknown; device?: unknown };
  const question = cleanPhoneQuestion(p.text, true);
  if (!question) return null;
  return { question, device: cleanDeviceName(p.device) || "phone" };
}

/** Where a question comes from: the presenter (voice, keys, the type box) or a paired phone. */
export type AskSource = "presenter" | "phone";

/**
 * How the panel's ask() treats a question, by where it comes from. A phone's question is never voiced
 * (whatever "Read typed answers aloud" says), never an agent job or a whiteboard, takes no screenshot,
 * sends none of the presenter's conversation, offers no Resume, and needs the presenter's fresh yes for
 * this one question (`freshYes`): a standing yes for the recipient counts for nothing.
 */
export function askPlan(source: AskSource, opts: { typed?: boolean; typedVoice?: boolean } = {}) {
  if (source === "phone") return { voiced: false, agents: false, whiteboard: false, capture: false, history: false, resumable: false, freshYes: true } as const;
  return { voiced: !opts.typed || opts.typedVoice === true, agents: true, whiteboard: true, capture: true, history: true, resumable: true, freshYes: false } as const;
}

/** The question as the model receives it: a phone's is a quote from someone else. */
export function questionForModel(source: AskSource, question: string): string {
  return source === "phone" ? phoneQuestionForModel(question) : question;
}

/** The conversation a presenter's question sends: without the phone's turns. */
export function presenterHistory(history: BuddyTurn[]): BuddyTurn[] {
  return history.filter((t) => t.source !== "phone").map(({ role, text }) => ({ role, text }));
}

/** The presenter's last answer (what "agent, ..." is given as context): never a phone's. */
export function lastPresenterAnswer(history: BuddyTurn[]): string {
  return presenterHistory(history).at(-1)?.text ?? "";
}

/** The two turns a phone's question adds to the history, marked as the phone's. */
export function phoneTurns(question: string, device: string, answer: string): BuddyTurn[] {
  return [{ role: "user", text: question, source: "phone", device }, { role: "assistant", text: answer, source: "phone", device }];
}

/** The phone's side: the line it shows after sending. Anything else (a viewer phone, no answer) is a plain failure. */
export function phoneAskLine(r: { ok: boolean; error?: string }): { key: I18nKey; error?: string } {
  if (r.ok) return { key: "mirror.ask.sent" };
  switch (r.error) {
    case PHONE_ASK.disabled: return { key: "mirror.ask.off" };
    case PHONE_ASK.busy: return { key: "mirror.ask.busy" };
    case PHONE_ASK.unavailable: return { key: "mirror.ask.unavailable" };
    case PHONE_ASK.notAllowed: return { key: "mirror.ask.notAllowed" };
    case PHONE_ASK.bad: return { key: "mirror.ask.bad" };
    default: return { key: "mirror.ask.failed", error: r.error ?? "" };
  }
}
