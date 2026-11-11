"use client";
// Dictation in Filow Settings (apps/desktop/dictation.js, docs/okfilow/DICTATION.md): speak into the text box
// you are in, in any app, with the speech turned into text on this computer only.
import { useEffect, useId, useState } from "react";
import type { DictationStatus } from "@/lib/buddy/bridge";
import { dictationText, pasteKeys, type DictationKey } from "@/lib/dictation/text";
import { modelsBridge, StopButton } from "./ModelControls";
import "./DictationSettings.css";

type DictationBridge = {
  status(): Promise<DictationStatus | null>;
  configure(patch: Partial<DictationStatus>): Promise<DictationStatus | null>;
  downloadCleanup?(): Promise<{ started: boolean; reason?: string }>;
  downloadPunctuation?(): Promise<{ started: boolean; reason?: string }>;
};
/** The desktop app's dictation bridge; null in the browser. Also used by the setup picker for the same download. */
export const dictationBridge = () => (globalThis as { filow?: { dictation?: DictationBridge } }).filow?.dictation ?? null;
const bridge = dictationBridge;

/** Each language in its own name, so a speaker finds theirs whatever the interface language. */
const LANG_NAMES = { en: "English", it: "Italiano", ru: "Русский", ro: "Română", ja: "日本語" } as const;

