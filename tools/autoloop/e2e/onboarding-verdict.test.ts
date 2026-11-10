import { describe, expect, it } from "vitest";
import { onboardingFailures, onboardingExitCode } from "./onboarding-verdict.mjs";

const clean = {
  problems: [],
  axe: { welcome: [], "welcome-mic": [] },
  keyboardPass: { order: [{ tag: "input", id: "lang-en", outline: true, visible: true }, { tag: "button", id: "start", outline: true, visible: true }], allFocusVisible: true },
  zoom: { "1.25": { hOverflow: false, vScroll: true, primaryVisible: true }, "setup@1.5": { hOverflow: false, primaryVisible: true } },
};

describe("onboarding probe verdict (review T3 finding 6)", () => {
  it("a clean run passes and exits 0", () => {
    expect(onboardingFailures(clean)).toEqual([]);
    expect(onboardingExitCode(0, onboardingFailures(clean))).toBe(0);
  });
  it("no point ticked fails", () => {
    const f = onboardingFailures({ ...clean, problems: ["no point ticked"] });
    expect(f).toEqual(["no point ticked"]);
    expect(onboardingExitCode(0, f)).toBe(4);
  });
  it("an axe violation fails, and so does an axe run that errored", () => {
    expect(onboardingFailures({ ...clean, axe: { welcome: [{ id: "color-contrast", impact: "serious", nodes: 2 }] } })).toEqual(["axe welcome: color-contrast (serious, 2)"]);
    expect(onboardingFailures({ ...clean, axe: { "welcome-setup": { error: "page closed" } } })).toEqual(["axe welcome-setup could not run: page closed"]);
  });
  it("a Tab stop without visible focus fails, and so does focus that falls to the page", () => {
    const order = [...clean.keyboardPass.order, { tag: "button", id: "back", outline: false, visible: true }];
    expect(onboardingFailures({ ...clean, keyboardPass: { order, allFocusVisible: false } })[0]).toMatch(/keyboard: 1 Tab stop.*back/);
    expect(onboardingFailures({ ...clean, keyboardPass: { order: [null], allFocusVisible: false } })[0]).toMatch(/keyboard: 1 Tab stop.*page/);
    expect(onboardingFailures({ ...clean, keyboardPass: { order: [], allFocusVisible: true } })).toEqual(["keyboard: Tab reached no control"]);
  });
  it("zoom: sideways scrolling or an off-screen primary button fails", () => {
    expect(onboardingFailures({ ...clean, zoom: { "1.5": { hOverflow: true, primaryVisible: true } } })).toEqual(["zoom 1.5: the page scrolls sideways"]);
    expect(onboardingFailures({ ...clean, zoom: { "mic@1.25": { hOverflow: false, primaryVisible: false } } })).toEqual(["zoom mic@1.25: the primary button is off screen"]);
  });
  it("the probe's own failure code wins over the checks", () => {
    expect(onboardingExitCode(2, ["no point ticked"])).toBe(2);
  });
});
