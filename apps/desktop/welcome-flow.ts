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

/** One meter frame: dtMs of audio at `level`. Heard is final; errors are left to the caller. */
export function micTick(state: MicState, level: number, dtMs: number): MicState {
  if (state.status !== "listening" && state.status !== "silent") return state;
  const heardMs = state.heardMs + (level >= MIC_SOUND_LEVEL ? dtMs : 0);
  const listenedMs = state.listenedMs + dtMs;
  if (heardMs >= MIC_HEARD_MS) return { status: "heard", heardMs, listenedMs };
  return { status: listenedMs >= MIC_SILENT_MS ? "silent" : "listening", heardMs, listenedMs };
}
