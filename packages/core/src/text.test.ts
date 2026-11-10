import { describe, expect, it } from "vitest";
import { contentTokens, fold, FUZZY_MIN, quantities, sentences, similarity, tokenize } from "./text";

describe("text: folding and tokens", () => {
  it("folds case and accents and keeps offsets into the original text", () => {
    expect(fold("Perché È COSÌ")).toBe("perche e cosi");
    const t = tokenize("Il fatturato è cresciuto del 12%.");
    expect(t.map((x) => x.norm)).toEqual(["il", "fatturato", "e", "cresciuto", "del", "12", "%"]);
    expect("Il fatturato è cresciuto del 12%.".slice(t[1].start, t[1].end)).toBe("fatturato");
  });

  it("turns English n't into a separate 'not' token", () => {
    expect(tokenize("We didn't cut it").map((x) => x.norm)).toEqual(["we", "did", "not", "cut", "it"]);
  });

  it("content tokens drop stop words and numbers", () => {
    expect(contentTokens("Abbiamo 450 clienti attivi")).toEqual(["clienti", "attivi"]);
    expect(contentTokens("We will raise prices in January")).toEqual(["raise", "prices", "january"]);
  });

  it("fuzzy similarity accepts inflections and rejects different words", () => {
    expect(similarity("tagliato", "tagliati")).toBeGreaterThanOrEqual(0.8);
    expect(similarity("presentazioni", "presentare")).toBeGreaterThanOrEqual(0.8);
    expect(similarity("engineers", "engineer")).toBeGreaterThanOrEqual(0.8);
    expect(similarity("server", "servizio")).toBeLessThan(0.8);
    expect(similarity("costi", "cosa")).toBeLessThan(0.8);
  });

  it("splits sentences, and chunks very long unpunctuated text", () => {
    const s = sentences("Uno due. Tre quattro? Cinque");
    expect(s.map((x) => x.text)).toEqual(["Uno due.", "Tre quattro?", "Cinque"]);
    const long = Array.from({ length: 70 }, (_, i) => `parola${i}`).join(" ");
    const chunks = sentences(long);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.text.split(" ").length <= 30)).toBe(true);
  });
});

describe("text: quantities", () => {
  const q = (s: string) => quantities(s).map((x) => [x.kind, x.value, ...(x.approx ? ["~"] : [])]);

  it("reads digits, percentages and decimal or thousands separators", () => {
    expect(q("calati del 30%")).toEqual([["percent", 30]]);
    expect(q("3,5 per cento")).toEqual([["percent", 3.5]]);
    expect(q("1.200 clienti")).toEqual([["count", 1200]]);
    expect(q("1,200 customers")).toEqual([["count", 1200]]);
  });

  it("reads Italian spelled numbers, compounds and units", () => {
    expect(q("aumentati del trenta per cento")).toEqual([["percent", 30]]);
    expect(q("quattrocentocinquanta clienti")).toEqual([["count", 450]]);
    expect(q("duemilaventicinque")).toEqual([["year", 2025]]);
    expect(q("ventuno per cento")).toEqual([["percent", 21]]);
    expect(q("due giorni lavorativi")).toEqual([["duration", 2 * 86400]]);
    expect(q("2 ore")).toEqual([["duration", 2 * 3600]]);
    expect(q("tre milioni di euro")).toEqual([["currency:eur", 3_000_000]]);
    expect(q("una decina d'anni")).toEqual([["duration", 10 * 31557600, "~"]]);
    expect(q("oltre 400 clienti")).toEqual([["count", 400, "~"]]);
  });

  it("reads English spelled numbers, hyphens and units", () => {
    expect(q("thirty percent")).toEqual([["percent", 30]]);
    expect(q("sixty-two, up from fifty-five")).toEqual([["count", 62], ["count", 55]]);
    expect(q("two hundred and fifty dollars")).toEqual([["currency:usd", 250]]);
    expect(q("$40")).toEqual([["currency:usd", 40]]);
    expect(q("four days")).toEqual([["duration", 4 * 86400]]);
    expect(q("4 hours")).toEqual([["duration", 4 * 3600]]);
    expect(q("in 2024")).toEqual([["year", 2024]]);
  });

  it("does not read articles or pronouns as numbers", () => {
    expect(q("una sede a Milano")).toEqual([]);
    expect(q("one small customer group")).toEqual([]);
    expect(q("ora abbiamo clienti")).toEqual([]);
  });
});

