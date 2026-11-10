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

describe("claim guard: Russian", () => {
  it("blocks the opposite direction, a denial, a wrong number and a wrong unit", () => {
    expect(blocked("Расходы на поддержку снизились на 30%", "Расходы на поддержку выросли на тридцать процентов в этом квартале, в основном из-за переработок.").conflict?.kind).toBe("direction");
    expect(blocked("Мы сократили время подключения клиента", "Мы не сократили время подключения клиента, оно по-прежнему две недели.").conflict?.kind).toBe("negation");
    expect(blocked("Мы повысим цены в январе", "Мы не повысим цены в январе, держим их до весны.").conflict?.kind).toBe("negation");
    expect(blocked("Отток упал до 4%", "Отток упал до четырнадцати процентов, и это не то, чего мы хотим.").conflict?.kind).toBe("number");
    expect(blocked("Передадим мобильное приложение 50 пилотным клиентам", "Сначала передадим мобильное приложение пятнадцати пилотным клиентам, потом всем остальным.").conflict?.kind).toBe("number");
    expect(blocked("Среднее время ответа составляет 4 часа", "Среднее время ответа составляет четыре дня, и это наша главная проблема.").ok).toBe(false);
  });

  it("passes the same claims said truthfully, numbers spelled out in any case", () => {
    expect(blocked("Расходы на поддержку снизились на 30%", "Расходы на поддержку снизились на тридцать процентов в этом квартале.").ok).toBe(true);
    expect(blocked("Отток упал до 4%", "Отток упал до четырёх процентов.").ok).toBe(true);
    expect(blocked("Индекс лояльности клиентов равен 62", "Индекс лояльности клиентов теперь равен шестидесяти двум, в прошлом квартале было пятьдесят пять.").ok).toBe(true);
    expect(blocked("Мы наняли 3 инженеров", "В июле мы наняли трёх инженеров, все они работают в поддержке.").ok).toBe(true);
    expect(blocked("Среднее время ответа составляет 4 часа", "Среднее время ответа составляет четыре часа.").ok).toBe(true);
    expect(blocked("Передадим мобильное приложение 50 пилотным клиентам", "Передадим мобильное приложение пятидесяти пилотным клиентам.").ok).toBe(true);
    expect(blocked("Все данные клиентов остаются на наших серверах", "Все данные клиентов остаются на наших серверах, ничего не уходит в чужое облако.").ok).toBe(true);
  });

  it("'не только' and a contrast after 'а' are not denials of the point", () => {
    expect(blocked("Выручка выросла", "Не только выручка выросла, но и прибыль.").ok).toBe(true);
    expect(blocked("Выручка выросла", "Выручка выросла, а расходы упали.").ok).toBe(true);
  });
});

describe("claim guard: Romanian, with and without diacritics", () => {
  it("blocks the opposite direction, a denial, a wrong number and a wrong unit", () => {
    expect(blocked("Costurile de suport au scăzut cu 30%", "Costurile de suport au crescut cu treizeci la sută în acest trimestru, mai ales din cauza orelor suplimentare.").conflict?.kind).toBe("direction");
    expect(blocked("Costurile de suport au scăzut cu 30%", "Costurile de suport au crescut cu treizeci la suta in acest trimestru.").conflict?.kind).toBe("direction");
    expect(blocked("Am redus timpul de integrare a clienților", "Nu am redus timpul de integrare a clienților, este tot două săptămâni.").conflict?.kind).toBe("negation");
    expect(blocked("Vom majora prețurile în ianuarie", "Nu vom majora preturile in ianuarie, le pastram pana in primavara.").conflict?.kind).toBe("negation");
    expect(blocked("Veniturile au crescut", "Veniturile nu au mai crescut.").conflict?.kind).toBe("negation");
    expect(blocked("Rata de renunțare a scăzut la 4%", "Rata de renunțare a scăzut la paisprezece la sută, ceea ce nu ne mulțumește.").conflict?.kind).toBe("number");
    expect(blocked("Livrăm aplicația mobilă către 50 de clienți pilot", "Livrăm aplicația mobilă mai întâi către cincisprezece clienți pilot, apoi tuturor.").conflict?.kind).toBe("number");
    expect(blocked("Timpul mediu de răspuns este de 4 ore", "Timpul mediu de răspuns este de patru zile, iar asta este cea mai mare problemă a noastră.").ok).toBe(false);
  });

  it("passes the same claims said truthfully, typed without diacritics too", () => {
    expect(blocked("Costurile de suport au scăzut cu 30%", "Costurile de suport au scazut cu treizeci la suta in acest trimestru.").ok).toBe(true);
    expect(blocked("Am redus timpul de integrare a clienților", "Am redus timpul de integrare a clientilor la o saptamana.").ok).toBe(true);
    expect(blocked("Rata de renunțare a scăzut la 4%", "Rata de renuntare a scazut la patru la suta.").ok).toBe(true);
    expect(blocked("Scorul de satisfacție este 62", "Scorul de satisfacție este acum șaizeci și doi, față de cincizeci și cinci în trimestrul trecut.").ok).toBe(true);
    expect(blocked("Am angajat 3 ingineri", "În iulie am angajat trei ingineri, toți la suport.").ok).toBe(true);
    expect(blocked("Timpul mediu de răspuns este de 4 ore", "Timpul mediu de raspuns este de patru ore.").ok).toBe(true);
    expect(blocked("Livrăm aplicația mobilă către 50 de clienți pilot", "Livram aplicatia mobila catre cincizeci de clienti pilot.").ok).toBe(true);
  });

  it("'mai' is the month, 'more' or 'first', not a denial, and a contrast after 'dar' stands", () => {
    expect(blocked("Biroul din Cluj se deschide în mai", "Mai întâi vestea bună: biroul din Cluj se deschide în mai.").ok).toBe(true);
    expect(blocked("Veniturile au crescut", "Cel mai mare client a plecat, dar veniturile au crescut.").ok).toBe(true);
  });
});

