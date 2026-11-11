import { describe, expect, it } from "vitest";
import { t as translate, type I18nKey } from "@filow/core";
import { localUnavailableText, readTranslateWhere, saveTranslateWhere, TRANSLATE_MODEL_TO_GET, whereHint, type TranslateState } from "./translateWhere";
import { LOCAL_TRANSLATE_MODELS } from "./translateLocal";
import { LOCAL_MODELS } from "./localModels";

const t = (key: I18nKey, vars?: Record<string, string | number>) => translate(key, "en", vars);
const ready: TranslateState = { local: { ok: true, model: "gemma4:e2b" }, cloud: "openrouter", offline: false };
const down: TranslateState = { ...ready, local: { ok: false, reason: "ollama_down" } };
const empty: TranslateState = { ...ready, local: { ok: false, reason: "no_model" } };
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe("where the editor's Translate runs", () => {
  it("is this PC until the user picks the cloud, and the pick is remembered", () => {
    const store = memory();
    expect(readTranslateWhere(store)).toBe("local");
    expect(readTranslateWhere(null)).toBe("local");
    saveTranslateWhere(store, "cloud");
    expect(readTranslateWhere(store)).toBe("cloud");
    saveTranslateWhere(store, "local");
    expect(readTranslateWhere(store)).toBe("local");
    // a storage that throws (private mode) is not an error and means this PC
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(readTranslateWhere(broken)).toBe("local");
    expect(() => saveTranslateWhere(broken, "cloud")).not.toThrow();
  });
  it("says before the press where the text will be worked on", () => {
    expect(whereHint("local", ready, "OpenRouter and Google", t)).toEqual({ text: "The translation runs on this PC with gemma4:e2b. Nothing leaves this computer.", blocked: false });
    expect(whereHint("cloud", ready, "OpenRouter and Google", t)).toEqual({ text: "The translation runs in the cloud: the script goes to OpenRouter and Google. You are asked before anything is sent.", blocked: false });
    expect(whereHint("local", null, "", t).blocked).toBe(false);
  });
  it("local not possible: the reason is said and the choice stays local (the editor offers the ways on)", () => {
    const stopped = whereHint("local", down, "OpenRouter", t);
    expect(stopped.blocked).toBe(true);
    expect(stopped.text).toContain("Ollama");
    expect(stopped.text).toContain("Nothing was sent");
    const none = whereHint("local", empty, "OpenRouter", t);
    expect(none.blocked).toBe(true);
    expect(none.text).toContain(`${TRANSLATE_MODEL_TO_GET.name} (${TRANSLATE_MODEL_TO_GET.downloadGb} GB`);
    // offline with the cloud chosen: said, and not turned into a local translation
    expect(whereHint("cloud", { ...ready, offline: true }, "OpenRouter", t)).toEqual({ text: "Offline mode is on, so nothing can go to the cloud. Choose “On this PC”.", blocked: true });
  });
  it("every reason the local path can give has its own sentence", () => {
    const texts = ["ollama_down", "no_model", "too_slow", "failed"].map((r) => localUnavailableText(r, t, "boom"));
    expect(new Set(texts).size).toBe(4);
    expect(texts[3]).toContain("boom");
  });
  it("the model the editor tells the user to get is one translation uses, at the size Local models shows", () => {
    expect(LOCAL_TRANSLATE_MODELS).toContain(TRANSLATE_MODEL_TO_GET.name);
    expect(LOCAL_MODELS.find((m) => m.name === TRANSLATE_MODEL_TO_GET.name)?.downloadGb).toBe(TRANSLATE_MODEL_TO_GET.downloadGb);
  });
});
