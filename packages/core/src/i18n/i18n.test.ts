import { expect, it } from "vitest";
import { DICTIONARIES, PLACEHOLDER } from "./index";
const labels = {
 "pair.device": ["Pair device", "Abbina dispositivo"],
 "footer.transcript": ["Transcript", "Trascrizione"],
 "ctl.auto.short": ["Automatic", "Automatico"],
 "mode.off.short": ["Off", "Spento"],
 "mode.slide-change.short": ["Slide change", "Cambio slide"],
 "mode.balanced.short": ["Balanced", "Bilanciato"],
 "mode.realtime.short": ["Real-time", "Tempo reale"],
 "screen.scan": ["Scan", "Scansiona"],
 "ctl.mode": ["Mode", "Modalità"],
 "ctl.more": ["More", "Altro"], "ctl.logReport": ["Log and report a problem", "Registro e segnalazione"],
 "nav.scriptTitle": ["The script", "Il copione"], "nav.sections": ["{n} sections", "{n} sezioni"],
 "section.counter": ["Section {n} of {m}", "Sezione {n} di {m}"], "section.points": ["{n} points to cover", "{n} punti da trattare"],
 "next.label": ["Next section", "Prossima sezione"], "state.waiting": ["Waiting", "In attesa"], "state.active": ["In progress", "In corso"],
 "state.done": ["Said", "Detto"], "status.thisComputer": ["This computer", "Questo computer"], "screen.inactive": ["Not active", "Non attivo"], "screen.active": ["Active", "Attivo"]
};
it("ships every flat-layout label in English and Italian", () => {
 for (const [key, values] of Object.entries(labels)) {
   expect((DICTIONARIES.en as Record<string,string>)[key]).toBe(values[0]);
   expect((DICTIONARIES.it as Record<string,string>)[key]).toBe(values[1]);
   expect(values.join()).not.toContain(String.fromCharCode(0x2014));
 }
});

// Scorecard item I18N-01 (docs/autoloop/STANDARDS.md): every translation has every English key, no
// empty text (t() only falls back to English when a key is absent, so "" would show a blank label),
// and the same {placeholders} as English, read with the same pattern t() substitutes.
it("gives every language every key with matching placeholders", () => {
 // Placeholder names, sorted, duplicates kept: "{n} of {m}" -> "m,n".
 const placeholders = (s: string) => [...s.matchAll(PLACEHOLDER)].map((m) => m[1]).sort().join(",");
 const en = DICTIONARIES.en as Record<string, string>;
 for (const [lang, dict] of Object.entries(DICTIONARIES) as [string, Record<string, string | undefined>][]) {
   if (lang === "en") continue;
   expect(Object.keys(en).filter((k) => !(k in dict)), `${lang} is missing keys`).toEqual([]);
   expect(Object.keys(dict).filter((k) => !(k in en)), `${lang} has keys English lacks`).toEqual([]);
   expect(Object.keys(dict).filter((k) => !dict[k]?.trim()), `${lang} has empty text`).toEqual([]);
   const wrong = Object.keys(en).filter((k) => placeholders(en[k]) !== placeholders(dict[k] ?? ""));
   expect(wrong.map((k) => `${k}: en {${placeholders(en[k])}} vs ${lang} {${placeholders(dict[k] ?? "")}}`), `${lang} placeholders differ`).toEqual([]);
 }
});

// Typography each language keeps: Romanian comma-below letters, Japanese full-width punctuation and brackets.
it("keeps each language's own typography", () => {
 const ro = DICTIONARIES.ro as Record<string, string>, ja = DICTIONARIES.ja as Record<string, string>;
 expect(Object.keys(ro).filter((k) => /[\u015E\u015F\u0162\u0163]/.test(ro[k]))).toEqual([]);
 expect(Object.keys(ja).filter((k) => /[\u3041-\u30FF\u4E00-\u9FFF][.,] /.test(ja[k]))).toEqual([]);
 expect(Object.keys(ja).filter((k) => /[\u3041-\u30FF\u4E00-\u9FFF][()]|[()][\u3041-\u30FF\u4E00-\u9FFF]/.test(ja[k]))).toEqual([]);
});
