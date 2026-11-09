// OK Filow keyboard gestures, HeyClicky-style (docs/OKFILOW-GAUNTLET.md rows 1-4):
//   talk       hold the talk chord (default Ctrl+Alt)            -> talk:start / talk:end / talk:cancel
//   dictate    hold Ctrl+Win                                     -> dictate:start / dictate:end / dictate:cancel
//   hands-free tap Ctrl+Win twice                                -> handsfree:toggle
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

  const which = () => {
    const d = o.dictate();
    if (chordHeld(o.talk(), down)) return "talk";
    if (d && chordHeld(d, down)) return "dictate";
    return null;
  };

  function disarm() {
    if (arming) ct(arming.timer);
    arming = null;
  }

  function update() {
    const want = suppressed ? null : which();
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
    if (want && !active && !arming) {
      const kind = want;
      arming = { kind, since: now(), timer: st(() => { arming = null; active = kind; o.emit(`${kind}:start`); }, ARM_MS) };
    }
  }

  function keydown(mod) {
    if (!mod) {
      // Another key: whatever chord is down was a shortcut, not a question.
      ctrlTap.clean = false;
      disarm();
      if (active) { o.emit(`${active}:cancel`); active = null; }
      if (MODS.some((m) => down[m])) suppressed = true;
      return;
    }
    if (down[mod]) return; // key repeat
    down[mod] = true;
    if (mod === "ctrl" && MODS.every((m) => m === "ctrl" || !down[m])) ctrlTap = { ...ctrlTap, since: now(), clean: true };
    else ctrlTap.clean = false;
    update();
  }

  function keyup(mod) {
    if (!mod || !down[mod]) return;
    down[mod] = false;
    if (mod === "ctrl" && ctrlTap.clean && now() - ctrlTap.since < TAP_MS) {
      if (now() - ctrlTap.last < DOUBLE_MS) { ctrlTap.last = 0; o.emit("text:open"); }
      else ctrlTap.last = now();
    }
    ctrlTap.clean = false;
    if (!MODS.some((m) => down[m])) suppressed = false;
    update();
  }

  /**
   * Forget every held key. Key-ups that happen on the secure desktop (Win+L, Ctrl+Alt+Del, UAC) never
   * reach the hook, so the caller resets on lock, unlock, suspend and resume.
   */
  function reset() {
    for (const m of MODS) down[m] = false;
    suppressed = false;
    ctrlTap = { since: 0, clean: false, last: 0 };
    disarm();
    if (active) { o.emit(`${active}:cancel`); active = null; }
  }

  /** The mouse button counts as "another key" only for the Ctrl double-tap. */
  function mousedown() { ctrlTap.clean = false; ctrlTap.last = 0; }

  return { keydown, keyup, mousedown, reset, get active() { return active; }, get anyDown() { return MODS.some((m) => down[m]); } };
}

module.exports = { createGestures, chordHeld, ARM_MS, TAP_MS, DOUBLE_MS };
