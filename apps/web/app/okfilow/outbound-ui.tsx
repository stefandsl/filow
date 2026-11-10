"use client";

// "Going outside": the notice before the first send to a recipient, the signal while something is
// in flight, and the list where each choice can be withdrawn. Shared by the OK Filow panel and the
// take page. The rules live in lib/buddy/outbound.ts; nothing here decides whether to send.

import { useEffect, useId, useRef } from "react";
import { joinNames, noticeBody, type ConsentMap, type Decision, type NoticeRequest, type OutboundKind, type OutboundSnapshot } from "@/lib/buddy/outbound";
import type { OkfKey } from "@/lib/buddy/text";

type T = (k: OkfKey) => string;

/** The arrow that leaves its box: the same mark in the panel, on the take page and next to the cursor. */
export function OutboundIcon({ size = 14 }: { size?: number }) {
  return (
    <svg className="okf-out-icon" width={size} height={size} viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M6.5 3H3.5A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14h8a1.5 1.5 0 0 0 1.5-1.5v-3" />
      <path d="M9 2h5v5M14 2 7.5 8.5" />
    </svg>
  );
}

/**
 * Asked before the first send of one kind of content to one recipient. Focus lands on the notice
 * itself, not on a button, so a key press that was meant for something else cannot send anything.
 */
export function OutboundNotice({ notice, t, onDecide }: { notice: NoticeRequest; t: T; onDecide: (d: Decision) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const key = `${notice.kind}:${notice.recipient.id}`;
  useEffect(() => { box.current?.focus(); }, [key]);
  return (
    <div
      ref={box}
      className="okf-notice"
      role="alertdialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      tabIndex={-1}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onDecide("dismissed"); } }}
    >
      <h2 id={`${id}-title`}><OutboundIcon size={16} />{t("noticeTitle")}</h2>
      <p id={`${id}-body`}>{noticeBody(notice, t)}</p>
      <p className="okf-notice-more">{t("noticeRemember")}</p>
      <div className="okf-notice-actions">
        <button type="button" className="okf-notice-keep" onClick={() => onDecide("declined")}>{t("noticeKeep")}</button>
        <button type="button" className="okf-notice-send" onClick={() => onDecide("granted")}>{t("noticeSend")}</button>
      </div>
    </div>
  );
}

/** The signal: shown only while something is leaving this PC. Put it inside a live region. */
export function OutboundPill({ snap, t }: { snap: OutboundSnapshot; t: T }) {
  if (!snap.active || !snap.names.length) return null;
  return (
    <span className="okf-out">
      <OutboundIcon />
      <span className="okf-out-label">{t("outLabel")}</span>
      <span className="okf-out-to">{t("outSending").replace("{names}", joinNames(snap.names, t("outAnd")))}</span>
    </span>
  );
}

/** Every stored choice, each one withdrawable. */
export function ConsentList({ consent, t, onForget }: { consent: ConsentMap | undefined; t: T; onForget: (key: string) => void }) {
  const entries = Object.entries(consent ?? {});
  return (
    <div className="okf-consent">
      <h2>{t("consentTitle")}</h2>
      {entries.length === 0 && <p className="okf-note">{t("consentEmpty")}</p>}
      {entries.length > 0 && (
        <ul>
          {entries.map(([key, entry]) => {
            const what = t(`kind_${key.slice(0, key.indexOf(":")) as OutboundKind}` as OkfKey);
            const to = t("consentTo").replace("{names}", joinNames(entry.names, t("outAnd")));
            const action = entry.state === "granted" ? t("consentWithdraw") : t("consentAskAgain");
            return (
              <li key={key}>
                <span className="okf-consent-what">{what} <span className="okf-consent-to">{to}</span></span>
                <span className={`okf-chip okf-consent-chip--${entry.state}`}>{entry.state === "granted" ? t("consentGranted") : t("consentDeclined")}</span>
                <button type="button" className="okf-link" aria-label={`${action}: ${what} ${to}`} onClick={() => onForget(key)}>{action}</button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
