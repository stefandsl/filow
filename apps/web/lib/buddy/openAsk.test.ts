import { describe, expect, it, vi } from "vitest";
import { OKFILOW_SETUP_ROUTE, anchorOf, canAskOkFilow, openOkFilow } from "./openAsk";

// The "OK Filow" button of the main window: one click and the question box is ready, or Settings opens
// at OK Filow's switch, or the page says OK Filow is not running. Never a dead button.
describe("asking OK Filow from the main window", () => {
  it("opens the panel next to the button when the desktop app says it did, and goes nowhere else", async () => {
    const openAsk = vi.fn(async () => "open" as const);
    const go = vi.fn();
    expect(await openOkFilow({ x: 260, y: 700 }, { openAsk }, go)).toBe("panel");
    expect(openAsk).toHaveBeenCalledWith({ x: 260, y: 700 });
    expect(go).not.toHaveBeenCalled();
  });

  it("switched off: opens OK Filow's switch in Settings, which says why", async () => {
    const go = vi.fn();
    expect(await openOkFilow(undefined, { openAsk: async () => "off" }, go)).toBe("setup");
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith("/settings/local?okfilow=off#okfilow");
    expect(OKFILOW_SETUP_ROUTE).toBe("/settings/local?okfilow=off#okfilow");
  });

  it("not running, refused or an answer it does not know: opens nothing and reports it", async () => {
    const go = vi.fn();
    expect(await openOkFilow(undefined, { openAsk: async () => "unavailable" }, go)).toBe("unavailable");
    expect(await openOkFilow(undefined, { openAsk: async () => { throw new Error("Denied"); } }, go)).toBe("unavailable");
    expect(await openOkFilow(undefined, { openAsk: (async () => true) as unknown as () => Promise<"open"> }, go)).toBe("unavailable");
    expect(await openOkFilow(undefined, {}, go)).toBe("unavailable");
    expect(await openOkFilow(undefined, null, go)).toBe("unavailable");
    expect(go).not.toHaveBeenCalled();
  });

  it("the button is drawn only where it can work: the desktop app with the entry", () => {
    expect(canAskOkFilow({ openAsk: async () => "open" })).toBe(true);
    expect(canAskOkFilow({})).toBe(false);
    expect(canAskOkFilow(null)).toBe(false);
  });

  it("names the button's right edge, level with its top, in whole pixels", () => {
    const el = { getBoundingClientRect: () => ({ right: 243.6, top: 612.2 }) } as unknown as Element;
    expect(anchorOf(el)).toEqual({ x: 244, y: 612 });
    expect(anchorOf(null)).toBeUndefined();
  });
});
