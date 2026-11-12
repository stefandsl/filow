"use client";

// The Easy settings page: eight plain controls in front of Advanced settings. Everything shown here
// comes from easyView (packages/core/src/easy.ts); this file only draws it and reports what the user
// asked for. No model names in labels: they appear once, in the small detail line under Speed or quality.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { LANG_LABELS, LANGS, isLang, type EasyControl, type EasyDownload, type EasyNeeds, type EasyQuality, type EasyValue, type EasyView, type I18nKey, type Lang, type SpokenLang } from "@filow/core";
import { useT } from "@filow/ui";

export type EasySettingsProps = {
  view: EasyView;
  /** the controls this page can write (lib/easy/io.ts easyVisible); the others are not drawn */
  visible: EasyControl[];
  /** the dictation keys as the user reads them ("Ctrl + Win") */
  keys: string;
  mac: boolean;
  /** the language "Automatic" stands for on this computer */
  systemLang: Lang;
  /** the system keeps Filow from starting with it: said under the switch */
  startup: "blocked" | "requires-approval" | null;
  /** the last refusal per control (easyPatch said what is needed) */
  refused: Partial<Record<EasyControl, EasyNeeds>>;
  busy: boolean;
  message: "" | "saved" | "failed";
  onChange: <C extends EasyControl>(control: C, value: EasyValue[C]) => void;
  onReset: () => void;
  advancedHref: string;
  /** where an online service's key is added */
  keyHref: string;
  downloadHref: (d: EasyDownload) => string;
  /** a download's size as the user reads it ("7.6 GB") */
  size: (gb: number) => string;
  /** a model's name for the detail line */
  modelName: (name: string) => string;
  /** tests: start with the reset question open */
  confirming?: boolean;
};

const SPOKEN: Record<SpokenLang, string> = LANG_LABELS;

/** One row: the name and its sentences on the left, the state word and the switch on the right. */
function SwitchRow({ control, name, state, disabled, desc, notes, busy, onChange, stateWord }: {
  control: EasyControl; name: string; state: "on" | "off" | "custom"; disabled?: boolean; desc: ReactNode; notes?: ReactNode; busy: boolean;
  onChange: (next: "on" | "off") => void; stateWord: string;
}) {
  const id = useId();
  const custom = state === "custom";
  const input = useRef<HTMLInputElement>(null);
  // Custom is neither on nor off: the native "mixed" checkbox, which a screen reader announces as such
  useEffect(() => {
    if (input.current) input.current.indeterminate = custom;
  }, [custom]);
  return (
    <div className={`easy-row ${custom ? "custom" : ""}`} data-easy={control} data-state={state}>
      <div className="easy-text">
        <label className="easy-name" htmlFor={id}>{name}</label>
        <p className="easy-desc" id={`${id}-desc`}>{desc}</p>
        {/* the warnings are part of what the control is described by, not only text next to it */}
        <div className="easy-notes" id={`${id}-notes`}>{notes}</div>
      </div>
      <div className="easy-control">
        <span className="easy-state" aria-hidden="true">{stateWord}</span>
        {/* Custom is drawn as a switch in the middle; a switch has no third state, so it is then a mixed checkbox */}
        <input ref={input} id={id} type="checkbox" role={custom ? undefined : "switch"} aria-checked={custom ? "mixed" : undefined} className="easy-switch" checked={state === "on"} disabled={disabled || busy}
          aria-describedby={`${id}-desc ${id}-notes`} onChange={(e) => onChange(e.target.checked ? "on" : "off")} />
      </div>
    </div>
  );
}

