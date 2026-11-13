// A question typed on a paired phone for OK Filow ({ type: "askOkFilow", text }), end to end:
// 1. Phone (components/MirrorAsk.tsx): the box shows only on a controller the presenter allowed to ask.
// 2. Session server (apps/server/src/server.ts): relays it only from such a device, checked (shape,
//    300 code points, no control or format characters), with the device it came from (`from`).
// 3. The window holding the session (components/useSession.ts, sessionCommand below): checks the device
//    against its own devices list, then hands { text, device, id, peer } to the desktop app.
// 4. Desktop (apps/desktop/okfilow-phone.js): the question waits in an inbox. Nothing of it shows by
//    itself: the presenter sees a count (the panel's badge, the tray), none during a slide show.
// 5. Panel (app/okfilow/panel/page.tsx, phonePrompt below): when the presenter opens the badge, a notice
//    labelled with the device, how it is connected and its pairing's short code asks them, every time (a
//    standing yes counts for nothing here). Only after that yes is the question asked: words only (no
//    screenshot is even taken), never read aloud, never an agent or a whiteboard command, never a
//    drawing, a 3D model, cards or pictures, wrapped as a quote from someone else, without the
//    presenter's conversation; the turn is kept in the history marked as the phone's and left out of
//    what later questions send.
import { cleanPhoneQuestion, cleanDeviceName, phoneQuestionForModel, PHONE_ASK, REMOTE, type Command, type CommandFrom, type CommandResult, type I18nKey } from "@filow/core";
import type { BuddyTurn } from "./prompt";

/** What the desktop app says about a phone's question it was handed. */
export type PhoneAskAnswer = "asked" | "off" | "busy" | "bad" | "blocked" | "unavailable";

/** The short code of a pairing: shown in the devices list and with that device's questions (apps/desktop/okfilow-phone.js makes the same one). */
export const pairingFingerprint = (id: string): string => id.slice(0, 4);

/** The question as the phone's box sends it: cleaned and cut to 300 code points; null when nothing is left. */
export function phoneQuestion(raw: unknown): string | null {
  return cleanPhoneQuestion(raw);
}

/** The pairings that may ask OK Filow now, from the devices list: controllers the presenter gave the right, never the app's own windows. */
export function phoneAskers(devices: ReadonlyArray<{ id: string; role: string; peer?: string; canAsk: boolean }>): string[] {
  return devices.filter((d) => d.role === "controller" && d.canAsk && d.peer !== "app").map((d) => d.id);
}

export type SessionCommandDeps = {
  dispatch(cmd: Command): CommandResult;
  /** The devices list says this pairing may ask OK Filow (the presenter's choice on the PC). */
  mayAsk(pairingId: string): boolean;
  /** The desktop app's channel (preload askFromPhone); absent in a browser or an older app. */
  askFromPhone?: (payload: { text: string; device: string; id: string; peer: string }) => Promise<unknown>;
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
    // The pairing's id and how it is connected, as the session server named them: the inbox keeps one
    // question per device, and the notice shows the presenter which device and from where.
    said = await deps.askFromPhone({ text, device: cleanDeviceName(from.device) || "phone", id: from.id, peer: from.peer === "lan" ? "lan" : "remote" });
  } catch {
    return { ok: false, error: PHONE_ASK.unavailable };
  }
  switch (said) {
    case "asked": return { ok: true };
    case "busy": return { ok: false, error: PHONE_ASK.busy };
    case "off": return { ok: false, error: PHONE_ASK.disabled };
    case "bad": return { ok: false, error: PHONE_ASK.bad };
    // Ignored too often: its right to ask is being switched off (the presenter can give it again).
    case "blocked": return { ok: false, error: PHONE_ASK.notAllowed };
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

/** A phone's question as the panel shows it: `key` names it in the desktop app's inbox, `fp` is its pairing's short code. */
export type PhonePrompt = { key: string; question: string; device: string; peer: "lan" | "remote"; fp: string };

/** The panel's side: what the desktop app's inbox handed it when the presenter opened the badge, or null when it is not a phone question. */
export function phonePrompt(payload: unknown): PhonePrompt | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { key?: unknown; text?: unknown; device?: unknown; peer?: unknown; fp?: unknown };
  const question = cleanPhoneQuestion(p.text, true);
  if (!question || typeof p.key !== "string" || !p.key) return null;
  const fp = typeof p.fp === "string" && /^[A-Za-z0-9_-]{1,8}$/.test(p.fp) ? p.fp : "";
  return { key: p.key.slice(0, 32), question, device: cleanDeviceName(p.device) || "phone", peer: p.peer === "lan" ? "lan" : "remote", fp };
}

/** The count on the panel's badge: a whole number from 0 to 99, whatever the shell sent. */
export function phoneCount(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.min(99, Math.floor(raw))) : 0;
}

/**
 * Who a question is from, as the notice says it: the name the device gave when it paired (it cannot
 * change it after), how it is connected, and its pairing's short code (the devices list shows the same).
 */
export function phoneLabel(p: Pick<PhonePrompt, "device" | "peer" | "fp">, text: { lan: string; remote: string }): string {
  return `${p.device} (${[p.peer === "lan" ? text.lan : text.remote, p.fp].filter(Boolean).join(", ")})`;
}

/**
 * Whether the panel may show a phone's question now: only when OK Filow is idle and no other notice (a
 * recipient's, another phone's) is open, so two notices with the same buttons never stack.
 */
export function phoneNoticeFree(state: { mode: string; noticeOpen: boolean; phoneNoticeOpen: boolean }): boolean {
  return state.mode === "idle" && !state.noticeOpen && !state.phoneNoticeOpen;
}

/** Where a question comes from: the presenter (voice, keys, the type box) or a paired phone. */
export type AskSource = "presenter" | "phone";

/**
 * How the panel's ask() treats a question, by where it comes from. A phone's question is never voiced
 * (whatever "Read typed answers aloud" says), never an agent job or a whiteboard, takes no screenshot,
 * sends none of the presenter's conversation, offers no Resume, shows no 3D model, drawing, cards or
 * pictures (`visuals`: a model window's part click would ask as the presenter), and needs the
 * presenter's fresh yes for this one question (`freshYes`): a standing yes for the recipient counts for nothing.
 */
export function askPlan(source: AskSource, opts: { typed?: boolean; typedVoice?: boolean } = {}) {
  if (source === "phone") return { voiced: false, agents: false, whiteboard: false, capture: false, history: false, resumable: false, visuals: false, freshYes: true } as const;
  return { voiced: !opts.typed || opts.typedVoice === true, agents: true, whiteboard: true, capture: true, history: true, resumable: true, visuals: true, freshYes: false } as const;
}

/** A parsed answer with its words only: what a phone's question may show (askPlan `visuals`). */
export function wordsOnly<T extends { points: unknown[]; marks: unknown[]; cards: unknown[]; model: unknown; drawing: unknown }>(parsed: T): T {
  return { ...parsed, points: [], marks: [], cards: [], model: null, drawing: null };
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

/** The phone's side: a refused command (not a question) in words, or null when the error is not one of the relay's own. */
export function remoteErrorKey(error: string | undefined): I18nKey | null {
  if (error === REMOTE.approveFirst) return "mirror.remote.approveFirst";
  if (error === REMOTE.tooMany) return "mirror.remote.tooMany";
  return null;
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
    case REMOTE.tooMany: return { key: "mirror.remote.tooMany" };
    default: return { key: "mirror.ask.failed", error: r.error ?? "" };
  }
}
