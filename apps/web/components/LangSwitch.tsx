"use client";

import { useEffect, useState } from "react";
import { LANGS, type Lang } from "@intelliprompter/core";
import { getLang, getThemePref, resolveTheme, setLang as saveLang, setThemePref, type ThemePref } from "@/lib/prefs";

/** Language state for a page: English on the server render, the stored choice after mount. */
export function useUiLang(): [Lang, (l: Lang) => void] {
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => {
    setLangState(getLang());
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const set = (l: Lang) => {
    setLangState(l);
    saveLang(l);
  };
  return [lang, set];
}

/** EN | IT toggle for the top bar. */
export function LangSwitch({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <span className="langswitch" role="group" aria-label="Language">
      {LANGS.map((l) => (
        <button key={l} className={`chip ${lang === l ? "code" : ""}`} onClick={() => onChange(l)} aria-pressed={lang === l}>
          {l.toUpperCase()}
        </button>
      ))}
    </span>
  );
}

/** Theme state for a page: applies data-theme on <html>, follows the OS while "system". */
export function useUiTheme(): [ThemePref, (t: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>("system");
  useEffect(() => {
    setPref(getThemePref());
  }, []);
  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(pref);
    };
    apply();
    const mq = window.matchMedia?.("(prefers-color-scheme: light)");
    mq?.addEventListener?.("change", apply);
    return () => mq?.removeEventListener?.("change", apply);
  }, [pref]);
  const set = (t: ThemePref) => {
    setPref(t);
    setThemePref(t);
  };
  return [pref, set];
}

/** ☀ / ◐ / ☾ toggle: light, system, dark. */
export function ThemeSwitch({ pref, onChange }: { pref: ThemePref; onChange: (t: ThemePref) => void }) {
  const items: Array<[ThemePref, string, string]> = [
    ["light", "☀", "Light"],
    ["system", "◐", "System"],
    ["dark", "☾", "Dark"],
  ];
  return (
    <span className="themeswitch" role="group" aria-label="Theme">
      {items.map(([t, icon, title]) => (
        <button key={t} className={`chip ${pref === t ? "code" : ""}`} onClick={() => onChange(t)} aria-pressed={pref === t} title={title}>
          {icon}
        </button>
      ))}
    </span>
  );
}
