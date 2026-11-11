"use client";
import { sherpaBridge, sherpaNotes, type SherpaStatus } from "@filow/stt";
import { useT } from "@filow/ui";
import { DownloadLabel } from "./DownloadLabel";
import { modelsBridge, StopButton } from "./ModelControls";

/**
 * Under the on-device speech model: which model the spoken language needs and, in plain words, what
 * it gives up; plus the optional, more accurate model for OK Filow questions with its own button.
 */
export function SherpaLanguageNote({ s }: { s: SherpaStatus | null }) {
  const t = useT();
  const notes = sherpaNotes(s);
  if (notes.length === 0) return null;
  const q = s?.questions;
  const busy = q?.state === "downloading" || q?.state === "extracting";
  return (
    <div className="hint" data-testid="sherpa-language-note">
      {notes.map((n) => (
        <p key={n.key}>
          {t(n.key, n.vars)}{" "}
          {n.key === "speech.questionsModel" && (
            <button className="btn" disabled={busy} onClick={() => sherpaBridge()?.download(s?.language, "questions")}>
              {q?.state === "downloading" ? <DownloadLabel label={t("progress.speechModel")} percent={q.pct ?? null} /> : q?.state === "extracting" ? t("settings.starting") : t("settings.download")}
            </button>
          )}{" "}
          {n.key === "speech.questionsModel" && busy && modelsBridge() && (
            <StopButton name={q?.wantedLabel ?? ""} onStop={() => void modelsBridge()?.cancel("speech")} />
          )}
        </p>
      ))}
    </div>
  );
}
