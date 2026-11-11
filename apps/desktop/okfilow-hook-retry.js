// Starting the keyboard hook, and starting it again until it works (issue #6).
// Windows can refuse a low-level keyboard hook ("Failed to register low level windows hook."), for a
// moment at launch or for much longer. Filow used to try four times in eight seconds and then only every
// 30 seconds without a word in the log; from the log it looked as if it had given up for the session.
// Now: four quick tries, then a growing delay (5, 10, 20, 30 s, then every 60 s) for as long as Filow
// runs, and a prompt new try whenever the PC is unlocked, wakes up or its displays change, since those
// are the moments Windows starts allowing the hook again. Pure logic: the uiohook wiring is in okfilow.js.

const QUICK_MS = [2000, 2000, 2000, 2000];
const SLOW_MS = [5000, 10_000, 20_000, 30_000, 60_000];
const NUDGE_MS = 1000;

/** The wait before the next try, after `failures` failed tries in a row (1 or more). */
function retryDelay(failures) {
  const n = Math.max(1, Math.floor(failures));
  if (n <= QUICK_MS.length) return QUICK_MS[n - 1];
  return SLOW_MS[Math.min(n - QUICK_MS.length - 1, SLOW_MS.length - 1)];
}

/** What the hook library said, with its error code when it gives one (UIOHOOK_ERROR_SET_WINDOWS_HOOK_EX). */
function describeHookError(e) {
  const message = String((e && e.message) || e);
  const code = e && typeof e.code === "string" && e.code ? e.code : "";
  return code ? `${message} [${code}]` : message;
}

/**
 * @param {{
 *   start: () => void,                      throws when the hook cannot be registered
 *   onUp: (info: { failures: number }) => void,
 *   onDown: (info: { error: unknown, failures: number, delayMs: number, quick: boolean, fallback: boolean }) => void,
 *   quickFor?: (error: unknown) => boolean,  false: this error will not pass in seconds, skip the quick tries
 *   setTimeout?: typeof setTimeout, clearTimeout?: typeof clearTimeout }} o
 * `onDown` gets `fallback: true` exactly once per outage, when the quick tries are used up: the moment to
 * offer the fallback key and tell the user.
 */
function createHookRetry(o) {
  const st = o.setTimeout || setTimeout;
  const ct = o.clearTimeout || clearTimeout;
  let up = false;
  let failures = 0; // failed tries in a row, for the delay
  let total = 0; // failed tries since the hook last worked, for the log
  let fellBack = false;
  let timer = null;
  let stopped = false;

  function schedule(ms) {
    if (timer) ct(timer);
    timer = st(() => { timer = null; attempt(); }, ms);
  }

  function attempt() {
    if (stopped || up) return up;
    if (timer) { ct(timer); timer = null; }
    try {
      o.start();
    } catch (error) {
      total += 1;
      failures += 1;
      if (failures <= QUICK_MS.length && o.quickFor && !o.quickFor(error)) failures = QUICK_MS.length + 1;
      const quick = failures <= QUICK_MS.length;
      const fallback = !quick && !fellBack;
      if (fallback) fellBack = true;
      const delayMs = retryDelay(failures);
      schedule(delayMs);
      o.onDown({ error, failures: total, delayMs, quick, fallback });
      return false;
    }
    const was = total;
    up = true;
    failures = 0;
    total = 0;
    fellBack = false;
    o.onUp({ failures: was });
    return true;
  }

  /**
   * Something changed that often makes Windows allow the hook again (unlock, wake, a display change): try
   * in a second, and start the growing delay over from its first step. Nothing to do while the hook works.
   */
  function nudge() {
    if (stopped || up) return;
    failures = Math.min(failures, QUICK_MS.length);
    schedule(NUDGE_MS);
  }

  /** The hook stopped working or was taken down on purpose: `attempt()` starts over. */
  function down() { up = false; }

  function stop() {
    stopped = true;
    if (timer) ct(timer);
    timer = null;
  }

  return {
    attempt, nudge, down, stop,
    get up() { return up; },
    get failures() { return total; },
    get waiting() { return timer !== null; },
  };
}

module.exports = { createHookRetry, retryDelay, describeHookError, QUICK_MS, SLOW_MS, NUDGE_MS };
