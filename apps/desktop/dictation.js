// Dictation (docs/okfilow/DICTATION.md): hold a shortcut, speak, let go: the words are typed into the text
// field that has focus, in any app. Speech is turned into text on this PC only (stt.js, the "questions"
// phrase models); there is no cloud path for dictation at all.
// The pieces it reuses: OK Filow's keyboard hook and gestures (okfilow.js, okfilow-gestures.js) for the
// shortcut, OK Filow's panel as the microphone and its overlays as the recording indicator. This file owns
// the settings and the last step, putting the text in place. Pure logic: dictation-core.js.
const core = require("./dictation-core");

/**
 * deps: { getSettings, saveSettings, logLine, clipboard, BrowserWindow, systemPreferences, dialog, shell,
 *         platform?, env?, modelReady?(language) -> boolean }
 */
function createDictation(deps) {
  const { getSettings, saveSettings, logLine } = deps;
  const platform = deps.platform || process.platform;
  const env = deps.env || process.env;
  const listeners = new Set();

  const cfg = () => {
    const s = getSettings();
    return core.sanitizeConfig(s.dictation, s.okFilow && s.okFilow.dictation);
  };

  function configure(patch) {
    const p = patch && typeof patch === "object" ? patch : {};
    const next = core.sanitizeConfig({ ...cfg(), ...p });
    saveSettings({ ...getSettings(), dictation: next });
    logLine(`dictation: settings ${JSON.stringify(next)}`);
    for (const fn of listeners) try { fn(next); } catch { /* a listener's own problem */ }
    return next;
  }

  /** The chord the hook should watch, or null (dictation off, or the keys clash with OK Filow's). */
  function activeChord(talkHotkey) {
    const c = cfg();
    if (!c.enabled) return null;
    return core.checkChord(c.chord, { talk: talkHotkey, platform }).ok ? c.chord : null;
  }

  function macTrusted() {
    if (platform !== "darwin" || !deps.systemPreferences) return true;
    try { return deps.systemPreferences.isTrustedAccessibilityClient(false); } catch { return false; }
  }

  /** Everything Settings shows: the choices, plain-word checks and what this PC can do. */
  function status({ talkHotkey, hook } = {}) {
    const c = cfg();
    const check = core.checkChord(c.chord, { talk: talkHotkey, platform });
    const decision = core.pasteDecision({ platform, insert: "paste", env, macTrusted: macTrusted(), hook: hook !== false });
    let modelReady;
    try { modelReady = deps.modelReady ? Boolean(deps.modelReady(c.language)) : null; } catch { modelReady = null; }
    return {
      ...c,
      platform,
      chords: core.CHORDS.map((value) => ({ value, label: core.chordLabel(value, platform) })),
      chordLabel: core.chordLabel(c.chord, platform),
      talk: talkHotkey || "",
      talkLabel: core.chordLabel(talkHotkey || "", platform),
      check,
      /** "paste" when key presses can reach other apps here; else "copy" and the reason. */
      canPaste: decision.action === "paste",
      copyReason: decision.reason,
      modelReady,
    };
  }

  let askedMac = false;
  /** macOS: a plain prompt that opens the Accessibility pane. Asked once per run; the text is copied meanwhile. */
  async function askMacPermission() {
    if (askedMac || platform !== "darwin" || !deps.dialog) return;
    askedMac = true;
    try { deps.systemPreferences.isTrustedAccessibilityClient(true); } catch { /* older macOS: the pane below still works */ }
    const r = await deps.dialog.showMessageBox({
      type: "info",
      message: "Let Filow type your dictation into other apps",
      detail: "macOS asks you to allow this once. In System Settings, open Privacy & Security, then Accessibility, and turn Filow on. Until then your words are copied: press Command + V to paste them.",
      buttons: ["Open Accessibility settings", "Not now"],
      defaultId: 0,
      cancelId: 1,
    });
    if (r.response === 0) void deps.shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility");
  }

  /** One of Filow's own windows has focus (the script editor, the OK Filow question box): type there directly. */
  function ownFocusedWindow() {
    try {
      const w = deps.BrowserWindow.getFocusedWindow();
      return w && !w.isDestroyed() && w.isVisible() ? w : null;
    } catch { return null; }
  }

  let inserter = null;
  let current = { hook: null, keysUp: null };
  /**
   * Puts the dictated text in place. `hook` sends the paste keys (uiohook keyTap, see DICTATION.md "Paste");
   * `keysUp` waits until the user's own modifiers are up. Returns what happened, for the panel to say.
   */
  async function insert(raw, { hook, keysUp, spokenLanguage } = {}) {
    const c = cfg();
    const lang = c.language !== "auto" ? c.language : spokenLanguage || "auto";
    const text = core.postProcess(raw, { language: lang, removeFillers: c.removeFillers });
    if (!text) return { ok: false, action: "none", reason: "empty", chars: 0 };
    const own = ownFocusedWindow();
    if (own) {
      own.webContents.insertText(text);
      logLine(`dictation: typed ${text.length} chars into Filow's own window directly`);
      return { ok: true, action: "direct", reason: "", chars: text.length };
    }
    const decision = core.pasteDecision({ platform, insert: c.insert, env, macTrusted: macTrusted(), hook: Boolean(hook) });
    if (decision.action === "copy") {
      deps.clipboard.writeText(text);
      logLine(`dictation: copied ${text.length} chars (${decision.reason})`);
      if (decision.reason === "accessibility") void askMacPermission();
      return { ok: true, action: "copy", reason: decision.reason, chars: text.length };
    }
    current = { hook, keysUp };
    if (!inserter) {
      inserter = core.createClipboardInserter({
        clipboard: deps.clipboard,
        keysUp: () => (current.keysUp ? current.keysUp() : Promise.resolve(true)),
        // Command + V on macOS, Ctrl + V elsewhere, sent through the same hook (SendInput / CGEvent / XTest).
        sendPaste: () => deps.sendPaste(current.hook),
      });
    }
    const r = await inserter.insert(text);
    if (!r.pasted) {
      deps.clipboard.writeText(text);
      logLine(`dictation: paste failed (${r.reason}${r.error ? `: ${r.error}` : ""}), ${text.length} chars left on the clipboard`);
      return { ok: true, action: "copy", reason: r.reason || "keys", chars: text.length };
    }
    logLine(`dictation: pasted ${text.length} chars`);
    return { ok: true, action: "paste", reason: "", chars: text.length };
  }

  return { cfg, configure, status, activeChord, insert, onChange: (fn) => (listeners.add(fn), () => listeners.delete(fn)) };
}

module.exports = { createDictation };
