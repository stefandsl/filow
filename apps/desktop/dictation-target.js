// Dictation: where the words are about to go, and how to put them there (docs/dictation/SPEC.md "Target").
// On Windows a small helper of our own (native/target, see its README.md) reads facts about the window
// that has the keyboard (program name, window class, administrator or not, password box or not; never a
// title, never any text) and sends the keys itself, so Filow knows whether Windows accepted them.
// On macOS, Linux and Windows on ARM there is no helper yet: every fact is "unknown" and the paste goes
// through the keyboard hook as before. Pure decisions are here so they can be tested without Windows.
const fs = require("node:fs");
const path = require("node:path");

/** The folder of the helper for this system, or "" (not Windows, or an architecture we did not build). */
function nativeFile({ platform = process.platform, arch = process.arch, baseDir = __dirname, exists = fs.existsSync } = {}) {
  if (platform !== "win32") return "";
  const file = path.join(baseDir, "native", "target", "prebuilds", `${platform}-${arch}`, "filow-target.node").replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2");
  return exists(file) ? file : "";
}

let loaded;
/** The helper's functions ({ info, sendPaste, typeText }), or null when this system has none. */
function loadTarget() {
  if (loaded !== undefined) return loaded;
  const file = nativeFile();
  try { loaded = file ? require(file) : null; } catch { loaded = null; }
  return loaded;
}

// Window classes of terminals: Ctrl + V is not paste in every one of them (or it pastes with a warning),
// so the words are typed as characters there. conhost, Windows Terminal, mintty (Git Bash), PuTTY,
// ConEmu, WezTerm; a terminal Filow does not know is pasted into like any other window.
const TERMINAL_CLASSES = new Set(["ConsoleWindowClass", "CASCADIA_HOSTING_WINDOW_CLASS", "mintty", "PuTTY", "org.wezfurlong.wezterm", "VirtualConsoleClass"]);
const TERMINAL_EXES = new Set(["windowsterminal.exe", "conhost.exe", "openconsole.exe", "mintty.exe", "putty.exe", "alacritty.exe", "wezterm-gui.exe", "conemu64.exe", "conemu.exe"]);

/**
 * The facts the report and the decision use, cleaned: nothing here can hold a window title or typed text.
 * `raw` is the helper's info() or null. `exe` is a file name only; both names are cut to plain characters.
 */
function describeTarget(raw) {
  if (!raw || typeof raw !== "object") return { known: false, none: false, exe: "", cls: "", focusCls: "", elevated: null, password: false, passwordChecked: false, own: false, remote: null };
  const name = (v) => String(v || "").replace(/[^\w .()+#-]/g, "").slice(0, 60);
  const none = !raw.hwnd;
  return {
    known: true,
    /** No window has the keyboard at all (a locked or disconnected session, a remote desktop left minimized). */
    none,
    exe: name(raw.exe),
    cls: name(raw.cls),
    focusCls: name(raw.focusCls),
    /** true: the window belongs to a program run as administrator while Filow is not (Windows refuses our keys). */
    elevated: raw.elevated === 1 && raw.selfElevated !== 1 ? true : raw.elevated === 0 || raw.selfElevated === 1 ? false : null,
    password: raw.password === true,
    passwordChecked: raw.passwordChecked === true,
    own: raw.own === true,
    remote: typeof raw.remote === "boolean" ? raw.remote : null,
  };
}

/**
 * How to put the words into this target:
 *   refuse  "password"   a password box has the keyboard: nothing is typed, copied or kept
 *   copy    "elevated"   an administrator window: Windows drops keys from a program that is not one
 *   copy    "nofocus"    no window has the keyboard
 *   type                 a terminal: the words are typed as characters
 *   paste                everything else (clipboard, Ctrl + V, clipboard put back)
 * An unknown target (no helper on this system) is pasted into, as before.
 */
function chooseMethod(target) {
  const t = target || {};
  if (t.password) return { method: "refuse", reason: "password" };
  if (!t.known) return { method: "paste", reason: "" };
  if (t.none) return { method: "copy", reason: "nofocus" };
  if (t.elevated === true) return { method: "copy", reason: "elevated" };
  if (TERMINAL_CLASSES.has(t.cls) || TERMINAL_EXES.has(String(t.exe).toLowerCase())) return { method: "type", reason: "" };
  return { method: "paste", reason: "" };
}

/** One line for the log and the report: "notepad.exe [Notepad > RichEditD2DPT]". Never a title. */
function targetLine(t) {
  if (!t || !t.known) return "unknown (no helper on this system)";
  if (t.none) return `no window has the keyboard${t.remote ? " (remote desktop session)" : ""}`;
  if (t.own) return "Filow itself";
  return `${t.exe || "?"} [${t.cls || "?"}${t.focusCls && t.focusCls !== t.cls ? ` > ${t.focusCls}` : ""}]${t.elevated === true ? " administrator" : ""}${t.password ? " password box" : ""}${t.remote ? " (remote desktop session)" : ""}`;
}

module.exports = { loadTarget, nativeFile, describeTarget, chooseMethod, targetLine, TERMINAL_CLASSES, TERMINAL_EXES };
