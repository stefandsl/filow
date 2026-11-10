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

const norms = (s: string) => tokenize(s).map((x) => x.norm);
const qa = (s: string) => quantities(s).map((x) => [x.kind, x.value, ...(x.approx ? ["~"] : [])]);

describe("text: Russian", () => {
  it("keeps Cyrillic words whole: stress marks go, ё becomes е, й stays й", () => {
    expect(norms("Вы́ручка ещё растёт, Ёлка и йод")).toEqual(["выручка", "еще", "растет", "елка", "и", "йод"]);
    expect(fold("ё Ё й")).toBe("е е й");
  });

  it("content tokens drop Russian stop words and hedges, and keep offsets", () => {
    expect(contentTokens("Выручка выросла на тридцать процентов")).toEqual(["выручка", "выросла"]);
    expect(contentTokens("Мы не сократили расходы")).toEqual(["сократили", "расходы"]);
    expect(contentTokens("около четырёхсот пятидесяти клиентов")).toEqual(["клиентов"]);
    const text = "Мы наняли инженеров";
    const t = tokenize(text);
    expect(text.slice(t[1].start, t[1].end)).toBe("наняли");
  });

  it("reads spelled-out numbers, as the recognisers write them", () => {
    expect(qa("выросла на тридцать процентов")).toEqual([["percent", 30]]);
    expect(qa("двадцать один процент")).toEqual([["percent", 21]]);
    expect(qa("две тысячи пятьсот клиентов")).toEqual([["count", 2500]]);
    expect(qa("тысяча клиентов")).toEqual([["count", 1000]]);
    expect(qa("около четырёхсот пятидесяти клиентов")).toEqual([["count", 450, "~"]]);
    expect(qa("три часа")).toEqual([["duration", 3 * 3600]]);
  });

  it("a year stays a year in both cases of 'год'", () => {
    expect(qa("в 2024 году")).toEqual([["year", 2024]]);
    expect(qa("с 2024 года")).toEqual([["year", 2024]]);
  });

  it("inflected forms of one word are close enough, different words are not", () => {
    expect(similarity("клиентов", "клиенты")).toBeGreaterThanOrEqual(0.8);
    expect(similarity("выручка", "выручки")).toBeGreaterThanOrEqual(0.8);
    expect(similarity("расходы", "доходы")).toBeLessThan(0.8);
  });
});

describe("text: Romanian", () => {
  it("gives the same tokens with diacritics, with cedilla forms and with none", () => {
    const plain = ["veniturile", "au", "crescut", "cu", "treizeci", "si", "cinci", "la", "suta"];
    expect(norms("Veniturile au crescut cu treizeci și cinci la sută")).toEqual(plain);
    expect(norms("Veniturile au crescut cu treizeci şi cinci la sută")).toEqual(plain);
    expect(norms("Veniturile au crescut cu treizeci si cinci la suta")).toEqual(plain);
    expect(norms("țară şi ţară și ștat şcoală")).toEqual(["tara", "si", "tara", "si", "stat", "scoala"]);
    expect(fold("Șțăîâ şţ")).toBe("staia st");
  });

  it("content tokens drop Romanian function words", () => {
    expect(contentTokens("Veniturile au crescut cu treizeci și cinci la sută")).toEqual(["veniturile", "crescut"]);
    expect(contentTokens("o sută douăzeci și cinci de clienți")).toEqual(["clienti"]);
    expect(contentTokens("cel mai mare client")).toEqual(["mare", "client"]);
  });

  it("reads spelled-out numbers with and without diacritics", () => {
    expect(qa("au crescut cu treizeci și cinci la sută")).toEqual([["percent", 35]]);
    expect(qa("au crescut cu treizeci si cinci la suta")).toEqual([["percent", 35]]);
    expect(qa("o sută douăzeci și cinci de clienți")).toEqual([["count", 125]]);
    expect(qa("o suta douazeci si cinci de clienti")).toEqual([["count", 125]]);
    expect(qa("două mii cinci sute de clienți")).toEqual([["count", 2500]]);
    expect(qa("20 de minute")).toEqual([["duration", 20 * 60]]);
    expect(qa("nouă milioane de euro")).toEqual([["currency:eur", 9_000_000]]);
    expect(qa("în 2024 am crescut")).toEqual([["year", 2024]]);
  });

  it("'noua' (new) and 'opt' (eight, but also English) are numbers only where a number can stand", () => {
    expect(qa("noua strategie")).toEqual([]);
    expect(contentTokens("noua strategie")).toEqual(["noua", "strategie"]);
    expect(qa("noua la suta")).toEqual([["percent", 9]]);
    expect(qa("customers opt out")).toEqual([]);
    expect(qa("two hundred opt out")).toEqual([["count", 200]]);
    expect(qa("o milioni di euro")).toEqual([]);
  });
});

