import { describe, expect, it } from "vitest";
import { DICTIONARIES, t, type I18nKey } from "./i18n";

it("keeps speaking labels plain and localized", () => {
  expect(t("stage.section", "en", { n: 1, total: 4 })).toBe("Section 1 of 4");
  expect(t("stage.section", "it", { n: 1, total: 4 })).toBe("Sezione 1 di 4");
  expect(t("stage.next", "en", { title: "Part I" })).toBe("Next: Part I");
  expect(t("stage.next", "it", { title: "Parte I" })).toBe("Prossima: Parte I");
  for (const lang of ["en", "it"] as const) {
    for (const value of Object.values(DICTIONARIES[lang])) expect(value).not.toMatch(/[—←→]/);
  }
});
import { normalizeUiPreferences, resolveUiLanguage, shouldShowWelcome, themeFollowing, validUiPatch, parseSystemAccent, rgb, luminance, contrast, mixColor, readableAccent, accentPalette, acceptUiSnapshot, type UiSnapshot } from "./ui-preferences";

describe("UI preference normalization", () => {
  it.each([undefined, null, [], "bad", { lang: "de", theme: false, followSystemAccent: "true", welcomeCompleted: 1 }])("normalizes malformed preferences %j", value => {
    expect(normalizeUiPreferences(value)).toEqual({ lang: "", theme: "system", followSystemAccent: false, welcomeCompleted: false });
  });
  it("preserves explicit values and Automatic through JSON", () => {
    expect(normalizeUiPreferences(JSON.parse(JSON.stringify({ lang: "", theme: "light", runAtStartup: false, welcomeCompleted: true })))).toMatchObject({ lang: "", theme: "light", runAtStartup: false, welcomeCompleted: true });
    expect(normalizeUiPreferences({ lang: "it", theme: "dark", followSystemAccent: true })).toMatchObject({ lang: "it", theme: "dark", followSystemAccent: true });
  });
  it.each([["it-IT", "it"], ["it-CH", "it"], ["IT", "it"], ["de-DE", "en"], ["en-US", "en"]])("resolves %s", (locale, lang) => {
    expect(resolveUiLanguage("", locale)).toBe(lang); expect(resolveUiLanguage("en", locale)).toBe("en");
  });
  it("requires literal durable completion and captures the resolved theme", () => {
    expect(shouldShowWelcome({})).toBe(true); expect(shouldShowWelcome({ welcomeCompleted: false })).toBe(true);
    expect(shouldShowWelcome({ welcomeCompleted: true })).toBe(false);
    expect(themeFollowing(false, "light")).toBe("light"); expect(themeFollowing(false, "dark")).toBe("dark"); expect(themeFollowing(true, "dark")).toBe("system");
  });
  it("rejects unknown keys, wrong types and arrays", () => {
    for (const value of [[], null, { welcomeCompleted: true }, { lang: "de" }, { runAtStartup: 1 }, { theme: "auto" }]) expect(validUiPatch(value)).toBe(false);
    expect(validUiPatch({ lang: "", theme: "system", followSystemAccent: false, runAtStartup: true })).toBe(true);
  });
});
describe("accent contrast", () => {
  it("parses RGBA, rejecting malformed and transparent values", () => {
    expect(parseSystemAccent("12AB347F")).toBe("#12ab34");
    for (const value of ["12ab3400", "#12ab34ff", "12ab34", "12ab34fg", undefined]) expect(parseSystemAccent(value)).toBeNull();
  });
  it("implements WCAG luminance, contrast and compositing", () => {
    expect(rgb("#123456")).toEqual([18, 52, 86]); expect(luminance("#000000")).toBe(0); expect(luminance("#ffffff")).toBe(1);
    expect(contrast("#000000", "#ffffff")).toBe(21); expect(mixColor("#000000", "#ffffff", .5)).toBe("#808080");
    expect(readableAccent("#000000", ["#000000"], true, 4.5)).not.toBe("#000000");
  });
  it.each(["#000000", "#ffffff", "#ffff00", "#0000ff", "#808080", "#ff0000", "#00ff00", "#010101", "#fefefe"])("keeps %s readable on opaque and composited glass", color => {
    for (const theme of ["light", "dark"] as const) {
      const p = accentPalette(color, theme), dark = theme === "dark";
      expect(p["--system-accent"]).toBe(color);
      expect(contrast(color, p["--action-foreground"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p["--action-background"], p["--action-foreground"])).toBeGreaterThanOrEqual(7);
      const surfaces = [dark ? "#08090b" : "#f7f7f5", dark ? "#1b1e26" : "#eef0f4"];
      for (const backdrop of ["#000000", "#ffffff", color]) surfaces.push(mixColor(dark ? "#13151a" : "#ffffff", backdrop, .08));
      surfaces.push(...surfaces.map(surface => mixColor(surface, color, .1)));
      for (const surface of surfaces) {
        expect(contrast(p["--accent"], surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p["--accent-ring"], surface)).toBeGreaterThanOrEqual(3);
      }
    }
  });
  it("off removes all overrides in both themes", () => {
    expect(accentPalette(null, "light")).toEqual({}); expect(accentPalette(null, "dark")).toEqual({}); expect(accentPalette("invalid", "dark")).toEqual({});
  });
});
it("provides EN/IT parity for all Welcome/UI additions", () => {
  const keys = Object.keys(DICTIONARIES.en).filter(k => k.startsWith("welcome.") || k.startsWith("ui.") || k === "menu.welcome") as I18nKey[];
  for (const key of keys) { expect(DICTIONARIES.it[key]).toBeTruthy(); expect(t(key, "en")).not.toBe(key); expect(t(key, "it")).toBe(DICTIONARIES.it[key]); }
});
it("never regresses snapshots", () => {
  const a = { revision: 2 } as UiSnapshot, b = { revision: 1 } as UiSnapshot;
  expect(acceptUiSnapshot(null, a)).toBe(a); expect(acceptUiSnapshot(a, b)).toBe(a); expect(acceptUiSnapshot(a, a)).toBe(a); expect(acceptUiSnapshot(b, a)).toBe(a);
});
