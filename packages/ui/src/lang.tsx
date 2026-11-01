"use client";

import { createContext, useContext, type ReactNode } from "react";
import { t as translate, type I18nKey, type Lang } from "@filow/core";

const LangContext = createContext<Lang>("en");

export function LangProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useLang(): Lang {
  return useContext(LangContext);
}

/** `t("key", { n: 3 })` bound to the current language. */
export function useT() {
  const lang = useContext(LangContext);
  return (key: I18nKey, vars?: Record<string, string | number>) => translate(key, lang, vars);
}
