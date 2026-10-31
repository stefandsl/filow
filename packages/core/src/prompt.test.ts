import { describe, expect, it } from "vitest";
import { buildUserPrompt, parseDecisions } from "./prompt";
import { parseScript } from "./script";

describe("parseDecisions", () => {
  it("strips code fences and fills missing ids", () => {
    const out = parseDecisions('```json\n{"decisions":[{"id":"a","started":true,"confidence":0.8}]}\n```', ["a", "b"]);
    expect(out.decisions).toEqual([
      { id: "a", started: true, confidence: 0.8 },
      { id: "b", started: false, confidence: 0 },
    ]);
  });

  it("clamps confidence and ignores unknown ids", () => {
    const out = parseDecisions('{"decisions":[{"id":"a","confidence":7},{"id":"zz","confidence":1}]}', ["a"]);
    expect(out.decisions).toEqual([{ id: "a", started: false, confidence: 1 }]);
  });

  it("recovers JSON embedded in prose and reads unmentioned", () => {
    const out = parseDecisions('Sure: {"decisions":[],"unmentioned":["42%", 3]} done', ["a"]);
    expect(out.decisions[0].id).toBe("a");
    expect(out.unmentioned).toEqual(["42%"]);
  });
});

describe("buildUserPrompt", () => {
  it("lists all four sections when on-screen facts are present", () => {
    const p = buildUserPrompt({
      transcript: "hi",
      bullets: [{ id: "a", text: "A" }],
      sectionTitle: "S",
      covered: [],
      upcoming: ["B"],
      onScreen: ["42%"],
    });
    expect(p).toContain("OPEN POINTS");
    expect(p).toContain("(none yet)");
    expect(p).toContain("- B");
    expect(p).toContain("ON SCREEN FACTS");
    expect(p.endsWith('"""hi"""')).toBe(true);
  });
});

describe("parseScript", () => {
  it("has stable ids across re-parses", () => {
    const a = parseScript("# A\n- x\n- y\n# B\n- z");
    const b = parseScript("# A\n- x\n- y\n# B\n- z");
    expect(a).toEqual(b);
    expect(a.sections[1].bullets[0].id).toBe("s1b0");
  });
});
