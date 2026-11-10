// The notice, the signal and the list of choices for the clients that run outside the Filow window
// (the PowerPoint add-in and the browser extension). Same notice and pill as the OK Filow panel and
// the take page (app/okfilow/outbound-ui.tsx); the rules are in lib/buddy/outboundPage.ts and
// outboundRemote.ts. These clients import it through their "@" alias to apps/web, so it must not
// import anything that only the web app has.
import { useEffect, useSyncExternalStore } from "react";
import { OKF_TEXT, type OkfKey } from "@/lib/buddy/text";
import type { OutboundKind } from "@/lib/buddy/outbound";
import type { PageOutbound } from "@/lib/buddy/outboundPage";
import { ConsentList, OutboundNoticeFor, OutboundSignalFor } from "@/app/okfilow/outbound-ui";
import "@/app/okfilow/outbound.css";
import "./RemoteOutbound.css";

/** Sentences a client says its own way (the extension looks at a browser tab, not at a shared screen). */
export type TextSwap = Partial<Record<OkfKey, OkfKey>>;

/** OK Filow's strings in the client's language (English for a language they do not have yet). */
export function remoteText(lang: string, swap: TextSwap = {}): (k: OkfKey) => string {
  const table = OKF_TEXT[lang === "it" ? "it" : "en"];
  // These clients keep their own choices: the sentences that point at OK Filow's settings point here.
  const own: TextSwap = { consentEmpty: "consentEmptyHere", ...swap };
  return (k) => table[own[k] ?? k];
}

/** The browser extension's wording: it sends a picture of the tab it follows, with the slide's title. */
export const EXTENSION_TEXT: TextSwap = { notice_screen: "notice_screenTab", kind_screen: "kind_screenTab", kept_screen: "kept_screenTab" };

/** The controller's state (notice, signal, choices), re-rendered on every change. */
export function useRemoteOutbound(out: PageOutbound) {
  const state = useSyncExternalStore(out.subscribe, out.getState, out.getState);
  useEffect(() => { void out.load(); }, [out]);
  return state;
}

/** The notice before the first send to a recipient, as a modal: nothing behind it works until it is answered. */
export function RemoteOutboundNotice({ out, lang, swap }: { out: PageOutbound; lang: string; swap?: TextSwap }) {
  const state = useRemoteOutbound(out);
  const t = remoteText(lang, swap);
  return <OutboundNoticeFor state={state} t={t} more={t("noticeRememberHere")} onDecide={(d) => void out.decide(d)} />;
}

const KEPT: Partial<Record<OutboundKind, OkfKey>> = { audio: "kept_takeHere", transcript: "kept_takeHere", screen: "kept_screen", script: "kept_script" };

/**
 * The signal while something is leaving this PC, and what a "Keep it on this PC" answer kept back.
 * Always rendered, so screen readers hear each change in the live region.
 */
export function RemoteOutboundSignal({ out, lang, swap }: { out: PageOutbound; lang: string; swap?: TextSwap }) {
  const state = useRemoteOutbound(out);
  return <OutboundSignalFor state={state} t={remoteText(lang, swap)} kept={KEPT} className="okf-out-region--bar" />;
}

/** Every stored choice of this client, each one withdrawable, folded away until opened. */
export function RemoteConsentList({ out, lang, swap }: { out: PageOutbound; lang: string; swap?: TextSwap }) {
  const state = useRemoteOutbound(out);
  const t = remoteText(lang, swap);
  return (
    <details className="okf-remote-consent">
      <summary>{t("consentTitle")}</summary>
      <ConsentList consent={state.consent} t={t} onForget={(key) => void out.forget(key)} />
    </details>
  );
}
