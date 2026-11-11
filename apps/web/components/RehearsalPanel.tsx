"use client";
// The prompter's side of the rehearsal report and the talk timer, kept out of Teleprompter.tsx: it
// records the take, opens the report after Stop, and offers "Talk length".
import { useEffect, useRef, useState, type ReactNode } from "react";
import { buildRehearsalReport, notesToMarkdown, parseScript, serializeScript, type Engine, type RehearsalReport as Report, type Script, type ScreenNote, type SessionState, type SpeechLanguage, type TranscriptEvent } from "@filow/core";
import { useT } from "@filow/ui";
import { getSpeechLang } from "@/lib/prefs";
import { RehearsalReport } from "./RehearsalReport";
import { TimerCue } from "./TimerCue";
import { TimerSettings } from "./TimerSettings";
import { takeRecorder } from "./TimerClock";

/** Same sections and points (a script sent from the browser or a phone is not in the prompter's text). */
export function sameScript(a: Script, b: Script): boolean {
  const shape = (s: Script) => JSON.stringify(s.sections.map((x) => [x.title, x.bullets.map((p) => p.text)]));
  return shape(a) === shape(b);
}

/** A take shorter than this (a quick check of the microphone) does not open the report by itself. */
export const AUTO_OPEN_MS = 15_000;

/**
 * What Stop does, kept apart from React so it can be tested: fed the recording flag every time it
 * changes, it answers once per take, when the take stops, with that take's report and whether to
 * open it. Before the first take, during one and on a repeated "not recording" it answers null.
 */
export class TakeReports {
  private wasRecording = false;

  update(recording: boolean, engine: Engine, lang: SpeechLanguage | "auto"): { report: Report; open: boolean } | null {
    if (recording) {
      this.wasRecording = true;
      return null;
    }
    if (!this.wasRecording) return null;
    this.wasRecording = false;
    const log = takeRecorder(engine).result();
    if (!log) return null;
    const report = buildRehearsalReport(log, engine.getState().script, { lang });
    return { report, open: report.durationMs >= AUTO_OPEN_MS };
  }
}

export function useRehearsal({ engine, state, scriptText, saveScript, notes }: {
  engine: Engine;
  state: SessionState;
  scriptText: string;
  saveScript: (text: string) => Promise<void> | void;
  notes: ScreenNote[];
}): { transcript: (e: TranscriptEvent) => void; timer: ReactNode; dialogs: ReactNode; menu: Array<{ id: string; label: string; onSelect: () => void }> } {
  const t = useT();
  const recorder = takeRecorder(engine);
  const [report, setReport] = useState<Report | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);
  const timerButton = useRef<HTMLButtonElement>(null);
  const recording = state.engine.recording;
  const reports = useRef(new TakeReports());

  useEffect(() => {
    const out = reports.current.update(recording, engine, getSpeechLang());
    if (!out) return;
    setReport(out.report);
    if (out.open) setReportOpen(true);
  }, [recording, engine]);

  const hasScript = state.script.sections.length > 0;
  const timer = hasScript ? (
    <TimerCue
      script={state.script}
      clock={recorder.talkClock()}
      sectionIdx={state.sectionIdx}
      points={state.points}
      action={
        <button ref={timerButton} type="button" className="btn" onClick={() => setTimerOpen(true)} disabled={recording} title={t("timer.setTitle")}>
          {t("timer.set")}
        </button>
      }
    />
  ) : null;

  const dialogs = (
    <>
      {reportOpen && report && (
        <RehearsalReport report={report} notes={notes.length ? notesToMarkdown(notes, "Talk notes") : undefined} onClose={() => setReportOpen(false)} />
      )}
      {timerOpen && (
        <TimerSettings
          script={state.script}
          // the targets go into the text of the script on screen, which may have come from elsewhere
          text={sameScript(parseScript(scriptText), state.script) ? scriptText : serializeScript(state.script)}
          returnFocusRef={timerButton}
          onCancel={() => setTimerOpen(false)}
          onSave={(text) => {
            setTimerOpen(false);
            void saveScript(text);
          }}
        />
      )}
    </>
  );

  return {
    transcript: (e) => recorder.transcript(e),
    timer,
    dialogs,
    menu: report ? [{ id: "rehearsal", label: t("report.open"), onSelect: () => setReportOpen(true) }] : [],
  };
}
