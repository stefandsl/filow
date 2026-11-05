export const SILENCE_PEAK = 1e-4;
export const SILENCE_MS = 4000;
export type SilenceState = { lastAudioAt: number; silent: boolean };

/** Pure transition, also called with zero when the capture graph produces no chunks. */
export function detectSilence(state: SilenceState, peak: number, at: number): SilenceState {
  const lastAudioAt = peak > SILENCE_PEAK ? at : state.lastAudioAt;
  return { lastAudioAt, silent: at - lastAudioAt >= SILENCE_MS };
}

export type MicWarning = { kind: "silence" | "ended" | "slow-context"; label: string; elapsedMs?: number };
