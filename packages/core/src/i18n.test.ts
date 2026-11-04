import { expect, it } from "vitest";
import { DICTIONARIES } from "./i18n";
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
