"use client";

// The plain controls of OK Filow, shared by the panel and the pill next to the pointer: the eye
// (whether a question takes the screen with it; lib/buddy/sees.ts) as a switch and as a button,
// Pause, Resume and Stop for the answer (docs/okfilow/PILL.md). Nothing here decides anything: the
// panel owns the state.
import { OutboundIcon } from "@/app/okfilow/outbound-ui";
import { keyLabel as shownKey, withKey, type PillView } from "@/lib/buddy/pill";
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
 * One room for several labels: as wide as the widest of them, only `show` visible. What stands in it
 * can change (Pause to Resume, one status to another) without anything around it moving.
 */
export function Slot({ labels, show, className = "" }: { labels: Array<{ key: string; text: string }>; show: string; className?: string }) {
  return (
    <span className={"okf-slot" + (className ? " " + className : "")}>
      {labels.map((l) => (
        <span key={l.key} className={l.key === show ? "okf-slot-on" : "okf-slot-off"} aria-hidden={l.key === show ? undefined : true}>{l.text}</span>
      ))}
    </span>
  );
}

/**
 * The eye as a button: a click opens or closes it (the same setting as the switch "Look at my
 * screen"). It shows the setting as it is now, in a word as well as with the icon. Its name is what
 * a click does; `keyLabel` is its shortcut ("" when it has none).
 */
export function EyeButton({ open, t, keyLabel, onToggle }: { open: boolean; t: T; keyLabel: string; onToggle: () => void }) {
  const name = t(open ? "eyeClose" : "seeScreen");
  return (
    <button type="button" className={"okf-ctl okf-ctl--eye" + (open ? "" : " okf-ctl--shut")} aria-pressed={open} aria-label={name} title={withKey(name, keyLabel)} onClick={onToggle} data-testid="okf-eye">
      <EyeIcon off={!open} size={15} />
      <Slot show={open ? "on" : "off"} labels={[{ key: "on", text: t("seeStateOn") }, { key: "off", text: t("seeStateOff") }]} />
    </button>
  );
}

/**
 * Pause while the answer goes on, Resume while it is paused or was stopped: one button, so the
 * keyboard focus stays on it when it changes, and one room for both words, so nothing moves.
 */
export function PauseButton({ state, t, keyLabel, onPause, onResume }: { state: "pause" | "resume"; t: T; keyLabel: string; onPause: () => void; onResume: () => void }) {
  const name = t(state === "pause" ? "pauseHint" : "resumeHint");
  return (
    <button type="button" className={"okf-ctl okf-ctl--" + state} aria-label={name} title={withKey(name, keyLabel)} onClick={state === "pause" ? onPause : onResume} data-testid={"okf-" + state}>
      {state === "pause"
        ? <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden focusable="false"><rect x="1" width="3" height="10" rx="1" /><rect x="6" width="3" height="10" rx="1" /></svg>
        : <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden focusable="false"><path d="M1.5 0.6v8.8a.6.6 0 0 0 .9.5l7-4.4a.6.6 0 0 0 0-1L2.4.1a.6.6 0 0 0-.9.5Z" /></svg>}
      <Slot show={state} labels={[{ key: "pause", text: t("pause") }, { key: "resume", text: t("resume") }]} />
    </button>
  );
}

/**
 * The controls of an answer, the same on the pill and on the panel's row: Pause or Resume, then
 * Stop while the answer is in progress. `view` says which (lib/buddy/pill.ts pillView).
 */
export function AnswerControls({ view, t, pauseKey, onAction, pill = false }: { view: Pick<PillView, "first" | "stop">; t: T; pauseKey: string; onAction: (action: "pause" | "resume" | "stop") => void; pill?: boolean }) {
  if (!view.first && !view.stop) return null;
  return (
    <span className={"okf-ctls" + (pill ? " okf-ctls--pill" : "")} data-testid="okf-ctls">
      {view.first && <PauseButton state={view.first} t={t} keyLabel={pauseKey} onPause={() => onAction("pause")} onResume={() => onAction("resume")} />}
      <StopButton active={view.stop} t={t} onStop={() => onAction("stop")} pill={pill} />
    </span>
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
export function SeeScreenSwitch({ on, slow, leaves, who, t, onChange, keyLabel = "", id = "okf-see" }: { on: boolean; slow: boolean; leaves: boolean; who: string; t: T; onChange: (next: boolean) => void; keyLabel?: string; id?: string }) {
  const described = [`${id}-what`, leaves ? `${id}-out` : "", keyLabel ? `${id}-key` : ""].filter(Boolean).join(" ");
  return (
    <div className="okf-see" data-testid="okf-see">
      <button type="button" role="switch" aria-checked={on} aria-describedby={described} className={"okf-see-switch" + (on ? " okf-see-switch--on" : "")} onClick={() => onChange(!on)}>
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
        <p id={`${id}-out`} className={"okf-see-out" + (on ? "" : " okf-see-out--kept")}>
          {on && <OutboundIcon />}
          <span>{on ? t("seeLeaves").replace("{names}", who) : t("seeKept")}</span>
        </p>
      )}
      {/* The eye's shortcut, from anywhere on this PC. */}
      {keyLabel && <p id={`${id}-key`} className="okf-see-key">{t("eyeKey").replace("{key}", keyLabel)}</p>}
    </div>
  );
}

/**
 * One of the pill's two shortcuts: a short list to choose from (the last entry is "no shortcut").
 * `state` "taken": Windows refused the key because another app has it, said in plain words.
 */
export function KeyChoice({ label, value, choices, state, t, onChange }: { label: string; value: string; choices: string[]; state?: string; t: T; onChange: (next: string) => void }) {
  return (
    <>
      <label className="okf-row">
        <span>{label}</span>
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {choices.map((k) => <option key={k} value={k}>{shownKey(k) || t("keyNone")}</option>)}
        </select>
      </label>
      {state === "taken" && <p className="okf-warn okf-key-taken" role="status">{t("keyTaken").replace("{key}", shownKey(value))}</p>}
    </>
  );
}
