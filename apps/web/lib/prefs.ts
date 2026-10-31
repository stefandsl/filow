// Per-browser preferences (not secrets). Server-side defaults come from env.
import type { DecisionProviderId } from "@intelliprompter/core";

const KEY = "prefs:decisionProvider";

export function getDecisionProvider(): DecisionProviderId | undefined {
  try {
    const v = localStorage.getItem(KEY);
    return v === "openrouter" || v === "clef-local" || v === "clef-cloudflare" ? v : undefined;
  } catch {
    return undefined;
  }
}

export function setDecisionProvider(id: DecisionProviderId | ""): void {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export const PROVIDER_LABELS: Record<DecisionProviderId, string> = {
  openrouter: "OpenRouter (cloud)",
  "clef-local": "Clef on this machine (Ollama)",
  "clef-cloudflare": "Clef on Cloudflare Workers AI",
};
