import { describe, expect, it } from "vitest";
import { alignErrors, corpusErrorRate, errorRate, scoreUnit, scoringUnits } from "./wer";

describe("scoringUnits", () => {
  it("drops case, punctuation and apostrophes", () => {
    expect(scoringUnits("Hello, World! Don't stop.", "en")).toEqual(["hello", "world", "dont", "stop"]);
    expect(scoringUnits("L'acqua è calda: 20 gradi.", "it")).toEqual(["lacqua", "è", "calda", "20", "gradi"]);
  });

  it("keeps diacritics unless asked to fold them", () => {
    expect(scoringUnits("și țară", "ro")).toEqual(["și", "țară"]);
    expect(scoringUnits("și țară", "ro", { foldDiacritics: true })).toEqual(["si", "tara"]);
  });

  it("reads the Romanian cedilla letters as the comma-below ones", () => {
    expect(scoringUnits("şi ţară", "ro")).toEqual(scoringUnits("și țară", "ro"));
    // Only for Romanian: Turkish ş is a different letter.
    expect(scoringUnits("şi", "tr")).not.toEqual(scoringUnits("și", "tr"));
  });

  it("reads Russian ё as е and keeps й", () => {
    expect(scoringUnits("Ёлка, ещё!", "ru")).toEqual(["елка", "еще"]);
    expect(scoringUnits("мой", "ru")).toEqual(["мой"]);
  });

  it("scores Japanese by character, without spaces or punctuation, katakana as hiragana, full width as half width", () => {
    expect(scoreUnit("ja")).toBe("char");
    expect(scoringUnits("日本には、約７千の島。", "ja")).toEqual(Array.from("日本には約7千の島"));
    expect(scoringUnits("カタカナ ｶﾀｶﾅ", "ja").join("")).toBe("かたかなかたかな");
    // The long vowel mark and the voiced marks survive.
    expect(scoringUnits("データ", "ja").join("")).toBe("でーた");
    expect(scoringUnits("ガ", "ja")).toEqual(["が"]);
  });
});

describe("alignErrors", () => {
  it("counts substitutions, deletions and insertions apart", () => {
    expect(alignErrors(["a", "b", "c"], ["a", "x", "c"])).toEqual({ substitutions: 1, deletions: 0, insertions: 0 });
    expect(alignErrors(["a", "b", "c"], ["a", "c"])).toEqual({ substitutions: 0, deletions: 1, insertions: 0 });
    expect(alignErrors(["a", "c"], ["a", "b", "c"])).toEqual({ substitutions: 0, deletions: 0, insertions: 1 });
    expect(alignErrors(["a", "b", "c", "d"], ["b", "x", "d", "e"])).toEqual({ substitutions: 1, deletions: 1, insertions: 1 });
    expect(alignErrors([], [])).toEqual({ substitutions: 0, deletions: 0, insertions: 0 });
  });
});

describe("errorRate", () => {
  it("is 0 for the same words written differently", () => {
    expect(errorRate("Hello, world.", "hello world", "en").rate).toBe(0);
    expect(errorRate("日本 の 島。", "日本の島", "ja").rate).toBe(0);
  });

  it("is errors over reference words", () => {
    const e = errorRate("the cat sat on the mat", "the cat sat on a mat today", "en");
    expect(e).toMatchObject({ units: 6, substitutions: 1, insertions: 1, deletions: 0, errors: 2, unit: "word" });
    expect(e.rate).toBeCloseTo(2 / 6, 10);
  });

  it("can exceed 1 when the recognizer invents words, and handles empty texts", () => {
    expect(errorRate("yes", "no no no", "en").rate).toBe(3);
    expect(errorRate("", "", "en").rate).toBe(0);
    expect(errorRate("", "word", "en").rate).toBe(1);
    expect(errorRate("two words", "", "en")).toMatchObject({ deletions: 2, rate: 1 });
  });

  it("is a character rate for Japanese", () => {
    const e = errorRate("日本には島がある", "日本にわ島がある", "ja");
    expect(e).toMatchObject({ units: 8, substitutions: 1, errors: 1, unit: "char" });
    expect(e.rate).toBeCloseTo(1 / 8, 10);
  });

  it("counts a missing diacritic as an error only when diacritics are kept", () => {
    expect(errorRate("și el", "si el", "ro").rate).toBe(0.5);
    expect(errorRate("și el", "si el", "ro", { foldDiacritics: true }).rate).toBe(0);
  });
});

describe("corpusErrorRate", () => {
  it("weighs clips by their length, not equally", () => {
    const total = corpusErrorRate([
      { reference: "one", hypothesis: "two" },
      { reference: "a b c d e f g h i", hypothesis: "a b c d e f g h i" },
    ], "en");
    expect(total).toMatchObject({ units: 10, errors: 1, substitutions: 1 });
    expect(total.rate).toBeCloseTo(0.1, 10);
  });
});
