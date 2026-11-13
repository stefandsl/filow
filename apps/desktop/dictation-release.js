// Issue #7: the words said as the dictation keys go up. The OK Filow panel's microphone hands over its
// sound in blocks of 128 ms (2048 samples at 16 kHz) and stopped the moment it heard of the release, so
// the block still filling and the end of the last word were thrown away: a 1 s press of "Ciao Marco"
// came out as "Chao, Matt." and presses under about 0.8 s typed nothing at all. A held dictation now
// keeps recording RELEASE_TAIL_MS after the keys are up before the panel is told to stop.
// A press that comes meanwhile sends the waiting release first, so the panel always hears release,
// then press, in the order the keys were used.
// Hands-free dictations and questions stop at once (the user has finished speaking when they press).

const RELEASE_TAIL_MS = 300;

/**
 * @param {{ send: (payload: unknown) => void, setTimeout?: typeof setTimeout, clearTimeout?: typeof clearTimeout }} o
 */
function createReleaseTail(o) {
  const st = o.setTimeout || setTimeout;
  const ct = o.clearTimeout || clearTimeout;
  let pending = null; // { timer, payload } while a release waits for its tail

  /** Sends a waiting release now (a new press came, or the app is going away). */
  function flush() {
    if (!pending) return;
    const p = pending;
    pending = null;
    ct(p.timer);
    o.send(p.payload);
  }

  /** The keys went up: tell the panel after `tailMs` (0: at once). An earlier waiting release goes first. */
  function release(payload, tailMs) {
    flush();
    if (!(tailMs > 0)) return void o.send(payload);
    pending = { payload, timer: st(() => { pending = null; o.send(payload); }, tailMs) };
  }

  return { release, flush, get waiting() { return pending !== null; } };
}

module.exports = { createReleaseTail, RELEASE_TAIL_MS };
