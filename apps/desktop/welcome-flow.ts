// Pure logic of the first-run welcome (docs/welcome/ONBOARDING-V2.md): which steps a run shows and how
// the microphone check reads its input. No DOM here, so it is unit tested; welcome.ts wires it up.

export type StepId = "language" | "mic" | "setup" | "preferences";

/**
 * A first run is a guided flow, one decision per step. Reopened later from the menu (Filow > Welcome...)
 * the window is the preferences page. The setup step is left out when the installer already chose.
 */
export function welcomeSteps({ firstRun, askSetup }: { firstRun: boolean; askSetup: boolean }): StepId[] {
  if (!firstRun) return ["preferences"];
  return askSetup ? ["language", "mic", "setup"] : ["language", "mic"];
}

/**
 * The setup step asks "download?" only when there is something to fetch and a way to fetch it. Ready for a
 * first take does not end the offer: the rest of the recommendation is still offered (review T3 finding 4).
 */
export function offersDownload(offer: { online: boolean; unknown?: boolean; downloadGb: number }): boolean {
  return offer.online && !offer.unknown && offer.downloadGb > 0;
}

export type MicErrorKind = "none" | "blocked" | "busy";

/** getUserMedia error name to what the user can do about it. */
export function micErrorKind(name: string): MicErrorKind {
  if (/^(NotFoundError|OverconstrainedError|DevicesNotFoundError)$/.test(name)) return "none";
  if (/^(NotAllowedError|SecurityError|PermissionDeniedError)$/.test(name)) return "blocked";
  return "busy";
}

/** RMS of a frame (0..1) to a meter level (0..1) on a dB scale: -60 dBFS reads 0, -6 dBFS reads 1. */
export function levelFromRms(rms: number): number {
  if (!(rms > 0)) return 0;
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db + 60) / 54));
}

/** Level that counts as sound (about -33 dBFS: speech near the microphone, not room noise). */
export const MIC_SOUND_LEVEL = 0.5;
/** Sound needed, in total, before the check passes. */
export const MIC_HEARD_MS = 400;
/** Listening this long with no sound shows the "can't hear you" help. */
export const MIC_SILENT_MS = 6000;

export type MicState = { status: "listening" | "heard" | "silent" | MicErrorKind; heardMs: number; listenedMs: number };

export function startMic(): MicState {
  return { status: "listening", heardMs: 0, listenedMs: 0 };
}

/** The Try again row shows when the check failed or heard nothing; it hides while listening and once heard. */
export function micActionsShown(status: MicState["status"]): boolean {
  return status !== "listening" && status !== "heard";
}

/**
 * Keyboard focus when the Try again row shows or hides (review T3 finding 3). Focus on a button that hides
 * would fall to the page, so it waits on the status line (a live region that says "Listening..."); when the
 * row comes back (the check failed again) it returns to Try again. Focus anywhere else is left alone.
 */
export function micFocusMove(actionsShown: boolean, focus: "actions" | "status" | "other"): "status" | "retry" | null {
  if (!actionsShown && focus === "actions") return "status";
  if (actionsShown && focus === "status") return "retry";
  return null;
}

/**
 * Microphones plugged in or out during the check (review T3 finding 5). No input left: say "No microphone".
 * One came back (or appeared) after the check failed or heard nothing: check again on its own.
 */
export function micDeviceChange(status: MicState["status"], hasInput: boolean): "none" | "restart" | null {
  if (!hasInput) return status === "none" ? null : "none";
  return status === "none" || status === "busy" || status === "silent" ? "restart" : null;
}

/** One meter frame: dtMs of audio at `level`. Heard is final; errors are left to the caller. */
export function micTick(state: MicState, level: number, dtMs: number): MicState {
  if (state.status !== "listening" && state.status !== "silent") return state;
  const heardMs = state.heardMs + (level >= MIC_SOUND_LEVEL ? dtMs : 0);
  const listenedMs = state.listenedMs + dtMs;
  if (heardMs >= MIC_HEARD_MS) return { status: "heard", heardMs, listenedMs };
  return { status: listenedMs >= MIC_SILENT_MS ? "silent" : "listening", heardMs, listenedMs };
}
