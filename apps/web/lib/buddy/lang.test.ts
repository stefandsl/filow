import { describe, expect, it } from "vitest";
import { answerLang, answerLanguage, buddyLang, detectLanguage } from "./lang";
import { buddySystemPrompt } from "./prompt";

const screens = [{ index: 1, width: 1280, height: 720, cursor: true }];

describe("language of an OK Filow question", () => {
  it.each([
    ["Where do I save this file?", "en"],
    ["What does this button do?", "en"],
    ["Dove salvo questo file?", "it"],
    ["Che cosa fa questo pulsante?", "it"],
    ["Где сохранить этот файл?", "ru"],
    ["Что делает эта кнопка?", "ru"],
    ["Unde salvez acest fișier?", "ro"],
    ["Ce face butonul asta?", "ro"],
    ["Unde salvez fisierul asta?", "ro"], // typed without diacritics
    ["Salvează fișierul", "ro"], // only the letters tell
    ["このファイルはどこに保存しますか？", "ja"],
    ["保存ボタンはどこ", "ja"],
    ["保存場所", "ja"], // kanji only
    ["ﾌｧｲﾙを保存", "ja"], // half-width katakana
  ])("%s is %s", (q, lang) => {
    expect(detectLanguage(q)).toBe(lang);
  });

  it("does not guess from nothing", () => {
    expect(detectLanguage("")).toBeNull();
    expect(detectLanguage("42")).toBeNull();
    expect(detectLanguage("ok")).toBeNull();
  });

  it("goes by the script that carries most of a mixed question", () => {
    expect(detectLanguage("Как открыть PowerPoint?")).toBe("ru");
    expect(detectLanguage("PowerPointはどこ")).toBe("ja");
  });

  it("lets the spoken language the user set win over the question, and the interface language break a tie", () => {
    expect(answerLanguage("Where is it?", "ru")).toBe("ru");
    expect(answerLanguage("Where is it?", "auto")).toBe("en");
    expect(answerLanguage("ok", "auto", "it-IT,it;q=0.9")).toBe("it");
    expect(answerLanguage("ok", "auto", "de-DE")).toBeNull();
    expect(answerLang("ok", "auto", "de-DE")).toBe("en");
  });

  it("only accepts the five languages as a code", () => {
    expect(buddyLang("JA-jp")).toBe("ja");
    expect(buddyLang("de")).toBeNull();
    expect(buddyLang(undefined)).toBeNull();
  });

  it("tells the model to answer in that language, or in the question's when it is unknown", () => {
    expect(buddySystemPrompt(screens, "ro")).toContain("Answer in Romanian.");
    expect(buddySystemPrompt(screens, "ja")).toContain("Answer in Japanese.");
    expect(buddySystemPrompt(screens, "ru")).toContain("Answer in Russian.");
    expect(buddySystemPrompt(screens, "auto")).toContain("Answer in the language the user speaks.");
  });
});
