// OK Filow keyboard gestures, HeyClicky-style (docs/OKFILOW-GAUNTLET.md rows 1-4):
//   talk       hold the talk chord (default Ctrl+Alt)            -> talk:start / talk:end / talk:cancel
//   dictate    hold the dictation chord (default Ctrl+Win)       -> dictate:start / dictate:end / dictate:cancel
//              or, in toggle mode, press and let go to start, again to stop; Escape cancels
//   hands-free tap the dictation chord twice (hold mode only)    -> handsfree:toggle
//   text box   tap Ctrl twice, alone                             -> text:open
// A chord must be held ARM_MS before it starts, so quick shortcuts never open the mic. Any other key
// while a chord is down cancels it (Ctrl+Alt is AltGr on many layouts) and nothing fires again until
// every modifier is released. Pure logic: the uiohook wiring lives in okfilow.js.

const ARM_MS = 250;
const TAP_MS = 300; // a press shorter than this is a tap
const DOUBLE_MS = 450; // two taps closer than this are a double tap

const MODS = ["ctrl", "alt", "shift", "meta"];

/** True when exactly the chord's modifiers are down (no more, no fewer). */
function chordHeld(chord, down) {
  const want = new Set(String(chord).split("+"));
  return MODS.every((m) => Boolean(down[m]) === want.has(m));
}

/**
 * @param {{ talk: () => string, dictate: () => string | null, emit: (ev: string) => void,
 *           dictateMode?: () => "hold" | "toggle",
 *           setTimeout?: typeof setTimeout, clearTimeout?: typeof clearTimeout, now?: () => number }} o
 */
function createGestures(o) {
  const st = o.setTimeout || setTimeout;
  const ct = o.clearTimeout || clearTimeout;
  const now = o.now || Date.now;
  const down = { ctrl: false, alt: false, shift: false, meta: false };
  let active = null; // "talk" | "dictate" while a chord session runs
  let arming = null; // { kind, timer, since }
  let suppressed = false;
  let ctrlTap = { since: 0, clean: false, last: 0 };
  const dictTap = { last: 0 };
  // Toggle mode (ported from Handy's transcription_coordinator.rs: a press starts, the next press stops):
  // the chord counts when it is let go cleanly, with no other key in between, so Ctrl+Win+D stays a
  // Windows shortcut. `toggled` is true while such a dictation runs; the talk chord is ignored meanwhile.
  let toggled = false;
  let tapping = false; // the dictation chord is down cleanly in toggle mode
  let tapDirty = false; // another key joined the chord: no toggle until every modifier is up
  const toggleMode = () => (o.dictateMode ? o.dictateMode() : "hold") === "toggle";

  const which = () => {
    const d = o.dictate();
    if (toggled || (d && toggleMode())) return d && chordHeld(d, down) ? "dictate-toggle" : toggled ? null : chordHeld(o.talk(), down) ? "talk" : null;
    if (chordHeld(o.talk(), down)) return "talk";
    if (d && chordHeld(d, down)) return "dictate";
    return null;
  };

  function disarm() {
    if (arming) ct(arming.timer);
    arming = null;
  }

  function update(cause) {
    const want = suppressed ? null : which();
    if (want === "dictate-toggle") { if (!tapDirty) tapping = true; }
    else if (tapping) {
      tapping = false;
      // Let go cleanly (not another modifier added): that was a press of the dictation chord.
      if (cause === "up") { toggled = !toggled; o.emit(toggled ? "dictate:start" : "dictate:end"); }
      else tapDirty = true;
    }
    if (active && want !== active) {
      o.emit(`${active}:end`);
      active = null;
    }
    if (arming && want !== arming.kind) {
      const a = arming;
      disarm();
      // A short tap of Ctrl+Win: two of them toggle hands-free.
      if (a.kind === "dictate" && now() - a.since < TAP_MS) {
        if (now() - dictTap.last < DOUBLE_MS) { dictTap.last = 0; o.emit("handsfree:toggle"); }
        else dictTap.last = now();
      }
    }
    if (want && want !== "dictate-toggle" && !active && !arming) {
      const kind = want;
      arming = { kind, since: now(), timer: st(() => { arming = null; active = kind; o.emit(`${kind}:start`); }, ARM_MS) };
    }
  }

  function keydown(mod) {
    if (!mod) {
      // Another key: whatever chord is down was a shortcut, not a question.
      ctrlTap.clean = false;
      if (tapping || MODS.some((m) => down[m])) tapDirty = true;
      tapping = false;
      disarm();
      if (active) { o.emit(`${active}:cancel`); active = null; }
      if (MODS.some((m) => down[m])) suppressed = true;
      return;
    }
    if (down[mod]) return; // key repeat
    down[mod] = true;
    if (mod === "ctrl" && MODS.every((m) => m === "ctrl" || !down[m])) ctrlTap = { ...ctrlTap, since: now(), clean: true };
    else ctrlTap.clean = false;
    update("down");
  }

  function keyup(mod) {
    if (!mod || !down[mod]) return;
    down[mod] = false;
    if (mod === "ctrl" && ctrlTap.clean && now() - ctrlTap.since < TAP_MS) {
      if (now() - ctrlTap.last < DOUBLE_MS) { ctrlTap.last = 0; o.emit("text:open"); }
      else ctrlTap.last = now();
    }
    ctrlTap.clean = false;
    if (!MODS.some((m) => down[m])) { suppressed = false; tapDirty = false; }
    update("up");
  }

  /** Escape stops a toggle-mode dictation without typing anything. */
  function escape() {
    if (!toggled) return;
    toggled = false;
    o.emit("dictate:cancel");
  }

  /** The dictation ended some other way (an error, the setting turned off): the next press starts again. */
  function endToggle() { toggled = false; tapping = false; tapDirty = false; }

  /**
   * Forget every held key. Key-ups that happen on the secure desktop (Win+L, Ctrl+Alt+Del, UAC) never
   * reach the hook, so the caller resets on lock, unlock, suspend and resume.
   */
  function reset() {
    for (const m of MODS) down[m] = false;
    suppressed = false;
    ctrlTap = { since: 0, clean: false, last: 0 };
    disarm();
    tapping = false;
    tapDirty = false;
    if (active) { o.emit(`${active}:cancel`); active = null; }
    if (toggled) { toggled = false; o.emit("dictate:cancel"); }
  }

  /** The mouse button counts as "another key" only for the Ctrl double-tap. */
  function mousedown() { ctrlTap.clean = false; ctrlTap.last = 0; }

  return {
    keydown, keyup, mousedown, reset, escape, endToggle,
    get active() { return active || (toggled ? "dictate" : null); },
    get anyDown() { return MODS.some((m) => down[m]); },
  };
}

module.exports = { createGestures, chordHeld, ARM_MS, TAP_MS, DOUBLE_MS };
