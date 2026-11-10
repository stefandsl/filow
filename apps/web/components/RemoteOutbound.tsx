// The notice, the signal and the list of choices for the clients that run outside the Filow window
// (the PowerPoint add-in and the browser extension). Same notice and pill as the OK Filow panel and
// the take page (app/okfilow/outbound-ui.tsx); the rules are in lib/buddy/outboundPage.ts and
// outboundRemote.ts. These clients import it through their "@" alias to apps/web, so it must not
// import anything that only the web app has.
import { useEffect, useSyncExternalStore } from "react";
import { OKF_TEXT, type OkfKey } from "@/lib/buddy/text";
import type { OutboundKind } from "@/lib/buddy/outbound";
import type { PageOutbound } from "@/lib/buddy/outboundPage";
import { ConsentList, OutboundNoticeModal, OutboundPill } from "@/app/okfilow/outbound-ui";
import "@/app/okfilow/outbound.css";
import "./RemoteOutbound.css";

/** OK Filow's strings in the client's language (English for a language they do not have yet). */
export function remoteText(lang: string): (k: OkfKey) => string {
  const table = OKF_TEXT[lang === "it" ? "it" : "en"];
  // These clients keep their own choices: the sentences that point at OK Filow's settings point here.
  return (k) => table[k === "consentEmpty" ? "consentEmptyHere" : k];
}

/** The controller's state (notice, signal, choices), re-rendered on every change. */
export function useRemoteOutbound(out: PageOutbound) {
  const state = useSyncExternalStore(out.subscribe, out.getState, out.getState);
  useEffect(() => { void out.load(); }, [out]);
  return state;
}

/** The notice before the first send to a recipient, as a modal: nothing behind it works until it is answered. */
export function RemoteOutboundNotice({ out, lang }: { out: PageOutbound; lang: string }) {
  const state = useRemoteOutbound(out);
  const t = remoteText(lang);
  const n = state.notice;
  if (!n) return null;
  return <OutboundNoticeModal key={`${n.kind}:${n.recipient.id}`} notice={n} t={t} more={t("noticeRememberHere")} onDecide={(d) => void out.decide(d)} />;
}

const KEPT: Partial<Record<OutboundKind, OkfKey>> = { audio: "kept_takeHere", transcript: "kept_takeHere", screen: "kept_screen", script: "kept_script" };

/**
 * The signal while something is leaving this PC, and what a "Keep it on this PC" answer kept back.
 * Always rendered, so screen readers hear each change in the live region.
 */
export function RemoteOutboundSignal({ out, lang }: { out: PageOutbound; lang: string }) {
  const state = useRemoteOutbound(out);
  const t = remoteText(lang);
  const kept = state.kept && !state.snap.active ? KEPT[state.kept] : undefined;
  return (
    <div className="okf-out-region okf-out-region--bar" role="status" aria-live="polite">
      {state.snap.active ? <OutboundPill snap={state.snap} t={t} /> : kept ? <span className="okf-out-kept">{t(kept)}</span> : null}
    </div>
  );
}

/** Every stored choice of this client, each one withdrawable, folded away until opened. */
export function RemoteConsentList({ out, lang }: { out: PageOutbound; lang: string }) {
  const state = useRemoteOutbound(out);
  const t = remoteText(lang);
  return (
    <details className="okf-remote-consent">
      <summary>{t("consentTitle")}</summary>
      <ConsentList consent={state.consent} t={t} onForget={(key) => void out.forget(key)} />
    </details>
  );
}
