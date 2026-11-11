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
// Electron 45's clipboard is the W3C-style one: read() gives every item with every format (raw Windows
// formats too, as "electron application/osclipboard;format=..."), write() puts items back atomically, and
// everything returns a promise. (The old readHTML / readImage calls are gone: Filow's earlier dictation
// compared a promise with a string and so never put the user's clipboard back.)

/** Windows: keep the dictation out of clipboard history (Win+V) and cloud clipboard sync. */
const OS_FORMAT = (name) => `electron application/osclipboard;format="${name}"`;
const PRIVATE_WIN = ["CanIncludeInClipboardHistory", "CanUploadToCloudClipboard"];

/** What is on the clipboard now, every format, so it can be put back as it was. */
async function snapshotClipboard(cb) {
  try {
    const items = await cb.read();
    const saved = [];
    for (const it of items) {
      const rec = {};
      for (const t of it.types) { try { rec[t] = await it.getType(t); } catch { /* a format that cannot be read is left out */ } }
      if (Object.keys(rec).length) saved.push(rec);
    }
    return { items: saved, empty: saved.length === 0, restorable: true };
  } catch {
    // Unreadable: never overwrite it later with a half copy; the dictation stays on the clipboard.
    return { items: [], empty: false, restorable: false };
  }
}

async function restoreClipboard(cb, s, ClipboardItem) {
  if (s.empty) return cb.clear();
  return cb.write(s.items.map((r) => new ClipboardItem(r)));
}

/**
 * Writes dictated text, with the Windows markers that keep it out of clipboard history and cloud sync
 * (Handy does the same in src-tauri/src/paste_tx/windows.rs publish_formats). Not the "exclude from
 * monitor processing" marker: remote desktop and virtual machine windows sync the clipboard as a
 * monitor, and the paste must reach them too.
 */
function clipboardWriter({ clipboard, ClipboardItem, platform = "win32" }) {
  return async (text) => {
    if (!ClipboardItem) return clipboard.writeText(text);
    const item = { "text/plain": text };
    if (platform === "win32") for (const f of PRIVATE_WIN) item[OS_FORMAT(f)] = new Blob([new Uint8Array(4)]);
    return clipboard.write([new ClipboardItem(item)]);
  };
}

/**
 * Puts `text` into the app with focus by the clipboard: save -> wait for the keys to be up -> write the
 * text -> paste -> after `restoreMs`, put the saved clipboard back unless the user copied something else
 * meanwhile. Slow targets (remote desktop, Office) read the clipboard late, hence the wait.
 * When a second dictation comes before the first one's restore, the first snapshot is kept (the user's own
 * clipboard, not the first dictation) and the earlier restore is cancelled.
 */
function createClipboardInserter({ clipboard, ClipboardItem, platform = "win32", sendPaste, keysUp = async () => true, restoreMs = 1500, setTimeout: st = setTimeout, clearTimeout: ct = clearTimeout }) {
  const write = clipboardWriter({ clipboard, ClipboardItem, platform });
  const ours = async (text) => { try { return (await clipboard.readText()) === text; } catch { return false; } };
  let pending = null; // { saved, text, timer, done }
  async function insert(text) {
    let saved;
    const prev = pending;
    pending = null;
    if (prev) { ct(prev.timer); prev.done(false); }
    if (prev && (await ours(prev.text))) saved = prev.saved;
    else saved = await snapshotClipboard(clipboard);
    if (!(await keysUp())) return { pasted: false, reason: "keys", restored: Promise.resolve(false) };
    await write(text);
    try { sendPaste(); } catch (e) {
      // No key press went out: the words stay on the clipboard and the user is told to paste them
      // (losing what was said would be worse than losing the older clipboard content).
      return { pasted: false, reason: "keys", error: String((e && e.message) || e), restored: Promise.resolve(false) };
    }
    let done;
    const restored = new Promise((r) => { done = r; });
    const p = { saved, text, done, timer: null };
    p.timer = st(async () => {
      if (pending === p) pending = null;
      try {
        if (!saved.restorable || !(await ours(text))) return done(false); // theirs now: keep it
        await restoreClipboard(clipboard, saved, ClipboardItem);
        done(true);
      } catch { done(false); }
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
const JA_SOUNDS = /(^|[\s、。，．,.!?！？])(?:え[ーぇえ〜]*っ?と|え[ーぇ〜]+|あの[ーう〜]+|う[ー〜]+ん|ま[あー]{2,})(?:[、，,]\s*|\s+|(?=[。．.!?！？]|$))/gu;

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

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}。、]/u;
/**
 * The text to insert after `before` (the character left of the caret): a space between a word or a full
 * stop and the new words, none at the start of a field, after a space or bracket, before punctuation, or
 * in Japanese and Chinese (written without spaces).
 */
function joinAfter(before, text) {
  const b = String(before || "");
  if (!b || !text || /[\s([{"'«“‘-]$/u.test(b) || /^[\s,.;:!?)\]}…]/u.test(text) || CJK.test(b) || CJK.test(text.charAt(0))) return text;
  return ` ${text}`;
}

module.exports = {
  joinAfter,
  MODS, LANGS, DEFAULTS, CHORDS, parseChord, chordLabel, checkChord, sanitizeConfig, pasteDecision,
  snapshotClipboard, restoreClipboard, clipboardWriter, createClipboardInserter, postProcess, removeFillers, setFillerHook, fold,
};
