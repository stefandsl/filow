// The Ollama line in Settings > Local models (issue #1): a failure reads as one sentence in the
// user's language with a next step, never the desktop shell's English reason inside an Italian page.
import { describe, expect, it } from "vitest";
import { DICTIONARIES, t as translate, type I18nKey, type Lang } from "@filow/core";
import type { LocalAiStatus } from "./sessionUrl";
import { LOCAL_AI_ERROR_CODES, localAiBusy, localAiNeedsReport, localAiText } from "./localAiStatus";

const status = (s: Partial<LocalAiStatus>): LocalAiStatus => ({ state: "idle", pct: 0, error: "", version: "", command: "", code: "", ...s });
const tr = (lang: Lang) => (key: I18nKey, vars?: Record<string, string | number>) => translate(key, lang, vars);
const ENGLISH_REASON = "Ollama stopped right after it was started (exit code 1)";

describe("the Ollama install and start line", () => {
  it("every failure the desktop shell names has its own sentence in English and in Italian", () => {
    for (const code of LOCAL_AI_ERROR_CODES) {
      const key = `settings.ai.err.${code}` as I18nKey;
      for (const lang of ["en", "it"] as const) {
        const text = DICTIONARIES[lang][key];
        expect(text, `${lang} ${key}`).toBeTruthy();
        expect(text, `${lang} ${key}`).toMatch(/[.!]$/);
        expect(text, `${lang} ${key}`).not.toMatch(/\.\.|\{/); // no doubled full stop, nothing left to fill in
      }
      expect(DICTIONARIES.it[key]).not.toBe(DICTIONARIES.en[key]);
    }
  });

  it("an Italian page shows the Italian sentence for the failure, not the English reason from the log", () => {
    const text = localAiText(status({ state: "error", code: "start_exited", error: ENGLISH_REASON }), tr("it"));
    expect(text).toBe(DICTIONARIES.it["settings.ai.err.start_exited"]);
    expect(text).not.toContain("stopped");
    expect(text).toContain("Segnala un problema"); // the next step, by the name of the button beside it
    expect(DICTIONARIES.it["log.report"]).toBe("Segnala un problema");
  });

  it("a failure the page has no sentence for gets the general one, still not the raw reason", () => {
    const text = localAiText(status({ state: "error", code: "something_new", error: ENGLISH_REASON }), tr("it"));
    expect(text).toBe(DICTIONARIES.it["settings.ai.err.unexpected"]);
  });

  it("a failure without a code is already a sentence for the user (the offline notice) and is shown as it is", () => {
    const offline = translate("offline.downloadDisabled", "it");
    expect(localAiText(status({ state: "error", error: offline }), tr("it"))).toBe(offline);
  });

  it("the steps on the way keep their short labels", () => {
    expect(localAiText(status({ state: "idle" }), tr("en"))).toBe("");
    expect(localAiText(status({ state: "starting" }), tr("it"))).toBe("avvio di Ollama…");
    expect(localAiText(status({ state: "downloading", pct: 42 }), tr("en"))).toBe("downloading Ollama 42%");
    expect(localAiText(status({ state: "ready", version: "0.40.16" }), tr("en"))).toBe("Ollama 0.40.16 ready");
  });

  it("Report a problem is offered for what the user cannot fix alone, not for a dropped download", () => {
    expect(localAiNeedsReport(status({ state: "error", code: "start_exited" }))).toBe(true);
    expect(localAiNeedsReport(status({ state: "error", code: "start_timeout" }))).toBe(true);
    expect(localAiNeedsReport(status({ state: "error", code: "something_new" }))).toBe(true);
    expect(localAiNeedsReport(status({ state: "error", code: "download_failed" }))).toBe(false);
    expect(localAiNeedsReport(status({ state: "error", code: "" }))).toBe(false);
    expect(localAiNeedsReport(status({ state: "starting", code: "start_exited" }))).toBe(false);
    expect(localAiNeedsReport(null)).toBe(false);
  });

  it("only a status on its way keeps the install button waiting: a failure frees it for another try", () => {
    for (const state of ["checking", "downloading", "installing", "starting"] as const) expect(localAiBusy(status({ state }))).toBe(true);
    for (const state of ["idle", "ready", "manual", "error"] as const) expect(localAiBusy(status({ state }))).toBe(false);
    expect(localAiBusy(null)).toBe(false);
  });
});
