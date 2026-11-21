// Raw provider JSON never reaches the user (owner, 14/11/2026: the bubble showed ElevenLabs' 401 body).
import fs from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { t as coreText } from "@filow/core";
import { createProblemReporter, plainError, problemText, providerProblem, practiceFailure } from "./providerError";
import { okfText } from "./text";

const BODY = 'ElevenLabs 401: {"detail":{"type":"authentication_error","code":"unauthorized","message":"Invalid API key","status":"invalid_api_key","request_id":"33feb5b51230706e5d1c07cd838c0c69"}}';

describe("N-02 practice question recovery", () => {
  it.each([
    ...["Anthropic", "OpenAI", "Google", "FreeLLMAPI", "Cloudflare"].flatMap(provider => [
      [`No ${provider} key`, "setup"], [`${provider} 401`, "setup"], [`${provider} 402`, "quota"],
      [`${provider} 429`, "quota"], [`${provider} 503`, "outage"],
    ]),
    ["[freellm:no_key] missing", "setup"], ["[freellm:quota] limit", "quota"], ["[freellm:not_running] offline", "outage"],
    ["No OpenRouter key: add OPENROUTER_API_KEY", "setup"],
    ["OpenRouter 402: synthetic refusal", "quota"],
    ["OpenRouter 429: synthetic refusal", "quota"],
    ["OpenRouter 503: synthetic service details", "outage"],
    ["OpenRouter unavailable", "outage"],
  ])("offers a private recovery for %s", (error, reason) => {
    expect(practiceFailure(error)).toEqual({ kind: reason, provider: error.startsWith("[freellm:") ? "FreeLLMAPI" : error.replace(/^No /, "").split(" ")[0] });
    expect(practiceFailure("unrelated audio error")).toBeNull();
  });
});

describe("a provider's refusal in plain words", () => {
  it("knows a key that is not valid, a used-up quota and a payment needed, for voice and answer providers", () => {
    expect(providerProblem(BODY)).toEqual({ provider: "ElevenLabs", kind: "key" });
    expect(providerProblem('OpenRouter 401: {"error":{"message":"No auth credentials found","code":401}}')).toEqual({ provider: "OpenRouter", kind: "key" });
    expect(providerProblem("OpenRouter 402: {\"error\":{\"message\":\"Insufficient credits\"}}")).toEqual({ provider: "OpenRouter", kind: "payment" });
    expect(providerProblem('ElevenLabs 401: {"detail":{"status":"quota_exceeded","message":"This request exceeds your quota"}}')).toEqual({ provider: "ElevenLabs", kind: "quota" });
    expect(providerProblem("OpenAI 429: You exceeded your current quota")).toEqual({ provider: "OpenAI", kind: "quota" });
    expect(providerProblem("OpenRouter 403: forbidden")).toEqual({ provider: "OpenRouter", kind: "key" });
    // something else: not a key problem
    expect(providerProblem("OpenRouter 500: upstream error")).toBeNull();
    expect(providerProblem("Ollama is not running")).toBeNull();
  });

  it("the 401 body becomes the plain sentence, with no JSON, in the five languages", () => {
    for (const lang of ["en", "it", "ru", "ro", "ja"] as const) {
      const text = problemText(providerProblem(BODY)!, okfText(lang), coreText("menu.editEnv", lang));
      expect(text, lang).toContain("ElevenLabs");
      expect(text, lang).toContain(coreText("menu.editEnv", lang));
      expect(text, lang).not.toMatch(/[{}]|invalid_api_key|request_id|401/);
      expect(text, lang).not.toContain(String.fromCharCode(0x2014));
    }
    expect(problemText(providerProblem(BODY)!, okfText("en"), coreText("menu.editEnv", "en"))).toBe('The ElevenLabs key is not valid. Replace it with "Edit API keys (.env)" in the Filow menu.');
  });

  it("any other error loses its JSON", () => {
    expect(plainError('OpenRouter 500: {"error":{"message":"upstream"}}')).toBe("OpenRouter 500");
    expect(plainError("Ollama 404: [1,2]")).toBe("Ollama 404");
    expect(plainError("No answer.")).toBe("No answer.");
  });

  it("shown once per session however many sentences meet it; every error's details go to the log", () => {
    const show = vi.fn();
    const log = vi.fn();
    const report = createProblemReporter({ log, show, text: (p) => `${p.provider} ${p.kind}` });
    for (let i = 0; i < 4; i++) expect(report(BODY)).toEqual({ provider: "ElevenLabs", kind: "key" });
    expect(report("OpenRouter 500: x")).toBeNull();
    expect(show).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith("ElevenLabs key", { provider: "ElevenLabs", kind: "key" });
    expect(log).toHaveBeenCalledTimes(5);
  });

  it("the panel shows it with the button to the keys file; the desktop opens that file and masks keys in the log", () => {
    const page = fs.readFileSync(new URL("../../app/okfilow/panel/page.tsx", import.meta.url), "utf8");
    expect(page).toContain('data-testid="okf-problem-fix" onClick={() => void bridge.openKeys?.()}');
    expect(page).toContain("onCloudError: (error) => reportProblem.current(error) !== null,");
    expect(page).toContain("refused ? problemText(refused, t, coreText(\"menu.editEnv\", lang)) : plainError(");
    const main = fs.readFileSync(new URL("../../../desktop/okfilow.js", import.meta.url), "utf8");
    expect(main).toContain('ipcMain.handle("okfilow:openKeys", guard(async () => (await shell.openPath(path.join(userData, ".env"))) === ""));');
    const { redactSecrets } = createRequire(import.meta.url)("../../../desktop/okfilow.js");
    expect(redactSecrets('xi-api-key: sk_abcdef123456 Authorization: Bearer abcdefghijklmnop "api_key":"zzzzzzzzzz"')).not.toMatch(/sk_abcdef123456|abcdefghijklmnop|zzzzzzzzzz/);
    expect(redactSecrets(BODY)).toBe(BODY);
  });
});
