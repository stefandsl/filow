"use client";

import { useEffect, useState } from "react";
import { LANGS, type Lang } from "@intelliprompter/core";
import { getLang, setLang as saveLang } from "@/lib/prefs";

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
