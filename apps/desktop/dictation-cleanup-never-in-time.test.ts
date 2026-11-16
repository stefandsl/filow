import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cleanup = require("./dictation-cleanup");

describe("S1-mini: a PC that is never inside the budget", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("rests after three late answers in a row (the first after a start not counted), even if no answer was ever in time", async () => {
    let calls = 0;
    const c = cleanup.createCleaner({ budgetMs: () => 700, run: () => { calls += 1; return new Promise<string>((res) => setTimeout(() => res("Send the report."), 3000)); } });
    const once = async () => { const r = c.clean("send the report", { language: "en" }); await vi.advanceTimersByTimeAsync(800); return r; };
    // first after start (model loading, not counted) + three late in a row
    for (let i = 0; i < 4; i++) expect((await once()).reason).toBe("slower than 700 ms");
    const pending = c.clean("send the report", { language: "en" }); await vi.advanceTimersByTimeAsync(800);
    const rest = await pending;
    expect(rest).toMatchObject({ used: false, reason: "resting: too slow on this computer", asked: false, ms: 0 });
    expect(calls).toBe(4);
  });
});
