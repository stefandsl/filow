// Escape closes what OK Filow put on the desktop (owner, 14/11: "even if I press Esc it does not work").
// The 3D window and the overlays never take the keyboard (they are shown without focus and ignore the
// mouse), so a key pressed "on" them goes to the app under them. Escape is therefore a global shortcut,
// held only while something of OK Filow is on screen and released as soon as nothing is: it never takes
// Escape from other apps otherwise. One press closes the topmost item (the 3D window, then the pictures,
// cards and marks, then the answer's bubble); a second press soon after closes everything. Test runs
// register nothing (FILOW_QA_NO_GLOBAL_INPUT: the shortcuts object is inert, global-input.js).

const KEY = "Escape";
/** A second Escape within this long closes everything. */
const TWICE_MS = 700;

/**
 * What one Escape closes: "all" for a second press in time, else the topmost thing on screen:
 * "model" (the 3D window), "items" (pictures, slide, cards, marks), "bubble", or null for nothing.
 */
function escTarget({ model, items, bubble, lastAt = 0, now = Date.now() }) {
  const any = Boolean(model || items || bubble);
  if (!any) return null;
  if (now - lastAt <= TWICE_MS) return "all";
  return model ? "model" : items ? "items" : "bubble";
}

/**
 * The shortcut, held while `sync(true)` and released at `sync(false)`. `shortcuts` is Electron's
 * globalShortcut (or the inert one of a test run). Returns whether Escape is held now.
 */
function createEscKey({ shortcuts, onEsc }) {
  let held = false;
  return {
    sync(shown) {
      if (shown && !held) {
        try { held = shortcuts.register(KEY, onEsc) !== false && shortcuts.isRegistered(KEY) !== false; } catch { held = false; }
      } else if (!shown && held) {
        try { shortcuts.unregister(KEY); } catch { /* already gone */ }
        held = false;
      }
      return held;
    },
    held: () => held,
  };
}

module.exports = { KEY, TWICE_MS, escTarget, createEscKey };
