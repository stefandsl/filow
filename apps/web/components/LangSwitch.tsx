"use client";
import { Icon, type IconName } from "./icons";
import { useSyncExternalStore } from "react";
import { isLang, LANG_LABELS, LANGS, t, type Lang } from "@filow/core";
import { getLang, getThemePref, setLang, setThemePref, subscribeUiPreferences, type ThemePref } from "@/lib/prefs";

export function useUiLang(): [Lang, (lang: Lang) => void] {
  const lang = useSyncExternalStore(subscribeUiPreferences, getLang, () => "en" as Lang);
  return [lang, setLang];
}
/** The interface language: five languages do not fit as chips on a phone, so a select names each in itself. */
export function LangSwitch({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return <select className="btn langswitch" value={lang} aria-label={t("common.language", lang)} title={t("common.language", lang)}
    onChange={(e) => { if (isLang(e.target.value)) onChange(e.target.value); }}>
    {LANGS.map(l => <option key={l} value={l} lang={l}>{LANG_LABELS[l]}</option>)}
  </select>;
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