export function DictationSettings({ lang }: { lang: string }) {
  const [s, setS] = useState<DictationStatus | null>(null);
  const id = useId();
  useEffect(() => {
    // Read again now and then: OK Filow's question keys (the section above), the keyboard hook coming
    // back, or a model download change what this section must say.
    const read = () => void bridge()?.status().then((v) => v && setS(v)).catch(() => {});
    read();
    const timer = setInterval(read, 2000);
    window.addEventListener("focus", read);
    return () => { clearInterval(timer); window.removeEventListener("focus", read); };
  }, []);
  const b = bridge();
  if (!b || !s) return null; // the browser, or an older desktop build
  const t = (k: DictationKey, vars?: Record<string, string>) => dictationText(lang, k, vars);
  // A refused change leaves the controls as they were (they show what is stored).
  const set = async (patch: Partial<DictationStatus>) => { try { const v = await b.configure(patch); if (v) setS(v); } catch { /* unchanged */ } };
  // Stop for a model download: the desktop app ends it, deletes the part and forgets to resume it at the next start.
  const stop = async (id: "cleanup" | "punctuation") => {
    try { await modelsBridge()?.cancel(id); const v = await b.status(); if (v) setS(v); } catch { /* the next reading shows the state */ }
  };
  const paste = pasteKeys(s.platform);
  const keyNote =
    s.check.conflict === "same" ? t("conflictSame", { talk: s.talkLabel })
    : s.check.conflict === "overlap" ? t("conflictOverlap", { talk: s.talkLabel })
    : "";
  const warnings = s.check.warnings.map((w) => t(w === "altgr" ? "warnAltgr" : "warnLayout"));
  const copyNote = s.copyReason === "wayland" ? t("copyWayland") : s.copyReason === "accessibility" ? t("copyAccessibility") : "";
  const off = !s.enabled;

  return (
    <section className="strip dictation" aria-labelledby={`${id}-title`}>
      <div className="label" id={`${id}-title`}>{t("title")}</div>
      <div>{t("intro")}</div>
      <div>{t("privacy")}</div>
      <label className="row">
        <input type="checkbox" checked={s.enabled} onChange={(e) => void set({ enabled: e.target.checked })} />
        <span>{t("enabled")}</span>
      </label>
      {s.enabled && (s.hookReady === false || s.copyReason === "nohook") && <div className="dictation-alert" role="alert">{t("copyNohook")}</div>}

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
      {s.talkLabel && <div className="hint">{t("handsFreeQuestions", { talk: s.talkLabel })}</div>}

      <label className="row">
        <span>{t("language")}</span>
        <select className="btn" value={s.language} disabled={off} onChange={(e) => void set({ language: e.target.value as DictationStatus["language"] })}>
          <option value="auto">{t("languageAuto")}</option>
          {(Object.keys(LANG_NAMES) as Array<keyof typeof LANG_NAMES>).map((l) => <option key={l} value={l} lang={l}>{LANG_NAMES[l]}</option>)}
        </select>
      </label>
      <div className="hint">{t("languageHint")}</div>
      {s.modelReady !== null && <div className={`hint${s.modelReady ? "" : " dictation-alert"}`}>{s.modelReady ? t("modelReady") : t("modelMissing")}</div>}

      <fieldset className="row dictation-choices" disabled={off}>
        <legend>{t("insert")}</legend>
        <label><input type="radio" name={`${id}-insert`} checked={s.insert === "paste"} onChange={() => void set({ insert: "paste" })} /> {t("insertPaste")}</label>
        <label><input type="radio" name={`${id}-insert`} checked={s.insert === "copy"} onChange={() => void set({ insert: "copy" })} /> {t("insertCopy")}</label>
      </fieldset>
      {s.insert === "paste" && <div className="hint">{copyNote || t("insertHow", { paste })}</div>}

      {/* S1-mini by Superwhisper: the name stays as it is in every language (its licence asks for it). */}
      <label className="row">
        <input type="checkbox" checked={s.cleanup} disabled={off} aria-describedby={`${id}-cleanup`} onChange={(e) => void set({ cleanup: e.target.checked })} />
        <span>{t("cleanup")}</span>
      </label>
      <div className="hint" id={`${id}-cleanup`}>{t("cleanupHint")}</div>
      {s.cleanup && !s.cleanupReady && s.cleanupState && !s.cleanupState.runtime && <div className="hint">{t("cleanupNoRuntime")}</div>}
      {s.cleanup && s.cleanupState?.runtime && !s.cleanupState.model && (
        <div className="row" role="status">
          {s.cleanupState.downloading
            ? <>
                <span className="dictation-progress">{t("cleanupDownloading", { pct: String(s.cleanupState.pct) })}</span>
                {modelsBridge() && <StopButton name="S1-mini by Superwhisper" onStop={() => void stop("cleanup")} />}
              </>
            : <>
                <span className="hint dictation-alert">{s.cleanupState.error ? t("cleanupDownloadFailed", { error: s.cleanupState.error }) : t("cleanupMissing")}</span>
                <button type="button" className="btn" disabled={off} onClick={() => { void b.downloadCleanup?.().then(() => b.status()).then((v) => v && setS(v)).catch(() => {}); }}>
                  {t("cleanupDownload", { size: `${Math.round(s.cleanupState.bytes / 1024 / 1024)} MB` })}
                </button>
              </>}
        </div>
      )}
      <label className="row">
        <span>{t("cleanupStyle")}</span>
        <select className="btn" value={s.cleanupStyle} disabled={off || !s.cleanup} onChange={(e) => void set({ cleanupStyle: e.target.value as DictationStatus["cleanupStyle"] })}>
          <option value="casual">{t("styleCasual")}</option>
          <option value="semi-casual">{t("styleSemiCasual")}</option>
          <option value="semi-formal">{t("styleSemiFormal")}</option>
          <option value="formal">{t("styleFormal")}</option>
        </select>
      </label>
      <label className="row">
        <input type="checkbox" checked={s.cleanupLists} disabled={off || !s.cleanup} onChange={(e) => void set({ cleanupLists: e.target.checked })} />
        <span>{t("cleanupLists")}</span>
      </label>

      {/* Italian, Russian, Romanian, Japanese: marks and capitals from a small model on this PC (dictation-punctuate.js). */}
      <label className="row">
        <input type="checkbox" checked={s.punctuate ?? true} disabled={off} aria-describedby={`${id}-punctuate`} onChange={(e) => void set({ punctuate: e.target.checked })} />
        <span>{t("punctuate")}</span>
      </label>
      <div className="hint" id={`${id}-punctuate`}>{t("punctuateHint")}</div>
      {(s.punctuate ?? true) && s.punctuateState && !s.punctuateState.runtime && <div className="hint">{t("punctuateNoRuntime")}</div>}
      {(s.punctuate ?? true) && s.punctuateState?.runtime && !s.punctuateState.model && (
        <div className="row" role="status">
          {s.punctuateState.downloading
            ? <>
                <span className="dictation-progress">{t("punctuateDownloading", { pct: String(s.punctuateState.pct) })}</span>
                {modelsBridge() && <StopButton name={t("punctuate")} onStop={() => void stop("punctuation")} />}
              </>
            : <>
                <span className="hint dictation-alert">{s.punctuateState.error ? t("punctuateDownloadFailed", { error: s.punctuateState.error }) : t("punctuateMissing")}</span>
                <button type="button" className="btn" disabled={off} onClick={() => { void b.downloadPunctuation?.().then(() => b.status()).then((v) => v && setS(v)).catch(() => {}); }}>
                  {t("punctuateDownload", { size: `${Math.round(s.punctuateState.bytes / 1024 / 1024)} MB` })}
                </button>
              </>}
        </div>
      )}
      <div className="hint">{t("cleanupByLanguage")}</div>

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
