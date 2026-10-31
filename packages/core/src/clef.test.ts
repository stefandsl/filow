import { describe, expect, it } from "vitest";
import { buildClefRequest, parseClefAnswers } from "./clef";

const req = {
  transcript: "so today we look at tensors",
  bullets: [
    { id: "s0b0", text: "introduce tensors" },
    { id: "s0b1", text: "show the demo" },
  ],
  sectionTitle: "Intro",
  covered: ["say hello"],
  upcoming: ["costs"],
  onScreen: ["42%"],
};

describe("buildClefRequest", () => {
  it("makes one noul question per open point plus one per on-screen fact", () => {
    const r = buildClefRequest(req, "clef-flash");
    expect(r.model).toBe("clef-flash");
    expect(Object.keys(r.questions)).toEqual(["s0b0", "s0b1", "fact_0"]);
    expect(r.questions.s0b0.type).toBe("noul");
    expect(r.questions.s0b0.instructions).toContain("introduce tensors");
    expect(r.state).toMatchObject({ section: "Intro", covered_points_context_only: ["say hello"] });
  });
});

describe("parseClefAnswers", () => {
  it("uses the probability as confidence and applies the threshold", () => {
    const out = parseClefAnswers({ answers: { s0b0: { noul: 0.93 }, s0b1: { noul: 0.2 }, fact_0: { noul: 0.1 } } }, req);
    expect(out.decisions).toEqual([
      { id: "s0b0", started: true, confidence: 0.93 },
      { id: "s0b1", started: false, confidence: 0.2 },
    ]);
    expect(out.unmentioned).toEqual(["42%"]);
  });

  it("treats missing or bad answers as not started", () => {
    const out = parseClefAnswers({ answers: { s0b0: { noul: Number.NaN } } }, req);
    expect(out.decisions.map((d) => d.confidence)).toEqual([0, 0]);
    expect(out.unmentioned).toEqual([]);
  });
});
