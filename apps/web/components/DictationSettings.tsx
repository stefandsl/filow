"use client";
// Dictation in Filow Settings (apps/desktop/dictation.js, docs/okfilow/DICTATION.md): speak into the text box
// you are in, in any app, with the speech turned into text on this computer only.
import { useEffect, useId, useState } from "react";
import type { DictationStatus } from "@/lib/buddy/bridge";
import { dictationText, pasteKeys, type DictationKey } from "@/lib/dictation/text";
import "./DictationSettings.css";

type DictationBridge = {
  status(): Promise<DictationStatus | null>;
  configure(patch: Partial<DictationStatus>): Promise<DictationStatus | null>;
};
const bridge = () => (globalThis as { filow?: { dictation?: DictationBridge } }).filow?.dictation ?? null;

/** Each language in its own name, so a speaker finds theirs whatever the interface language. */
const LANG_NAMES = { en: "English", it: "Italiano", ru: "Русский", ro: "Română", ja: "日本語" } as const;

export function DictationSettings({ lang }: { lang: string }) {
  const [s, setS] = useState<DictationStatus | null>(null);
  const id = useId();
  useEffect(() => { void bridge()?.status().then(setS).catch(() => setS(null)); }, []);
  const b = bridge();
  if (!b || !s) return null; // the browser, or an older desktop build
  const t = (k: DictationKey, vars?: Record<string, string>) => dictationText(lang, k, vars);
  const set = async (patch: Partial<DictationStatus>) => setS(await b.configure(patch));
  const paste = pasteKeys(s.platform);
  const keyNote =
    s.check.conflict === "same" ? t("conflictSame", { talk: s.talkLabel })
    : s.check.conflict === "overlap" ? t("conflictOverlap", { talk: s.talkLabel })
    : "";
  const warnings = s.check.warnings.map((w) => t(w === "altgr" ? "warnAltgr" : "warnLayout"));
  const copyNote = s.copyReason === "wayland" ? t("copyWayland") : s.copyReason === "accessibility" ? t("copyAccessibility") : s.copyReason === "nohook" ? t("copyNohook") : "";
  const off = !s.enabled;

  return (
    <section className="strip" aria-labelledby={`${id}-title`}>
      <div className="label" id={`${id}-title`}>{t("title")}</div>
      <div className="hint">{t("intro")}</div>
      <div className="hint">{t("privacy")}</div>
      <label className="row">
        <input type="checkbox" checked={s.enabled} onChange={(e) => void set({ enabled: e.target.checked })} />
        <span>{t("enabled")}</span>
      </label>

      <label className="row">
        <span>{t("shortcut")}</span>
        <select className="btn" value={s.chord} disabled={off} aria-describedby={keyNote || warnings.length ? `${id}-keys` : undefined} onChange={(e) => void set({ chord: e.target.value })}>
          {s.chords.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </label>
      {(keyNote || warnings.length > 0) && (
        <div id={`${id}-keys`}>
          {keyNote && <div className="hint dictation-alert" role="alert">{keyNote}</div>}
          {warnings.map((w) => <div key={w} className="hint">{w}</div>)}
        </div>
      )}

      <fieldset className="row dictation-choices" disabled={off}>
        <legend>{t("mode")}</legend>
        <label><input type="radio" name={`${id}-mode`} checked={s.mode === "hold"} onChange={() => void set({ mode: "hold" })} /> {t("modeHold")}</label>
        <label><input type="radio" name={`${id}-mode`} checked={s.mode === "toggle"} onChange={() => void set({ mode: "toggle" })} /> {t("modeToggle")}</label>
      </fieldset>
      <div className="hint">{s.mode === "toggle" ? t("modeToggleHint") : t("togglesHandsFree")}</div>

      <label className="row">
        <span>{t("language")}</span>
        <select className="btn" value={s.language} disabled={off} onChange={(e) => void set({ language: e.target.value as DictationStatus["language"] })}>
          <option value="auto">{t("languageAuto")}</option>
          {(Object.keys(LANG_NAMES) as Array<keyof typeof LANG_NAMES>).map((l) => <option key={l} value={l} lang={l}>{LANG_NAMES[l]}</option>)}
        </select>
      </label>
      {s.modelReady !== null && <div className={`hint${s.modelReady ? "" : " dictation-alert"}`}>{s.modelReady ? t("modelReady") : t("modelMissing")}</div>}

      <fieldset className="row dictation-choices" disabled={off}>
        <legend>{t("insert")}</legend>
        <label><input type="radio" name={`${id}-insert`} checked={s.insert === "paste"} onChange={() => void set({ insert: "paste" })} /> {t("insertPaste")}</label>
        <label><input type="radio" name={`${id}-insert`} checked={s.insert === "copy"} onChange={() => void set({ insert: "copy" })} /> {t("insertCopy")}</label>
      </fieldset>
      {s.insert === "paste" && <div className="hint">{copyNote || t("insertHow", { paste })}</div>}

      <label className="row">
        <input type="checkbox" checked={s.removeFillers} disabled={off} onChange={(e) => void set({ removeFillers: e.target.checked })} />
        <span>{t("fillers")}</span>
      </label>
      <div className="hint">{t("fillersHint")}</div>
      <label className="row">
        <input type="checkbox" checked={s.sound} disabled={off} onChange={(e) => void set({ sound: e.target.checked })} />
        <span>{t("sound")}</span>
      </label>
      <div className="hint">{t("soundHint")}</div>
    </section>
  );
}
