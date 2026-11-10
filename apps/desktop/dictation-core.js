// Dictation (docs/okfilow/DICTATION.md): the pure parts, kept apart from Electron so they can be tested.
//   - the shortcut: a chord of two or three modifier keys, parsed, labelled and checked against OK Filow's
//   - the settings, cleaned up
//   - paste or copy: what this platform can do
//   - the clipboard dance: save, write, paste, put the user's clipboard back
//   - text clean-up: spaces, and (optional) hesitation sounds such as "um" and "ehm"
// Ideas ported from Handy (github.com/cjpais/handy, MIT, (c) 2025 CJ Pais), see
// G:/FILOW/tmp/research/HANDY-STUDY.md: the hold-or-toggle shortcut (src-tauri/src/transcription_coordinator.rs),
// the paste-then-restore order (src-tauri/src/clipboard.rs paste_via_clipboard) and the filler removal that
// moves a sentence's capital to the next word (src-tauri/src/audio_toolkit/text.rs remove_filler_words,
// remove_filler_matches). Written again in JavaScript; no Handy code is copied.

const MODS = ["ctrl", "alt", "shift", "meta"];
const LANGS = ["en", "it", "ru", "ro", "ja"];

const DEFAULTS = Object.freeze({
  enabled: true,
  /** Two or three modifiers held together (okfilow-gestures.js only tracks modifiers). */
  chord: "ctrl+meta",
  /** "hold": talk while the keys are down. "toggle": press and let go to start, again to stop. */
  mode: "hold",
  /** "auto": the speech language set in Filow Settings (and if that is Automatic, the model decides). */
  language: "auto",
  /** "paste": type into the app that has focus. "copy": only put the text on the clipboard. */
  insert: "paste",
  /** Take out hesitation sounds ("um", "ehm", "эээ", "えーと"). Off by default: what was said is what is typed. */
  removeFillers: false,
  /** A short quiet tone when dictation starts and stops (useful with a screen reader). */
  sound: false,
});

// Names people write for each modifier, on every platform.
const ALIASES = {
  ctrl: "ctrl", control: "ctrl", ctl: "ctrl", strg: "ctrl", "^": "ctrl",
  alt: "alt", option: "alt", opt: "alt", "⌥": "alt",
  shift: "shift", "⇧": "shift",
  meta: "meta", win: "meta", windows: "meta", super: "meta", cmd: "meta", command: "meta", "⌘": "meta",
};

/**
 * "Ctrl + Win", "cmd+option", "ctrl+meta" -> the canonical "ctrl+meta" (modifiers in MODS order), or null
 * when it is not two or three different modifiers. A single modifier is refused (taps of Ctrl are OK
 * Filow's text box, and one key alone starts by accident); four is refused (too hard to hold).
 */
function parseChord(input) {
  if (typeof input !== "string") return null;
  const parts = input.split(/\s*\+\s*/).map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return null;
  const mods = new Set();
  for (const p of parts) {
    const m = ALIASES[p];
    if (!m || mods.has(m)) return null;
    mods.add(m);
  }
  return MODS.filter((m) => mods.has(m)).join("+");
}

/** Every chord the setting offers: the two- and three-key combinations, in a stable order. */
const CHORDS = (() => {
  const out = [];
  for (let i = 0; i < MODS.length; i++) for (let j = i + 1; j < MODS.length; j++) out.push(`${MODS[i]}+${MODS[j]}`);
  for (let i = 0; i < MODS.length; i++) for (let j = i + 1; j < MODS.length; j++) for (let k = j + 1; k < MODS.length; k++) out.push(`${MODS[i]}+${MODS[j]}+${MODS[k]}`);
  return Object.freeze(out);
})();

const KEY_NAMES = {
  win32: { ctrl: "Ctrl", alt: "Alt", shift: "Shift", meta: "Win" },
  darwin: { ctrl: "Control", alt: "Option", shift: "Shift", meta: "Command" },
  linux: { ctrl: "Ctrl", alt: "Alt", shift: "Shift", meta: "Super" },
};

/** "ctrl+meta" -> "Ctrl + Win" (Windows), "Control + Command" (macOS), "Ctrl + Super" (Linux). */
function chordLabel(chord, platform = "win32") {
  const names = KEY_NAMES[platform] || KEY_NAMES.linux;
  const c = parseChord(chord);
  return c ? c.split("+").map((m) => names[m]).join(" + ") : "";
}

/**
 * Checks the dictation chord against OK Filow's talk chord and the platform.
 *   conflict "same":    both are the same keys: dictation stays off until one of them changes.
 *   conflict "overlap": one holds all the keys of the other (Ctrl + Alt and Ctrl + Alt + Shift): letting go
 *                       of one key would leave the other chord held and start it, so dictation stays off.
 *   warnings "altgr":   Ctrl + Alt is the AltGr key on many keyboards (Windows).
 *   warnings "layout":  Windows switches the keyboard language with Alt + Shift or Ctrl + Shift.
 */
