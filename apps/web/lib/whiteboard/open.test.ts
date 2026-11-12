import { describe, expect, it, vi } from "vitest";
import { WHITEBOARD_ROUTE, openWhiteboard } from "./open";

// The "Whiteboard" button of the main window: one click always opens the whiteboard, never a dead button.
describe("calling up the whiteboard from the main window", () => {
  it("opens the desktop app's own window, and no tab, when the app says it did", async () => {
    const showWhiteboard = vi.fn(async () => true);
    const openTab = vi.fn();
    expect(await openWhiteboard({ showWhiteboard }, openTab)).toBe("window");
    expect(showWhiteboard).toHaveBeenCalledTimes(1);
    expect(openTab).not.toHaveBeenCalled();
  });

  it("opens the whiteboard page in a tab in a plain browser (no desktop bridge)", async () => {
    const openTab = vi.fn();
    expect(await openWhiteboard(null, openTab)).toBe("tab");
    expect(openTab).toHaveBeenCalledTimes(1);
    expect(openTab).toHaveBeenCalledWith("/okfilow/whiteboard");
    expect(WHITEBOARD_ROUTE).toBe("/okfilow/whiteboard");
  });

  it("opens the tab in a desktop build older than the button (bridge without showWhiteboard)", async () => {
    const openTab = vi.fn();
    expect(await openWhiteboard({}, openTab)).toBe("tab");
    expect(openTab).toHaveBeenCalledWith(WHITEBOARD_ROUTE);
  });

  it("still opens the tab when OK Filow is not running (the app answers false) or the app refuses", async () => {
    const openTab = vi.fn();
    expect(await openWhiteboard({ showWhiteboard: async () => false }, openTab)).toBe("tab");
    expect(await openWhiteboard({ showWhiteboard: async () => { throw new Error("Denied"); } }, openTab)).toBe("tab");
    // an answer that is not a plain yes is not a window either
    expect(await openWhiteboard({ showWhiteboard: (async () => undefined) as unknown as () => Promise<boolean> }, openTab)).toBe("tab");
    expect(openTab).toHaveBeenCalledTimes(3);
  });
});
