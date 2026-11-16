import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const core = require("./dictation-core.js") as {
  postProcess(t: string, o?: { language?: string; removeFillers?: boolean }): string;
};

describe("a filler sound after a finished sentence", () => {
  const en = { language: "en", removeFillers: true };
  it("keeps the sentence's end once", () => {
    expect(core.postProcess("Hello. Um.", en)).toBe("Hello.");
    expect(core.postProcess("I agree. Um?", en)).toBe("I agree.");
    expect(core.postProcess("Yes! Uh.", en)).toBe("Yes!");
    expect(core.postProcess("Hello. Um.", { language: "auto", removeFillers: true })).toBe("Hello.");
  });
  it("still moves a sentence's end from the sound to the word before it", () => {
    expect(core.postProcess("I think so, um.", en)).toBe("I think so.");
  });
});
