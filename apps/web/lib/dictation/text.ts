// Words for Dictation (apps/desktop/dictation.js) in Filow Settings and in OK Filow's panel and overlay.
// English here, one file per other language (text.<lang>.ts); text.test.ts checks they match.
import { isLang, type Lang } from "@filow/core";
import { it } from "./text.it";
import { ru } from "./text.ru";
import { ro } from "./text.ro";
import { ja } from "./text.ja";

const en = {
  title: "Dictation",
  intro: "Hold a key combination, speak, let go: your words are typed into the text box you are in, in any app. Or tap the keys twice and just talk: each phrase is typed when you pause.",
  privacy: "Your voice stays on this computer. Dictation never uses an online speech service, even when one is set up elsewhere in Filow.",
  enabled: "Dictation on",
  shortcut: "Keys",
  mode: "How the keys work",
  modeHold: "Hold to talk, let go to type",
  modeToggle: "Press once to start, press again to stop",
  modeToggleHint: "Hands-free: Filow types each phrase when you pause. Press the keys again to stop; Escape stops without typing the last words. A dictation nobody stops ends after 5 minutes.",
  language: "Language you dictate in",
  languageAuto: "Same as the speech language above",
  languageHint: "Pick your language for the best accuracy: Filow then uses the speech model made for short phrases in that language.",
  insert: "Where the words go",
  insertPaste: "Type them where I am",
  insertCopy: "Only copy them, I paste myself",
  insertHow: "Filow puts the words on the clipboard, presses {paste} for you, then puts back what you had copied before.",
  fillers: "Leave out \"um\", \"uh\", \"ehm\" and similar sounds",
  fillersHint: "Only sounds. Words like \"basically\" stay: they may be meant.",
  sound: "Play a soft sound when dictation starts and stops",
  soundHint: "Helpful with a screen reader, or when you are not looking at the screen.",
  cleanup: "Clean up what I say (English): S1-mini by Superwhisper, on this PC",
  cleanupHint: "English only for now. S1-mini by Superwhisper takes out fillers and false starts and writes numbers, dates and e-mail addresses properly, on this computer. Dictations in other languages never go through it: they keep the simple cleanup below.",
  cleanupMissing: "S1-mini by Superwhisper is not on this computer yet, so English dictations keep the simple cleanup for now.",
  cleanupStyle: "How written it should sound",
  styleCasual: "Casual: all lowercase",
  styleSemiCasual: "Relaxed: your phrasing, light punctuation",
  styleSemiFormal: "Standard written English",
  styleFormal: "Formal: no contractions",
  cleanupLists: "Turn three or more spoken items into a list",
  conflictSame: "These are the same keys OK Filow uses to ask a question ({talk}). Dictation is off until you pick other keys here or in OK Filow.",
  conflictOverlap: "These keys contain OK Filow's question keys ({talk}), or the other way round: letting go of one key would start the other. Dictation is off until you pick other keys.",
  warnAltgr: "On many keyboards Ctrl + Alt is the AltGr key, used to type some letters. Pressing it on its own can start dictation.",
  warnLayout: "Windows can use these keys to switch the keyboard language. If it does, pick other keys.",
  togglesHandsFree: "Tap the keys twice to dictate hands-free: Filow types each phrase when you pause, until you press the keys once more or Escape. A dictation nobody stops ends after 5 minutes.",
  copyWayland: "On this desktop (Wayland) apps cannot press keys in other apps, so the words are only copied: press Ctrl + V to paste them.",
  copyAccessibility: "macOS needs the Accessibility permission before Filow can type into other apps. Until you allow it, the words are copied: press Command + V to paste them.",
  copyNohook: "Filow cannot watch the keyboard yet, so the dictation keys do nothing for now. Filow keeps trying in the background and the keys start working by themselves, with no restart. Meanwhile you can still ask OK Filow a question with Ctrl + Alt + O.",
  modelMissing: "No speech model for this language is on this computer yet. Download it in the speech section above; dictation works after that.",
  modelReady: "Speech model ready on this computer.",
  // Panel and overlay
  dictating: "Dictating… let go to type it",
  dictatingToggle: "Dictating… press {keys} again to type it",
  dictatingHandsFree: "Dictating hands-free… pause and I type it. Press {keys} or Esc to stop",
  handsFreeQuestions: "OK Filow's hands-free questions have their own keys: tap {talk} twice.",
  typed: "Typed into your app",
  copied: "Copied. Press {paste} to paste it",
  nothing: "Nothing was heard",
  nothingHint: "Nothing was heard. Hold {keys} while you speak, or press them twice briefly to keep listening.",
  refusedPassword: "This is a password box: nothing was typed and nothing was kept.",
  copiedElevated: "This window runs as administrator, so Filow cannot type in it. Copied: press {paste}.",
  copiedNoFocus: "No text box has the keyboard. Copied: click where the words should go and press {paste}.",
  copiedBlocked: "Windows did not accept the keys. Copied: press {paste}.",
  failed: "Could not type into the app. Your words are in the OK Filow panel.",
  startedLive: "Dictation started",
  hintHold: "Hold {keys} to dictate into any app; tap it twice to dictate hands-free, phrase by phrase.",
  hintToggle: "Press {keys} to dictate hands-free into any app, and again to stop.",
};

export type DictationKey = keyof typeof en;

export const DICTATION_TEXT: Record<Lang, Record<DictationKey, string>> = { en, it, ru, ro, ja };

/** The text for a key in the interface language (English for an unknown one), with {placeholders} filled. */
export function dictationText(lang: string, key: DictationKey, vars: Record<string, string> = {}): string {
  const s = DICTATION_TEXT[isLang(lang) ? lang : "en"][key] || en[key];
  return s.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

/** The paste keys in the platform's own words. */
export function pasteKeys(platform: string): string {
  return platform === "darwin" ? "Command + V" : "Ctrl + V";
}
