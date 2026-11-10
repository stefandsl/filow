import fs from "node:fs";
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

// Adversarial cases from the independent review of the P1 branch (all failed before the fix).
describe("claim guard: review findings", () => {
  const verdict = (point: string, said: string) => checkClaim(point, said).ok;

  it("blocks contradictions that used to pass", () => {
    expect(verdict("Support costs fell 30% this quarter", "Let's talk about support costs this quarter. Support costs rose thirty percent.")).toBe(false);
    expect(verdict("I costi operativi sono calati del 30%", "Parliamo dei costi operativi. I costi operativi sono aumentati del trenta per cento.")).toBe(false);
    expect(verdict("Support costs fell 30%", "Support costs fell thirty percent. Sorry, I misread: support costs rose thirty percent.")).toBe(false);
    expect(verdict("Churn dropped to 4.5%", "Churn dropped to 14.5%.")).toBe(false);
    expect(verdict("Abbiamo 2.000 clienti attivi", "Abbiamo 3.000 clienti attivi.")).toBe(false);
    expect(verdict("We have 2,000 users", "We have twenty thousand users.")).toBe(false);
    expect(verdict("Non usiamo il cloud per i dati", "Usiamo il cloud per i dati, non i server locali.")).toBe(false);
    expect(verdict("Abbiamo tagliato i tempi di consegna", "Non siamo riusciti a tagliare i tempi di consegna.")).toBe(false);
    expect(verdict("We reduced support costs", "We failed to reduce support costs.")).toBe(false);
    expect(verdict("We reduced support costs", "We didn't manage to reduce support costs.")).toBe(false);
  });

  it("passes true points that used to be blocked", () => {
    expect(verdict("Abbiamo 1.200 clienti attivi", "Abbiamo 1.200 clienti attivi.")).toBe(true);
    expect(verdict("We have 2,500 users", "We have two thousand five hundred users.")).toBe(true);
    expect(verdict("Revenue reached 1.2 million euro", "Revenue reached one million two hundred thousand euro.")).toBe(true);
    expect(verdict("Abbiamo 1500 clienti", "Abbiamo mille e cinquecento clienti.")).toBe(true);
    expect(verdict("Il tempo medio di risposta è di 2,5 ore", "Il tempo medio di risposta è di due ore e mezza.")).toBe(true);
    expect(verdict("Il margine è passato dal 20% al 25%", "Il margine è passato dal 20 al 25 per cento.")).toBe(true);
    expect(verdict("Margin went from 20% to 25%", "Margin went from 20 to 25 percent.")).toBe(true);
    expect(verdict("Ship the app to 50 pilot customers in 3 cities", "We ship the app to 50 pilot customers.")).toBe(true);
    expect(verdict("Abbiamo raddoppiato i clienti", "Come mai abbiamo raddoppiato i clienti? Ve lo spiego.")).toBe(true);
    expect(verdict("Oggi serve investire nella formazione", "Oggi più che mai serve investire nella formazione.")).toBe(true);
    expect(verdict("We cut the onboarding time", "Don't forget we cut the onboarding time in half.")).toBe(true);
    expect(verdict("Abbiamo tagliato i tempi di consegna", "Non dimentichiamo che abbiamo tagliato i tempi di consegna.")).toBe(true);
    expect(verdict("We cut the onboarding time", "Nobody expected us to cut the onboarding time.")).toBe(true);
    expect(verdict("We cut onboarding time", "We cut onboarding time and no customer complained.")).toBe(true);
    expect(verdict("Launch the spring sale", "We launch the spring sale and lower prices on old stock.")).toBe(true);
    expect(verdict("Set up a support team", "We created a support team to cut waiting times.")).toBe(true);
    expect(verdict("Revenue grew 12%", "Revenue jumped 12 percent while support costs dropped.")).toBe(true);
    expect(verdict("Non usiamo il cloud", "Lavoriamo senza cloud, tutto in locale.")).toBe(true);
  });
});

describe("claim guard: counts are compared only for the same counted thing", () => {
  it("'dieci aziende' is not a wrong number for '450 clienti' (traps-it, a later sentence)", () => {
    expect(checkClaim("Abbiamo 450 clienti attivi", "Oggi abbiamo quattrocentocinquanta clienti attivi. In autunno lanceremo l'app mobile per i clienti, già in prova con dieci aziende.").ok).toBe(true);
  });
  it("the same counted thing with another number still conflicts", () => {
    expect(checkClaim("Abbiamo 450 clienti attivi", "Abbiamo quaranta clienti attivi.").ok).toBe(false);
  });
});

