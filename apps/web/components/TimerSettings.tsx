"use client";
// "Talk length": an optional target for the whole talk and for each section, saved into the script
// text ("<!-- target: 20 min -->", "# Intro (3 min)"), so it travels with the script.
import { useState, type RefObject } from "react";
import { hasLeadingPoints, setTimeTargets, type Script } from "@filow/core";
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
  const r = Math.round(n * 10) / 10;
  return Number.isFinite(n) && r > 0 && r <= 600 ? r : "invalid";
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
  const untitledFirst = hasLeadingPoints(text);
  const secValues = sections.map((v, i) => (i === 0 && untitledFirst ? null : readMinutes(v)));
  const talkMin = readMinutes(talk);
  const values = [talkMin, ...secValues];
  const invalid = values.some((v) => v === "invalid");
  const planned = secValues.reduce<number>((a, v) => a + (typeof v === "number" ? v : 0), 0);
  // the untitled first section still shares the rest of the talk (talkBudget), so it counts here
  const open = secValues.filter((v) => v === null).length;
  const round = (n: number) => Math.round(n * 10) / 10;
  const summary = typeof talkMin !== "number" ? t("timer.planned", { n: round(planned) })
    : planned > talkMin ? t("timer.tooMuch", { planned: round(planned), talk: talkMin })
    : open > 0 ? t("timer.share", { n: open, rest: round(talkMin - planned) })
    : t("timer.planned", { n: round(planned) });

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
          <span className="timer-name">{t("timer.talk")}</span>
          <input className="btn" inputMode="decimal" value={talk} onChange={(e) => setTalk(e.target.value)} aria-label={t("timer.talkMinutes")} aria-invalid={talkMin === "invalid"} />
          <span className="timer-unit" aria-hidden="true">{t("timer.min")}</span>
        </label>
        <div className="timer-sections">
          {script.sections.map((s, i) => {
            // points before the first heading have no heading to hold a target
            if (i === 0 && untitledFirst) return null;
            const title = sectionLabel(s.title).title;
            return (
              <label key={s.id} className="timer-field">
                <span className="timer-name"><span className="timer-num" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>{title}</span>
                <input className="btn" inputMode="decimal" value={sections[i]} aria-label={t("timer.sectionMinutes", { section: title })} aria-invalid={secValues[i] === "invalid"}
                  onChange={(e) => setSections((v) => v.map((x, k) => (k === i ? e.target.value : x)))} />
                <span className="timer-unit" aria-hidden="true">{t("timer.min")}</span>
              </label>
            );
          })}
        </div>
        <p className="hint" aria-live="polite">{summary}</p>
        {invalid && <p className="timer-error" role="alert">{t("timer.invalid")}</p>}
        <div className="controls">
          <button type="submit" className="btn primary" disabled={invalid}>{t("timer.save")}</button>
          <button type="button" className="btn" onClick={onCancel}>{t("timer.cancel")}</button>
        </div>
      </form>
    </Dialog>
  );
}
