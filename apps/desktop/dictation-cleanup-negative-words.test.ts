// Audit 0.9.42, extension of C2 (lead change, not proven by an independent prover): a cleanup must not turn
// a negative word positive. acceptCleaned's contract: "It must be the same message, cleaned".
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { acceptCleaned } = require("./dictation-cleanup.js") as { acceptCleaned: (raw: string, cleaned: string) => { ok: boolean; reason: string } };

describe("dictation cleanup keeps negative words", () => {
  it.each([
    ["I have nothing against the new plan", "I have something against the new plan."],
    ["None of them agreed with the budget", "All of them agreed with the budget."],
    ["Neither option works for the team", "Either option works for the team."],
    ["Nobody will attend the meeting on Friday", "Everybody will attend the meeting on Friday."],
    ["we can go nowhere with this budget", "We can go anywhere with this budget."],
    ["it is neither cheap nor fast", "It is either cheap or fast."],
  ])("refuses %j -> %j", (raw, cleaned) => {
    expect(acceptCleaned(raw, cleaned)).toMatchObject({ ok: false, reason: "negation" });
  });

  it.each([
    ["nobody came to the meeting", "Nobody came to the meeting."],
    ["um nothing else to add", "Nothing else to add."],
    ["five no six chairs", "6 chairs."],
    ["I have no time today", "I have no time today."],
  ])("still accepts %j -> %j", (raw, cleaned) => {
    expect(acceptCleaned(raw, cleaned).ok).toBe(true);
  });
});
