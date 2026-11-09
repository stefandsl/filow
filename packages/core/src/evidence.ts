// "Why is this done?" (P1 step 5): the human-readable lines of a point's evidence record, shared by
// the prompter (apps/web PointsList) and the stage view (PowerPoint, browser side panel).
import { t, type Lang } from "./i18n";
import type { Evidence } from "./types";

const pct = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 100);
const clock = (ms: number, lang: Lang) => new Date(ms).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function explainEvidence(evidence: Evidence, lang: Lang): { title: string; quote?: string; lines: string[] } {
  const title = t("why.title", lang);
  if (evidence.source === "manual") return { title, lines: [t("why.manual", lang, { t: clock(evidence.fromMs, lang) })] };
  const from = clock(evidence.fromMs, lang);
  const to = clock(evidence.toMs, lang);
  return {
    title,
    quote: evidence.quote,
    lines: [
      from === to ? t("why.heard", lang, { t: from }) : t("why.heardRange", lang, { from, to }),
      t("why.model", lang, { model: evidence.model, pct: pct(evidence.decision) }),
      t("why.words", lang, { pct: pct(evidence.lexical) }),
      ...(evidence.gate !== undefined ? [t("why.gate", lang, { pct: pct(evidence.gate) })] : []),
    ],
  };
}

/** One plain-text block for a hover tooltip. */
export function evidenceSummary(evidence: Evidence, lang: Lang): string {
  const { title, quote, lines } = explainEvidence(evidence, lang);
  return [title, quote ? `"${quote}"` : "", ...lines].filter(Boolean).join("\n");
}
