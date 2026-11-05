"use client";
import { Icon, type IconName } from "./icons";
import { useSyncExternalStore } from "react";
import { LANGS, t, type Lang } from "@filow/core";
import { getLang, getThemePref, setLang, setThemePref, subscribeUiPreferences, type ThemePref } from "@/lib/prefs";

export function useUiLang(): [Lang, (lang: Lang) => void] {
  const lang = useSyncExternalStore(subscribeUiPreferences, getLang, () => "en" as Lang);
  return [lang, setLang];
}
export function LangSwitch({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return <span className="langswitch" role="group" aria-label={t("common.language", lang)}>
    {LANGS.map(l => <button key={l} className={`chip ${lang === l ? "code" : ""}`} onClick={() => onChange(l)} aria-pressed={lang === l}>{l.toUpperCase()}</button>)}
  </span>;
}
export function useUiTheme(): [ThemePref, (theme: ThemePref) => void] {
  return [useSyncExternalStore(subscribeUiPreferences, getThemePref, () => "system" as ThemePref), setThemePref];
}
export function ThemeSwitch({ pref, onChange }: { pref: ThemePref; onChange: (t: ThemePref) => void }) {
  const [lang] = useUiLang();
  const icons: Record<ThemePref, IconName> = { light: "sun", dark: "moon", system: "system" };
  const next: Record<ThemePref, ThemePref> = { light: "dark", dark: "system", system: "light" };
  return <span className="themeswitch" role="group" aria-label={t("ui.theme", lang)}>
    <button type="button" className="btn" onClick={() => onChange(next[pref])} aria-label={`${t("ui.theme", lang)}: ${t(`ui.${pref}`, lang)}`} title={t(`ui.${pref}`, lang)}><Icon name={icons[pref]} /></button>
  </span>;
}
