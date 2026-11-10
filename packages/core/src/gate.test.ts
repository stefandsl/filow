import { describe, expect, it } from "vitest";
import { DEFAULT_GATE, embedPoints, gate, gateCacheKey, gatedDecide, gateThresholdsFor, lexicalScores, prepareWindowText, scorePoints, windowTexts, type Embedder } from "./gate";
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

  // A live take (trk-p3): the paraphrase of a point came right after an unrelated sentence; embedded
  // together the tail scored under the 0.3 line and the model was never asked about it.
  const before = "On a completely different note I had a great espresso this morning and the weather in Milan was lovely and the mountains around the lake looked wonderful under clear skies with gentle breezes";
  const said = "let me tell you about the pricing of the product";
  const skipOnly = (calls: DecideRequest[]) =>
    gatedDecide(
      async (r) => {
        calls.push(r);
        return { decisions: r.bullets.map((b) => ({ id: b.id, started: b.id === "b", confidence: b.id === "b" ? 0.9 : 0.1 })), latencyMs: 5, cost: 0, model: "m" };
      },
      toyEmbed,
      () => pointVectors,
      // lexical stage off: the point shares its words with the speech, which would let it through anyway
      { ...gateThresholdsFor("clef-local"), lexicalLow: Infinity },
    );
  let pointVectors: Awaited<ReturnType<typeof embedPoints>>;

  it.each([
    ["after a full stop", `${before}. ${said}`],
    ["with no full stop (speech recognisers often leave it out)", `${before} ${said}`],
  ])("asks the model about a point said in one sentence of a diluted tail (%s)", async (_, transcript) => {
    pointVectors = await embedPoints(toyEmbed, bullets, "en");
    // the tail as a whole is under the line: this is the dilution the per-sentence scores fix
    const [whole] = await toyEmbed([prepareWindowText(transcript)]);
    expect(scorePoints(whole, pointVectors, bullets).find((s) => s.id === "b")!.similarity).toBeLessThan(DEFAULT_GATE.low);
    const calls: DecideRequest[] = [];
    const out = await skipOnly(calls)({ transcript, bullets, sectionTitle: "s" });
    expect(calls.length).toBe(1);
    expect(out.decisions.find((d) => d.id === "b")?.started).toBe(true);
    expect(out.decisions.find((d) => d.id === "b")!.gate!).toBeGreaterThanOrEqual(DEFAULT_GATE.low);
  });

  it("still skips the call when no sentence of the tail is about any point", async () => {
    pointVectors = await embedPoints(toyEmbed, bullets, "en");
    const calls: DecideRequest[] = [];
    await skipOnly(calls)({ transcript: `${before}. The espresso was strong and the lake was calm.`, bullets, sectionTitle: "s" });
    expect(calls.length).toBe(0);
  });

  it("embeds the tail and each of its sentences, never a cut-off word or two on its own", () => {
    expect(windowTexts("First sentence is here. Second one follows now. ok")).toEqual(["First sentence is here. Second one follows now. ok", "First sentence is here.", "Second one follows now."]);
    expect(windowTexts("a single sentence with no stop")).toEqual(["a single sentence with no stop"]);
  });

  it("embeds at most the last three sentences on their own, whatever the language packs into the tail", () => {
    const many = Array.from({ length: 12 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const texts = windowTexts(many);
    expect(texts).toHaveLength(4);
    expect(texts.slice(1)).toEqual(["Sentence number 9 is here.", "Sentence number 10 is here.", "Sentence number 11 is here."]);
    // Japanese recogniser output: phrases separated by spaces, many of them in 320 characters
    const ja = prepareWindowText("サポートコストは今四半期三十パーセント増加しました 主に残業が原因です ".repeat(8));
    expect(windowTexts(ja).length).toBeLessThanOrEqual(4);
  });
});

