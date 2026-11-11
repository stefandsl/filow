// Measures local script translation (apps/web/lib/translateLocal.ts) with models installed in Ollama:
// one fixed Italian outline (3 sections, 13 points) into en, ru, ro, ja and one English outline into
// it. Prints one row per model and language and writes every translation to a folder so a person
// can read them. Results are recorded in docs/TRANSLATE-LOCAL.md. It runs under vitest only because
// vitest loads the app's TypeScript the way the app does; it is not part of the test suite.
//
//   $env:TRANSLATE_BENCH_OUT="<out-dir>"; $env:TRANSLATE_BENCH_MODELS="gemma4:e2b,gemma4:e4b"
//   npx vitest run --config tools/translate-bench/vitest.config.mts
//
// OLLAMA_URL picks the Ollama (default http://127.0.0.1:11434). Only /api/chat is called.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { it } from "vitest";
import { parseScript } from "@filow/core";
import { translateScriptLocal } from "../../apps/web/lib/translateLocal";

export const OUTLINE_IT = `<!-- target: 12 min -->
# Perché nasce Filow (3 min)
- Buongiorno a tutti, sono Marta Bianchi e lavoro in Helinext dal 2019
- Ogni relatore perde il filo almeno una volta: succede anche ai più esperti
- Un gobbo classico scorre da solo e ti costringe a inseguirlo
- Filow ascolta la tua voce e spunta i punti man mano che li dici

# Come funziona (5 min)
- Il riconoscimento vocale gira sul tuo PC, senza inviare l'audio a nessuno
- Scrivi la scaletta in Markdown: un titolo per sezione, un trattino per punto
- Se salti un punto, Filow lo tiene in evidenza finché non lo recuperi
- Il timer ti dice se sei in anticipo o in ritardo rispetto ai 12 minuti previsti
- Funziona anche con PowerPoint: le slide avanzano quando chiudi la sezione

# Prossimi passi (4 min)
- La versione 1.8 arriva a gennaio con la traduzione in locale
- Il 70% dei tester ha chiesto il supporto per il giapponese
- Scriveteci a supporto@filow.app per provare la beta
- Grazie dell'attenzione: ci sono domande?`;

export const OUTLINE_EN = `<!-- target: 12 min -->
# Why Filow exists (3 min)
- Good morning everyone, I am Marta Bianchi and I have worked at Helinext since 2019
- Every speaker loses the thread at least once: it happens to the most experienced too
- A classic teleprompter scrolls by itself and makes you chase it
- Filow listens to your voice and ticks off the points as you say them

# How it works (5 min)
- Speech recognition runs on your PC, without sending the audio to anyone
- Write the outline in Markdown: one title per section, one dash per point
- If you skip a point, Filow keeps it highlighted until you come back to it
- The timer tells you whether you are ahead of or behind the planned 12 minutes
- It works with PowerPoint too: the slides advance when you close the section

# Next steps (4 min)
- Version 1.8 arrives in January with translation on this PC
- 70% of the testers asked for Japanese support
- Write to support@filow.app to try the beta
- Thank you for your attention: any questions?`;

const LANG: Record<string, string> = { en: "English", it: "Italian", ru: "Russian", ro: "Romanian", ja: "Japanese" };
const JOBS: Array<{ from: "it" | "en"; to: string }> = [
  { from: "it", to: "en" },
  { from: "it", to: "ru" },
  { from: "it", to: "ro" },
  { from: "it", to: "ja" },
  { from: "en", to: "it" },
];
/** Things a translation must carry over untouched. */
const KEEP = ["Marta Bianchi", "Helinext", "2019", "Filow", "Markdown", "PowerPoint", "1.8", "70", "12", "filow.app"];

const outDir = process.env.TRANSLATE_BENCH_OUT ?? "";
const models = (process.env.TRANSLATE_BENCH_MODELS ?? "").split(",").map((m) => m.trim()).filter(Boolean);

it("translates the fixed outlines with every model named", { timeout: 60 * 60_000 }, async () => {
if (!outDir || !models.length) throw new Error("set TRANSLATE_BENCH_OUT and TRANSLATE_BENCH_MODELS");
mkdirSync(outDir, { recursive: true });
const rows: string[] = ["model | pair | seconds | lines kept in source | chunks retried | same as source | names and numbers lost"];
for (const model of models) {
  // load the model first so the first pair's seconds are not the load time
  const t0 = Date.now();
  await translateScriptLocal("# Prova\n- Uno", "English", model).catch((e) => console.error(String(e)));
  console.log(`${model}: loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  for (const job of JOBS) {
    const sourceText = job.from === "it" ? OUTLINE_IT : OUTLINE_EN;
    const source = parseScript(sourceText);
    const started = Date.now();
    try {
      const r = await translateScriptLocal(sourceText, LANG[job.to], model);
      const seconds = (Date.now() - started) / 1000;
      const text = r.text;
      const translated = parseScript(text);
      const src = source.sections.flatMap((s) => [s.title, ...s.bullets.map((b) => b.text)]);
      const out = translated.sections.flatMap((s) => [s.title, ...s.bullets.map((b) => b.text)]);
      const same = out.filter((l, i) => l === src[i]).length - r.untranslated;
      const lost = KEEP.filter((k) => !text.includes(k));
      writeFileSync(path.join(outDir, `${model.replace(/[:/]/g, "_")}.${job.from}-${job.to}.md`), text, "utf8");
      rows.push(`${model} | ${job.from}>${job.to} | ${seconds.toFixed(1)} | ${r.untranslated} | ${r.retried} | ${same} | ${lost.join(", ") || "none"}`);
    } catch (e) {
      rows.push(`${model} | ${job.from}>${job.to} | failed: ${(e as Error).message}`);
    }
    console.log(rows[rows.length - 1]);
  }
}
writeFileSync(path.join(outDir, "rows.txt"), rows.join("\n") + "\n", "utf8");
});
