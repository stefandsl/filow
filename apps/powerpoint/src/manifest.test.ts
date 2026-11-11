import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { LANGS } from "@filow/core";

// What PowerPoint itself shows of the add-in (description, ribbon button, first-run card) in the
// five interface languages: the manifest carries one override per language.
const require = createRequire(import.meta.url);
const { buildManifest, LOCALES, TEXT } = require("../scripts/manifest.js") as {
  buildManifest(origin: string, opts?: { dev?: boolean; id?: string }): string;
  LOCALES: string[];
  TEXT: Record<string, Record<string, string>>;
};

describe("the PowerPoint manifest", () => {
  const xml = buildManifest("https://localhost:3000", { dev: true, id: "c81ed31a-5e9e-4361-92fe-3d97098875a5" });

  it("has an override for every interface language but the default, on every sentence", () => {
    expect(LOCALES.map((l) => l.slice(0, 2)).sort()).toEqual(LANGS.filter((l) => l !== "en").sort());
    for (const [key, text] of Object.entries(TEXT)) {
      expect(Object.keys(text).sort(), key).toEqual(["en", ...LOCALES].sort());
      for (const locale of LOCALES) {
        expect(text[locale].trim(), `${key} ${locale}`).toBeTruthy();
        expect(text[locale], `${key} ${locale}`).not.toBe(text.en);
        expect(xml).toContain(`Locale="${locale}" Value="${text[locale]}"`);
      }
    }
    expect(xml.match(/<Override Locale=/g)).toHaveLength(LOCALES.length);
    expect(xml.match(/<bt:Override Locale=/g)).toHaveLength(3 * LOCALES.length);
  });

  it("keeps Office's limits: 125 characters for a label, 250 for a description", () => {
    for (const text of Object.values(TEXT.open)) expect(text.length).toBeLessThanOrEqual(125);
    for (const key of ["description", "getStarted", "tooltip"]) for (const text of Object.values(TEXT[key])) expect(text.length).toBeLessThanOrEqual(250);
  });

  it("is well formed: every localized element closes, and the tracked manifest.xml is what the script writes", () => {
    expect(xml.match(/<Description DefaultValue=/g)).toHaveLength(1);
    expect(xml.match(/<\/Description>/g)).toHaveLength(1);
    expect(xml.match(/<\/bt:String>/g)).toHaveLength(3);
    const tracked = readFileSync(new URL("../manifest.xml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    expect(tracked).toBe(xml.replace(/\r\n/g, "\n"));
  });
});