describe("text: review findings", () => {
  const q = (s: string) => quantities(s).map((x) => [x.kind, x.value]);
  it("does not split sentences inside numbers", () => {
    expect(sentences("Abbiamo 1.200 clienti. Poi 3.5 punti.").map((s) => s.text)).toEqual(["Abbiamo 1.200 clienti.", "Poi 3.5 punti."]);
  });
  it("reads counts in 1900-2100 as counts unless they are said as a year", () => {
    expect(q("2.000 clienti")).toEqual([["count", 2000]]);
    expect(q("2,000 users")).toEqual([["count", 2000]]);
    expect(q("2000 clienti")).toEqual([["count", 2000]]);
    expect(q("two thousand users")).toEqual([["count", 2000]]);
    expect(q("nel 2025 i costi")).toEqual([["year", 2025]]);
    expect(q("since 2019 we grew")).toEqual([["year", 2019]]);
    expect(q("rispetto al 2024.")).toEqual([["year", 2024]]);
  });
  it("reads numbers after a scale, connectors and halves", () => {
    expect(q("two thousand five hundred users")).toEqual([["count", 2500]]);
    expect(q("one million two hundred thousand")).toEqual([["count", 1_200_000]]);
    expect(q("mille e cinquecento clienti")).toEqual([["count", 1500]]);
    expect(q("due ore e mezza")).toEqual([["duration", 2.5 * 3600]]);
    expect(q("two and a half hours")).toEqual([["duration", 2.5 * 3600]]);
    expect(q("un milione di euro")).toEqual([["currency:eur", 1e6]]);
    expect(q("a million users")).toEqual([["count", 1e6]]);
    expect(q("€1.2m")).toEqual([["currency:eur", 1.2e6]]);
    expect(q("tre virgola 05")).toEqual([["count", 3.05]]);
  });
  it("carries a unit back across a range", () => {
    expect(q("dal 20 al 25 per cento")).toEqual([["percent", 20], ["percent", 25]]);
    expect(q("from 20 to 25 percent")).toEqual([["percent", 20], ["percent", 25]]);
    expect(q("tra 2 e 3 ore")).toEqual([["duration", 7200], ["duration", 10800]]);
  });
});

describe("similarity: verb and noun of the same Latin -d / -s stem (TRK-2)", () => {
  it("matches chiudere ~ chiusura, decidere ~ decisione, conclude ~ conclusion", () => {
    for (const [a, b] of [["chiudiamo", "chiusura"], ["chiudere", "chiuso"], ["decidere", "decisione"], ["decide", "decision"], ["conclude", "conclusion"]]) {
      expect(similarity(a, b), `${a} ~ ${b}`).toBeGreaterThanOrEqual(FUZZY_MIN);
      expect(similarity(b, a), `${b} ~ ${a}`).toBeGreaterThanOrEqual(FUZZY_MIN);
    }
  });
  it("does not match short words or stems of fewer than 4 letters before the d/s", () => {
    for (const [a, b] of [["comedy", "comes"], ["prendere", "presentare"], ["credere", "crescere"], ["media", "mesi"], ["programma", "progetto"], ["consegna", "condizione"], ["server", "servizio"]]) {
      expect(similarity(a, b), `${a} ~ ${b}`).toBeLessThan(FUZZY_MIN);
    }
  });
});
