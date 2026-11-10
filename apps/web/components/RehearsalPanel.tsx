"use client";
// The prompter's side of the rehearsal report and the talk timer, kept out of Teleprompter.tsx: it
// records the take, opens the report after Stop, and offers "Talk length".
import { useEffect, useRef, useState, type ReactNode } from "react";
import { buildRehearsalReport, notesToMarkdown, parseScript, serializeScript, type Engine, type RehearsalReport as Report, type Script, type ScreenNote, type SessionState, type TranscriptEvent } from "@filow/core";
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
const AUTO_OPEN_MS = 15_000;

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
  const wasRecording = useRef(false);

  useEffect(() => {
    if (recording) {
      wasRecording.current = true;
      return;
    }
    if (!wasRecording.current) return;
    wasRecording.current = false;
    const log = recorder.result();
    if (!log) return;
    const r = buildRehearsalReport(log, engine.getState().script, { lang: getSpeechLang() });
    setReport(r);
    if (r.durationMs >= AUTO_OPEN_MS) setReportOpen(true);
  }, [recording, recorder, engine]);

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
