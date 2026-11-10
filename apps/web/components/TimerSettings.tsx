"use client";
// "Talk length": an optional target for the whole talk and for each section, saved into the script
// text ("<!-- target: 20 min -->", "# Intro (3 min)"), so it travels with the script.
import { useState, type RefObject } from "react";
import { setTimeTargets, type Script } from "@filow/core";
import { useT } from "@filow/ui";
import { Dialog } from "./prompter/Dialog";
import { sectionLabel } from "./prompter/sectionLabel";
import "./Rehearsal.css";

const asText = (n: number | undefined) => (n ? String(n) : "");
/** "" means no target; anything else must be a number of minutes above 0 and at most 600. */
export function readMinutes(text: string): number | null | "invalid" {
  const s = text.trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n <= 600 ? Math.round(n * 10) / 10 : "invalid";
}

export function TimerSettings({ script, text, onSave, onCancel, returnFocusRef }: {
  script: Script;
  /** the script text as saved: only the target line and the heading suffixes change */
  text: string;
  onSave: (text: string) => void;
  onCancel: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const t = useT();
  const [talk, setTalk] = useState(asText(script.minutes));
  const [sections, setSections] = useState(script.sections.map((s) => asText(s.minutes)));
  const values = [talk, ...sections].map(readMinutes);
  const invalid = values.some((v) => v === "invalid");
  const planned = sections.map(readMinutes).reduce<number>((a, v) => a + (typeof v === "number" ? v : 0), 0);

  return (
    <Dialog title={t("timer.dialogTitle")} onClose={onCancel} className="timer-settings" returnFocusRef={returnFocusRef}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (invalid) return;
          const [talkMin, ...secMin] = values as Array<number | null>;
          onSave(setTimeTargets(text, { minutes: talkMin, sections: secMin }));
        }}
      >
        <p className="hint">{t("timer.hint")}</p>
        <label className="timer-field timer-field-talk">
          <span>{t("timer.talkMinutes")}</span>
          <input className="btn" inputMode="decimal" value={talk} onChange={(e) => setTalk(e.target.value)} aria-invalid={readMinutes(talk) === "invalid"} />
        </label>
        <div className="timer-sections">
          {script.sections.map((s, i) => {
            const title = sectionLabel(s.title).title;
            return (
              <label key={s.id} className="timer-field">
                <span>{t("timer.sectionMinutes", { section: title })}</span>
                <input className="btn" inputMode="decimal" value={sections[i]} aria-invalid={readMinutes(sections[i]) === "invalid"}
                  onChange={(e) => setSections((v) => v.map((x, k) => (k === i ? e.target.value : x)))} />
              </label>
            );
          })}
        </div>
        <p className="hint" aria-live="polite">{t("timer.planned", { n: Math.round(planned * 10) / 10 })}</p>
        {invalid && <p className="timer-error" role="alert">{t("timer.invalid")}</p>}
        <div className="controls">
          <button type="submit" className="btn primary" disabled={invalid}>{t("timer.save")}</button>
          <button type="button" className="btn" onClick={onCancel}>{t("timer.cancel")}</button>
        </div>
      </form>
    </Dialog>
  );
}
