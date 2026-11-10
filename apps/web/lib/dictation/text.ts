// Words for Dictation (apps/desktop/dictation.js) in Filow Settings and in OK Filow's panel and overlay.
// English and Italian here; Russian, Romanian and Japanese come with the translation pass (until then
// those interfaces show English, like the OK Filow strings in lib/buddy/text.ts).

const en = {
  title: "Dictation",
  intro: "Hold a key combination, speak, let go: your words are typed into the text box you are in, in any app.",
  privacy: "Your voice stays on this computer. Dictation never uses an online speech service, even when one is set up elsewhere in Filow.",
  enabled: "Dictation on",
  shortcut: "Keys",
  mode: "How the keys work",
  modeHold: "Hold to talk, let go to type",
  modeToggle: "Press once to start, press again to stop",
  modeToggleHint: "Escape stops without typing. A dictation nobody stops ends after 5 minutes.",
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
  conflictSame: "These are the same keys OK Filow uses to ask a question ({talk}). Dictation is off until you pick other keys here or in OK Filow.",
  conflictOverlap: "These keys contain OK Filow's question keys ({talk}), or the other way round: letting go of one key would start the other. Dictation is off until you pick other keys.",
  warnAltgr: "On many keyboards Ctrl + Alt is the AltGr key, used to type some letters. Holding it alone for a moment starts dictation.",
  warnLayout: "Windows can use these keys to switch the keyboard language. If it does, pick other keys.",
  togglesHandsFree: "Tap the keys twice to let OK Filow listen hands-free.",
  copyWayland: "On this desktop (Wayland) apps cannot press keys in other apps, so the words are only copied: press Ctrl + V to paste them.",
  copyAccessibility: "macOS needs the Accessibility permission before Filow can type into other apps. Until you allow it, the words are copied: press Command + V to paste them.",
  copyNohook: "The keyboard shortcut could not start on this computer, so dictation cannot run. Restart Filow to try again.",
  modelMissing: "No speech model for this language is on this computer yet. Download it in the speech section above; dictation works after that.",
  modelReady: "Speech model ready on this computer.",
  // Panel and overlay
  dictating: "Dictating… let go to type it",
  dictatingToggle: "Dictating… press {keys} again to type it",
  typed: "Typed into your app",
  copied: "Copied. Press {paste} to paste it",
  nothing: "Nothing was heard",
  failed: "Could not type into the app. The text is in the box below.",
  startedLive: "Dictation started",
  hintHold: "Hold {keys} to dictate into any app; tap it twice for hands-free.",
  hintToggle: "Press {keys} to dictate into any app, and again to type it.",
};

export type DictationKey = keyof typeof en;

const it: Record<DictationKey, string> = {
  title: "Dettatura",
  intro: "Tieni premuti alcuni tasti, parla, lascia: le tue parole vengono scritte nella casella di testo in cui ti trovi, in qualsiasi app.",
  privacy: "La tua voce resta su questo computer. La dettatura non usa mai un servizio vocale online, anche se ne hai impostato uno altrove in Filow.",
  enabled: "Dettatura attiva",
  shortcut: "Tasti",
  mode: "Come funzionano i tasti",
  modeHold: "Tieni premuto per parlare, lascia per scrivere",
  modeToggle: "Premi una volta per iniziare, di nuovo per finire",
  modeToggleHint: "Esc ferma senza scrivere. Una dettatura che nessuno ferma finisce dopo 5 minuti.",
  language: "Lingua in cui detti",
  languageAuto: "La stessa lingua parlata impostata sopra",
  languageHint: "Scegli la tua lingua per la massima precisione: Filow usa allora il modello vocale fatto per frasi brevi in quella lingua.",
  insert: "Dove vanno le parole",
  insertPaste: "Scrivile dove mi trovo",
  insertCopy: "Copiale soltanto, incollo io",
  insertHow: "Filow mette le parole negli appunti, preme {paste} per te, poi rimette quello che avevi copiato prima.",
  fillers: "Togli \"ehm\", \"uhm\" e suoni simili",
  fillersHint: "Solo suoni. Parole come \"praticamente\" restano: potresti volerle dire.",
  sound: "Suono leggero quando la dettatura inizia e finisce",
  soundHint: "Utile con un lettore di schermo, o quando non guardi lo schermo.",
  conflictSame: "Sono gli stessi tasti che OK Filow usa per le domande ({talk}). La dettatura resta spenta finché non scegli altri tasti qui o in OK Filow.",
  conflictOverlap: "Questi tasti contengono quelli delle domande di OK Filow ({talk}), o il contrario: lasciando un tasto partirebbe l'altra funzione. La dettatura resta spenta finché non scegli altri tasti.",
  warnAltgr: "Su molte tastiere Ctrl + Alt è il tasto AltGr, che serve a scrivere alcune lettere. Tenerlo premuto da solo per un attimo avvia la dettatura.",
  warnLayout: "Windows può usare questi tasti per cambiare la lingua della tastiera. Se succede, scegli altri tasti.",
  togglesHandsFree: "Tocca i tasti due volte per far ascoltare OK Filow a mani libere.",
  copyWayland: "Su questo desktop (Wayland) le app non possono premere tasti in altre app, quindi le parole vengono solo copiate: premi Ctrl + V per incollarle.",
  copyAccessibility: "macOS chiede il permesso Accessibilità prima che Filow possa scrivere in altre app. Finché non lo concedi, le parole vengono copiate: premi Comando + V per incollarle.",
  copyNohook: "La scorciatoia da tastiera non è partita su questo computer, quindi la dettatura non può funzionare. Riavvia Filow per riprovare.",
  modelMissing: "Su questo computer non c'è ancora un modello vocale per questa lingua. Scaricalo nella sezione della voce qui sopra; poi la dettatura funziona.",
  modelReady: "Modello vocale pronto su questo computer.",
  dictating: "Detto… lascia per scriverlo",
  dictatingToggle: "Detto… premi di nuovo {keys} per scriverlo",
  typed: "Scritto nella tua app",
  copied: "Copiato. Premi {paste} per incollarlo",
  nothing: "Non ho sentito niente",
  failed: "Non riesco a scrivere nell'app. Il testo è nella casella qui sotto.",
  startedLive: "Dettatura iniziata",
  hintHold: "Tieni {keys} per dettare in qualsiasi app; toccalo due volte per il vivavoce.",
  hintToggle: "Premi {keys} per dettare in qualsiasi app, e di nuovo per scriverlo.",
};

export const DICTATION_TEXT: Record<"en" | "it", Record<DictationKey, string>> = { en, it };

/** The text for a key in the interface language (Italian or English for now), with {placeholders} filled. */
export function dictationText(lang: string, key: DictationKey, vars: Record<string, string> = {}): string {
  const s = DICTATION_TEXT[lang === "it" ? "it" : "en"][key];
  return s.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

/** The paste keys in the platform's own words. */
export function pasteKeys(platform: string): string {
  return platform === "darwin" ? "Command + V" : "Ctrl + V";
}
