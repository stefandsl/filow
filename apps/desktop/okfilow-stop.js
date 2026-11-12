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
function overlayMouse({ caught, hover, mode, pill, bubble }) {
  return { ignore: !(caught || (hover && overlayLive(mode, pill, bubble))) };
}

/**
 * An overlay has something for the mouse: a control of the pill, or the answer bubble (`bubble`: it
 * is open: its text scrolls under the wheel and it has a close button).
 */
const overlayLive = (mode, pill, bubble) => pillLive(mode, pill) || bubble === true;

// ---- the answer bubble (docs/okfilow/BUBBLE.md) ----
/** The longest text the bubble is given. An answer is never cut to fit: the bubble scrolls. */
const BUBBLE_TEXT_MAX = 20000;
const bubbleText = (v) => String(v || "").slice(0, BUBBLE_TEXT_MAX);

/** How long the bubble stays once nothing is running any more. */
const BUBBLE = {
  /** After an answer that was spoken to its end (or shown for as long as it takes to read). */
  lingerMs: 4000,
  /** A stopped answer, with its pill and Resume. */
  stoppedMs: 8000,
  /** After the pointer leaves the bubble. */
  afterHoverMs: 2500,
  /** Reading time: per letter, twice that for Japanese, Chinese and Korean letters, between these bounds. */
  msPerChar: 60,
  readMinMs: 5000,
  readMaxMs: 90000,
  /** A short note with its own time (a dictation's result): kept between these bounds. */
  noteMinMs: 1000,
  noteMaxMs: 6000,
};
const wideChar = (ch) => {
  const n = ch.codePointAt(0);
  return (n >= 0x3000 && n <= 0x9fff) || (n >= 0xac00 && n <= 0xd7af) || (n >= 0xff00 && n <= 0xffef);
};
/** The time it takes to read `text`, within sane bounds. */
function readingMs(text) {
  let units = 0;
  for (const ch of String(text || "")) units += /\s/.test(ch) ? 0 : wideChar(ch) ? 2 : 1;
  return Math.min(BUBBLE.readMaxMs, Math.max(BUBBLE.readMinMs, units * BUBBLE.msPerChar));
}

/**
 * When the bubble goes away by itself: milliseconds from now, or null while it must stay (an answer
 * is running or paused, somebody is talking, or the pointer is on it). Every state in which nothing
 * runs any more gets a number: no bubble stays for ever. Marks kept on screen and "always show the
 * pointer" do not count: they keep the overlay, never the bubble.
 *   shownMs: how long the whole text has been on screen (the voice may have read it meanwhile, or
 *   said nothing: voice off, no voice for the language, a voice that failed); holdMs: the panel's
 *   own time for a short note; afterHover: the pointer has just left the bubble.
 */
function bubbleHold({ mode, text, stopped, paused, hover, shownMs, holdMs, afterHover } = {}) {
  if (answering(mode) || mode === "listening" || paused === true || hover === true) return null;
  if (!text && !stopped) return 0;
  if (afterHover === true) return BUBBLE.afterHoverMs;
  if (stopped) return BUBBLE.stoppedMs;
  if (Number(holdMs) > 0) return Math.min(BUBBLE.noteMaxMs, Math.max(BUBBLE.noteMinMs, Number(holdMs)));
  return Math.max(BUBBLE.lingerMs, readingMs(text) - Math.max(0, Number(shownMs) || 0));
}

/**
 * The bubble's life, for the main process: it is told the text, the mode, the pause and the pointer,
 * and calls `dismiss(why)` once when the bubble must go ("timer", "escape", "button"). Timers and
 * the clock are handed in, so every end state can be tested.
 */
function createBubble({ dismiss, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, onPlan } = {}) {
  let text = "";
  let mode = "idle";
  let stopped = false;
  let paused = false;
  let hover = false;
  let holdMs = 0;
  let shownAt = 0;
  let timer = null;
  const open = () => Boolean(text) || stopped;
  const cancel = () => { if (timer !== null) clearTimer(timer); timer = null; };
  function close(why) {
    cancel();
    if (!open()) return false;
    text = "";
    stopped = false;
    hover = false;
    dismiss(why);
    return true;
  }
  function plan(afterHover = false) {
    cancel();
    if (!open()) return;
    const ms = bubbleHold({ mode, text, stopped, paused, hover, shownMs: now() - shownAt, holdMs, afterHover });
    if (onPlan) onPlan(ms);
    if (ms === null) return;
    timer = setTimer(() => { timer = null; close("timer"); }, ms);
  }
  return {
    open,
    /** The text in the bubble now (an overlay that loads late is given it). */
    text: () => text,
    /** What the bubble says now ("" takes it away, unless it marks a stopped answer). */
    setText(next) {
      const t = bubbleText(next);
      if (t && !text) shownAt = now();
      text = t;
      plan();
    },
    /** The mode, with what the panel said about it (`stopped`, `holdMs`). */
    setMode(next, extra = {}) {
      mode = next;
      stopped = (next === "idle" && extra.stopped === true);
      holdMs = Number(extra.holdMs) || 0;
      // The whole answer is on screen from here: its reading time starts.
      if (next === "speaking") shownAt = now();
      plan();
    },
    setPaused(on) {
      if (paused === (on === true)) return;
      paused = on === true;
      plan();
    },
    /** The pointer is on the bubble, or has left it. */
    setHover(on) {
      if (hover === (on === true)) return;
      hover = on === true;
      plan(!hover);
    },
    /** Escape with no answer running, or the bubble's close button. True when there was a bubble. */
    close,
  };
}

