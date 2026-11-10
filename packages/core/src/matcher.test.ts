import { describe, expect, it } from "vitest";
import { DEFAULT_MATCHER, isAnnouncement, matcherDecide, matcherDecisions, stageConfidence, withoutAnnouncements } from "./matcher";
import type { Embedder, PointVectors } from "./gate";

describe("stageConfidence", () => {
  it("below the start it only hints, from start to sure it rises 0.70 to 0.95", () => {
    expect(stageConfidence(0.59, 0.6, 0.8)).toBeLessThan(0.5);
    expect(stageConfidence(0.6, 0.6, 0.8)).toBeCloseTo(0.7);
    expect(stageConfidence(0.7, 0.6, 0.8)).toBeCloseTo(0.825);
    expect(stageConfidence(0.8, 0.6, 0.8)).toBeCloseTo(0.95);
    expect(stageConfidence(0.99, 0.6, 0.8)).toBeCloseTo(0.95);
    expect(stageConfidence(1, Infinity, Infinity)).toBeLessThan(0.5);
  });
});

describe("matcherDecisions", () => {
  it("credits the clearly best point and keeps a near tie ambiguous", () => {
    const clear = matcherDecisions([{ id: "a", similarity: 0.82 }, { id: "b", similarity: 0.3 }]);
    expect(clear.map((d) => [d.id, d.started])).toEqual([["a", true], ["b", false]]);
    const tie = matcherDecisions([{ id: "a", similarity: 0.82 }, { id: "b", similarity: 0.79 }]);
    expect(tie.every((d) => !d.started && d.confidence === 0.69)).toBe(true);
  });

  it("the lexical stage alone can credit a point (names and numbers the embedding blurs)", () => {
    const d = matcherDecisions([{ id: "a", similarity: 0.2, lexical: 1 }, { id: "b", similarity: 0.25, lexical: 0.2 }]);
    expect(d.find((x) => x.id === "a")).toMatchObject({ started: true, confidence: 0.95 });
  });
});

describe("announcements", () => {
  it("drops sentences that only announce a point, in English and Italian", () => {
    expect(isAnnouncement("Later I will also cover the new pricing model, but first the next steps.")).toBe(true);
    expect(isAnnouncement("Tra poco vi parlerò anche del nuovo portale clienti.")).toBe(true);
    expect(isAnnouncement("We'll come back to the budget in a moment.")).toBe(true);
    expect(isAnnouncement("The new pricing model has three tiers.")).toBe(false);
    expect(isAnnouncement("Let me start with who we are: a small studio in Bassano.")).toBe(false);
    expect(withoutAnnouncements("Churn dropped to 4%. Later I will cover pricing. Next steps now.")).toBe("Churn dropped to 4%. Next steps now.");
  });
});

describe("matcherDecide", () => {
  // a toy embedder: one dimension per keyword
  const words = ["pricing", "team", "churn"];
  const embed: Embedder = async (texts) => texts.map((t) => Float32Array.from(words.map((w) => (t.toLowerCase().includes(w) ? 1 : 0.01))));
  const bullets = [{ id: "p", text: "pricing" }, { id: "t", text: "team" }, { id: "c", text: "churn" }];
  const req = (transcript: string) => ({ transcript, bullets, sectionTitle: "s" });

  it("answers not started for every point until the point vectors are ready", async () => {
    const out = await matcherDecide(embed, () => null)(req("our pricing has three tiers"));
    expect(out.decisions.every((d) => !d.started && d.confidence === 0)).toBe(true);
    expect(out.cost).toBe(0);
  });

  it("credits the point the speech is about, and ignores an announcement of it", async () => {
    const pv: PointVectors = { key: "k", ids: bullets.map((b) => b.id), vectors: await embed(bullets.map((b) => b.text)) };
    const decide = matcherDecide(embed, () => pv, DEFAULT_MATCHER);
    const said = await decide(req("So, our pricing has three tiers and a free plan."));
    expect(said.decisions.find((d) => d.id === "p")?.started).toBe(true);
    expect(said.decisions.filter((d) => d.started)).toHaveLength(1);
    const announced = await decide(req("Later I will cover the pricing."));
    expect(announced.decisions.some((d) => d.started)).toBe(false);
  });

  it("scores the last sentence on its own, so a point said after another topic is not diluted", async () => {
    const pv: PointVectors = { key: "k", ids: bullets.map((b) => b.id), vectors: await embed(bullets.map((b) => b.text)) };
    const said = req("Churn is a topic for another day, honestly. Our pricing has three tiers for small companies.");
    const tailOnly = await matcherDecide(embed, () => pv, { ...DEFAULT_MATCHER, perSentence: 0 })(said);
    expect(tailOnly.decisions.some((d) => d.started)).toBe(false); // a tie between churn and pricing
    const withSentence = await matcherDecide(embed, () => pv, DEFAULT_MATCHER)(said);
    expect(withSentence.decisions.filter((d) => d.started).map((d) => d.id)).toEqual(["p"]);
  });
});
