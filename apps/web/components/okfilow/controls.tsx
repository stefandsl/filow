"use client";

// Two plain controls of OK Filow, shared by the panel and the pill next to the pointer: Stop (ends
// the answer in progress) and "Look at my screen" (whether a question takes the screen with it;
// lib/buddy/sees.ts). Nothing here decides anything: the panel owns the state.
import { OutboundIcon } from "@/app/okfilow/outbound-ui";
import type { OkfKey } from "@/lib/buddy/text";

type T = (k: OkfKey) => string;

/** An eye, or an eye struck through: the same mark on the switch and on the pill while asking. */
export function EyeIcon({ off = false, size = 16 }: { off?: boolean; size?: number }) {
  return (
    <svg className="okf-eye" width={size} height={size} viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="2" />
      {off && <path d="M2.5 13.5 13.5 2.5" />}
    </svg>
  );
}

/**
 * Stops the answer. Shown only while an answer is in progress; the caller keeps the room for it so
 * nothing moves when it comes and goes. `pill`: the compact form next to the pointer.
 */
export function StopButton({ active, t, onStop, pill = false }: { active: boolean; t: T; onStop: () => void; pill?: boolean }) {
  if (!active) return null;
  return (
    <button type="button" className={"okf-stop" + (pill ? " okf-stop--pill" : "")} aria-label={t("stopHint")} title={t("stopHint")} onClick={onStop} data-testid="okf-stop">
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden focusable="false"><rect width="10" height="10" rx="2" /></svg>
      <span>{t("stop")}</span>
      {pill && <kbd>Esc</kbd>}
    </button>
  );
}

/**
 * The switch. `on`: questions take the screen with them. `slow`: looking is slow on this PC (said,
 * the user still chooses). `leaves`: answers come from online, so with the switch on pictures of the
 * screen go to `who` (the same mark as the "going outside" signal; the notice and the yes it needs
 * are the panel's, unchanged) and with it off none leave.
 */
export function SeeScreenSwitch({ on, slow, leaves, who, t, onChange, id = "okf-see" }: { on: boolean; slow: boolean; leaves: boolean; who: string; t: T; onChange: (next: boolean) => void; id?: string }) {
  return (
    <div className="okf-see" data-testid="okf-see">
      <button type="button" role="switch" aria-checked={on} aria-describedby={`${id}-what`} className={"okf-see-switch" + (on ? " okf-see-switch--on" : "")} onClick={() => onChange(!on)}>
        <EyeIcon off={!on} />
        <span className="okf-see-name">{t("seeScreen")}</span>
        <span className="okf-see-state">{t(on ? "seeStateOn" : "seeStateOff")}</span>
        <span className="okf-see-track" aria-hidden><i /></span>
      </button>
      <p id={`${id}-what`} className="okf-see-what">
        {t(on ? "seeOn" : "seeOff")}
        {slow && <> <span className="okf-see-slow">{t("seeSlow")}</span></>}
      </p>
      {/* Answers from online: always one line here (so nothing moves), saying where the pictures go or that none leave. */}
      {leaves && (
        <p className={"okf-see-out" + (on ? "" : " okf-see-out--kept")}>
          {on && <OutboundIcon />}
          <span>{on ? t("seeLeaves").replace("{names}", who) : t("seeKept")}</span>
        </p>
      )}
    </div>
  );
}
