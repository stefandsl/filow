import { describe, expect, it, vi } from "vitest";
import { WHITEBOARD_ROUTE, openWhiteboard } from "./open";

// The "Whiteboard" button of the main window: one click opens the whiteboard, or says why it cannot. Never a dead button.
describe("calling up the whiteboard from the main window", () => {
  it("opens the desktop app's own window, and no tab, when the app says it did", async () => {
    const showWhiteboard = vi.fn(async () => true);
    const openTab = vi.fn();
    expect(await openWhiteboard({ showWhiteboard }, openTab)).toBe("window");
    expect(showWhiteboard).toHaveBeenCalledTimes(1);
    expect(openTab).not.toHaveBeenCalled();
  });

  it("opens the whiteboard page in a tab in a plain browser (no desktop bridge), inside the click", async () => {
    const openTab = vi.fn();
    const going = openWhiteboard(null, openTab);
    // before anything is awaited: a tab opened later would be blocked as a pop-up
    expect(openTab).toHaveBeenCalledTimes(1);
    expect(openTab).toHaveBeenCalledWith("/okfilow/whiteboard");
    expect(await going).toBe("tab");
    expect(WHITEBOARD_ROUTE).toBe("/okfilow/whiteboard");
  });

  it("opens the tab when the bridge has no whiteboard entry", async () => {
    const openTab = vi.fn();
    expect(await openWhiteboard({}, openTab)).toBe("tab");
    expect(openTab).toHaveBeenCalledWith(WHITEBOARD_ROUTE);
  });

  it("in the desktop app with OK Filow not running, opens nothing and reports it (a tab there could not work)", async () => {
    const openTab = vi.fn();
    expect(await openWhiteboard({ showWhiteboard: async () => false }, openTab)).toBe("unavailable");
    expect(await openWhiteboard({ showWhiteboard: async () => { throw new Error("Denied"); } }, openTab)).toBe("unavailable");
    // an answer that is not a plain yes is not a window either
    expect(await openWhiteboard({ showWhiteboard: (async () => undefined) as unknown as () => Promise<boolean> }, openTab)).toBe("unavailable");
    expect(openTab).not.toHaveBeenCalled();
  });
});
