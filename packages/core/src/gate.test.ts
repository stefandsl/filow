import { describe, expect, it } from "vitest";
import { embedPoints, gate, gateCacheKey, gatedDecide, prepareWindowText, scorePoints, type Embedder } from "./gate";
import type { DecideRequest } from "./api";

// A toy embedder: bag of lowercase words (4+ letters, so "the"/"was" do not count) hashed into 256 dims.
const toyEmbed: Embedder = async (texts) =>
  texts.map((t) => {
    const v = new Float32Array(256);
    for (const w of t.toLowerCase().split(/[^a-zà-ú]+/).filter((x) => x.length > 3)) {
      let h = 7;
      for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      v[h % 256] += 1;
    }
    return v;
  });

const bullets = [
  { id: "a", text: "who we are: a small team from Bassano" },
  { id: "b", text: "the pricing of the product" },
  { id: "c", text: "the decision model answers twice a second" },
];

describe("embedding gate", () => {
  it("cache key changes with the points, the language and the preparation version", () => {
    const k1 = gateCacheKey(bullets, "it");
    expect(gateCacheKey(bullets, "it")).toBe(k1);
    expect(gateCacheKey(bullets, "en")).not.toBe(k1);
    expect(gateCacheKey([...bullets, { id: "d", text: "x" }], "it")).not.toBe(k1);
  });

  it("ranks the point the speech is about first and gates the others out", async () => {
    const pv = await embedPoints(toyEmbed, bullets, "en");
    const [wv] = await toyEmbed([prepareWindowText("so today, a small team from Bassano, that is who we are")]);
    const scores = scorePoints(wv, pv, bullets);
    expect(scores[0].id).toBe("a");
    const out = gate(scores, bullets, { low: 0.3, maxCandidates: 4, tailChars: 320 });
    expect(out.candidates.map((b) => b.id)).toEqual(["a"]);
    expect(out.skipped).toBe(false);
  });

  it("skips the model entirely when nothing is similar, and only asks about candidates otherwise", async () => {
    const pv = await embedPoints(toyEmbed, bullets, "en");
    const calls: DecideRequest[] = [];
    const decide = gatedDecide(
      async (r) => {
        calls.push(r);
        return { decisions: r.bullets.map((b) => ({ id: b.id, started: true, confidence: 0.9 })), latencyMs: 5, cost: 0, model: "m" };
      },
      toyEmbed,
      () => pv,
    );
    const quiet = await decide({ transcript: "the weather in the mountains was lovely yesterday", bullets, sectionTitle: "s" });
    expect(calls.length).toBe(0);
    expect(quiet.model).toContain("gate");
    expect(quiet.decisions.every((d) => !d.started && d.confidence < 0.5)).toBe(true);

    const hit = await decide({ transcript: "let me tell you about the pricing of the product", bullets, sectionTitle: "s" });
    expect(calls.length).toBe(1);
    expect(calls[0].bullets.map((b) => b.id)).toEqual(["b"]);
    expect(hit.decisions.find((d) => d.id === "b")?.started).toBe(true);
    expect(hit.decisions.find((d) => d.id === "a")?.started).toBe(false);
    expect(hit.model).toContain("gate 1/3");
  });
});