describe("text: Japanese", () => {
  it("cuts unspaced text into words", () => {
    expect(norms("売上は三十パーセント増えました。顧客は四百五十社です。")).toEqual(["売上", "は", "30", "パーセント", "増え", "ま", "した", "顧客", "は", "450", "社", "です"]);
    const text = "新しいオフィスを大阪に開設しました";
    const t = tokenize(text);
    const i = t.findIndex((x) => x.norm === "大阪");
    expect(text.slice(t[i].start, t[i].end)).toBe("大阪");
  });

  it("content tokens are the words that carry meaning: no particles, no endings, no numbers", () => {
    expect(contentTokens("売上は三十パーセント増えました。顧客は四百五十社です。")).toEqual(["売上", "増え", "顧客"]);
    expect(contentTokens("車椅子の利用者は三つの施設を使います")).toEqual(["車椅子", "利用", "施設", "使い"]);
  });

  it("reads kanji numerals as numbers", () => {
    expect(qa("売上は三十パーセント増えました")).toEqual([["percent", 30]]);
    expect(qa("顧客は四百五十社です")).toEqual([["count", 450]]);
    expect(qa("約七千の島々")).toEqual([["count", 7000, "~"]]);
    expect(qa("第一四半期の売上高は1200万円です")).toEqual([["currency:jpy", 12_000_000]]);
    expect(qa("会議は二時間かかりました")).toEqual([["duration", 2 * 3600]]);
    expect(qa("三十分ほど散策")).toEqual([["duration", 30 * 60]]);
  });

  it("reads a year written digit by digit, with the zero sign", () => {
    expect(norms("二〇二四年に開始")).toEqual(["2024", "年", "に", "開始"]);
    expect(qa("二〇二四年に開始")).toEqual([["year", 2024]]);
    expect(qa("2024年の売上")).toEqual([["year", 2024]]);
  });

  it("words that contain a numeral stay words", () => {
    expect(norms("二人で万一に備えて一緒に千葉へ行く")).toEqual(["2", "人", "で", "万一", "に", "備え", "て", "一緒", "に", "千葉", "へ", "行く"]);
    expect(qa("二人で万一に備えて一緒に千葉へ行く")).toEqual([["count", 2]]);
  });

  it("folds half-width katakana and full-width letters and digits", () => {
    expect(norms("ﾃﾞｰﾀ データ ＡＢＣ １２３")).toEqual(["データ", "データ", "abc", "123"]);
  });

  it("splits sentences at Japanese full stops, with no space after them", () => {
    expect(sentences("売上は増えました。顧客は減りません！次は？はい").map((s) => s.text)).toEqual(["売上は増えました。", "顧客は減りません！", "次は？", "はい"]);
  });

  it("a space between two Japanese phrases ends a sentence (recognisers write no punctuation), a space inside Latin text does not", () => {
    expect(sentences("売上は増えました 顧客は減りません 2024年に開始 Hello world 次は").map((s) => s.text)).toEqual(["売上は増えました", "顧客は減りません", "2024年に開始 Hello world 次は"]);
    expect(sentences("Revenue grew twelve percent this year").map((s) => s.text)).toEqual(["Revenue grew twelve percent this year"]);
  });

  it("a day after a number is a length of time, so it never equals hours", () => {
    expect(qa("平均応答時間は四日です")).toEqual([["duration", 4 * 86400]]);
    expect(qa("平均応答時間は4時間です")).toEqual([["duration", 4 * 3600]]);
    expect(qa("五月に開設します")).toEqual([["count", 5]]);
  });
});

describe("text: Russian case forms of small numbers", () => {
  it("reads the dative and instrumental of two, three and four inside a compound", () => {
    expect(qa("равен шестидесяти двум")).toEqual([["count", 62]]);
    expect(qa("к тридцати трем процентам")).toEqual([["percent", 33]]);
    expect(qa("четырьмя инженерами")).toEqual([["count", 4]]);
  });
});

describe("text: Italian and English are unchanged by the other languages", () => {
  it("Italian 'ce', 'care', 'sub', 'te' and English 'care', 'sub' stay content or stop words as before", () => {
    expect(contentTokens("customer care team")).toEqual(["customer", "care", "team"]);
    expect(contentTokens("We care about the EU market")).toContain("eu");
    expect(qa("o milioni di euro")).toEqual([]);
    expect(qa("nove clienti")).toEqual([["count", 9]]);
  });
});
