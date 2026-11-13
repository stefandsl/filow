// OK Filow's microphone, as the main process sees it (the panel opens it: apps/web/app/okfilow/panel).
// Kept here, without Electron, so it can be tested.

/** The longest wait a test may ask for: a minute. */
const QA_MIC_DELAY_MAX_MS = 60_000;

/**
 * FILOW_OKF_QA_MIC_DELAY as whole milliseconds (test builds only; okfilow.js hands in "" otherwise):
 * 0 for anything that is not a positive number, at most a minute.
 */
function qaMicDelay(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(QA_MIC_DELAY_MAX_MS, n) : 0;
}

module.exports = { QA_MIC_DELAY_MAX_MS, qaMicDelay };
