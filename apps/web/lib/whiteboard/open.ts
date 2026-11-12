// Calling up the whiteboard from the main window (the "Whiteboard" button in the sidebar).
// Desktop app: its own window, through window.filow.okFilow.showWhiteboard (apps/desktop/preload.js).
// Plain browser, or a desktop app where OK Filow is not running: the whiteboard page in a new tab.
import { okFilowSettingsBridge, type OkFilowSettingsBridge } from "@/lib/buddy/bridge";

export const WHITEBOARD_ROUTE = "/okfilow/whiteboard";

/** Where the whiteboard went: the desktop app's own window, or a new tab. One click always opens it. */
export async function openWhiteboard(
  bridge: Pick<OkFilowSettingsBridge, "showWhiteboard"> | null = okFilowSettingsBridge(),
  openTab: (url: string) => void = (url) => { window.open(url, "_blank", "noopener"); },
): Promise<"window" | "tab"> {
  if (bridge?.showWhiteboard) {
    try {
      if (await bridge.showWhiteboard() === true) return "window";
    } catch { /* the app refused or is closing: the tab still opens */ }
  }
  openTab(WHITEBOARD_ROUTE);
  return "tab";
}
