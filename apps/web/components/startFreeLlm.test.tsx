import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LangProvider } from "@filow/ui";
import { StartModeDialog, cloudProvider, cloudReady } from "./Teleprompter";

// A cloud take is tracked by OpenRouter unless the user switched takes to FreeLLMAPI in Settings.
// The choice is the user's alone, and one never stands in for the other.
const base = { openrouterKey: false, sttKey: true, whisper: false, sherpa: false, clef: false, stt: { elevenlabs: true, openai: false }, setup: null };
const dialog = (r: Parameters<typeof StartModeDialog>[0]["readiness"]) =>
  renderToStaticMarkup(<LangProvider lang="en"><StartModeDialog readiness={r} onPick={() => {}} onCancel={() => {}} /></LangProvider>);

describe("who tracks a cloud take", () => {
  it("is OpenRouter until the user picks FreeLLMAPI, whatever is set up", () => {
    expect(cloudProvider({})).toBe("openrouter");
    expect(cloudProvider({ cloudDecision: "openrouter" })).toBe("openrouter");
    expect(cloudProvider({ cloudDecision: "freellm" })).toBe("freellm");
    // FreeLLMAPI being set up does not make it the tracker
    expect(cloudReady({ ...base, freellmReady: true })).toBe(false);
  });
  it("a take through FreeLLMAPI needs FreeLLMAPI, not an OpenRouter key; and the reverse", () => {
    expect(cloudReady({ ...base, cloudDecision: "freellm", freellmReady: true })).toBe(true);
    expect(cloudReady({ ...base, cloudDecision: "freellm", freellmReady: false, openrouterKey: true })).toBe(false);
    expect(cloudReady({ ...base, cloudDecision: "openrouter", openrouterKey: true, freellmReady: false })).toBe(true);
    expect(cloudReady({ ...base, cloudDecision: "freellm", freellmReady: true, sttKey: false })).toBe(false);
  });
  it("the start dialog says where the words go and what is missing", () => {
    const free = dialog({ ...base, cloudDecision: "freellm", freellmReady: false });
    expect(free).toContain("FreeLLMAPI address and key");
    expect(free).toContain("then to a free provider it chooses");
    expect(free).toContain("Cloud mode through FreeLLMAPI needs its address and key");
    expect(free).not.toContain("OpenRouter key (decisions)");
    const router = dialog({ ...base, cloudDecision: "openrouter", freellmReady: true });
    expect(router).toContain("OpenRouter key (decisions)");
    expect(router).not.toContain("FreeLLMAPI");
  });
});
