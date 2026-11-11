import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LANGS } from "@filow/core";

// The extension's name card (store listing, toolbar title) in the five interface languages.
const root = new URL("../", import.meta.url);
const read = (file: string) => JSON.parse(readFileSync(new URL(file, root), "utf8"));
const messages = (lang: string): Record<string, { message: string }> => read(`_locales/${lang}/messages.json`);

describe("the browser extension's locales", () => {
  const manifest = read("manifest.json");
  const used = [...JSON.stringify(manifest).matchAll(/__MSG_([A-Za-z0-9_]+)__/g)].map((m) => m[1]);

  it("has one folder per interface language, and the default is English", () => {
    expect(readdirSync(new URL("_locales/", root)).sort()).toEqual([...LANGS].sort());
    expect(manifest.default_locale).toBe("en");
  });

  it("leaves no English sentence in the manifest itself", () => {
    expect(manifest.description).toBe("__MSG_extDescription__");
    expect(manifest.action.default_title).toBe("__MSG_actionTitle__");
    expect(used.length).toBeGreaterThanOrEqual(2);
  });

  it("gives every message the manifest uses, in every language, within the store's 132 characters", () => {
    const keys = Object.keys(messages("en")).sort();
    for (const lang of LANGS) {
      const m = messages(lang);
      expect(Object.keys(m).sort(), lang).toEqual(keys);
      for (const key of used) expect(m[key]?.message.trim(), `${lang} ${key}`).toBeTruthy();
      expect(m.extDescription.message.length, lang).toBeLessThanOrEqual(132);
      if (lang !== "en") for (const key of keys) expect(m[key].message, `${lang} ${key}`).not.toBe(messages("en")[key].message);
    }
  });

  it("packs the locales next to the manifest", () => {
    expect(readFileSync(new URL("scripts/pack.js", root), "utf8")).toContain('path.join(dist, "_locales")');
  });
});