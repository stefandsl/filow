// Per-browser preferences (not secrets). Server-side defaults come from env.
import { isLang, langFromLocale, type DecisionProviderId, type Lang, type ScreenMode } from "@intelliprompter/core";

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

// ---- Screen Sense cost dial (ARCHITECTURE.md §6.5) ----
const SCREEN_KEY = "prefs:screenMode";

export function getScreenMode(): ScreenMode {
  try {
    const v = localStorage.getItem(SCREEN_KEY);
    return v === "off" || v === "slide-change" || v === "balanced" || v === "realtime" ? v : "balanced";
  } catch {
    return "balanced";
  }
}

export function setScreenMode(mode: ScreenMode): void {
  try {
    localStorage.setItem(SCREEN_KEY, mode);
  } catch {
    /* ignore */
  }
}

// ---- UI language ----
const LANG_KEY = "prefs:lang";

/** Stored choice, else the browser locale. */
export function getLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (isLang(v)) return v;
  } catch {
    /* ignore */
  }
  return typeof navigator !== "undefined" ? langFromLocale(navigator.language) : "en";
}

export function setLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* ignore */
  }
  (globalThis as { intelliprompter?: { setLang?: (l: Lang) => void } }).intelliprompter?.setLang?.(lang);
}
