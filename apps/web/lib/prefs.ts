// Per-browser preferences (not secrets). Server-side defaults come from env.
import { isLang, isSetupPreference, langFromLocale, type DecisionProviderId, type Lang, type ScreenMode, type SetupPreference } from "@filow/core";
import { acceptUiSnapshot, type UiLanguage, type UiSnapshot, type UiPatch } from "@filow/core";
import { desktopBridge, type DesktopBridge } from "./sessionUrl";

let desktopState: UiSnapshot | null = null;
let uiError: "ui.saveError" | "ui.startupError" | null = null;
const uiListeners = new Set<() => void>();
export function subscribeUiPreferences(fn: () => void) { uiListeners.add(fn); return () => { uiListeners.delete(fn); }; }
export function notifyUiPreferences() { uiListeners.forEach(fn => fn()); }
export function getDesktopPreferences() { return desktopState; }
export function getUiError() { return uiError; }
export function receiveUiPreferences(next: UiSnapshot) {
  const accepted = acceptUiSnapshot(desktopState, next);
  if (accepted === desktopState) return;
  desktopState = accepted;
  try {
    if (accepted.lang) localStorage.setItem("prefs:lang", accepted.lang);
    else localStorage.removeItem("prefs:lang");
    localStorage.setItem("prefs:theme", accepted.theme);
  } catch { /* persistence in the desktop profile is authoritative */ }
  notifyUiPreferences();
}
export function legacyUiPreferences(storage: Pick<Storage, "getItem">): UiPatch {
  const lang = storage.getItem("prefs:lang"), theme = storage.getItem("prefs:theme");
  return { ...(isLang(lang) ? { lang } : {}), ...(theme === "light" || theme === "dark" || theme === "system" ? { theme } : {}) };
}
/** One subscription per root; cancellation also ignores outstanding initial IPC replies. */
export function connectDesktopPreferences(bridge: Pick<DesktopBridge, "getPreferences" | "onPreferencesChanged" | "migrateUiPreferences">, ready: () => void, failure: () => void): () => void {
  let active = true;
  let legacy: UiPatch = {};
  try { legacy = legacyUiPreferences(localStorage); } catch { /* browser storage may be disabled */ }
  const unsubscribe = bridge.onPreferencesChanged?.(state => { if (active) receiveUiPreferences(state); });
  void (async () => {
    try {
      if (bridge.migrateUiPreferences) {
        const result = await bridge.migrateUiPreferences(legacy);
        if (active) { uiError = result.ok ? null : result.code; receiveUiPreferences(result.state); }
      }
      const initial = await bridge.getPreferences!();
      if (active) { receiveUiPreferences(initial); ready(); }
    } catch { if (active) failure(); }
  })();
  return () => { active = false; unsubscribe?.(); };
}
async function updateDesktopPreferences(patch: UiPatch) {
  try {
    const result = await desktopBridge()!.updatePreferences!(patch);
    uiError = result.ok ? null : result.code;
    receiveUiPreferences(result.state);
  } catch { uiError = "ui.saveError"; }
  notifyUiPreferences();
}

const KEY = "prefs:decisionProvider";

export function getDecisionProvider(): DecisionProviderId | undefined {
  try {
    const v = localStorage.getItem(KEY);
    return v === "openrouter" || v === "clef-local" || v === "clef-cloudflare" || v === "matcher" || v === "freellm" ? v : undefined;
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

// ---- Setup profile (P3): "auto" follows the machine (packages/core/src/profile.ts) ----
const SETUP_KEY = "prefs:setup";

export function getSetupPreference(): SetupPreference {
  try {
    const v = localStorage.getItem(SETUP_KEY);
    return isSetupPreference(v) ? v : "auto";
  } catch {
    return "auto";
  }
}

export function setSetupPreference(p: SetupPreference): void {
  try {
    if (p === "auto") localStorage.removeItem(SETUP_KEY);
    else localStorage.setItem(SETUP_KEY, p);
  } catch {
    /* ignore */
  }
}

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
  if (desktopState) return desktopState.resolvedLang;
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (isLang(v)) return v;
  } catch {
    /* ignore */
  }
  return typeof navigator !== "undefined" ? langFromLocale(navigator.language) : "en";
}

export function getLanguagePref(): UiLanguage {
  if (desktopState) return desktopState.lang;
  try { const value = localStorage.getItem(LANG_KEY); return isLang(value) ? value : ""; } catch { return ""; }
}
export function setLang(lang: UiLanguage): void {
  if (desktopBridge()?.updatePreferences) { void updateDesktopPreferences({ lang }); return; }
  try {
    if (lang) localStorage.setItem(LANG_KEY, lang);
    else localStorage.removeItem(LANG_KEY);
  } catch {
    /* ignore */
  }
  desktopBridge()?.setLang?.(lang);
  notifyUiPreferences();
}

