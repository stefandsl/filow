import { describe, expect, it } from "vitest";
import { DICTIONARIES, LANGS } from "@filow/core";
import { OKF_TEXT } from "./buddy/text";
import { DICTATION_TEXT } from "./dictation/text";
import { WB_TEXT } from "./whiteboard/text";

// Typography every string table keeps, in every interface language (review of the five-language
// pass, finding 7): one ellipsis character instead of three dots, and in Japanese full-width
// punctuation and brackets next to Japanese text.
const TABLES: Record<string, Record<string, Record<string, string>>> = {
  core: DICTIONARIES as unknown as Record<string, Record<string, string>>,
  okfilow: OKF_TEXT,
  dictation: DICTATION_TEXT,
  whiteboard: WB_TEXT,
};
const JA = "\\u3041-\\u30FF\\u4E00-\\u9FFF";
const HALF_BRACKET = new RegExp(`[${JA}][()]|[()][${JA}]`);
const HALF_STOP = new RegExp(`[${JA}][.,] `);
const offenders = (table: Record<string, string>, bad: (text: string) => boolean) => Object.keys(table).filter((k) => bad(table[k]));

describe("typography of the string tables", () => {
  for (const [name, table] of Object.entries(TABLES)) {
    it(`${name}: no three dots in a row in any language`, () => {
      for (const lang of LANGS) expect(offenders(table[lang], (s) => s.includes("...")), `${name} ${lang}`).toEqual([]);
    });

    it(`${name}: Japanese has no half-width bracket, comma or full stop against Japanese text`, () => {
      expect(offenders(table.ja, (s) => HALF_BRACKET.test(s)), `${name} brackets`).toEqual([]);
      expect(offenders(table.ja, (s) => HALF_STOP.test(s)), `${name} stops`).toEqual([]);
    });

    it(`${name}: Romanian uses comma-below letters, never the cedilla ones`, () => {
      expect(offenders(table.ro, (s) => /[\u015E\u015F\u0162\u0163]/.test(s))).toEqual([]);
    });
  }

  it("the checks bite", () => {
    expect(HALF_BRACKET.test("設定フォルダーを開く(キーと台本)")).toBe(true);
    expect(HALF_BRACKET.test("設定フォルダーを開く（キーと台本）")).toBe(false);
    expect(HALF_BRACKET.test("Filow (beta) を開く")).toBe(false);
    expect(HALF_STOP.test("はい, そうです")).toBe(true);
  });
});

// Review finding 9: Russian said "скачать" in one place and "загрузить" in the next for the same
// download. One word family for a download (скачать, скачивание); "загрузить" stays for loading a
// script or a model into memory, and "перезагрузить" for a reload.
describe("Russian wording", () => {
  it("calls a download скачать or скачивание wherever English says download", () => {
    const mixed: string[] = [];
    for (const [name, table] of Object.entries(TABLES)) {
      for (const [key, en] of Object.entries(table.en)) {
        const ru = table.ru[key].replace(/перезагру[зж]\p{L}*/giu, "");
        if (/download/i.test(en.replace(/ollama\.com\/download/g, "")) && /загру[зж]/i.test(ru)) mixed.push(`${name} ${key}`);
      }
    }
    expect(mixed).toEqual([]);
  });
});
