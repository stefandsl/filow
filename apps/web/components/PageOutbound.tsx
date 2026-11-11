"use client";
// The take page's notice and signal (docs/okfilow/OUTBOUND.md). The rules are in
// lib/buddy/outboundPage.ts; this file only shows them, in the page's language.
import { useLang } from "@filow/ui";
import { okfText, type OkfKey } from "@/lib/buddy/text";
import type { OutboundKind } from "@/lib/buddy/outbound";
import { OutboundNoticeFor, OutboundSignalFor } from "@/app/okfilow/outbound-ui";
import "@/app/okfilow/outbound.css";
import { usePageOutbound } from "./usePageOutbound";

/** OK Filow's strings in the page's language. */
export function useOkfText(): (k: OkfKey) => string {
  return okfText(useLang());
}

const KEPT: Partial<Record<OutboundKind, OkfKey>> = { audio: "kept_take", transcript: "kept_take", screen: "kept_screen", script: "kept_script" };

/** The notice before the first send to a recipient: a modal above everything else on the page. */
export function PageOutboundNotice() {
  const { out, state } = usePageOutbound();
  const okt = useOkfText();
  return <OutboundNoticeFor state={state} t={okt} more={okt("noticeRememberTake")} onDecide={(d) => void out.decide(d)} />;
}

/**
 * The signal while something is leaving this PC, and what a "Keep it on this PC" answer kept back.
 * Always rendered, so screen readers hear each change in the live region.
 */
export function PageOutboundSignal({ className = "" }: { className?: string }) {
  const { state } = usePageOutbound();
  const okt = useOkfText();
  return <OutboundSignalFor state={state} t={okt} kept={KEPT} className={className} />;
}
