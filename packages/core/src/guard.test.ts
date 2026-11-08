import { describe, expect, it } from "vitest";
import { checkClaim } from "./guard";

const blocked = (point: string, said: string) => checkClaim(point, said);

describe("claim guard: contradictions never pass", () => {
  it("direction: rose against fell, aumentati against calati", () => {
    expect(blocked("Support costs fell 30% this quarter", "Support costs rose thirty percent this quarter.").conflict?.kind).toBe("direction");
    expect(blocked("I costi operativi sono calati del 30% nel 2025", "Nel 2025 i costi operativi sono aumentati del trenta per cento.").conflict?.kind).toBe("direction");
  });

  it("negation of the point's own words", () => {
    expect(blocked("We cut the onboarding time", "We did not cut the onboarding time; it is still two weeks.").conflict?.kind).toBe("negation");
    expect(blocked("We cut the onboarding time", "We didn't cut the onboarding time.").conflict?.kind).toBe("negation");
    expect(blocked("Abbiamo tagliato i tempi di consegna", "Sui tempi di consegna invece no: non abbiamo tagliato i tempi di consegna.").conflict?.kind).toBe("negation");
    expect(blocked("We will raise prices in January", "We will not raise prices in January, we hold them until spring.").conflict?.kind).toBe("negation");
    expect(blocked("Apriremo una sede a Milano", "Non apriremo una sede a Milano quest'anno.").conflict?.kind).toBe("negation");
  });

  it("a negated point said without any negation", () => {
    expect(blocked("Non usiamo il cloud per i dati", "Usiamo il cloud per tutti i dati dei clienti.").conflict?.kind).toBe("negation");
  });

  it("wrong number", () => {
    expect(blocked("Il fatturato è cresciuto del 12%", "Il fatturato è cresciuto del ventuno per cento, trainato dall'estero.").conflict?.kind).toBe("number");
    expect(blocked("Churn dropped to 4%", "Churn dropped to fourteen percent, which is not where we want it.").conflict?.kind).toBe("number");
    expect(blocked("Ship the mobile app to 50 pilot customers", "We ship the mobile app to fifteen pilot customers first.").conflict?.kind).toBe("number");
  });

  it("wrong unit", () => {
    expect(blocked("Il tempo medio di risposta è di 2 ore", "Il tempo medio di risposta al cliente è di due giorni lavorativi.").conflict?.kind).toBe("number");
    expect(blocked("Average response time is 4 hours", "Average response time is four days, our biggest problem.").conflict?.kind).toBe("number");
    expect(blocked("I costi sono calati del 30%", "I costi sono calati di trenta euro a cliente.").conflict?.kind).toBe("unit");
  });
});

describe("claim guard: true points pass", () => {
  const ok = (point: string, said: string) => {
    const r = checkClaim(point, said);
    expect(r.conflict).toBeUndefined();
    expect(r.ok).toBe(true);
    return r;
  };

  it("spelled-out numbers, extra numbers, hedged numbers and equal durations", () => {
    ok("Abbiamo 450 clienti attivi", "Oggi abbiamo quattrocentocinquanta clienti attivi in tutta Italia.");
    ok("Net promoter score is 62", "Our net promoter score is now sixty-two, up from fifty-five last quarter.");
    ok("We hired 3 engineers", "We hired three engineers in July, all of them in support.");
    ok("Lavoriamo con le PMI del Veneto da dieci anni", "Seguiamo le piccole e medie imprese del Veneto, ormai da una decina d'anni.");
    ok("Il tempo medio di risposta è di 2 ore", "Il tempo medio di risposta è sceso a centoventi minuti.");
  });

  it("negations that are not about the point, and negated points said with a negation", () => {
    ok("Keep all customer data on our own servers", "All customer data stays on our own servers, nothing goes to a third party cloud.");
    ok("Non usiamo il cloud: i dati restano in azienda", "Non usiamo nessun servizio cloud esterno: tutti i dati restano nei nostri server in azienda.");
    ok("We cut the onboarding time", "Not only did we cut the onboarding time, we halved it.");
    // demo-it, 39 s: "senza niente" is "without anything", not a denial (a guard false positive in the first run)
    ok("Senza script si saltano punti importanti", "Il contrario però è peggio: senza niente davanti si saltano i punti importanti.");
    ok("Without a script you skip key points", "Without any notes at all you skip key points.");
  });

  it("years are not compared (a comparison year is not a wrong year)", () => {
    ok("I costi operativi sono calati del 30% nel 2025", "I costi operativi sono calati del trenta per cento rispetto al 2024.");
  });

  it("a later correction in the window wins over the earlier mistake, and is the evidence", () => {
    const r = ok(
      "I costi operativi sono calati del 30% nel 2025",
      "Nel 2025 i costi operativi sono aumentati del trenta per cento. Anzi, scusate: i costi operativi sono calati del trenta per cento.",
    );
    expect(r.evidence?.text).toBe("Anzi, scusate: i costi operativi sono calati del trenta per cento.");
    expect(r.lexical).toBeGreaterThan(0.6);
  });

  it("a correction that only repeats the right number counts too", () => {
    ok("Il fatturato è cresciuto del 12%", "Il fatturato è cresciuto del ventuno per cento. Scusate, dodici per cento.");
  });

  it("a paraphrase with no shared words is the model's call, not the guard's", () => {
    const r = ok("Le presentazioni con lo script fanno sembrare che stai leggendo", "La voce diventa piatta e il pubblico se ne accorge.");
    expect(r.lexical).toBeLessThan(0.34);
  });

  it("reports where the evidence is in the transcript", () => {
    const text = "Buongiorno. We hired three engineers in July.";
    const r = ok("We hired 3 engineers", text);
    expect(text.slice(r.evidence!.start, r.evidence!.end)).toBe("We hired three engineers in July.");
  });
});
