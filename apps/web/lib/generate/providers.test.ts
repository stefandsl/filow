import { afterEach, describe, expect, it } from "vitest";
import { resolveGenerateProvider } from "./providers";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe("resolveGenerateProvider", () => {
  it("defaults to OpenRouter and honours the request", () => {
    delete process.env.FILOW_OFFLINE;
    delete process.env.GENERATE_PROVIDER;
    delete process.env.DECISION_PROVIDER;
    expect(resolveGenerateProvider()).toBe("openrouter");
    expect(resolveGenerateProvider("ollama")).toBe("ollama");
  });
  it("forces Ollama when the Offline switch is on, whatever was requested", () => {
    process.env.FILOW_OFFLINE = "1";
    expect(resolveGenerateProvider("openrouter")).toBe("ollama");
  });
  it("follows a local decision provider", () => {
    delete process.env.FILOW_OFFLINE;
    delete process.env.GENERATE_PROVIDER;
    process.env.DECISION_PROVIDER = "clef-local";
    expect(resolveGenerateProvider()).toBe("ollama");
  });
});
