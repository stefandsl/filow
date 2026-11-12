// Test isolation: FILOW_QA_NO_GLOBAL_INPUT=1 makes this Filow deaf and mute towards the rest of the
// computer. A test instance then cannot react to the keys of the person using the PC, and cannot put
// anything into their windows (it once did: a test run opened the microphone on the owner's dictation
// keys and pasted the words into the owner's focused window).
// With the switch on, this instance:
//   - starts no keyboard or mouse hook (uiohook.js hands out a stand-in that does nothing),
//   - registers no global shortcut,
//   - never opens a real microphone (Chromium gets its fake device, and the permission is refused
//     unless a test recording is fed in with FILOW_OKF_FAKE_MIC),
//   - never types or pastes into another window and never writes the clipboard,
//   - never takes the keyboard focus for OK Filow's panel.
// Keys reach the gestures only through the QA key path inside the app (FILOW_OKF_QA_KEYS=1).
// Like every test switch it works only in development and in a QA package (qa.js, STANDARDS SEC-13):
// a released build has no test mode at all. A released build that is started with the switch does
// not run without the isolation it was asked for: it says so and leaves at once (refusedInRelease),
// so a test can never end up with a Filow that listens to the keys of the person using the PC.

const SWITCH = "FILOW_QA_NO_GLOBAL_INPUT";

const asked = (env) => Boolean(env) && env[SWITCH] === "1";
const qaBuildNow = () => require("./qa.js").isQaBuild();

/** True when this run must not listen to, or act on, anything outside its own windows (development and QA packages only). */
const globalInputOff = (env = process.env, qaBuild = qaBuildNow()) => asked(env) && qaBuild === true;

/** True for a released build started with the switch: it cannot give the isolation, so it must not run. */
const refusedInRelease = (env = process.env, qaBuild = qaBuildNow()) => asked(env) && qaBuild !== true;

/** The one line the log gets at start when the switch is on. */
const OFF_LINE = `qa: global input is off (${SWITCH}=1): no keyboard or mouse hook, no global shortcuts, no real microphone, no typing or pasting into other windows, no clipboard writes`;

/** What a released build started with the switch says before it leaves. */
const REFUSED_LINE = `${SWITCH}=1 is a test switch and this is a released Filow: it cannot run isolated, so it does not start. Remove the variable, or use a QA build.`;

/** Electron's globalShortcut, or (switch on) one that registers nothing and says so by returning false. */
function shortcutsFor(globalShortcut, off = globalInputOff()) {
  if (!off) return globalShortcut;
  return { register: () => false, registerAll: () => {}, isRegistered: () => false, unregister: () => {}, unregisterAll: () => {} };
}

/** Electron's clipboard, or (switch on) one whose writes and clear do nothing; reads stay as they are. */
function clipboardFor(clipboard, off = globalInputOff()) {
  if (!off || !clipboard) return clipboard;
  return new Proxy(clipboard, {
    get(target, prop) {
      if (typeof prop === "string" && /^(write|clear)/.test(prop)) return () => {};
      const v = target[prop];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

/**
 * The keyboard hook library's stand-in: same shape, nothing behind it. start() registers no hook,
 * keyTap() sends no key, and no event ever arrives. Key codes are distinct numbers no real key has.
 */
function inertUiohook() {
  const codes = new Map();
  const UiohookKey = new Proxy({}, {
    get(_t, name) {
      if (typeof name !== "string") return undefined;
      if (!codes.has(name)) codes.set(name, -1 - codes.size);
      return codes.get(name);
    },
  });
  const uIOhook = { on() { return uIOhook; }, off() { return uIOhook; }, removeAllListeners() { return uIOhook; }, start() {}, stop() {}, keyTap() {}, keyToggle() {}, inert: true };
  return { uIOhook, UiohookKey };
}

/**
 * Which permissions a page of the app gets. Microphone ("media"): with the switch on only when a test
 * recording stands in for it (`fakeMic`, a QA build that was given one), never the real device.
 */
function permissionAllowed(permission, { off = globalInputOff(), fakeMic = false } = {}) {
  if (permission === "media") return !off || fakeMic;
  return permission === "display-capture" || permission === "notifications";
}

/** What a dictation returns when nothing may be typed, pasted or copied. */
const REFUSED_INSERT = Object.freeze({ ok: false, action: "none", reason: "global-input-off", chars: 0 });

module.exports = { SWITCH, OFF_LINE, REFUSED_LINE, globalInputOff, refusedInRelease,shortcutsFor, clipboardFor, inertUiohook, permissionAllowed, REFUSED_INSERT };
