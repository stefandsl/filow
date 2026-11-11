import { describe, expect, it } from "vitest";
import { LANGS, PLACEHOLDER } from "@filow/core";
import { OKF_TEXT } from "./text";
import { DICTATION_TEXT } from "../dictation/text";

// The parity check of the core dictionary (packages/core/src/i18n/i18n.test.ts), for the two tables
// that live with the web app: every language has every key, no empty text, the same {placeholders},
// and none of the characters the project keeps out of its interface.
const placeholders = (s: string) => [...s.matchAll(PLACEHOLDER)].map((m) => m[1]).sort().join(",");

describe.each([["OK Filow", OKF_TEXT as Record<string, Record<string, string>>], ["Dictation", DICTATION_TEXT as Record<string, Record<string, string>>]])("%s texts", (_name, tables) => {
  it("exist in the five interface languages", () => expect(Object.keys(tables).sort()).toEqual([...LANGS].sort()));
  it.each(LANGS.filter((l) => l !== "en"))("%s has every key, no empty text and the same placeholders", (lang) => {
    const en = tables.en, tr = tables[lang];
    expect(Object.keys(en).filter((k) => !(k in tr)), "missing").toEqual([]);
    expect(Object.keys(tr).filter((k) => !(k in en)), "extra").toEqual([]);
    expect(Object.keys(tr).filter((k) => !tr[k]?.trim()), "empty").toEqual([]);
    expect(Object.keys(en).filter((k) => placeholders(en[k]) !== placeholders(tr[k] ?? "")), "placeholders differ").toEqual([]);
    expect(Object.keys(tr).filter((k) => /[—←→]/.test(tr[k])), "em dash or arrow").toEqual([]);
  });
  it("writes Romanian with comma-below letters and Japanese with its own punctuation", () => {
    expect(Object.keys(tables.ro).filter((k) => /[ŞşŢţ]/.test(tables.ro[k]))).toEqual([]);
    expect(Object.keys(tables.ja).filter((k) => /[ぁ-ヿ一-鿿][.,] /.test(tables.ja[k]))).toEqual([]);
  });
});