export function EasySettings(p: EasySettingsProps) {
  const t = useT();
  const id = useId();
  const { view, visible } = p;
  const { state } = view;
  const shown = (c: EasyControl) => visible.includes(c);
  const word = (s: string) => t(s === "on" ? "easy.on" : s === "off" ? "easy.off" : "easy.custom");
  const changed = view.changed.filter(shown);
  const [confirming, setConfirming] = useState(Boolean(p.confirming));
  const resetButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const wasConfirming = useRef(confirming);
  // The question takes the focus when it opens. Cancel gives it back to the button that opened it;
  // after Reset that button goes away (nothing is left to put back), so the page title takes it.
  useEffect(() => {
    if (confirming && !wasConfirming.current) cancelButton.current?.focus();
    if (!confirming && wasConfirming.current && document.activeElement === document.body) (resetButton.current ?? title.current)?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);
  const link = (href: string, text: string) => <a href={href}>{text}</a>;
  const advanced = link(p.advancedHref, t("easy.seeAdvanced"));
  const join = t("easy.listJoin");

  const privateDesc = (): ReactNode => {
    if (state.private === "custom") return <>{t("easy.private.custom", { list: view.private.differences.map((d) => t(`easy.private.diff.${d}` as I18nKey)).join(join) })} {advanced}</>;
    if (state.private === "off") return `${t("easy.private.off.desc")} ${t(state.screen === "on" ? "easy.private.off.screen" : "easy.private.off.noScreen")} ${t("easy.private.off.asks")}`;
    return t("easy.private.desc");
  };
  const needsKey = p.refused.private === "online-service" || (!view.private.localAnswers && !view.private.onlineReady);

  const qualityName = (q: EasyQuality) => (q === "auto" ? t("easy.chosen") : t(`easy.quality.${q}` as I18nKey));
  const bestReason = view.quality.bestBlocked === "stronger-pc" ? t("easy.quality.best.small") : view.quality.bestBlocked === "disk" ? t("easy.quality.best.disk") : null;
  const qualityDesc = (q: EasyQuality): ReactNode => {
    // what Best quality costs on this PC is said where the PC already gets it, not only where it is a choice
    if (q === "auto") return `${t(`easy.quality.chosen.${view.quality.chosen}` as I18nKey)}${view.quality.chosen === "advanced" && view.quality.bestNote ? ` ${t("easy.quality.best.shared")}` : ""}`;
    if (q === "faster") return t("easy.quality.faster.desc");
    return <>{bestReason ?? t("easy.quality.best.desc")}{!bestReason && view.quality.bestNote ? ` ${t("easy.quality.best.shared")}` : ""}</>;
  };
  const langValue = state.language;

  return (
    <div className="easy" aria-busy={p.busy}>
      <div className="strip easy-head">
        <div className="easy-headline">
          <h1 className="easy-title" id={`${id}-title`} ref={title} tabIndex={-1}>{t("easy.title")}</h1>
          <p className="easy-live" role="status" aria-live="polite">{p.message === "saved" ? t("easy.saved") : p.message === "failed" ? t("easy.saveFailed") : ""}</p>
        </div>
        <p className="easy-desc">{t("easy.intro")}</p>
        {changed.length > 0 && !confirming && (
          <div className="row">
            <button type="button" className="btn" ref={resetButton} disabled={p.busy} onClick={() => setConfirming(true)}>{t("easy.reset")}</button>
          </div>
        )}
        {confirming && (
          <div className="easy-confirm" role="group" aria-labelledby={`${id}-reset`}>
            <strong id={`${id}-reset`}>{t("easy.reset.title")}</strong>
            <p className="easy-desc">{t("easy.reset.list", { list: changed.map((c) => t(`easy.${c}` as I18nKey)).join(join) })} {t("easy.reset.keeps")}</p>
            <div className="row">
              <button type="button" className="btn" ref={cancelButton} onClick={() => { resetButton.current?.focus(); setConfirming(false); }}>{t("common.cancel")}</button>
              <button type="button" className="btn primary" disabled={p.busy || changed.length === 0} onClick={() => { title.current?.focus(); setConfirming(false); p.onReset(); }}>{t("easy.reset.confirm")}</button>
            </div>
          </div>
        )}
      </div>

      <section className="strip easy-list" aria-labelledby={`${id}-title`}>
        {shown("private") && (
          <SwitchRow control="private" name={t("easy.private")} state={state.private} busy={p.busy} stateWord={word(state.private)} desc={privateDesc()} onChange={(v) => p.onChange("private", v)}
            notes={<>
              {/* a two-way choice: what Off means is said before the click, not only after it */}
              {state.private === "on" && <p className="easy-desc" data-easy-other>{t("easy.private.other")}</p>}
              {!view.private.localAnswers && state.private !== "off" && <p className="easy-note">{t("easy.private.tooSmall")}</p>}
              {needsKey && state.private !== "off" && <p className="easy-note" role={p.refused.private ? "alert" : undefined}>{t("easy.private.needsKey")} {link(p.keyHref, t("easy.private.setUp"))}</p>}
            </>} />
        )}
        {shown("screen") && (
          <SwitchRow control="screen" name={t("easy.screen")} state={state.screen} busy={p.busy} stateWord={word(state.screen)} desc={t("easy.screen.desc")} onChange={(v) => p.onChange("screen", v)}
            notes={<>
              {view.screen.slow && <p className="easy-note">{t("easy.screen.slow")}</p>}
              {view.screen.leaves && <p className="easy-note">{t("easy.screen.leaves")}</p>}
            </>} />
        )}
        {shown("voice") && (
          <SwitchRow control="voice" name={t("easy.voice")} state={state.voice} busy={p.busy} stateWord={word(state.voice)} onChange={(v) => p.onChange("voice", v)}
            desc={state.voice === "custom" ? <>{t("easy.voice.custom")} {advanced}</> : t("easy.voice.desc")} />
        )}
        {shown("dictation") && (
          <SwitchRow control="dictation" name={t("easy.dictation")} state={state.dictation} busy={p.busy} stateWord={word(state.dictation)} desc={t("easy.dictation.desc", { keys: p.keys })} onChange={(v) => p.onChange("dictation", v)} />
        )}
        {shown("tidy") && (
          <SwitchRow control="tidy" name={t("easy.tidy")} state={state.tidy} busy={p.busy} stateWord={word(state.tidy)} disabled={!view.tidy.usable} onChange={(v) => p.onChange("tidy", v)}
            desc={state.tidy === "custom" ? <>{t("easy.tidy.custom")} {advanced}</> : t("easy.tidy.desc")}
            notes={!view.tidy.usable && <p className="easy-note">{t("easy.tidy.needsDictation")}</p>} />
        )}

        {shown("quality") && (
          <div className={`easy-row easy-wide ${state.quality === "custom" ? "custom" : ""}`} data-easy="quality" data-state={state.quality}>
            <fieldset className="easy-choice" aria-describedby={`${id}-quality-desc`}>
              <legend className="easy-name">{t("easy.quality")}</legend>
              <p className="easy-desc" id={`${id}-quality-desc`}>{t("easy.quality.desc")}</p>
              <div className="setup-options">
                {view.quality.options.map((q) => {
                  const off = q === "best" && Boolean(bestReason) && state.quality !== "best";
                  return (
                    <label key={q} className={`setup-option ${state.quality === q ? "on" : ""} ${off ? "off" : ""}`}>
                      <input type="radio" name={`${id}-quality`} value={q} checked={state.quality === q} disabled={off || p.busy} aria-describedby={`${id}-quality-${q}`} onChange={() => p.onChange("quality", q)} />
                      <span className="setup-text">
                        <strong>{qualityName(q)}</strong>
                        <span className="hint" id={`${id}-quality-${q}`}>{qualityDesc(q)}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              {state.quality === "custom" && (
                <p className="easy-note" data-easy-custom="quality">{t(view.quality.active === "advanced" ? "easy.quality.customBest" : "easy.quality.custom")} {advanced}</p>
              )}
            </fieldset>
            {(view.quality.helpers.length > 0 || view.quality.downloads.length > 0) && (
              <div className="easy-downloads" role="group" aria-labelledby={`${id}-dl`}>
                <strong className="easy-sub" id={`${id}-dl`}>{t("easy.download.title")}</strong>
                {view.quality.helpers.length > 0 && view.quality.downloads.every((d) => d.id !== "helper") && (
                  <p className="easy-detail">{t("easy.quality.detail", { models: view.quality.helpers.map(p.modelName).join(", ") })}</p>
                )}
                {view.quality.downloads.length > 0 && (
                  <>
                    <ul className="easy-offers">
                      {view.quality.downloads.map((d) => (
                        <li key={d.id} className="easy-offer" data-download={d.id}>
                          <span className="easy-offer-text">
                            <span className="easy-offer-name">{t(`easy.download.${d.id}` as I18nKey)}{d.preselected && view.quality.downloads.length > 1 && <span className="chip inuse">{t("easy.download.suggested")}</span>}</span>
                            <span className="hint">{t(`easy.download.${d.id}.desc` as I18nKey)}{d.id === "best" && view.quality.bestNote ? ` ${t("easy.quality.best.shared")}` : ""}</span>
                            <span className="easy-detail">{d.models.map((m) => p.modelName(m.name)).join(", ")}</span>
                          </span>
                          {d.room
                            ? <a className={`btn ${d.preselected ? "primary" : ""}`} href={p.downloadHref(d)}>{t("easy.download.get", { size: p.size(d.gb) })}</a>
                            : <span className="easy-note">{t("easy.download.noRoom", { size: p.size(d.gb) })}</span>}
                        </li>
                      ))}
                    </ul>
                    <p className="hint">{t("easy.download.note")}</p>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {shown("language") && (
          <div className="easy-row" data-easy="language" data-state={langValue || "auto"}>
            <div className="easy-text">
              <label className="easy-name" htmlFor={`${id}-lang`}>{t("easy.language")}</label>
              <p className="easy-desc" id={`${id}-lang-desc`}>{t("easy.language.desc")}</p>
              {view.language.listensIn && <p className="easy-note">{t("easy.language.listens", { language: SPOKEN[view.language.listensIn] })} {advanced}</p>}
            </div>
            <div className="easy-control">
              <select id={`${id}-lang`} className="btn easy-select" value={langValue} disabled={p.busy} aria-describedby={`${id}-lang-desc`}
                onChange={(e) => p.onChange("language", isLang(e.target.value) ? e.target.value : "")}>
                <option value="">{t("easy.language.auto", { language: LANG_LABELS[p.systemLang] })}</option>
                {LANGS.map((l) => <option key={l} value={l} lang={l}>{LANG_LABELS[l]}</option>)}
              </select>
            </div>
          </div>
        )}

        {shown("startup") && (
          <SwitchRow control="startup" name={t(p.mac ? "easy.startup.mac" : "easy.startup")} state={state.startup} busy={p.busy} stateWord={word(state.startup)} desc={t("easy.startup.desc")} onChange={(v) => p.onChange("startup", v)}
            notes={p.startup && <p className="easy-note">{t(p.startup === "blocked" ? "ui.startupBlocked" : "ui.startupApproval")}</p>} />
        )}
      </section>

      {!shown("private") && <p className="hint easy-foot">{t("easy.desktopOnly")}</p>}

      <section className="strip easy-advanced" aria-label={t("easy.advanced")}>
        <a className="btn" href={p.advancedHref}>{t("easy.advanced")}</a>
        <span className="hint">{t("easy.advanced.desc")}</span>
      </section>
    </div>
  );
}
