// Builds the FIXED AR-1 question set once: 60 questions per language (en, it, ru, ro, ja) on the
// 40 synthetic pointing screens (tools/eval/latency-screen.html, rendered to G:/FILOW/tmp/latency/screens).
// Target labels stay as they are on the screen (English). The split (30 dev, 30 held out) is fixed by SEED.
// Run once: node tools/autoresearch/ar1/build-questions.mjs  (writes questions.json next to this file).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SEED = 20261114;
const ELEMENTS = ["Pay now", "Save draft", "Send reminder", "Customer name", "Invoice total"];
const KINDS = ["where", "show", "what"];
const isField = (x) => x === "Customer name" || x === "Invoice total";

// One template per language and kind. English is the source; the others are translations of it.
const T = {
  en: { where: (x, f) => `Where is the ${x} ${f ? "field" : "button"}?`, show: (x, f) => `Show me the ${x} ${f ? "field" : "button"}.`, what: (x, f) => `What does the ${x} ${f ? "field" : "button"} do?` },
  it: { where: (x, f) => `Dov'è il ${f ? "campo" : "pulsante"} ${x}?`, show: (x, f) => `Mostrami il ${f ? "campo" : "pulsante"} ${x}.`, what: (x, f) => `A cosa serve il ${f ? "campo" : "pulsante"} ${x}?` },
  ru: { where: (x, f) => `Где ${f ? "поле" : "кнопка"} ${x}?`, show: (x, f) => `Покажи ${f ? "поле" : "кнопку"} ${x}.`, what: (x, f) => `Для чего ${f ? "поле" : "кнопка"} ${x}?` },
  ro: { where: (x, f) => `Unde este ${f ? "câmpul" : "butonul"} ${x}?`, show: (x, f) => `Arată-mi ${f ? "câmpul" : "butonul"} ${x}.`, what: (x, f) => `La ce folosește ${f ? "câmpul" : "butonul"} ${x}?` },
  ja: { where: (x, f) => `${x} ${f ? "欄" : "ボタン"}はどこですか？`, show: (x, f) => `${x} ${f ? "欄" : "ボタン"}を見せてください。`, what: (x, f) => `${x} ${f ? "欄" : "ボタン"}は何のためのものですか？` },
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const shuffle = (list, rnd) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export function buildQuestions() {
  const rnd = mulberry32(SEED);
  const elements = shuffle(Array.from({ length: 60 }, (_, i) => ELEMENTS[i % 5]), rnd);
  const order = shuffle(Array.from({ length: 60 }, (_, i) => i), rnd);
  const dev = new Set(order.slice(0, 30));
  const items = Array.from({ length: 60 }, (_, id) => {
    const element = elements[id];
    const kind = KINDS[id % 3];
    const text = Object.fromEntries(Object.entries(T).map(([lang, t]) => [lang, t[kind](element, isField(element))]));
    return { id, screen: (id % 40) + 1, element, kind, split: dev.has(id) ? "dev" : "heldout", text };
  });
  return { seed: SEED, languages: Object.keys(T), note: "Built by build-questions.mjs. Do not edit by hand.", items };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "questions.json");
  fs.writeFileSync(out, JSON.stringify(buildQuestions(), null, 1) + "\n");
  console.log(`wrote ${out}`);
}
