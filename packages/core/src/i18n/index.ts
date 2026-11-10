// UI languages. One flat dictionary per language, one file each, keys shared by every surface
// (web app, mirror, PowerPoint pane, browser extension, desktop shell). No library: `t(key, lang)`
// with {name} placeholders. A missing key falls back to English.

import { en, type Dictionary, type I18nKey } from "./en";
import { it } from "./it";

export type { I18nKey, Dictionary };

export type Lang = "en" | "it";
export const LANGS: Lang[] = ["en", "it"];
/** Each language named in itself, as a language picker shows it. */
export const LANG_LABELS: Record<Lang, string> = { en: "English", it: "Italiano" };

export const DICTIONARIES: Record<Lang, Dictionary> = { en, it };

/** A {name} placeholder; shared with the locale parity test so both read placeholders the same way. */
export const PLACEHOLDER = /\{(\w+)\}/g;

/** Translate `key` with {placeholders}. Unknown language or missing key > English > the key itself. */
export function t(key: I18nKey, lang: Lang = "en", vars?: Record<string, string | number>): string {
  const text = DICTIONARIES[lang]?.[key] ?? en[key] ?? key;
  if (!vars) return text;
  return text.replace(PLACEHOLDER, (m, k) => (k in vars ? String(vars[k]) : m));
}

export function isLang(v: unknown): v is Lang {
  return typeof v === "string" && (LANGS as string[]).includes(v);
}

/** Best default for a browser or OS locale string such as "it-IT" or "ja". Moldovan ("mo") is Romanian. */
export function langFromLocale(locale: string | undefined): Lang {
  const base = (locale ?? "").toLowerCase().split(/[-_]/)[0];
  const code = base === "mo" ? "ro" : base;
  return isLang(code) ? code : "en";
}