describe("lexical stage (P1 step 3)", () => {
  const points = [
    { id: "s1b0", text: "Abbiamo 450 clienti attivi" },
    { id: "s1b1", text: "Il tempo medio di risposta è di 2 ore" },
    { id: "s1b2", text: "Il nuovo portale clienti" },
  ];

  it("scores names, terms and spelled-out numbers the speech shares with a point, 0..1", () => {
    const lex = lexicalScores("Oggi abbiamo quattrocentocinquanta clienti attivi in tutta Italia.", points);
    expect(lex.get("s1b0")).toBeGreaterThan(0.9);
    expect(lex.get("s1b1")).toBe(0);
    // "clienti" is in two points: alone it is worth less than a word only one point has
    expect(lex.get("s1b2")!).toBeLessThan(0.5);
    expect(lexicalScores("parliamo del nuovo portale", points).get("s1b2")).toBeGreaterThan(0.6);
  });

  it("matches inflected forms fuzzily", () => {
    const lex = lexicalScores("abbiamo tagliato di molto i tempi della consegna", [{ id: "a", text: "Tagliati i tempi di consegna" }]);
    expect(lex.get("a")).toBeGreaterThan(0.9);
  });

  // An embedder that finds nothing similar: only the lexical stage can make a candidate.
  const blind: Embedder = async (texts) => texts.map((t, i) => {
    const v = new Float32Array(8);
    v[t.startsWith("§") ? 0 : 1 + (i % 7)] = 1;
    return v;
  });

  it("a point the embedding misses but the words match is still asked; with neither, the model is skipped", async () => {
    const pv = { key: "k", ids: points.map((p) => p.id), vectors: points.map(() => (() => { const v = new Float32Array(8); v[0] = 1; return v; })()) };
    const calls: DecideRequest[] = [];
    const seen: Array<{ skipped: boolean; lexicalOnly: number }> = [];
    const decide = gatedDecide(
      async (r) => {
        calls.push(r);
        return { decisions: r.bullets.map((b) => ({ id: b.id, started: true, confidence: 0.9 })), latencyMs: 5, cost: 0, model: "m" };
      },
      blind,
      () => pv,
      { ...DEFAULT_GATE, low: 0.3, lexicalLow: 0.5 },
      (o) => seen.push({ skipped: o.skipped, lexicalOnly: o.lexicalOnly }),
    );
    const hit = await decide({ transcript: "Oggi abbiamo quattrocentocinquanta clienti attivi.", bullets: points, sectionTitle: "Clienti" });
    expect(calls.map((c) => c.bullets.map((b) => b.id))).toEqual([["s1b0"]]);
    expect(seen[0]).toEqual({ skipped: false, lexicalOnly: 1 });
    const d = hit.decisions.find((x) => x.id === "s1b0")!;
    expect(d.lexical).toBeGreaterThan(0.9);
    expect(d.gate).toBeTypeOf("number");

    await decide({ transcript: "Il tempo oggi è bello.", bullets: points.slice(2), sectionTitle: "Clienti" });
    expect(calls).toHaveLength(1);
    expect(seen[1].skipped).toBe(true);
  });

  it("with lexicalLow off, the gate behaves as before (embedding only)", () => {
    const scores = [{ id: "s1b0", similarity: 0.1, lexical: 1 }];
    expect(gate(scores, points, { ...DEFAULT_GATE, lexicalLow: Infinity }).skipped).toBe(true);
    expect(gate(scores, points, { ...DEFAULT_GATE, lexicalLow: 0.5 }).candidates.map((b) => b.id)).toEqual(["s1b0"]);
  });
});

describe("gate modes", () => {
  it("narrow: false keeps the skip but asks about every open point once any point passes", async () => {
    const pv = await embedPoints(toyEmbed, bullets, "en");
    const calls: DecideRequest[] = [];
    const decide = gatedDecide(
      async (r) => {
        calls.push(r);
        return { decisions: r.bullets.map((b) => ({ id: b.id, started: false, confidence: 0.2 })), latencyMs: 5, cost: 0, model: "m" };
      },
      toyEmbed,
      () => pv,
      { ...DEFAULT_GATE, narrow: false },
    );
    await decide({ transcript: "the weather in the mountains was lovely yesterday", bullets, sectionTitle: "s" });
    expect(calls).toHaveLength(0);
    const out = await decide({ transcript: "let me tell you about the pricing of the product", bullets, sectionTitle: "s" });
    expect(calls[0].bullets.map((b) => b.id)).toEqual(["a", "b", "c"]);
    expect(out.decisions.every((d) => typeof d.gate === "number")).toBe(true);
  });
});

describe("gate thresholds per provider", () => {
  it("local Clef gets the skip-only gate; other providers keep the narrowed gate", () => {
    expect(gateThresholdsFor("clef-local").narrow).toBe(false);
    expect(gateThresholdsFor("openrouter").narrow).not.toBe(false);
    expect(gateThresholdsFor(undefined).narrow).not.toBe(false);
    expect(gateThresholdsFor("clef-local").lexicalLow).toBe(DEFAULT_GATE.lexicalLow);
  });
});

describe("gate fusion (P1 review)", () => {
  it("ranks each stage's score against its own threshold", () => {
    const pts = [{ id: "emb", text: "x" }, { id: "lex", text: "y" }];
    // 0.36 is 1.2x the embedding threshold; 0.55 only 1.1x the lexical one
    const out = gate([{ id: "lex", similarity: 0.1, lexical: 0.55 }, { id: "emb", similarity: 0.36, lexical: 0 }], pts, { ...DEFAULT_GATE, maxCandidates: 1 });
    expect(out.candidates.map((b) => b.id)).toEqual(["emb"]);
  });
  it("the lexical scores of a script's points are prepared once and reused", () => {
    // Measured against itself, not against a wall-clock budget: "under 5 ms per call" failed on a busy
    // machine. A prepared set of points costs about a twentieth of a new one (0.7 ms against 14 ms
    // here); without the reuse the two cost the same, so a factor of 4 separates them under any load.
    const tail = "abbiamo ridotto i tempi di consegna per i clienti attivi";
    const points = (salt: string) => Array.from({ length: 40 }, (_, i) => ({ id: `p${i}${salt}`, text: `Punto numero ${i} sui clienti attivi e i tempi di consegna ${i * 7}` }));
    const time = (fn: () => void) => {
      const t0 = performance.now();
      fn();
      return performance.now() - t0;
    };
    const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    const same = points("");
    lexicalScores(tail, same); // prepares this set
    const reused = median(Array.from({ length: 31 }, () => time(() => lexicalScores(tail, same))));
    const fresh = median(Array.from({ length: 31 }, (_, k) => time(() => lexicalScores(tail, points(`-${k}`)))));
    expect(reused).toBeLessThan(fresh / 4);
  });
});
