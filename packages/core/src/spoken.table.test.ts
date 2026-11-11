import { describe, expect, it } from "vitest";
import { detectDominantLanguage, detectLanguage } from "./spoken";
import { HELDOUT_CASES, PAIR_CASES, REVIEW_CASES, UNDECIDABLE, type LatinCase } from "./spoken.cases";

// The detector on a labeled table of short sentences. It may say "cannot tell" (null); naming the
// wrong language is the failure that gives a Romanian speaker an English or Italian voice.
function tally(cases: LatinCase[]) {
  const wrong: string[] = [];
  const undecided: string[] = [];
  for (const [text, lang] of cases) {
    const got = detectLanguage(text);
    if (got === null) undecided.push(text);
    else if (got !== lang) wrong.push(`${text} -> ${got}`);
  }
  return { wrong, undecided, right: cases.length - wrong.length - undecided.length, total: cases.length };
}

describe("telling English, Italian and Romanian apart in short sentences", () => {
  it("gets every sentence of the review right", () => {
    const t = tally(REVIEW_CASES);
    expect(t.wrong).toEqual([]);
    expect(t.undecided).toEqual([]);
  });

  for (const [pair, cases] of Object.entries(PAIR_CASES)) {
    it(`${pair}: never the wrong language, at most two of ${cases.length} undecided`, () => {
      expect(cases.length).toBeGreaterThanOrEqual(10);
      const t = tally(cases);
      expect(t.wrong).toEqual([]);
      expect(t.undecided.length, t.undecided.join(" | ")).toBeLessThanOrEqual(2);
    });
  }

  it("holds on sentences written after it was finished", () => {
    const t = tally(HELDOUT_CASES);
    expect(t.wrong).toEqual([]);
    expect(t.right / t.total).toBeGreaterThanOrEqual(0.9);
  });

  it("leaves what two languages share undecided, and the caller's fallback decides", () => {
    for (const text of UNDECIDABLE) expect(detectLanguage(text), text).toBeNull();
    expect(detectDominantLanguage("Pare", "it")).toBe("it");
    expect(detectDominantLanguage("Pare", "ro")).toBe("ro");
    expect(detectDominantLanguage("Are", "ro")).toBe("ro");
    // English is not one of the two "pare" could be: the first of them, never a third language.
    expect(detectDominantLanguage("Pare", "en")).toBe("it");
  });

  it("does not name a language from spelling alone", () => {
    for (const text of ["PowerPoint", "Keynote", "Whisper", "Arrivo"]) expect(detectLanguage(text), text).toBeNull();
  });
});
