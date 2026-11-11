// Stopping, pausing and resuming an answer, the eye, and the small rules around them that the main
// process applies (okfilow.js, docs/okfilow/PILL.md). Kept here, without Electron, so they can be tested.

/** An answer is in progress: OK Filow is thinking, or speaking, drawing and pointing. */
const answering = (mode) => mode === "thinking" || mode === "speaking";

/**
 * What the panel says about the pill: `sees` (the next question would take the screen with it),
 * `paused` (the answer in progress is paused), `resumable` (a stopped answer can be carried on).
 */
const pillState = (v) => ({ sees: !v || v.sees !== false, paused: Boolean(v && v.paused === true), resumable: Boolean(v && v.resumable === true) });

/**
 * The pill has something to click right now: during an answer (the eye, Pause or Resume, Stop),
 * while listening (the eye), and on a stopped answer that can be carried on (Resume), although the
 * mode is idle by then.
 */
const pillLive = (mode, pill) => answering(mode) || mode === "listening" || Boolean(pill && pill.resumable === true);

/**
 * What an overlay window does with the mouse. The overlays are click-through, except: while the
 * talk keys are held (`caught`: a drag marks the screen), and while the pointer is on a control of
 * the pill (`hover`: the overlay page says so from the pointer position main sends it; mouse events
 * forwarded by Electron made the window flap between the two states and lose the click).
 */
function overlayMouse({ caught, hover, mode, pill }) {
  return { ignore: !(caught || (hover && pillLive(mode, pill))) };
}

/** "Look at my screen": "on" or "off" once the user chose, "auto" until then (the setup decides). */
const seeChoice = (v) => (v === "on" || v === "off" ? v : "auto");

/**
 * Whether a picture of the screen may be taken at all. `images` false: the panel asked for none.
 * `seeScreen` "off": the user closed the eye, and then nothing takes one, whoever asks.
 */
const mayCapture = ({ images, seeScreen } = {}) => images !== false && seeScreen !== "off";

/** The screens' pictures, or none: `getSources` is not even called when no picture may be taken. */
async function screenSources(want, getSources) {
  return mayCapture(want) ? getSources() : [];
}

/** Recipient ids as stored: strings only, at most twenty, each of a sane length. */
const wordsOnlyList = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" && x && x.length <= 200))].slice(-20) : []);

/** What a control of the pill, or a shortcut, can ask for. Anything else is dropped. */
const PILL_ACTIONS = ["eye", "pause", "resume", "stop"];
const pillAction = (v) => (PILL_ACTIONS.includes(v) ? v : null);

/**
 * What the Pause/Resume key does right now: pause an answer in progress, carry on a paused one, or
 * a stopped one that can be continued. Null otherwise: the key then does nothing.
 */
function pauseKeyAction(mode, pill) {
  if (answering(mode)) return pill && pill.paused ? "resume" : "pause";
  return pill && pill.resumable ? "resume" : null;
}

/** The shortcut choices (the first is the default): the eye, and Pause/Resume. Three modifiers, so never a talk chord. */
const EYE_KEYS = ["ctrl+alt+shift+h", "ctrl+alt+shift+f7", "none"];
const PAUSE_KEYS = ["ctrl+alt+shift+g", "ctrl+alt+shift+f8", "none"];
const keyChoice = (v, list) => (list.includes(v) ? v : list[0]);

/** Electron's name for a choice: "ctrl+alt+shift+h" -> "Control+Alt+Shift+H". Null for no shortcut. */
function accelerator(choice) {
  if (typeof choice !== "string" || !choice || choice === "none") return null;
  return choice.split("+").map((p) => (p === "ctrl" ? "Control" : p[0].toUpperCase() + p.slice(1))).join("+");
}

/**
 * Registers one shortcut and lets go of the one it replaces (`was`: what bindKey returned before).
 * state: "none" (the user wants no shortcut), "ok", "taken" (Windows refused it: another app has
 * it), "off" (test isolation: no global shortcut is ever registered).
 */
function bindKey(shortcuts, was, choice, handler, { inputOff = false } = {}) {
  if (was && was.accelerator) {
    try { shortcuts.unregister(was.accelerator); } catch { /* was not registered */ }
  }
  const acc = accelerator(choice);
  if (!acc) return { choice, accelerator: null, state: "none" };
  if (inputOff) return { choice, accelerator: null, state: "off" };
  let ok;
  try { ok = shortcuts.register(acc, handler) === true; } catch { ok = false; }
  return { choice, accelerator: ok ? acc : null, state: ok ? "ok" : "taken" };
}

module.exports = { answering, overlayMouse, seeChoice, wordsOnlyList, pillState, pillLive, mayCapture, screenSources, pillAction, pauseKeyAction, EYE_KEYS, PAUSE_KEYS, keyChoice, accelerator, bindKey };
