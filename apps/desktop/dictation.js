// Dictation (docs/okfilow/DICTATION.md): hold a shortcut, speak, let go: the words are typed into the text
// field that has focus, in any app. Speech is turned into text on this PC only (stt.js, the "questions"
// phrase models); there is no cloud path for dictation at all.
// The pieces it reuses: OK Filow's keyboard hook and gestures (okfilow.js, okfilow-gestures.js) for the
// shortcut, OK Filow's panel as the microphone and its overlays as the recording indicator. This file owns
// the settings and the last step, putting the text in place. Pure logic: dictation-core.js.
const core = require("./dictation-core");
const { PANES } = require("./mac-permissions");
const target = require("./dictation-target");
const { createDictationDiag, reportText } = require("./dictation-diag");
const { globalInputOff, REFUSED_INSERT } = require("./global-input");

/**
 * deps: { getSettings, saveSettings, logLine, clipboard, BrowserWindow, systemPreferences, dialog,
 *         openSystemSettings(url) (main.js: system settings schemes only, never a web link),
 *         platform?, env?, modelReady?(language) -> boolean,
 *         target?() -> the Windows helper { info, sendPaste, typeText } or null (dictation-target.js loadTarget) }
 */
function createDictation(deps) {
  const { getSettings, saveSettings, logLine } = deps;
  const platform = deps.platform || process.platform;
  const env = deps.env || process.env;
  const listeners = new Set();
  /** What happened in the last dictations, for "Report a problem" (never the words). */
  const diag = createDictationDiag();
  /** Windows: our helper that reads the target window and sends the keys (main.js passes it; null elsewhere and in tests without one). */
  const helperFor = () => (typeof deps.target === "function" ? deps.target() || null : null);

  const cfg = () => {
    const s = getSettings();
    return core.sanitizeConfig(s.dictation, s.okFilow && s.okFilow.dictation);
  };

  function configure(patch) {
    const p = patch && typeof patch === "object" ? patch : {};
    const next = core.sanitizeConfig({ v: 2, ...cfg(), ...p });
    // Saved sparse: only the keys this patch set (cleaned), on top of the user's earlier choices.
    const chosen = {};
    for (const k of Object.keys(p)) if (k in next) chosen[k] = next[k];
    const s = getSettings();
    saveSettings({ ...s, dictation: core.nextStored(s.dictation, chosen) });
    logLine(`dictation: settings ${JSON.stringify(next)}`);
    for (const fn of listeners) try { fn(next); } catch { /* a listener's own problem */ }
    return next;
  }

  /** The chord the hook should watch, or null (dictation off, or the keys clash with OK Filow's). */
  function activeChord(talkHotkey, { qaKeys = false } = {}) {
    const c = cfg();
    // Test isolation (global-input.js): the dictation keys are never watched. `qaKeys`: the test itself
    // feeds the keys through the QA key path (okfilow.js QA_KEYS), so its own dictation can be checked;
    // insert() below still types, pastes and copies nothing.
    if (!c.enabled || (globalInputOff(env) && qaKeys !== true)) return null;
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
      /** False while the keyboard hook is not registered: the dictation keys do nothing (okfilow.js keeps trying). */
      hookReady: hook !== false,
      canPaste: decision.action === "paste",
      copyReason: decision.reason,
      modelReady,
      /** S1-mini by Superwhisper: is the model on this computer and the runtime in this build? (Settings says so.) */
      cleanupReady: deps.cleanupStatus ? (() => { const s = deps.cleanupStatus(); return Boolean(s.model && s.runtime); })() : false,
      /** { runtime, model, downloading, pct, bytes, error }: what Settings needs to offer the download and show it. */
      cleanupState: deps.cleanupStatus ? deps.cleanupStatus() : null,
      // the punctuation and capitals model for Italian, Russian, Romanian and Japanese (dictation-punctuate.js)
      punctuateState: deps.punctuateStatus ? deps.punctuateStatus() : null,
      // A screen reader is running (Chromium noticed one): the start and stop tones play even when the
      // sound setting is off, since an announcement from the overlay may not be read out.
      screenReader: Boolean(deps.screenReader && deps.screenReader()),
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
      message: deps.text("menu.dictationMacMessage"),
      detail: deps.text("menu.dictationMacDetail"),
      buttons: [deps.text("menu.dictationMacOpen"), deps.text("menu.macKeysLater")],
      defaultId: 0,
      cancelId: 1,
    });
    if (r.response === 0) void deps.openSystemSettings(PANES.accessibility);
  }

  /** One of Filow's own windows has focus (the script editor, the OK Filow question box): type there directly. */
  function ownFocusedWindow() {
    try {
      const w = deps.BrowserWindow.getFocusedWindow();
      return w && !w.isDestroyed() && w.isVisible() ? w : null;
    } catch { return null; }
  }

  /**
   * A text field has the focus in that window's page: null when none does, `{ password: true }` for a
   * password box (dictation never goes into one), else the character just before the caret (so a second
   * dictation is not glued to the first one's full stop).
   */
  async function editableFocused(win) {
    try {
      const r = await win.webContents.executeJavaScript(
        "(() => { const e = document.activeElement; if (!e) return null;" +
        " if (e.tagName === 'INPUT' && /^password$/i.test(e.type || '')) return { password: true };" +
        " if (e.disabled || e.readOnly) return null;" +
        " if (e.isContentEditable) { const s = getSelection(); const n = s && s.anchorNode; return { before: n && n.nodeType === 3 ? n.textContent.slice(Math.max(0, s.anchorOffset - 1), s.anchorOffset) : '' }; }" +
        " const field = e.tagName === 'TEXTAREA' || (e.tagName === 'INPUT' && /^(text|search|email|url|tel|)$/i.test(e.type || ''));" +
        " if (!field) return null; const at = e.selectionStart || 0; return { before: e.value.slice(Math.max(0, at - 1), at) }; })()",
        true,
      );
      if (!r || typeof r !== "object") return null;
      return r.password === true ? { password: true } : { before: String(r.before || "") };
    } catch { return null; }
  }

  let unchecked = ""; // the last target whose password state could not be read (logged once per target)
  /**
   * The window that has the keyboard now (dictation-target.js). When Windows could not say whether the
   * focused control is a password box (UI Automation did not answer), it is asked once more after a
   * moment; if it still cannot say, the dictation goes on and the log says that the check was not possible.
   */
  async function readTarget() {
    const helper = helperFor();
    const read = () => { try { return target.describeTarget(helper ? helper.info() : null); } catch { return target.describeTarget(null); } };
    let t = read();
    if (t.known && !t.none && !t.own && !t.password && !t.passwordChecked) {
      await new Promise((r) => setTimeout(r, 120));
      t = read();
      const line = target.targetLine(t);
      if (t.known && !t.none && !t.password && !t.passwordChecked && line !== unchecked) {
        unchecked = line;
        logLine(`dictation: Windows could not say whether the focused control of ${line} is a password box`);
      }
    }
    return t;
  }

  // Where the last dictation went (window and last character), until the user types or clicks.
  let lastSpot = null;
  let ignoreMovesUntil = 0;
  /** The user pressed a key or clicked (the keyboard hook saw it): the caret may be anywhere now. */
  function userMoved() { if (Date.now() >= ignoreMovesUntil) lastSpot = null; }

  let inserter = null;
  let current = { hook: null, keysUp: null };
  /** Copy-only and fallback writes carry the same "not in clipboard history" markers as a paste. */
  const writeText = core.clipboardWriter({ clipboard: deps.clipboard, ClipboardItem: deps.ClipboardItem, platform });
  /**
   * Puts the dictated text in place. `hook` sends the paste keys (uiohook keyTap, see DICTATION.md "Paste");
   * `keysUp` waits until the user's own modifiers are up. Returns what happened, for the panel to say.
   * `run` (core.createPhraseRun) is given for each phrase of one hands-free dictation: it puts the space
   * between phrases and, when the words are only copied, keeps the whole text on the clipboard.
   */
  async function insert(raw, { hook, keysUp, spokenLanguage, run } = {}) {
    // Test isolation (global-input.js): nothing is typed, pasted or copied, into any window.
    if (globalInputOff(env)) {
      logLine("dictation: global input is off (test isolation): nothing typed, nothing pasted, nothing copied");
      return { ...REFUSED_INSERT };
    }
    const c = cfg();
    const lang = c.language !== "auto" ? c.language : spokenLanguage || "auto";
    let text = core.postProcess(raw, { language: lang, removeFillers: c.removeFillers });
    if (!text) {
      // Nothing recognised (or only filler sounds). In a hands-free dictation earlier phrases may have gone in.
      diag.nothing();
      return { ok: false, action: "none", reason: "empty", chars: 0 };
    }
    diag.mark("recognised", { chars: text.length });
    const copy = (t) => writeText(run ? run.copyText(t) : t);
    /** A password box has the keyboard: the words are not typed, not copied and not kept anywhere. */
    const refuse = () => {
      logLine("dictation: a password box has the keyboard: nothing typed, nothing copied");
      diag.mark("done", { what: "refused (password box)" });
      diag.result("refused:password");
      return { ok: true, action: "refused", reason: "password", chars: 0 };
    };
    const own = ownFocusedWindow();
    // Before anything is typed or copied, on every path (Filow's own windows, "only copy", no keyboard
    // hook): a password box never gets dictated words, and they never reach the clipboard for it.
    const field = own ? await editableFocused(own) : null;
    if (field && field.password) return refuse();
    if (!own && (await readTarget()).password) return refuse();
    // English only: S1-mini by Superwhisper writes the words out on this PC (dictation-cleanup.js). An
    // answer that is late or not safely the same message is dropped: the words above go in instead.
    if (deps.cleaner) {
      const said = core.postProcess(raw, { language: lang, removeFillers: false });
      const cl = await deps.cleaner.clean(said, { enabled: c.cleanup, language: c.language, spokenLanguage, style: c.cleanupStyle, lists: c.cleanupLists });
      if (cl.used) text = cl.text;
      diag.mark("cleanup", cl.used ? { used: true, took: cl.ms } : { used: false, why: cl.reason, took: cl.ms });
      if (cl.asked) logLine(`dictation: cleanup ${cl.used ? `used (S1-mini, ${cl.ms} ms)` : `skipped (${cl.reason}, ${cl.ms} ms)`}`);
    }
    // Italian, Russian, Romanian, Japanese: where the recognizer left the sentence open, a small model on this
    // PC adds full stops, commas, question marks and capitals (dictation-punctuate.js). It only adds; an
    // answer that is late or not provably the same words is dropped and the words above go in.
    if (deps.punctuator) {
      const pu = await deps.punctuator.punctuate(text, { enabled: c.punctuate, language: c.language, spokenLanguage });
      if (pu.used) text = pu.text;
      diag.mark("punctuation", pu.used ? { used: true, took: pu.ms } : { used: false, why: pu.reason, took: pu.ms });
      if (pu.asked) logLine(`dictation: punctuation ${pu.used ? `added (${pu.ms} ms)` : `skipped (${pu.reason}, ${pu.ms} ms)`}`);
    }
    /** One of Filow's own windows has the keyboard: only into a text field; with none the words are copied and the user is told so. */
    const intoOwn = async (win, fld) => {
      if (fld) {
        await win.webContents.insertText(core.joinAfter(fld.before, text));
        if (run) run.typed(text);
        logLine(`dictation: typed ${text.length} chars into Filow's own window directly`);
        diag.mark("target", { line: "Filow itself", method: "direct" });
        diag.result("direct");
        return { ok: true, action: "direct", reason: "", chars: text.length };
      }
      await copy(text);
      logLine(`dictation: copied ${text.length} chars (a Filow window has focus, but no text field)`);
      diag.mark("target", { line: "Filow itself, no text field", method: "copy" });
      diag.result("copied:nofield");
      return { ok: true, action: "copy", reason: "nofield", chars: text.length };
    };
    if (own) return intoOwn(own, field);
    const decision = core.pasteDecision({ platform, insert: c.insert, env, macTrusted: macTrusted(), hook: Boolean(hook) });
    if (decision.action === "copy") {
      await copy(text);
      logLine(`dictation: copied ${text.length} chars (${decision.reason})`);
      diag.result(`copied:${decision.reason}`);
      if (decision.reason === "accessibility") void askMacPermission();
      return { ok: true, action: "copy", reason: decision.reason, chars: text.length };
    }
    current = { hook, keysUp };
    const helper = helperFor();
    if (!inserter) {
      inserter = core.createClipboardInserter({
        clipboard: deps.clipboard,
        ClipboardItem: deps.ClipboardItem,
        platform,
        keysUp: () => (current.keysUp ? current.keysUp() : Promise.resolve(true)),
        // Windows with our helper: Ctrl + V by SendInput, and Windows says whether it took the keys (it
        // refuses them for an administrator window). Elsewhere: Command + V on macOS, Ctrl + V on Linux,
        // sent through the keyboard hook (CGEvent / XTest), which cannot tell.
        sendPaste: () => {
          const h = helperFor();
          if (!h) return deps.sendPaste(current.hook);
          const accepted = h.sendPaste();
          if (accepted !== 4) throw Object.assign(new Error(`Windows accepted ${accepted} of 4 key events`), { blocked: true });
        },
      });
    }
    // Looked at when the user's keys are up and the words are ready: the window that has the keyboard
    // now, not the one that had it when the keys went down (the user may have clicked another text box).
    let seen = null;
    const check = () => {
      seen = target.describeTarget(helper ? helper.info() : null);
      const how = target.chooseMethod(seen);
      const line = target.targetLine(seen);
      diag.mark("target", { line, method: how.method });
      logLine(`dictation: target ${line} -> ${how.method}${how.reason ? ` (${how.reason})` : ""}`);
      // The keyboard went to one of Filow's own windows meanwhile: its page says what has the focus
      // (a password box there is refused below), and nothing is pasted blind.
      if (seen.own) return { reason: "own", method: "own", giveBack: true };
      if (how.method === "paste") return null;
      return { reason: how.reason || how.method, method: how.method, giveBack: how.method !== "copy" };
    };
    // Two dictations in a row into the same window (issue seen in Notepad: "...alle 9.La riunione..."):
    // Filow cannot read another program's caret, but it knows where its own last words went. Same
    // window, and no key or click of the user's since: the new words follow the old ones, so they get
    // the space a writer would put there.
    const lead = (piece) => (piece === text && lastSpot && seen && seen.id && lastSpot.id === seen.id && Date.now() - lastSpot.at < 10 * 60_000 ? core.joinAfter(lastSpot.tail, piece) : piece);
    const went = () => {
      if (run) run.typed(text);
      ignoreMovesUntil = Date.now() + 400; // our own Ctrl + V comes back through the keyboard hook
      lastSpot = seen && seen.id ? { id: seen.id, tail: text.slice(-1), at: Date.now() } : null;
    };
    // The space before a phrase depends on the phrase before it, so it is decided when this one's turn comes.
    const r = await inserter.insert(() => lead(run ? run.pasteText(text) : text), went, check);
    if (r.method === "refuse") return refuse(); // the keyboard moved to a password box while the keys went up
    if (r.method === "own") {
      const win = ownFocusedWindow();
      const fld = win ? await editableFocused(win) : null;
      if (fld && fld.password) return refuse();
      if (win) return intoOwn(win, fld);
      await copy(text);
      logLine(`dictation: only copied (no window has the keyboard), ${text.length} chars left on the clipboard`);
      diag.result("copied:nofocus");
      return { ok: true, action: "copy", reason: "nofocus", chars: text.length };
    }
    if (r.method === "type") {
      // A terminal: typed as characters (the keys are up: the inserter waited for them).
      const piece = lead(run ? run.pasteText(text) : text);
      const wanted = 2 * [...piece.replace(/[\r\n\t]/g, "")].reduce((n, ch) => n + ch.length, 0);
      const accepted = helper.typeText(piece);
      if (accepted === wanted) {
        went();
        logLine(`dictation: typed ${text.length} chars as key presses`);
        diag.mark("done", { what: "typed as key presses" });
        diag.result("typed");
        return { ok: true, action: "typed", reason: "", chars: text.length };
      }
      await copy(text);
      logLine(`dictation: typing stopped (Windows accepted ${accepted} of ${wanted} key events), ${text.length} chars left on the clipboard`);
      diag.mark("done", { what: "copied", accepted: false });
      diag.result("copied:blocked");
      return { ok: true, action: "copy", reason: "blocked", chars: text.length };
    }
    if (!r.pasted) {
      await copy(text);
      const why = r.reason || "keys";
      logLine(`dictation: ${r.method === "copy" ? "only copied" : "paste failed"} (${why}${r.error ? `: ${r.error}` : ""}), ${text.length} chars left on the clipboard`);
      diag.mark("done", { what: "copied", accepted: r.error ? false : undefined });
      diag.result(`copied:${r.error ? "blocked" : why}`);
      return { ok: true, action: "copy", reason: r.error ? "blocked" : why, chars: text.length };
    }
    logLine(`dictation: pasted ${text.length} chars`);
    diag.mark("done", { what: "pasted" });
    diag.result("pasted");
    void r.restored.then((back) => {
      logLine(`dictation: clipboard ${back ? "put back as it was" : "left as is (changed meanwhile, or unreadable before)"}`);
      diag.mark("clipboard", { back: Boolean(back) });
    });
    return { ok: true, action: "paste", reason: "", chars: text.length };
  }

  /** Facts for "Report a problem" (dictation-diag.js reportText): settings, model, this system, the last dictations. */
  function reportFacts({ hook = {}, mic = "" } = {}) {
    const c = cfg();
    const helper = helperFor();
    let info;
    try { info = helper ? helper.info() : null; } catch { info = null; }
    let ready;
    try { ready = deps.modelReady ? Boolean(deps.modelReady(c.language)) : null; } catch { ready = null; }
    const session = [];
    if (platform === "win32") {
      session.push(`Windows, remote desktop session ${info ? (info.remote ? "yes" : "no") : "unknown"}, Filow runs as administrator ${info ? (info.selfElevated === 1 ? "yes" : "no") : "unknown"}`);
    } else if (platform === "darwin") {
      session.push(`macOS, Accessibility permission (needed to press the paste keys) ${macTrusted() ? "granted" : "NOT granted"}${hook.permission ? `, keyboard permission missing: ${hook.permission}` : ""}`);
    } else {
      const wayland = String(env.XDG_SESSION_TYPE || "").toLowerCase() === "wayland" || Boolean(env.WAYLAND_DISPLAY);
      session.push(`Linux, ${wayland ? "Wayland session (apps cannot press keys in other apps: the words are only copied)" : `X11 session (${String(env.XDG_SESSION_TYPE || "type not set").replace(/[^\w-]/g, "")})`}, desktop ${String(env.XDG_CURRENT_DESKTOP || "?").replace(/[^\w:-]/g, "").slice(0, 40)}`);
    }
    return {
      platform,
      settings: { enabled: c.enabled, chord: c.chord, mode: c.mode, insert: c.insert, language: c.language, cleanup: c.cleanup, cleanupStyle: c.cleanupStyle, cleanupLists: c.cleanupLists, punctuate: c.punctuate },
      cleanup: deps.cleanupStatus ? deps.cleanupStatus() : { model: false, runtime: false },
      punctuation: deps.punctuateStatus ? deps.punctuateStatus() : { model: false, runtime: false },
      hook,
      model: { ready, language: c.language },
      mic,
      helper: Boolean(helper),
      session,
      runs: diag.runs(),
    };
  }

  /** The dictation keys went down: get the cleanup ready while the person speaks (main.js decides whether). */
  function warmCleanup() { try { if (deps.cleanupWarm) deps.cleanupWarm(); } catch { /* the first words go in raw */ } }

  return { cfg, configure, status, activeChord, insert, userMoved, warmCleanup, diag, reportFacts, reportText: (o) => reportText(reportFacts(o)), newPhraseRun: core.createPhraseRun, onChange: (fn) => (listeners.add(fn), () => listeners.delete(fn)) };
}

module.exports = { createDictation };