describe("claim guard: contrast tails are not negated claims", () => {
  it("', non alla tua' after a pause is a contrast (demo-it s1b2, blocked by the first reviewed guard)", () => {
    expect(checkClaim("Il gobbo tradizionale scorre alla sua velocità, non alla tua", "Il gobbo classico, quello che scorre, non risolve: va alla sua velocità, non alla tua, e tu lo insegui.").ok).toBe(true);
    expect(checkClaim("Prices follow the market, not our costs", "Our prices follow the market and nothing else.").ok).toBe(true);
  });
  it("a point that starts with its negation is still a negated claim", () => {
    expect(checkClaim("Non usiamo il cloud per i dati", "Usiamo il cloud per i dati, non i server locali.").ok).toBe(false);
  });
});

describe("claim guard: the latest sentence that states the claim decides", () => {
  it("a later sentence about another subject with the same verb does not undo a stated claim", () => {
    expect(checkClaim("Il fatturato è cresciuto del 12%", "Il fatturato è cresciuto del 12 per cento. Il margine è cresciuto del 5 per cento.").ok).toBe(true);
  });
  it("a topic mention after the claim keeps the claim as evidence", () => {
    const r = checkClaim("Support costs fell 30% this quarter", "Support costs fell thirty percent this quarter. Support costs are a big topic for us.");
    expect(r.ok).toBe(true);
    expect(r.evidence?.text).toBe("Support costs fell thirty percent this quarter.");
  });
});

describe("claim guard: short topic labels (TRK-2)", () => {
  it("a label denied with the verb of its noun (chiusura, non chiudiamo) is blocked (topics-it s2b1)", () => {
    const r = checkClaim("Chiusura estiva ad agosto", "Quest'estate non chiudiamo ad agosto, restiamo aperti.");
    expect(r.ok).toBe(false);
    expect(r.conflict?.kind).toBe("negation");
  });
  it("a label said plainly still passes, also in the future tense", () => {
    expect(checkClaim("Bristol pilot", "The Bristol pilot will start with one small customer group.").ok).toBe(true);
    expect(checkClaim("Chiusura estiva ad agosto", "La chiusura estiva sarà ad agosto, come ogni anno.").ok).toBe(true);
    expect(checkClaim("Launch date Monday", "The launch date is Monday, giving us the weekend to finish preparation.").ok).toBe(true);
  });
  it("a negation about something else in a sentence that shares one word does not block", () => {
    expect(checkClaim("Programma fedeltà", "Il programma di oggi non prevede pause.").ok).toBe(true);
    expect(checkClaim("Weekly review", "We do not have time for questions, so the weekly review comes next.").ok).toBe(true);
  });
});

describe("claim guard: one shared word out of three is not a denial (TRK-2 review)", () => {
  // True points an independent review found blocked when the relevance threshold was lowered to 0.33.
  const pass: Array<[string, string]> = [
    ["Launch date Monday", "We will not ship anything before Monday, that is when we go live."],
    ["Chiusura estiva ad agosto", "Non accetteremo ordini ad agosto, andiamo tutti in ferie per tre settimane."],
    ["Customer survey results", "We never got a survey back this positive: nine out of ten people would recommend us."],
    ["Nuovo orario di apertura", "Non abbiamo mai avuto un orario così comodo: da lunedì si apre alle otto e mezza."],
  ];
  it.each(pass)("%s / %s passes", (point, said) => {
    expect(checkClaim(point, said).ok).toBe(true);
  });
});

describe("claim guard: true points said with a negation, guard probes (ratchet)", () => {
  // docs/gauntlet/adversarial/cases.json, guardProbes: sentences a careful human counts as covering the
  // point, each with a negation that does not deny it. The guard must not block them. The ones it still
  // blocks are listed here so the cost stays visible: fixing one must remove it from this list, and a
  // change that blocks another one fails.
  const KNOWN_BLOCKED = [
    "Inventario di fine anno | Il ventotto non voglio vedere ferie a fine dicembre: contiamo tutto il magazzino.",
    "Hiring plan for Q2 | We have never had a plan this ambitious: five people between April and June.",
    "Programma fedeltà | Non perdete i punti del programma: ogni dieci euro un punto, e valgono un anno.",
  ];
  it("blocks only the known ones", () => {
    const { guardProbes } = JSON.parse(fs.readFileSync(new URL("../../../docs/gauntlet/adversarial/cases.json", import.meta.url), "utf8")) as { guardProbes: { point: string; said: string }[] };
    expect(guardProbes.length).toBeGreaterThanOrEqual(16);
    const blocked = guardProbes.filter((p) => !checkClaim(p.point, p.said).ok).map((p) => `${p.point} | ${p.said}`);
    expect(blocked).toEqual(KNOWN_BLOCKED);
  });
});
