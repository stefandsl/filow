// Prover C2: a cleaned answer that flips the meaning by dropping or adding a negation must not be typed.
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const cleanup = require("./dictation-cleanup.js") as {
  acceptCleaned(raw: string, cleaned: string, o?: Record<string, unknown>): { ok: boolean; reason: string; text?: string };
  createCleaner(o: Record<string, unknown>): { clean(raw: string, o?: Record<string, unknown>): Promise<{ used: boolean; text?: string; reason: string }> };
};

describe("S1-mini guard: a negation dropped or added is not the same message", () => {
  it("acceptCleaned refuses answers whose negation differs from what was said", () => {
    expect(cleanup.acceptCleaned("i don't want to send the report today", "I want to send the report today.").ok).toBe(false);
    expect(cleanup.acceptCleaned("please do not delete the file", "Please delete the file.").ok).toBe(false);
    expect(cleanup.acceptCleaned("please delete the file", "Please do not delete the file.").ok).toBe(false);
    expect(cleanup.acceptCleaned("we will never ship it on friday", "We will ship it on Friday.").ok).toBe(false);
  });

  it("createCleaner (production path) does not type the flipped answer; the caller keeps its own cleanup", async () => {
    const cleaner = cleanup.createCleaner({ run: async () => "Please delete the file." });
    const r = await cleaner.clean("please do not delete the file", { language: "en" });
    expect(r.used).toBe(false);
  });

  it("still accepts legitimate cleanups: contractions expanded, self-correction 'no' dropped", () => {
    expect(cleanup.acceptCleaned("i don't want to send the report today", "I do not want to send the report today.").ok).toBe(true);
    expect(cleanup.acceptCleaned("i cant just walk past him", "I cannot just walk past him.").ok).toBe(true);
    expect(cleanup.acceptCleaned("we need five no six chairs", "We need 6 chairs.").ok).toBe(true);
  });
});