// ---- Theme: system | light | dark ----
export type ThemePref = "system" | "light" | "dark";
const THEME_KEY = "prefs:theme";

export function getThemePref(): ThemePref {
  if (desktopState) return desktopState.theme;
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch {
    return "system";
  }
}

export function setThemePref(t: ThemePref): void {
  if (desktopBridge()?.updatePreferences) { void updateDesktopPreferences({ theme: t }); return; }
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* ignore */
  }
  desktopBridge()?.setTheme?.(t);
  notifyUiPreferences();
}

/** The theme actually shown for a preference, following the OS for "system". */
export function resolveTheme(t: ThemePref): "light" | "dark" {
  if (t !== "system") return t;
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

// ---- Start mode: ask every time, or always cloud / always local ----
export type StartMode = "ask" | "auto" | "cloud" | "local";
const START_KEY = "prefs:startMode";

// ---- Speech language: what the speaker talks, independent of the interface language ----
export type SpeechLang = "auto" | "en" | "it" | "ru" | "ro" | "ja";
export const SPEECH_LANGS: SpeechLang[] = ["auto", "en", "it", "ru", "ro", "ja"];
const SPEECH_KEY = "prefs:speechLang";

export function getSpeechLang(): SpeechLang {
  try {
    const v = localStorage.getItem(SPEECH_KEY);
    return (SPEECH_LANGS as string[]).includes(v ?? "") ? (v as SpeechLang) : "auto";
  } catch {
    return "auto";
  }
}

export function setSpeechLang(l: SpeechLang): void {
  try {
    if (l === "auto") localStorage.removeItem(SPEECH_KEY);
    else localStorage.setItem(SPEECH_KEY, l);
  } catch {
    /* ignore */
  }
}

/** The hint handed to the transcription backends: the explicit speech language, else the UI language. */
export function speechLangFor(uiLang: string): string {
  const s = getSpeechLang();
  return s === "auto" ? uiLang : s;
}

export function getStartMode(): StartMode {
  try {
    const v = localStorage.getItem(START_KEY);
    return v === "cloud" || v === "local" || v === "auto" ? v : "ask";
  } catch {
    return "ask";
  }
}

export function setStartMode(m: StartMode): void {
  try {
    if (m === "ask") localStorage.removeItem(START_KEY);
    else localStorage.setItem(START_KEY, m);
  } catch {
    /* ignore */
  }
}

// ---- Gate: embedding pre-filter in front of the decision model (packages/core/src/gate.ts) ----
// On by default since the setup profiles (P3): every profile uses it, and with local Clef it only
// skips calls (P1: same recall, 4 of 62 calls saved). "off" stays available under More options.
// The gate's width (narrow, or only skipping calls) follows the decision provider of the take
// (gateThresholdsFor), which is what each setup's `gate.narrow` describes: Best quality decides with
// Clef (skip only), and with the matcher (Lite, Balanced, or Best quality before Clef is downloaded)
// the matcher's scores decide and the width does not apply. profile.test.ts checks the two agree.
export type GateMode = "off" | "on";
const GATE_KEY = "prefs:gate";
/** Set once the stored gate value follows the on-by-default rule (see migrateGateMode). */
const GATE_MIGRATED = "prefs:gateMigrated";
/** Keys earlier versions wrote while being used: their presence means Filow ran here before P3. */
const EARLIER_USE = ["prefs:startMode", "prefs:screenMode", "prefs:speechLang", "prefs:decisionProvider", "prefs:micDeviceId", "prefs:nextHeight", "prefs:resourcesCollapsed", "whisper:model", "okfilow.history.v1", "mirror:lastCode"];

/**
 * Before the setup profiles the gate was off by default and only "on" was stored: nothing stored
 * meant off, whether the user switched it off or never touched it. On such an install the gate stays
 * off (the user turns it on in Settings); a new install starts with it on. Runs once.
 */
export function migrateGateMode(s: Pick<Storage, "getItem" | "setItem">): void {
  if (s.getItem(GATE_MIGRATED) !== null) return;
  if (s.getItem(GATE_KEY) === null && EARLIER_USE.some((k) => s.getItem(k) !== null)) s.setItem(GATE_KEY, "off");
  s.setItem(GATE_MIGRATED, "1");
}

export function getGateMode(): GateMode {
  try {
    migrateGateMode(localStorage);
    return localStorage.getItem(GATE_KEY) === "off" ? "off" : "on";
  } catch {
    return "on";
  }
}

export function setGateMode(m: GateMode): void {
  try {
    localStorage.setItem(GATE_MIGRATED, "1");
    if (m === "on") localStorage.removeItem(GATE_KEY);
    else localStorage.setItem(GATE_KEY, m);
  } catch {
    /* ignore */
  }
}