function checkChord(chord, { talk, platform = "win32" } = {}) {
  const c = parseChord(chord);
  if (!c) return { ok: false, conflict: "invalid", warnings: [] };
  const t = parseChord(talk || "");
  let conflict = null;
  if (t) {
    const a = new Set(c.split("+"));
    const b = new Set(t.split("+"));
    if (c === t) conflict = "same";
    else if ([...a].every((m) => b.has(m)) || [...b].every((m) => a.has(m))) conflict = "overlap";
  }
  const warnings = [];
  if (platform === "win32") {
    if (c.includes("ctrl") && c.includes("alt")) warnings.push("altgr");
    if (c === "alt+shift" || c === "ctrl+shift") warnings.push("layout");
  }
  return { ok: !conflict, conflict, warnings };
}

/** Stored settings (plus the old okFilow.dictation switch) -> clean settings. */
function sanitizeConfig(raw, legacyEnabled) {
  const r = raw && typeof raw === "object" ? raw : {};
  const enabled = typeof r.enabled === "boolean" ? r.enabled : legacyEnabled === false ? false : DEFAULTS.enabled;
  return {
    enabled,
    chord: parseChord(r.chord) || DEFAULTS.chord,
    mode: r.mode === "toggle" ? "toggle" : "hold",
    language: LANGS.includes(r.language) ? r.language : "auto",
    insert: r.insert === "copy" ? "copy" : "paste",
    removeFillers: r.removeFillers === true,
    sound: r.sound === true,
  };
}

/**
 * Paste into the app with focus, or only copy? `reason` says why in one word, so the UI can say it plainly:
 *   setting        the user chose "copy only"
 *   nohook         the keyboard hook did not start, so no key press can be sent
 *   wayland        a Wayland session: apps cannot send key presses to other apps
 *   accessibility  macOS without the Accessibility permission for Filow
 */
function pasteDecision({ platform = "win32", insert = "paste", env = {}, macTrusted = true, hook = true } = {}) {
  if (insert === "copy") return { action: "copy", reason: "setting" };
  if (platform === "linux" && (String(env.XDG_SESSION_TYPE || "").toLowerCase() === "wayland" || Boolean(env.WAYLAND_DISPLAY))) return { action: "copy", reason: "wayland" };
  if (platform === "darwin" && !macTrusted) return { action: "copy", reason: "accessibility" };
  if (!hook) return { action: "copy", reason: "nohook" };
  return { action: "paste", reason: "" };
}

// ---- clipboard: save, write, paste, restore ----

const read = (cb, fn, empty) => { try { return typeof cb[fn] === "function" ? cb[fn]() : empty; } catch { return empty; } };
const hasFormat = (cb, fmt) => { try { return typeof cb.read === "function" && cb.read(fmt).length > 0; } catch { return false; } };

/** What is on the clipboard now, as far as it can be put back faithfully. */
function snapshotClipboard(cb) {
  // Copied files (and formats Electron cannot write back) cannot be restored: then the dictation stays.
  const restorable = !hasFormat(cb, "FileNameW") && !hasFormat(cb, "FileName");
  const image = read(cb, "readImage", null);
  const s = { text: read(cb, "readText", ""), html: read(cb, "readHTML", ""), rtf: read(cb, "readRTF", ""), image: image && !image.isEmpty() ? image : null, restorable };
  s.empty = !s.text && !s.html && !s.rtf && !s.image;
  return s;
}

function restoreClipboard(cb, s) {
  if (s.empty) return void cb.clear();
  const data = { text: s.text };
  if (s.html) data.html = s.html;
  if (s.rtf) data.rtf = s.rtf;
  if (s.image) data.image = s.image;
  try { cb.write(data); } catch { cb.writeText(s.text); }
}

/**
 * Puts `text` into the app with focus by the clipboard: save -> wait for the keys to be up -> write the
 * text -> paste -> after `restoreMs`, put the saved clipboard back unless the user copied something else
 * meanwhile. Slow targets (remote desktop, Office) read the clipboard late, hence the wait.
 * When a second dictation comes before the first one's restore, the first snapshot is kept (the user's own
 * clipboard, not the first dictation) and the earlier restore is cancelled.
 */
function createClipboardInserter({ clipboard, sendPaste, keysUp = async () => true, restoreMs = 1500, setTimeout: st = setTimeout, clearTimeout: ct = clearTimeout }) {
  let pending = null; // { saved, text, timer, done }
  async function insert(text) {
    let saved;
    if (pending && clipboard.readText() === pending.text) {
      ct(pending.timer);
      saved = pending.saved;
      pending.done(false);
    } else {
      if (pending) { ct(pending.timer); pending.done(false); }
      saved = snapshotClipboard(clipboard);
    }
    pending = null;
    if (!(await keysUp())) return { pasted: false, reason: "keys", restored: Promise.resolve(false) };
    clipboard.writeText(text);
    try { sendPaste(); } catch (e) {
      // No key press went out: put the user's clipboard back at once.
      if (saved.restorable && clipboard.readText() === text) restoreClipboard(clipboard, saved);
      return { pasted: false, reason: "keys", error: String((e && e.message) || e), restored: Promise.resolve(true) };
    }
    let done;
    const restored = new Promise((r) => { done = r; });
    const p = { saved, text, done, timer: null };
    p.timer = st(() => {
      if (pending === p) pending = null;
      if (!saved.restorable || clipboard.readText() !== text) return done(false); // theirs now: keep it
      try { restoreClipboard(clipboard, saved); done(true); } catch { done(false); }
    }, restoreMs);
    pending = p;
    return { pasted: true, reason: "", restored };
  }
  return { insert, get pending() { return Boolean(pending); } };
}

