// OK Filow's microphone, as the main process sees it (the panel opens it: apps/web/app/okfilow/panel,
// apps/web/lib/buddy/micOpen.ts). Kept here, without Electron, so it can be tested.
// Windows can take seconds to hand a microphone over (0.9.37: 15 s on every press until the PC was
// restarted) and nothing in the log said so. The panel now tells main how long each open took
// (`okfilow:mic`), and main writes one line for every slow one and keeps the numbers for
// "Report a problem". Numbers and fixed words only: never a device name.

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

/** An open that took longer than this gets its line in startup.log. */
const MIC_SLOW_LOG_MS = 1000;
/** No open time above this is kept (a clock that jumped, a PC that slept). */
const MIC_MS_MAX = 10 * 60 * 1000;
const STATES = Object.freeze(["live", "late", "waiting"]);

/**
 * What the panel said about one open, checked: { ms, state, fallback }, or null when there is no time in it.
 *   state "live": it opened and is being listened to; "late": it opened after the wait had been
 *   abandoned (and was closed at once); "waiting": the wait was abandoned and it is still not open.
 *   fallback: the microphone saved in Settings is not connected, the default one was opened.
 */
function micOpenFacts(payload) {
  const p = payload && typeof payload === "object" ? payload : null;
  if (!p || typeof p.ms !== "number" || !Number.isFinite(p.ms) || p.ms < 0) return null;
  return { ms: Math.min(MIC_MS_MAX, Math.round(p.ms)), state: STATES.includes(p.state) ? p.state : "live", fallback: p.fallback === true };
}

/** The log line for one open, or "" when it is not worth one (a quick open of the microphone the user chose). */
function micOpenLine(facts) {
  if (!facts) return "";
  const slow = facts.ms > MIC_SLOW_LOG_MS;
  if (facts.state === "waiting") return slow ? `okfilow: microphone still not open after ${facts.ms} ms: nothing was recorded` : "";
  if (facts.state === "late") return slow ? `okfilow: microphone opened in ${facts.ms} ms, after the keys went up: nothing was recorded` : "";
  if (!slow && !facts.fallback) return "";
  return `okfilow: microphone opened in ${facts.ms} ms${facts.fallback ? " (the saved microphone is not connected: the default one is used)" : ""}`;
}

/** The opens of this run of Filow: `note(payload)` returns the line to log (or ""), `report()` the words for "Report a problem". */
function createMicOpens() {
  let count = 0;
  let lastMs = 0;
  let maxMs = 0;
  let slow = 0;
  let late = 0;
  let fallback = false;
  return {
    note(payload) {
      const f = micOpenFacts(payload);
      if (!f) return "";
      // A wait that was abandoned is not an open yet: its open (if it comes) reports itself as "late".
      if (f.state !== "waiting") {
        count += 1;
        lastMs = f.ms;
        maxMs = Math.max(maxMs, f.ms);
        if (f.ms > MIC_SLOW_LOG_MS) slow += 1;
        if (f.state === "late" && f.ms > MIC_SLOW_LOG_MS) late += 1;
        fallback = f.fallback;
      }
      return micOpenLine(f);
    },
    report() {
      if (!count) return "not opened since Filow started";
      return `opened ${count} ${count === 1 ? "time" : "times"} since Filow started: last in ${lastMs} ms, slowest ${maxMs} ms${slow ? `, ${slow} over 1 s` : ""}${late ? `, ${late} too late to record anything` : ""}${fallback ? "; the saved microphone is not connected, the default one is used" : ""}`;
    },
  };
}

/**
 * An error from the panel ends the hold main is counting (the panel could not start listening, so no
 * release must be waited for) only when the panel says it is about listening (`listen`: the microphone
 * or the recognizer of the recording in progress failed, or its open was given up on). An error that belongs to the
 * recording before ("I didn't catch that", arriving while the keys are down again) used to end the
 * new hold: the release that followed was dropped and the microphone stayed open with the keys up.
 */
const errorEndsHold = ({ held, listen }) => held === true && listen === true;

/** Sound may come this long with no key held before it is stopped (a release waits for the recognizer to load, 2 s on first use). */
const CAPTURE_GRACE_MS = 4000;

/**
 * The watchdog: sound from the microphone is expected only while a key is held or a hands-free mode
 * is on (`allowed`). `frame(allowed)` is called for every block of sound the panel hands over and
 * returns true once sound has kept coming for `graceMs` with nothing allowing it: the capture must
 * be stopped. It then starts counting again (so a capture that will not stop is stopped again).
 */
function createCaptureWatch({ graceMs = CAPTURE_GRACE_MS, now = Date.now } = {}) {
  let since = null;
  return {
    frame(allowed) {
      if (allowed) { since = null; return false; }
      const t = now();
      if (since === null) { since = t; return false; }
      if (t - since < graceMs) return false;
      since = null;
      return true;
    },
    /** The capture ended (or a new one starts): nothing is being counted. */
    reset() { since = null; },
  };
}

module.exports = { errorEndsHold, CAPTURE_GRACE_MS, createCaptureWatch, QA_MIC_DELAY_MAX_MS, qaMicDelay, MIC_SLOW_LOG_MS, micOpenFacts, micOpenLine, createMicOpens };
