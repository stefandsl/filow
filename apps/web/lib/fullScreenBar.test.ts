// The full-screen bar's rules (fullScreenBar.ts): when it shows, and when Escape leaves full screen.
import { describe, expect, it } from "vitest";
import { barShown, ESCAPE_OWNERS, escapeLeavesFullScreen, HIDE_DELAY_MS } from "./fullScreenBar";

describe("when the bar shows", () => {
  it("only in full screen, while the pointer is on the top edge or the bar, or a button has the focus", () => {
    expect(barShown({ fullScreen: true, pointer: false, focus: false })).toBe(false);
    expect(barShown({ fullScreen: true, pointer: true, focus: false })).toBe(true);
    expect(barShown({ fullScreen: true, pointer: false, focus: true })).toBe(true);
    expect(barShown({ fullScreen: true, pointer: true, focus: true })).toBe(true);
    // never outside full screen, whatever the pointer and the focus do
    expect(barShown({ fullScreen: false, pointer: true, focus: true })).toBe(false);
  });
  it("stays a short moment after the pointer leaves, not seconds", () => {
    expect(HIDE_DELAY_MS).toBeGreaterThan(0);
    expect(HIDE_DELAY_MS).toBeLessThanOrEqual(600);
  });
});

/** A stand-in document: `open` lists the selectors that match an element on screen, `hidden` those that match one hidden. */
const doc = (open: string[] = [], hidden: string[] = []) => ({
  querySelectorAll: (s: string) => [
    ...(open.some((o) => s.split(", ").includes(o)) ? [{ checkVisibility: () => true }] : []),
    ...(hidden.some((o) => s.split(", ").includes(o)) ? [{ checkVisibility: () => false }] : []),
  ],
});
const plain = { closest: () => null, isContentEditable: false };
const field = { closest: (s: string) => (s.includes("input") ? {} : null), isContentEditable: false };
const key = (over: Partial<Parameters<typeof escapeLeavesFullScreen>[0]> = {}) => ({ key: "Escape", defaultPrevented: false, target: plain, ...over });

describe("Escape", () => {
  it("leaves full screen when nothing else wants it", () => {
    expect(escapeLeavesFullScreen(key(), true, doc())).toBe(true);
  });
  it("does nothing outside full screen, and other keys do nothing", () => {
    expect(escapeLeavesFullScreen(key(), false, doc())).toBe(false);
    expect(escapeLeavesFullScreen(key({ key: "Enter" }), true, doc())).toBe(false);
    expect(escapeLeavesFullScreen(key({ key: "F11" }), true, doc())).toBe(false);
  });
  it("is left to whoever already took it, to a field being typed in, and to an input method composing", () => {
    expect(escapeLeavesFullScreen(key({ defaultPrevented: true }), true, doc())).toBe(false);
    expect(escapeLeavesFullScreen(key({ target: field }), true, doc())).toBe(false);
    expect(escapeLeavesFullScreen(key({ target: { closest: () => null, isContentEditable: true } }), true, doc())).toBe(false);
    expect(escapeLeavesFullScreen(key({ isComposing: true }), true, doc())).toBe(false);
  });
  it("with a modifier is not plain Escape", () => {
    for (const m of ["altKey", "ctrlKey", "metaKey", "shiftKey"] as const) expect(escapeLeavesFullScreen(key({ [m]: true }), true, doc())).toBe(false);
  });
  it("closes an open dialog or menu first", () => {
    for (const owner of ESCAPE_OWNERS.split(", ")) expect(escapeLeavesFullScreen(key(), true, doc([owner])), owner).toBe(false);
  });
  it("is not held back by a closed menu that stays in the page, hidden (the prompter's overflow menu)", () => {
    expect(escapeLeavesFullScreen(key(), true, doc([], ["[role='menu']"]))).toBe(true);
    expect(escapeLeavesFullScreen(key(), true, doc(["[role='menu']"], ["[role='menu']"]))).toBe(false);
  });
  it("is not held back by an open disclosure (aria-expanded alone)", () => {
    expect(ESCAPE_OWNERS).not.toMatch(/(^|, )\[aria-expanded='true'\]/);
    expect(ESCAPE_OWNERS).toContain("[aria-haspopup][aria-expanded='true']");
  });
});