describe("claim guard: Japanese, as a recogniser writes it (no punctuation, kanji numerals)", () => {
  it("blocks the opposite direction, a denial in the verb ending, a wrong number and a wrong unit", () => {
    expect(blocked("サポートコストは30%減少しました", "サポートコストは今四半期三十パーセント増加しました").conflict?.kind).toBe("direction");
    expect(blocked("オンボーディング期間を短縮しました", "オンボーディング期間は短縮していません").conflict?.kind).toBe("negation");
    expect(blocked("エンジニアを3人採用しました", "エンジニアは採用していません").conflict?.kind).toBe("negation");
    expect(blocked("1月に価格を上げます", "一月に価格は上げません").conflict?.kind).toBe("negation");
    expect(blocked("解約率は4%に下がりました", "解約率は十四パーセントに下がりました").conflict?.kind).toBe("number");
    expect(blocked("モバイルアプリを50社のパイロット顧客に提供します", "モバイルアプリをまず十五社のパイロット顧客に提供します").conflict?.kind).toBe("number");
    expect(blocked("平均応答時間は4時間です", "平均応答時間は四日です").ok).toBe(false);
  });

  it("passes the same claims said truthfully", () => {
    expect(blocked("サポートコストは30%減少しました", "サポートコストは今四半期三十パーセント減少しました").ok).toBe(true);
    expect(blocked("オンボーディング期間を短縮しました", "オンボーディング期間を一週間に短縮しました").ok).toBe(true);
    expect(blocked("解約率は4%に下がりました", "解約率は四パーセントに下がりました").ok).toBe(true);
    expect(blocked("顧客満足度スコアは62です", "顧客満足度スコアは六十二です").ok).toBe(true);
    expect(blocked("エンジニアを3人採用しました", "七月にエンジニアを三人採用しました").ok).toBe(true);
    expect(blocked("平均応答時間は4時間です", "平均応答時間は四時間です").ok).toBe(true);
    expect(blocked("モバイルアプリを50社のパイロット顧客に提供します", "モバイルアプリを五十社のパイロット顧客に提供します").ok).toBe(true);
    expect(blocked("大阪オフィスは5月に開設します", "まず良い知らせです 大阪オフィスは五月に開設します").ok).toBe(true);
  });

  it("endings that look like a denial but are not: かもしれません, なければなりません", () => {
    expect(blocked("売上は増えました", "売上は増えるかもしれません").conflict?.kind).not.toBe("negation");
    expect(blocked("値上げします", "値上げしなければなりません").ok).toBe(true);
  });

  it("a negated point said without its negation is blocked, said with it passes", () => {
    expect(blocked("値上げはしません", "値上げします").conflict?.kind).toBe("negation");
    expect(blocked("値上げはしません", "値上げはしません").ok).toBe(true);
  });
});

describe("claim guard: the new word lists leave Italian and English alone", () => {
  it("Italian 'scade' (expires) and 'tripla A' are not directions, 'dar' and 'mai' keep their Italian reading", () => {
    expect(blocked("Il contratto scade a maggio", "Il contratto scade a maggio e lo rinnoviamo.").ok).toBe(true);
    expect(blocked("Abbiamo il rating tripla A", "Abbiamo ottenuto il rating tripla A a marzo.").ok).toBe(true);
    expect(blocked("Non abbiamo mai perso un cliente", "Non abbiamo mai perso un cliente in dieci anni.").ok).toBe(true);
    expect(blocked("Vogliamo dar voce ai clienti", "Vogliamo dar voce ai clienti con un sondaggio.").ok).toBe(true);
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
