// The microphone's open, as OK Filow and dictation live it (the panel, app/okfilow/panel/page.tsx).
// Windows can take a long time to hand a microphone over (0.9.37: 15 s on every press, until the PC
// was restarted). The pointer used to say "listening" from the key press, so everything said while
// the microphone opened was lost, and the user was then told to hold the keys longer.
// Here the open is its own state: it is waited for, said after a moment, given up on truthfully when
// the keys go up or it never comes, and a microphone that arrives after that is closed at once.
import type { OkfKey } from "./text";

/** Still opening after this long: the pointer says so. Shorter than that is a flicker nobody reads. */
export const MIC_NOTE_MS = 400;
/** An open this long is slow: it goes to the log, it ends a wait whose keys are up, and it explains a recording with no words. */
export const MIC_SLOW_MS = 1000;
/** Nobody waits longer than this for a microphone, keys down or not (the stall of 0.9.37 was 15 s, and those opened). */
export const MIC_GIVE_UP_MS = 20_000;

export type MicLive<S> = { state: "live"; stream: S; openMs: number };
/** "released": the keys went up first; "gaveUp": it never came; "cancelled": Escape, or the recording was called off. */
export type MicAbandoned = { state: "abandoned"; why: "released" | "gaveUp" | "cancelled"; waitedMs: number };
export type MicOpenResult<S> = MicLive<S> | MicAbandoned;

export type MicOpening<S> = {
  /** Settles once: the microphone is open, or the wait was abandoned. Rejects when the open itself failed first. */
  done: Promise<MicOpenResult<S>>;
  /** The keys went up while it opens: a quick open is still waited for (a short tap), a slow one is abandoned. */
  release(): void;
  /** Escape, or the recording is called off: the wait ends now. */
  cancel(): void;
};

type Timer = ReturnType<typeof setTimeout> | number;

/**
 * Asks for the microphone (`open`) and follows the wait. `onNote`: still opening after `noteMs`.
 * `onOpened(ms, used)`: the microphone opened after `ms`; `used` false when the wait had been abandoned
 * (the stream is then closed with `close`, so the microphone is never left open with nobody listening).
 */
export function openMicrophone<S>(o: {
  open: () => Promise<S>;
  close: (stream: S) => void;
  onNote?: () => void;
  onOpened?: (openMs: number, used: boolean) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => Timer;
  clearTimer?: (id: Timer) => void;
  noteMs?: number;
  slowMs?: number;
  giveUpMs?: number;
}): MicOpening<S> {
  const now = o.now ?? (() => performance.now());
  const setTimer = o.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((id: Timer) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const slowMs = o.slowMs ?? MIC_SLOW_MS;
  const startedAt = now();
  const waited = () => Math.max(0, Math.round(now() - startedAt));
  let settled = false;
  let released = false;
  let resolve!: (r: MicOpenResult<S>) => void;
  let reject!: (e: unknown) => void;
  const done = new Promise<MicOpenResult<S>>((res, rej) => { resolve = res; reject = rej; });
  const timers = new Set<Timer>();
  const later = (fn: () => void, ms: number) => {
    const id = setTimer(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
  };
  const end = () => {
    settled = true;
    for (const id of timers) clearTimer(id);
    timers.clear();
  };
  const abandon = (why: MicAbandoned["why"]) => {
    if (settled) return;
    const waitedMs = waited();
    end();
    resolve({ state: "abandoned", why, waitedMs });
  };

  later(() => { if (!settled) o.onNote?.(); }, o.noteMs ?? MIC_NOTE_MS);
  later(() => abandon("gaveUp"), o.giveUpMs ?? MIC_GIVE_UP_MS);

  o.open().then(
    (stream) => {
      const openMs = waited();
      // The keys went up while it opened: it is closed, never listened to (keys up always end the capture).
      const used = !settled && !released;
      if (used) { end(); resolve({ state: "live", stream, openMs }); }
      else { o.close(stream); abandon("released"); }
      o.onOpened?.(openMs, used);
    },
    (e: unknown) => {
      // Refused after the wait was abandoned: the user has been told already.
      if (settled) return;
      end();
      reject(e);
    },
  );

  return {
    done,
    release() {
      if (settled || released) return;
      released = true;
      const left = slowMs - waited();
      if (left <= 0) abandon("released");
      else later(() => abandon("released"), left);
    },
    cancel() { abandon("cancelled"); },
  };
}

/** Whole seconds for a message, never zero ("took 0 s" reads as nothing happened). */
export const micSeconds = (ms: number): number => Math.max(1, Math.round(ms / 1000));

export type MicNote = { key: Extract<OkfKey, "micSlow" | "micNotOpen">; seconds: number };

/**
 * A recording that gave no words: the microphone's doing when it was slow to open (`openMs`), so the
 * user is told that and not to hold the keys longer. Null after a quick open: the usual hint is right.
 */
export function emptyRecordingNote(openMs: number | null, slowMs = MIC_SLOW_MS): MicNote | null {
  return openMs !== null && openMs >= slowMs ? { key: "micSlow", seconds: micSeconds(openMs) } : null;
}

/** A wait that was abandoned: how long the microphone had been asked for. Null when the user called it off, or only tapped the keys. */
export function abandonedNote(a: MicAbandoned, slowMs = MIC_SLOW_MS): MicNote | null {
  // (keys up within a moment, before a microphone that was not slow: a tap too short to say anything)
  return a.why === "cancelled" || (a.why === "released" && a.waitedMs < slowMs) ? null : { key: "micNotOpen", seconds: micSeconds(a.waitedMs) };
}

/** The sentence of a note, in the interface language (`t`). */
export const micNoteText = (note: MicNote, t: (k: OkfKey) => string): string => t(note.key).replace("{n}", String(note.seconds));
