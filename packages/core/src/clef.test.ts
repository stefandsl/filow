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

  // The wording is measured (docs/gauntlet/BASELINE.md, TRK-2): "has the speaker STARTED this idea /
  // made this point" scored 0.2 to 0.65 on short labels said word for word. Changing it again needs
  // the seven corpora and the adversarial set re-run, not a quiet edit.
  it("asks whether the point was said, and names what does not count", () => {
    const q = buildClefRequest(req, "clef-flash").questions.s0b0;
    expect(q.instructions).toContain('Script point: "introduce tensors". Has the speaker said this, or begun saying something about it');
    expect(q.instructions).not.toMatch(/STARTED talking about this idea/);
    expect(q.criteria?.true).toMatch(/exactly this topic/);
    expect(q.criteria?.false).toMatch(/someone else/);
    expect(q.criteria?.false).toMatch(/dropped or did not happen/);
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

describe("verification questions (TRK-2)", () => {
  it("adds two questions for each point listed in `verify`, and only for those", () => {
    const r = buildClefRequest({ ...req, verify: ["s0b1", "unknown"] }, "clef-flash");
    expect(Object.keys(r.questions)).toEqual(["s0b0", "s0b1", "s0b1__real", "s0b1__party", "fact_0"]);
    expect(r.questions.s0b1__real.instructions).toContain('"show the demo"');
    expect(r.questions.s0b1__real.instructions).toMatch(/cancelled/);
    expect(r.questions.s0b1__party.instructions).toMatch(/same party/);
  });

  it("the party question names both directions, so a point about others said of those others is the same party", () => {
    // A live take (trk-p3): "Everyone is copying it, so it must be good" said as "all the other companies
    // are making their own version of it" scored 0.40 to 0.52 when the only example was "about us, said of
    // a competitor"; with both directions named it scores 0.66 to 0.70 (docs/gauntlet/BASELINE.md).
    const r = buildClefRequest({ ...req, bullets: [{ id: "s0b2", text: "Everyone is copying it, so it must be good" }], verify: ["s0b2"] }, "clef-flash");
    const party = r.questions.s0b2__party.instructions;
    expect(party).toMatch(/the point is about us and the transcript says that a supplier, a competitor or "they" did it/);
    expect(party).toMatch(/the point is about others \(everyone, competitors, customers, the market\) and the transcript says it of us/);
    expect(party).toMatch(/When the point itself is about others, the transcript naming those others is the same party\./);
  });

  it("reads both answers into `verification`; a point not listed gets none", () => {
    const out = parseClefAnswers({ answers: { s0b0: { noul: 0.9 }, s0b1: { noul: 0.8 }, s0b1__real: { noul: 0.12 }, s0b1__party: { noul: 0.95 } } }, { ...req, verify: ["s0b1"] });
    expect(out.decisions[0].verification).toBeUndefined();
    expect(out.decisions[1].verification).toEqual({ real: 0.12, sameParty: 0.95 });
  });

  it("a missing verification answer is not a pass: the point stays unverified", () => {
    const out = parseClefAnswers({ answers: { s0b1: { noul: 0.8 }, s0b1__real: { noul: 0.9 } } }, { ...req, verify: ["s0b1"] });
    expect(out.decisions[1].verification).toBeUndefined();
  });
});
