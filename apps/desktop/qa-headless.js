// Test isolation for measured runs: FILOW_QA_HEADLESS=1 makes this Filow invisible. Nothing it would
// show appears on the screens of the person using the PC: no window (splash, main window, OK Filow's
// panel, model and whiteboard windows, overlays), no tray icon, no message box, no notification.
// Each place that would show something goes through one of the helpers below, which keep it hidden
// and say so in the log ("qa headless: kept hidden <name>"); qa-headless-wiring.test.ts fails on any
// show, tray or message box in main.js and okfilow.js that does not.
// Like every test switch it works only in development and in a QA package (qa.js, STANDARDS SEC-13).
// A released build started with it does not run without the isolation it was asked for: it says so
// and leaves at once (refusedInRelease), like FILOW_QA_NO_GLOBAL_INPUT (global-input.js).

const SWITCH = "FILOW_QA_HEADLESS";

const asked = (env) => Boolean(env) && env[SWITCH] === "1";
const qaBuildNow = () => require("./qa.js").isQaBuild();

/** True when nothing of this run may appear on screen (development and QA packages only). */
const headless = (env = process.env, qaBuild = qaBuildNow()) => asked(env) && qaBuild === true;

/** True for a released build started with the switch: it cannot keep itself hidden, so it must not run. */
const refusedInRelease = (env = process.env, qaBuild = qaBuildNow()) => asked(env) && qaBuild !== true;

/** The one line the log gets at start when the switch is on. */
const HEADLESS_LINE = `qa headless: on (${SWITCH}=1): no window, tray icon, message box or notification is shown`;

/** What a released build started with the switch says before it leaves. */
const REFUSED_LINE = `${SWITCH}=1 is a test switch and this is a released Filow: it cannot keep itself hidden, so it does not start. Remove the variable, or use a QA build.`;

// Decided once per process (main.js and okfilow.js share it); tests set it with setHeadless.
let state = { on: /** @type {boolean | null} */ (null), log: /** @type {(line: string) => void} */ (() => {}) };
const isOn = () => (state.on === null ? (state.on = headless()) : state.on);

/** Tests and main.js: whether the switch is on for this process, and where the helpers' lines go. */
function setHeadless(on, log) {
  state = { on: on === null || on === undefined ? state.on : Boolean(on), log: typeof log === "function" ? log : state.log };
}

/**
 * Shows `win` (a BrowserWindow, or anything with show and showInactive, such as a Notification), or,
 * headless, keeps it hidden and logs `name`. True when it was shown: the caller focuses it only then.
 */
function showWindow(win, name, inactive = false) {
  if (!win || (typeof win.isDestroyed === "function" && win.isDestroyed())) return false;
  if (isOn()) {
    state.log(`qa headless: kept hidden ${name}`);
    return false;
  }
  if (inactive) win.showInactive();
  else win.show();
  return true;
}

/** Electron's Tray, or (headless) a stand-in with the same methods that puts no icon in the taskbar. */
function trayFor(Tray) {
  if (!isOn()) return Tray;
  return class HeadlessTray {
    constructor() {
      this.destroyed = false;
      state.log("qa headless: kept hidden tray icon");
    }
    setToolTip() {}
    setTitle() {}
    setImage() {}
    setContextMenu() {}
    displayBalloon() {}
    popUpContextMenu() {}
    on() { return this; }
    once() { return this; }
    removeListener() { return this; }
    getBounds() { return { x: 0, y: 0, width: 0, height: 0 }; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  };
}

/** The options of a dialog call: after the parent window when there is one. */
const optionsOf = (args) => (args.length > 1 && args[1] && typeof args[1] === "object" ? args[1] : args[0] && typeof args[0] === "object" ? args[0] : {});
/** A fixed name for the log: the box's title (Filow's own words, never what it shows). */
const nameOf = (o) => String((o && o.title) || "message box").slice(0, 40);

/**
 * Electron's dialog, or (headless) one whose boxes never open: a message box answers with its cancel
 * button (cancelId, else the second button) and an open or save box is cancelled.
 */
function dialogFor(dialog) {
  if (!isOn() || !dialog) return dialog;
  const answer = (args) => {
    const o = optionsOf(args);
    state.log(`qa headless: dialog suppressed ${nameOf(o)}`);
    return typeof o.cancelId === "number" ? o.cancelId : 1;
  };
  const stub = {
    showMessageBox: (...args) => Promise.resolve({ response: answer(args), checkboxChecked: false }),
    showMessageBoxSync: (...args) => answer(args),
    showErrorBox: (title) => { state.log(`qa headless: dialog suppressed ${String(title || "error box").slice(0, 40)}`); },
    showOpenDialog: () => (state.log("qa headless: dialog suppressed open"), Promise.resolve({ canceled: true, filePaths: [] })),
    showOpenDialogSync: () => (state.log("qa headless: dialog suppressed open"), undefined),
    showSaveDialog: () => (state.log("qa headless: dialog suppressed save"), Promise.resolve({ canceled: true, filePath: "" })),
    showSaveDialogSync: () => (state.log("qa headless: dialog suppressed save"), undefined),
  };
  return new Proxy(dialog, {
    get(target, prop) {
      if (typeof prop === "string" && Object.prototype.hasOwnProperty.call(stub, prop)) return stub[prop];
      const v = target[prop];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

module.exports = { SWITCH, HEADLESS_LINE, REFUSED_LINE, headless, refusedInRelease, setHeadless, showWindow, trayFor, dialogFor };
