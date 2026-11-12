// "Look at my screen": one switch in the OK Filow panel. Its value lives in one place, the desktop
// settings (okFilow.seeScreen, apps/desktop/okfilow.js): "on" or "off" once the user has chosen,
// "auto" until then, which keeps what the setup for this computer picked (packages/core/src/profile.ts
// screenHelper: pictures on a PC that carries them, the user's words only on a modest one).
import type { AskRoute } from "./outbound";

export type SeeChoice = "auto" | "on" | "off";
/** What the setup for this computer picked for answers on this PC; null until the server has said. */
export type LocalScreenMode = "picture" | "text" | "none" | null;

export const isSeeChoice = (v: unknown): v is SeeChoice => v === "auto" || v === "on" || v === "off";

/** Whether the next question takes the screen with it. */
export function seesScreen(choice: SeeChoice | undefined, route: AskRoute, local: LocalScreenMode): boolean {
  if (choice === "on") return true;
  if (choice === "off") return false;
  // Not chosen yet: online answers always had the screen; on this PC the setup decides.
  return route !== "local" || local !== "text";
}

/**
 * The eye (the button on the pill, its shortcut): it flips what the next question would do, and
 * from then on that is the user's own choice. So a click while the setup decides ("auto") closes
 * the eye for good when it was looking, and opens it when the setup had left it shut.
 */
export const eyeToggle = (choice: SeeChoice | undefined, route: AskRoute, local: LocalScreenMode): "on" | "off" => (seesScreen(choice, route, local) ? "off" : "on");

/**
 * Whether a screenshot taken for a question may still be used (sent with it, or sent again to find
 * the point). `took`: the question took one; `now`: the setting at this moment. Closing the eye in
 * between drops the picture: the question goes with the words only. Opening it changes nothing for
 * a question that was asked without the screen.
 */
export const stillSees = (took: boolean, now: SeeChoice | undefined): boolean => took && now !== "off";

/** What the request carries: the user's own choice, or nothing so the server keeps the setup's pick. */
export const askSees = (choice: SeeChoice | undefined): boolean | undefined => (choice === "on" ? true : choice === "off" ? false : undefined);

/** Looking at the screen is slow on this PC (why the setup left it off): said next to the switch, the user still chooses. */
export const slowToSee = (route: AskRoute, local: LocalScreenMode): boolean => route === "local" && local === "text";

/**
 * A yes given to the notice that said "no picture of your screen is sent" does not cover the screen.
 * `wordsOnly` lists the recipients whose yes was given that way (okFilow.askWordsOnly): with the
 * switch on, such a yes is withdrawn first, so the full notice is shown before a screenshot goes.
 */
export const screenYesMissing = (seeing: boolean, granted: boolean, wordsOnly: readonly string[] | undefined, recipientId: string): boolean =>
  seeing && granted && (wordsOnly ?? []).includes(recipientId);

/** The list after the user said yes to a notice: on it when that notice was the words-only one, off it when it named the screenshot. */
export function wordsOnlyAfterYes(wordsOnly: readonly string[] | undefined, recipientId: string, seeing: boolean): string[] {
  const rest = (wordsOnly ?? []).filter((id) => id !== recipientId);
  return seeing ? rest : [...rest, recipientId].slice(-20);
}

/** With the switch on and answers from online, pictures of the screen leave this PC with each question. */
export const screenLeaves = (sees: boolean, route: AskRoute): boolean => sees && route !== "local";
