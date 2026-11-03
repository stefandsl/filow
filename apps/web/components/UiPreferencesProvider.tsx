"use client";
import { useEffect, useState, type ReactNode } from "react";
import { t } from "@filow/core";
import { desktopBridge } from "../lib/sessionUrl";
import { applyUiPreferences } from "../lib/applyUiPreferences";
import { connectDesktopPreferences, getDesktopPreferences, getLang, getThemePref, getUiError, notifyUiPreferences, resolveTheme, subscribeUiPreferences } from "../lib/prefs";

export function UiPreferencesProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const bridge = desktopBridge();
    const apply = () => {
      if (!active) return;
      const state = getDesktopPreferences();
      applyUiPreferences(state ?? { resolvedLang: getLang(), resolvedTheme: resolveTheme(getThemePref()), accentColor: null }, !!bridge?.glass);
      const code = getUiError();
      setError(code ? t(code, getLang()) : null);
    };
    const unsubscribeLocal = subscribeUiPreferences(apply);
    let unsubscribeDesktop: (() => void) | undefined;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const storage = (event: StorageEvent) => { if (!bridge && (event.key === null || event.key === "prefs:lang" || event.key === "prefs:theme")) notifyUiPreferences(); };
    window.addEventListener("storage", storage);
    media.addEventListener("change", apply);
    if (bridge?.getPreferences) {
      unsubscribeDesktop = connectDesktopPreferences(bridge, () => { apply(); setReady(true); }, () => setError(t("ui.saveError", getLang())));
    } else { apply(); setReady(true); }
    return () => { active = false; unsubscribeLocal(); unsubscribeDesktop?.(); media.removeEventListener("change", apply); window.removeEventListener("storage", storage); };
  }, []);
  return <>{error && <p role="alert" className="ui-preferences-error">{error}</p>}{ready ? children : null}</>;
}
