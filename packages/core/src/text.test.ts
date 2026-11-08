import { describe, expect, it } from "vitest";
import { contentTokens, fold, quantities, sentences, similarity, tokenize } from "./text";

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
