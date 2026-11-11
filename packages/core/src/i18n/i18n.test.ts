import { expect, it } from "vitest";
import { DICTIONARIES, PLACEHOLDER } from "./index";
import { EASY_CONTROLS } from "../easy";
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

// Easy settings: the eight controls an ordinary person sees first. Their texts use everyday words:
// no technical term, product or company name, in any language. "PC" and "Windows" are everyday words.
const EASY_JARGON: RegExp[] = [
 /\b(models?|gpus?|cpu|v?ram|ollama|api|llm|cloud|open ?router|free ?llm\w*|whisper|clef|gemma|backend|providers?|hotkeys?|runtime|tokens?|server|offline|\.env|cloudflare|elevenlabs|openai|superwhisper|nemotron|sherpa|tts|stt)\b/i,
 /\bAI\b/, // capitals only: "ai" is an everyday Romanian word
 /\b(modell[oi]|fornitor[ei]|scheda grafica|memoria video|modelul?|modele(le)?|furnizor\w*|plac[aă] video)\b/i,
 /модел|облак|облач|провайдер|видеокарт|видеопамят|сервер|оперативн|нейросет|(^|[^а-яё])ии([^а-яё]|$)/i,
 /モデル|クラウド|プロバイダ|ランタイム|バックエンド|ホットキー|サーバー|グラフィック|メモリ|ＡＩ|人工知能/,
];
it("keeps every Easy settings text free of technical terms, in all five languages", () => {
 const found: string[] = [];
 let checked = 0;
 for (const [lang, dict] of Object.entries(DICTIONARIES) as [string, Record<string, string>][]) {
   for (const [key, text] of Object.entries(dict)) {
     if (!key.startsWith("easy.")) continue;
     checked++;
     const plain = text.replace(PLACEHOLDER, " ");
     for (const re of EASY_JARGON) { const m = plain.match(re); if (m) found.push(`${lang} ${key}: "${m[0]}"`); }
     if (text.includes(String.fromCharCode(0x2014))) found.push(`${lang} ${key}: em dash`);
   }
 }
 expect(found).toEqual([]);
 expect(checked).toBe(5 * 25);
});
it("has a label and a one-line description for each of the eight Easy controls, and the shared words", () => {
 const en = DICTIONARIES.en as Record<string, string>;
 for (const control of EASY_CONTROLS) {
   expect(en[`easy.${control}`], control).toBeTruthy();
   expect(en[`easy.${control}.desc`], control).toMatch(/^[A-Z][^\n]{20,160}\.$/);
 }
 expect([en["easy.custom"], en["easy.chosen"], en["easy.reset"], en["easy.on"], en["easy.off"]]).toEqual(["Custom", "Chosen for this PC", "Reset to recommended", "On", "Off"]);
 expect(EASY_CONTROLS.map((c) => en[`easy.${c}`])).toEqual(["Keep it on this PC", "Look at my screen", "Answer out loud", "Dictate into any app", "Tidy up what I dictate", "Speed or quality", "Language", "Start with Windows"]);
});

// Typography each language keeps: Romanian comma-below letters, Japanese full-width punctuation and brackets.
it("keeps each language's own typography", () => {
 const ro = DICTIONARIES.ro as Record<string, string>, ja = DICTIONARIES.ja as Record<string, string>;
 expect(Object.keys(ro).filter((k) => /[\u015E\u015F\u0162\u0163]/.test(ro[k]))).toEqual([]);
 expect(Object.keys(ja).filter((k) => /[\u3041-\u30FF\u4E00-\u9FFF][.,] /.test(ja[k]))).toEqual([]);
 expect(Object.keys(ja).filter((k) => /[\u3041-\u30FF\u4E00-\u9FFF][()]|[()][\u3041-\u30FF\u4E00-\u9FFF]/.test(ja[k]))).toEqual([]);
});
