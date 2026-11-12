// Calling up the whiteboard from the main window (the "Whiteboard" button in the sidebar).
// Desktop app: its own window, through window.filow.okFilow.showWhiteboard (apps/desktop/preload.js).
// Plain browser: the whiteboard page in a new tab.
import { okFilowSettingsBridge, type OkFilowSettingsBridge } from "@/lib/buddy/bridge";

export const WHITEBOARD_ROUTE = "/okfilow/whiteboard";

/**
 * Where the whiteboard went: the desktop app's own window, a new tab, or nowhere ("unavailable").
 * "unavailable" is the desktop app with OK Filow not running: the whiteboard is one of OK Filow's
 * windows and gets its access to the engine from it, and a tab opened from the desktop app lands in
 * the system browser, where every lesson would be refused. The caller says so in words instead.
 */
export async function openWhiteboard(
  bridge: Pick<OkFilowSettingsBridge, "showWhiteboard"> | null = okFilowSettingsBridge(),
  openTab: (url: string) => void = (url) => { window.open(url, "_blank", "noopener"); },
): Promise<"window" | "tab" | "unavailable"> {
  if (bridge?.showWhiteboard) {
    try {
      return await bridge.showWhiteboard() === true ? "window" : "unavailable";
    } catch {
      return "unavailable";
    }
  }
  // no await before this line: the tab opens inside the click, so the browser does not block it
  openTab(WHITEBOARD_ROUTE);
  return "tab";
}