/**
 * Whether a list of points, marks or cards keeps the overlays on screen until Escape, Clear or the
 * next question: only when there is something in it. (An empty list of points is how the panel calls
 * the pointer back; it used to keep the overlays, and the bubble with them, for ever.)
 */
const keepsOverlays = (list) => Array.isArray(list) && list.length > 0;

/**
 * How long the pointer takes to visit `count` things an answer points at (the overlay page's
 * timing: a flight, then a look of 1.8 s when another follows, 5.5 s at the last). The overlays stay
 * that long for them; unlike marks and cards, points do not keep the overlays until Escape.
 */
const POINT = { flyMs: 650, nextMs: 1800, holdMs: 5500 };
const pointsShowMs = (count) => (count > 0 ? (count - 1) * (POINT.flyMs + POINT.nextMs) + POINT.flyMs + POINT.holdMs : 0);

/**
 * How long an answer's marks (boxes, circles, arrows, underlines and their labels) stay: null while
 * they are being told (a question is being heard or answered, or the answer is paused); then a short
 * hold, 4 s after the voice and 8 s when nothing was spoken (the marks are all there is to look at);
 * at once when the answer was stopped or failed.
 */
const MARKS_HOLD_MS = 4000;
const MARKS_UNSPOKEN_MS = 8000;
function marksHold({ mode, paused, stopped, spoken }) {
  if ((mode !== "idle" && mode !== "error") || paused) return null;
  if (mode === "error" || stopped) return 0;
  return spoken ? MARKS_HOLD_MS : MARKS_UNSPOKEN_MS;
}

/**
 * The life of an answer's marks, for the main process. They belong to what is being said: they stay
 * while the answer is spoken, and go a short hold after it ended, or sooner: at once on Stop or an
 * error, when the bubble is closed (Escape, its close button, its own time), and at the user's first
 * click once the answer has ended (the screen may have changed under them). They used to stay until
 * Escape, so boxes and labels were left on the desktop long after the answer. `clear(why)` is called
 * once each time they must be wiped.
 */
function createMarks({ clear, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let up = false;
  let timer = null;
  let state = { mode: "idle", paused: false, stopped: false, spoken: false };
  const cancel = () => { if (timer !== null) clearTimer(timer); timer = null; };
  function drop(why) {
    cancel();
    if (!up) return false;
    up = false;
    clear(why);
    return true;
  }
  function plan() {
    cancel();
    if (!up) return;
    const ms = marksHold(state);
    if (ms === 0) drop(state.mode === "error" ? "error" : "stopped");
    else if (ms !== null) timer = setTimer(() => { timer = null; drop("timer"); }, ms);
  }
  return {
    /** Marks are on screen. */
    up: () => up,
    /** The panel drew this list (an empty one draws nothing and keeps nothing). Marks shown with nothing running (Show again) get the hold. */
    drawn(list) {
      up = keepsOverlays(list);
      if (state.mode === "idle" || state.mode === "error") state = { ...state, mode: "idle", stopped: false };
      plan();
    },
    /**
     * The mode with what the panel said about it (`stopped`), the pause, or `spoken: true` when the
     * voice says a sentence (the mode alone does not tell: an answer shown without the voice passes
     * through "speaking" too). A new question starts unspoken.
     */
    set(next) {
      const fresh = next.mode === "listening" || next.mode === "thinking";
      state = { ...state, ...next, spoken: fresh ? false : next.spoken === true || state.spoken, stopped: "mode" in next ? next.stopped === true : state.stopped };
      plan();
    },
    /** The user clicked somewhere: once the answer has ended the screen may have changed, so the marks go. While it is told they stay. */
    screenChanged() { return marksHold(state) === null ? false : drop("click"); },
    /** The bubble went (`why`), or the marks must go for another reason: wipes them. True when there were any. */
    drop,
    /** They were wiped by someone else (Escape, Clear, a new question). */
    forget() { cancel(); up = false; },
  };
}

/** What Escape does: stops the answer in progress; with none, closes the bubble and wipes the marks. */
const escapePlan = (mode) => (answering(mode) ? ["stop"] : ["bubble", "marks"]);

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

module.exports = { keepsOverlays, MARKS_HOLD_MS, MARKS_UNSPOKEN_MS, marksHold, createMarks, pointsShowMs, BUBBLE, BUBBLE_TEXT_MAX, bubbleText, readingMs, bubbleHold, createBubble, escapePlan, overlayLive, answering, overlayMouse,seeChoice, wordsOnlyList, pillState, pillLive, mayCapture, screenSources, pillAction, pauseKeyAction, EYE_KEYS, PAUSE_KEYS, keyChoice, accelerator, bindKey };
