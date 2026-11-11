import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectDominantLanguage, detectLanguage, latinScores, SPOKEN_LANGS, spokenLang } from "./spoken";
import { detectSpeechLanguage, SPEECH_LANGUAGES } from "./rehearsal";

describe("spoken languages", () => {
  it("is one list: the desktop shell's CommonJS copies say the same five, in the same order", () => {
    // stt.js, tts.js and dictation-core.js cannot import TypeScript (they run unbundled in the
    // shell and their tests load them directly), so each keeps a literal that must equal this list.
    const literal = (file: string, name: string) => {
      const source = readFileSync(new URL(`../../../apps/desktop/${file}`, import.meta.url), "utf8");
      const m = new RegExp(`^const ${name} = (\\[[^\\]]+\\]);`, "m").exec(source);
      return m ? JSON.parse(m[1]) : null;
    };
    expect(literal("stt.js", "LANGUAGES")).toEqual([...SPOKEN_LANGS]);
    expect(literal("tts.js", "LANGS")).toEqual([...SPOKEN_LANGS]);
    expect(literal("dictation-core.js", "LANGS")).toEqual([...SPOKEN_LANGS]);
    expect(SPEECH_LANGUAGES).toEqual([...SPOKEN_LANGS]);
  });

  it("reads a locale tag and refuses anything else", () => {
    expect(spokenLang("ja-JP")).toBe("ja");
    expect(spokenLang("auto")).toBeNull();
    expect(spokenLang(undefined)).toBeNull();
  });

  it("tells a short question by script first, then by words", () => {
    expect(detectLanguage("Где кнопка Export в Adobe Premiere Pro?")).toBe("ru");
    expect(detectLanguage("このボタンは何ですか")).toBe("ja");
    expect(detectLanguage("Unde este butonul?")).toBe("ro");
    expect(detectLanguage("Dove clicco per salvare?")).toBe("it");
    expect(detectLanguage("Where is the button?")).toBe("en");
    expect(detectLanguage("42")).toBeNull();
  });

  // Review of the rehearsal report, L3: short Romanian text without diacritics was read as English,
  // so its fillers were never counted and the pace was judged on the English range.
  it("knows short Romanian speech, with or without diacritics", () => {
    expect(detectSpeechLanguage("Buna ziua tuturor, vorbim despre securitate")).toBe("ro");
    expect(detectSpeechLanguage("Bună ziua tuturor, vorbim despre securitate")).toBe("ro");
    expect(detectSpeechLanguage("Astazi vorbim despre proiect")).toBe("ro");
    expect(latinScores("Buna ziua tuturor").ro).toBeGreaterThan(0);
    // Found by the review of this pass: everyday short sentences, with the letters only Romanian has.
    for (const s of ["Când începem?", "Cât e ceasul?", "Îmi place", "Câte slide-uri am?", "El are dreptate", "Are cineva intrebari?", "I-am spus ieri", "Mi-e foame", "Mi se pare bine", "Te rog sa repeti", "O sa mai vedem"]) {
      expect(detectLanguage(s), s).toBe("ro");
      expect(detectSpeechLanguage(s), s).toBe("ro");
    }
    // â and î are Romanian letters on their own, in words no list knows.
    expect(latinScores("gândind").ro).toBeGreaterThan(0);
    expect(detectLanguage("Un gând")).toBe("ro");
    expect(detectLanguage("Gânduri, în sfârșit")).toBe("ro");
    for (const s of ["Come faccio a esportare?", "Come si salva?", "Un attimo e arrivo"]) expect(detectSpeechLanguage(s), s).toBe("it");
    for (const s of ["Come here and look at this", "I am here", "Are you there?"]) expect(detectSpeechLanguage(s), s).toBe("en");
  });

  it("falls back only among the languages the text could be", () => {
    expect(detectDominantLanguage("OK", "it")).toBe("it");
    expect(detectDominantLanguage("OK", "ru")).toBe("en"); // Latin letters are never read as Russian
    expect(detectDominantLanguage("123", "ru")).toBe("ru"); // no letters at all: the fallback
    expect(detectDominantLanguage("OK")).toBeNull();
    expect(detectSpeechLanguage("Hello everyone, today we talk about security")).toBe("en");
    expect(detectSpeechLanguage("Buongiorno a tutti, oggi parliamo di sicurezza")).toBe("it");
  });
});
