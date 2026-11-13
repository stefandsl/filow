// The "OK Filow" button in the main window's sidebar: one click and the question box is ready, or the
// page says why not. Desktop app only: OK Filow is the desktop app's own assistant (apps/desktop/okfilow.js).
import { okFilowSettingsBridge, type OkFilowSettingsBridge } from "@/lib/buddy/bridge";

/** Where OK Filow's switch lives: the OK Filow section of Advanced settings, which says why it was opened. */
export const OKFILOW_SETUP_ROUTE = "/settings/local?okfilow=off#okfilow";

/** The button is drawn only where it can work: the desktop app, with a build that has the entry. */
export function canAskOkFilow(bridge: Pick<OkFilowSettingsBridge, "openAsk"> | null = okFilowSettingsBridge()): boolean {
  return typeof bridge?.openAsk === "function";
}

/**
 * "panel": the panel is open with its question box focused. "setup": OK Filow is switched off, so its
 * switch in Settings was opened instead (`go` gets the address). "unavailable": OK Filow is not
 * running in this desktop app (or the app did not answer); the caller says so in words.
 */
export async function openOkFilow(
  at: { x: number; y: number } | undefined,
  bridge: Pick<OkFilowSettingsBridge, "openAsk"> | null = okFilowSettingsBridge(),
  go: (url: string) => void = (url) => { window.location.assign(url); },
): Promise<"panel" | "setup" | "unavailable"> {
  if (!bridge?.openAsk) return "unavailable";
  let went: unknown;
  try {
    went = await bridge.openAsk(at);
  } catch {
    return "unavailable";
  }
  if (went === "open") return "panel";
  if (went === "off") {
    go(OKFILOW_SETUP_ROUTE);
    return "setup";
  }
  return "unavailable";
}

/** The point next to the button the panel opens beside: its right edge, level with its top (page pixels). */
export function anchorOf(el: Element | null): { x: number; y: number } | undefined {
  if (!el) return undefined;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.right), y: Math.round(r.top) };
}
