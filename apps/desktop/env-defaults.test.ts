import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { OPENROUTER_DECISION_MODEL } from "../web/lib/decide/openrouter";
import { VISION_MODEL } from "../web/lib/vision/openrouter";
import { GENERATE_VISION_MODEL } from "../web/lib/generate/providers";

const require = createRequire(import.meta.url);
const { RETIRED_DEFAULTS, retiredDefault } = require("./env-defaults.js");

it("an old seeded default is read as unset, a model the user chose is kept", () => {
  expect(retiredDefault("OPENROUTER_DECISION_MODEL", "google/gemini-2.5-flash-lite")).toBe(true);
  expect(retiredDefault("OPENROUTER_VISION_MODEL", "google/gemini-2.5-flash")).toBe(true);
  expect(retiredDefault("OPENROUTER_GENERATE_VISION_MODEL", "google/gemini-2.5-flash")).toBe(true);
  // a choice of the user's, another key, or the old value under a key it was never seeded for
  expect(retiredDefault("OPENROUTER_DECISION_MODEL", "openai/gpt-4o-mini")).toBe(false);
  expect(retiredDefault("OPENROUTER_GENERATE_MODEL", "google/gemini-2.5-flash-lite")).toBe(false);
  expect(retiredDefault("BUDDY_CLOUD_MODEL", "google/gemini-2.5-flash")).toBe(false);
  expect(retiredDefault("toString", undefined)).toBe(false);
});

it("every retired default differs from the default that replaces it", () => {
  const now: Record<string, () => string> = { OPENROUTER_DECISION_MODEL, OPENROUTER_VISION_MODEL: VISION_MODEL, OPENROUTER_GENERATE_VISION_MODEL: GENERATE_VISION_MODEL };
  for (const [key, old] of Object.entries(RETIRED_DEFAULTS as Record<string, string>)) {
    expect(now[key], key).toBeTypeOf("function");
    expect(now[key](), key).not.toBe(old);
  }
});
