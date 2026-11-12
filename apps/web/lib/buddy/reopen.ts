/**
 * Hands-free OK Filow: the microphone is closed while Filow speaks, and `speak()` resolves on the audio
 * context's clock, which ignores the output device's latency. Listening again at once could hear the tail of
 * Filow's own voice, so after speech the microphone opens only after this quiet gap.
 */
export const REOPEN_GAP_MS = 600;

/**
 * Calls `listen` after `delayMs`, only if `stillWanted()` is still true then. No cancel handle: Stop and a new
 * question change the run id, and turning hands-free off clears its flag, so the predicate covers them.
 */
export function reopenAfterSpeech(listen: () => void, stillWanted: () => boolean, delayMs: number = REOPEN_GAP_MS): void {
  setTimeout(() => { if (stillWanted()) listen(); }, delayMs);
}