// ---- text clean-up ----

/**
 * Hesitation sounds per language, matched on whole words after folding (lower case, accents off: "ăăă" is
 * "aaa"). Only sounds: words people use as fillers ("basically", "diciamo", "типа") are often meant, and
 * dictation must never drop a meant word. The sound patterns follow the rehearsal report's FILLERS
 * (packages/core/src/rehearsal.ts, feat-rehearsal-report) and Handy's list; `fillerHook` lets a caller swap in
 * the shared list once both live in one place.
 */
const SOUNDS = {
  any: [/^u+h*m+$/, /^u+h{2,}$/, /^e+h*m+$/, /^h+m{2,}$/, /^m{3,}$/, /^э{2,}м*$/, /^э+м+$/, /^м{3,}$/],
  en: [/^u+h+$/, /^e+r+m*$/, /^h*m{2,}$/],
  it: [/^e+h{2,}$/, /^e{2,}h+$/, /^m{2,}$/],
  ru: [/^э+$/, /^м{2,}$/],
  ro: [/^a{3,}$/, /^i{3,}$/, /^e{3,}$/, /^h*m{2,}$/],
};
// Japanese is written without spaces: the sound must stand alone, before a comma, a space or the end.
const JA_SOUNDS = /(^|[\s、。，．,.!?！？])(?:え[ーぇ〜]*っ?と|え[ーぇ〜]+|あの[ーう〜]+|う[ー〜]+ん|ま[あー]{2,})(?:[、，,]\s*|\s+|(?=[。．.!?！？]|$))/gu;

let fillerHook = null;
/** Lets another module supply the filler patterns: (lang) => RegExp[] (whole folded word). */
function setFillerHook(fn) { fillerHook = typeof fn === "function" ? fn : null; }

function fillerPatterns(lang) {
  if (fillerHook) { const p = fillerHook(lang); if (Array.isArray(p)) return p; }
  return lang === "any" ? SOUNDS.any : [...SOUNDS.any, ...(SOUNDS[lang] || [])];
}

const fold = (w) => w.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const SENTENCE_END = /[.!?…]$/u;
const upperFirst = (w) => w.charAt(0).toLocaleUpperCase() + w.slice(1);
const isUpper = (ch) => ch !== ch.toLocaleLowerCase() && ch === ch.toLocaleUpperCase();

function removeFillers(text, lang) {
  if (lang === "ja") return text.replace(JA_SOUNDS, "$1");
  const pats = fillerPatterns(lang);
  const words = text.split(/\s+/).filter(Boolean);
  const out = [];
  let capNext = false;
  for (let i = 0; i < words.length; i++) {
    const m = /^([\p{L}\p{M}]+)([,.;:!?…]*)$/u.exec(words[i]);
    if (m && pats.some((re) => re.test(fold(m[1])))) {
      const punct = m[2];
      const startOfSentence = out.length === 0 || SENTENCE_END.test(out[out.length - 1]);
      if (startOfSentence && isUpper(m[1].charAt(0))) capNext = true;
      // "I think, um." -> "I think."  The sentence's end stays; a comma goes with the sound.
      if (/[.!?…]/u.test(punct) && out.length) out[out.length - 1] = out[out.length - 1].replace(/[,;:]+$/u, "") + punct.replace(/^[,;:]+/u, "");
      continue;
    }
    let w = words[i];
    if (capNext) { w = upperFirst(w); capNext = false; }
    out.push(w);
  }
  return out.join(" ");
}

/**
 * The text that goes into the app: spaces tidied, and, when asked, the hesitation sounds taken out.
 * `lang` is the spoken language ("auto" uses only the sounds no language uses as a word).
 */
function postProcess(text, { language = "auto", removeFillers: drop = false } = {}) {
  let t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (drop) t = removeFillers(t, LANGS.includes(language) ? language : "any").replace(/\s+/g, " ").trim();
  // A lone comma or full stop left at the very start by a removed sound.
  return t.replace(/^[,;:]\s*/u, "").trim();
}

module.exports = {
  MODS, LANGS, DEFAULTS, CHORDS, parseChord, chordLabel, checkChord, sanitizeConfig, pasteDecision,
  snapshotClipboard, restoreClipboard, createClipboardInserter, postProcess, removeFillers, setFillerHook, fold,
};
