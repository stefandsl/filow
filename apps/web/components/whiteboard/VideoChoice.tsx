"use client";
// "Save video" asks first: with voice or without (owner, 14/11/2026). With voice is the default when a
// voice can be recorded; it records the narration even when the lesson's voice is off, and says so.
// When no voice on this PC can be recorded the choice says why and offers the video without voice.
import { useEffect, useId, useRef } from "react";
import type { BoardVoice } from "@/lib/whiteboard/voice";
import type { WbKey } from "@/lib/whiteboard/text";

/** The lines under the two buttons: why there is no voice, which voice reads, and that a muted voice is still recorded. */
export function videoChoiceNotes(voice: BoardVoice, voiceOn: boolean): WbKey[] {
  if (voice.voice === "off") return ["voiceRecordNone"];
  return [...(voice.note ? [voice.note] : []), ...(voiceOn ? [] : (["videoVoiceMuted"] as const))];
}

export function VideoChoice({ t, voice, voiceOn, onPick, onCancel }: { t: (k: WbKey) => string; voice: BoardVoice; voiceOn: boolean; onPick: (withVoice: boolean) => void; onCancel: () => void }) {
  const id = useId();
  const can = voice.voice !== "off";
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  const notes = videoChoiceNotes(voice, voiceOn);
  return (
    <div className="wb-choice" role="group" aria-labelledby={`${id}-l`} aria-describedby={notes.length ? `${id}-n` : undefined} data-choice="video" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } }}>
      <span id={`${id}-l`} className="wb-choice-label">{t("videoChoice")}</span>
      <button ref={can ? first : undefined} type="button" className={`wb-btn${can ? " primary" : ""}`} data-action="video-voice" disabled={!can} onClick={() => onPick(true)}>{t("videoWithVoice")}</button>
      <button ref={can ? undefined : first} type="button" className={`wb-btn${can ? "" : " primary"}`} data-action="video-silent" onClick={() => onPick(false)}>{t("videoNoVoice")}</button>
      <button type="button" className="wb-btn" data-action="video-cancel" onClick={onCancel}>{t("videoCancel")}</button>
      {notes.length > 0 && <p id={`${id}-n`} className="wb-note">{notes.map((k) => t(k)).join(" ")}</p>}
    </div>
  );
}
