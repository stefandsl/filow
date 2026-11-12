"use client";
// The answer bubble next to the pointer (docs/okfilow/BUBBLE.md): the whole answer, always. It grows
// to half the screen's height and scrolls inside itself beyond that; nothing is ever cut with an
// ellipsis. A close button for the mouse; the keyboard closes it with Esc (the desktop shell's hook),
// because the overlay window never takes the keyboard from the app in use.
import { Fragment, type Ref, type UIEvent } from "react";
import type { OkFilowMode } from "@/lib/buddy/bridge";
import { sentenceParts } from "@/lib/buddy/turn";
import type { OkfKey } from "@/lib/buddy/text";

type T = (k: OkfKey) => string;
const BARS = [0.55, 0.85, 1, 0.8, 0.5];

/** An answer (or an error, or a note) is in the bubble: it holds still for the pointer and can be closed. Not while listening: that is the waveform, or a dictation's words. */
export const answerInBubble = (mode: OkFilowMode, text: string, stopped: boolean): boolean => mode !== "listening" && (Boolean(text) || stopped);
/** The close button is there once the text is whole (while it is still being written, a closed bubble would only come back with the next words). */
export const bubbleClosable = (mode: OkFilowMode, text: string, stopped: boolean): boolean => mode !== "thinking" && answerInBubble(mode, text, stopped);

/** Marks the text's room when more text lies below what is in view (the last line then fades out instead of being cut in half). */
export function markMore(box: HTMLElement | null) {
  if (box) box.dataset.more = box.scrollHeight - box.scrollTop - box.clientHeight > 2 ? "1" : "0";
}

export function AnswerBubble({ mode, text, stopped, shown, level = 0, spoken = -1, t, onClose, bubbleRef, textRef }: {
  mode: OkFilowMode;
  text: string;
  /** The answer on screen was stopped by the user. */
  stopped: boolean;
  /** On screen (the display with the pointer, and not closed). */
  shown: boolean;
  /** The microphone's level while listening, 0 to 1. */
  level?: number;
  /** The sentence the voice is on (-1: none). */
  spoken?: number;
  t: T;
  onClose: () => void;
  bubbleRef?: Ref<HTMLDivElement>;
  textRef?: Ref<HTMLDivElement>;
}) {
  const answer = answerInBubble(mode, text, stopped);
  return (
    <div
      ref={bubbleRef}
      className={"okf-bubble" + (shown ? "" : " okf-hidden") + (mode === "error" ? " okf-bubble--error" : "") + (answer ? " okf-bubble--answer" : "")}
      role="group"
      aria-label="OK Filow"
      data-testid="okf-bubble"
    >
      {mode === "listening" && (
        <span className="okf-wave" aria-hidden>{BARS.map((b, i) => <i key={i} style={{ height: `${4 + Math.round(level * b * 18)}px` }} />)}</span>
      )}
      {mode === "thinking" && <span className="okf-spin" aria-hidden />}
      {(text || stopped) && (
        <div className="okf-bubble-body">
          {/* Every sentence is here, whole: the room scrolls, the text is never cut. (The panel holds the same answer for screen readers.) */}
          {text && (
            <div ref={textRef} className="okf-text" aria-hidden data-testid="okf-bubble-text" onScroll={(e: UIEvent<HTMLDivElement>) => markMore(e.currentTarget)}>
              {sentenceParts(text).map((part, i) => {
                // The spacing after a sentence stays outside its span, so the mark on the spoken sentence ends with its last letter.
                const body = part.trimEnd();
                return <Fragment key={i}><span data-s={i} className={i === spoken ? "okf-said" : undefined}>{body}</span>{part.slice(body.length)}</Fragment>;
              })}
            </div>
          )}
          {/* What was said stays, marked: the user stopped it, nothing went wrong. */}
          {stopped && <span className="okf-bubble-stopped">{t("stopped")}</span>}
        </div>
      )}
      {bubbleClosable(mode, text, stopped) && (
        <button type="button" className="okf-bubble-close" data-testid="okf-bubble-close" aria-label={t("closeAnswer")} title={`${t("closeAnswer")} (Esc)`} tabIndex={shown ? 0 : -1} onClick={onClose}>
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" /></svg>
        </button>
      )}
    </div>
  );
}
