# Dictation

Hold a key combination, speak, let go: the words are typed into the text box that has focus, in any
app. The speech is turned into text on this computer; dictation has no cloud path at all, and it works
with `FILOW_OFFLINE=1`. Study of the app this is modelled on: `G:\FILOW\tmp\research\HANDY-STUDY.md`
(Handy by CJ Pais, MIT).

## For the user (Settings > Dictation, and the OK Filow panel)

- **On / off.** On by default. It works with OK Filow's questions turned off.
- **Keys.** Two or three modifier keys held together; the default is Ctrl + Win (Control + Command on
  macOS). Modifiers only: a letter or Space would also reach the app you are typing in. If the keys are
  the same as OK Filow's question keys, or one set contains the other (letting go of one key would
  start the other), Settings says so in plain words and dictation stays off until one of them changes.
  Ctrl + Alt warns about AltGr; Alt + Shift and Ctrl + Shift warn that Windows may switch the keyboard
  language with them.
- **How the keys work.** Hold to talk and let go to type (default), or press once to start and once
  more to stop.
- **Hands-free (issue #2, like Wispr Flow).** Press the keys twice, briefly (or, in "press once" mode,
  press them once): Filow listens with the keys up and types each phrase into the focused field when the
  user pauses. "Briefly" is under 0.8 s, with the second press starting within 0.6 s of the first one's
  end (issue #7: two fingers on two keys take 0.4 to 0.8 s, and the old limit of 0.25 s made two presses
  two empty dictations). A second press long enough to have started a dictation keeps that dictation
  going with the keys up: nothing restarts. A press that gave no words says how the keys work. One more press of the keys stops it and types what was said since the last pause; Escape
  stops it without typing those last words (phrases already typed stay). A hands-free dictation
  nobody stops ends after five minutes. The bubble says how to stop while it runs.
  OK Filow's own hands-free questions are no longer on these keys: they start with two taps of OK
  Filow's question keys (Ctrl + Alt by default), and both settings screens say so.
- **Language.** "Same as the speech language above" or one of English, Italian, Russian, Romanian,
  Japanese. A chosen language picks the most accurate model made for short phrases (stt.js
  `CANDIDATES.questions`: Parakeet for en/it/ru/ro, ReazonSpeech for ja); "Automatic" needs the one
  model that knows all five (Nemotron streaming). Settings says whether a model for it is on the PC.
- **Where the words go.** "Type them where I am" (default) or "Only copy them, I paste myself".
- **Filler sounds.** On by default (issue #3). Sounds like "um", "uh", "ehm", "эээ", "えーと" are taken
  out (never words such as "basically" or "diciamo", which may be meant), and a sentence's capital moves
  to the next word.
- **Sound.** On by default (issue #3): a short quiet tone at start (higher) and stop (lower), for screen
  reader users or when not looking at the screen. When Chromium detects a running screen reader
  (`app.isAccessibilitySupportEnabled()`), the tones play whatever this setting says.
- **Settings never touched follow the defaults.** settings.json keeps only what the user chose
  (`dictation: { v: 2, ...chosen keys }`), so a later change of a default reaches everyone who never
  changed that setting. A record saved whole by 0.9.31 (no `v`) loses its `false` for these two on load:
  that build saved the old default with every change, so it was not a choice.

While recording, OK Filow's overlay shows the "Dictating" pill at the top of the screen with the mouse
and the bubble with the live level next to the pointer (no movement with reduced motion). A polite
`role="status"` region says "Dictation started" for screen readers; the overlay never takes the focus,
and screen readers often read live regions only in the window in front, so the tones are the reliable cue. When the words could only be
copied, the bubble says "Copied. Press Ctrl + V to paste it" for a few seconds.

## How it works

1. **Keys.** OK Filow's keyboard hook (uiohook-napi) and `okfilow-gestures.js`; no second hook. Hold
   mode arms after 250 ms like the question keys (so Ctrl + Win + D stays a Windows shortcut); toggle
   mode counts a clean press and release (another key in between cancels it), ported from Handy's
   `src-tauri/src/transcription_coordinator.rs`. Two short taps of the chord within 450 ms (keys let
   go each time, no other key or modifier in between) emit `dictate:handsfree` and put the gestures in
   the same "running with the keys up" state as toggle mode, so the next press ends it.
   **Hands-free phrases.** The microphone and the recognizer stay open for the whole dictation. The
   recognizer closes phrases by itself (stt-worker.js); `apps/web/lib/dictation/handsfree.ts` decides
   when they are typed: at the pause heard by the voice-activity detector OK Filow's hands-free
   questions use (`lib/buddy/listen.ts` createVad, about 1.1 s of quiet after speech), or the moment a
   phrase closes right after such a pause, or after 2 s without a new phrase when the detector missed
   the pause. Each phrase goes through the same `dictation.insert` as a single dictation, so the
   clipboard rules below hold for every phrase; `dictation-core.js` createPhraseRun adds the space
   between phrases (none in Japanese; none after the user's own Enter, Tab or mouse click, seen by
   the hook) and, when the words can only be copied, keeps everything said so far on the clipboard
   instead of the last phrase only. Two pastes are kept at least 300 ms apart (the app reads the
   clipboard a moment after Ctrl + V). After Escape or an error no queued phrase is typed; words
   that were waiting for a pause when an error came are kept in the panel's text box.
2. **Microphone and indicator.** OK Filow's panel records (the selected microphone, echo cancellation)
   and its overlays show the state. The recognizer and the microphone start together; sound is kept in
   the panel until the model is loaded, so the first words are not lost on a cold start. A press that
   comes while the last dictation is still being typed waits for it, so two quick dictations neither
   merge nor lose words.
3. **Speech to text.** `stt.js` with the "questions" catalogue (short utterances). Phrase models run
   on whole phrases cut by the Silero voice detector; a streaming model gets 0.8 s of silence after the
   last sample so its last word is finished (without it "Friday" came out as "Fri").
4. **Putting the text in place** (`dictation.js`, pure parts in `dictation-core.js`):
   - one of Filow's own windows has focus and a text field in it does (script editor, OK Filow question
     box): typed directly with `webContents.insertText`, the clipboard is not touched;
   - else the window that has the keyboard is looked at when the words are ready and the user's keys are
     up (`dictation-target.js`, Windows x64, through our helper `native/target`): a password box is
     refused (nothing typed, copied, kept or logged), an administrator window or a session where no
     window has the keyboard gets the words on the clipboard with its own sentence, a terminal gets them
     typed as Unicode characters (never Enter), and Windows' answer to the key events is checked
     (`SendInput` returns how many it took). Each dictation logs its target as program name and window
     class, never a title. Full table: `docs/dictation/SPEC.md`;
   - else, when the platform allows key presses into other apps: save every clipboard format
     (Electron 45 `clipboard.read()`), wait until the user's modifier keys are up, write the text, send
     Ctrl + V (Command + V on macOS), and 1.5 s later put the saved formats back unless the user copied
     something else meanwhile. A second dictation within those 1.5 s keeps the user's original
     snapshot. A clipboard that cannot be read is never overwritten later;
   - else only copy, and say why (below).
   On Windows the dictated text carries `CanIncludeInClipboardHistory = 0` and
   `CanUploadToCloudClipboard = 0`, so Win + V history and cloud clipboard sync skip it (Handy's
   `paste_tx/windows.rs` publish_formats). Not `ExcludeClipboardContentFromMonitorProcessing`: remote
   desktop and virtual machine windows sync the clipboard as monitors, and the paste must reach them.

### Paste mechanism (why this one)

The Ctrl + V goes out through `uiohook-napi`'s `keyTap` (MIT, already a dependency for the hook):
`SendInput` on Windows, `CGEventPost` on macOS, XTest on X11. No PowerShell or shell command is built
(SEC-16 stays at 0), no new native module, nothing paid. Typing the text key by key (Handy's "direct"
mode) is not used: uiohook sends key codes, not Unicode characters, so accented, Cyrillic and Japanese
text would come out wrong; the clipboard handles every script.

### When it can only copy (said in Settings and in the bubble)

| Case | Why | What the user sees |
|---|---|---|
| Linux Wayland session | apps cannot send key presses to other apps | "only copied: press Ctrl + V" |
| macOS without Accessibility | Command + V cannot be sent | a plain prompt once per run with "Open Accessibility settings" (opens Privacy & Security > Accessibility); copied meanwhile |
| The keyboard hook did not start | no shortcut, no key presses | Settings and the OK Filow panel say so and name the key that works meanwhile (Ctrl + Alt + O for questions); Filow keeps trying (okfilow-hook-retry.js: four quick tries, then 5, 10, 20, 30 s and every 60 s, and at once after unlock, wake-up or a display change) and the keys come back without a restart |
| A Filow window has focus, but no text field | nowhere to type | "Copied. Press Ctrl + V to paste it" |
| The paste keys could not be sent, or the user's keys stayed down for 2 s | no paste | the words stay on the clipboard (losing what was said would be worse than losing the older clipboard content) and the bubble says so |
| "Only copy them" chosen | the user's choice | "Copied. Press Ctrl + V to paste it" |
| A window run as administrator (Windows) | Windows drops keys from a program that is not one | "This window runs as administrator, so Filow cannot type in it. Copied: press Ctrl + V." |
| No window has the keyboard (Windows: locked or disconnected session, remote desktop left minimized) | nowhere to type | "No text box has the keyboard. Copied: click where the words should go and press Ctrl + V." |
| Windows took none of the key events | the paste did not happen | "Windows did not accept the keys. Copied: press Ctrl + V." |
| A password box (Windows) | dictation never goes into one | "This is a password box: nothing was typed and nothing was kept." Nothing is copied either. |

## Privacy

Nothing leaves the PC: microphone to `stt.js` on this PC, text to the clipboard and the focused app.
Dictated text and audio are not stored; the log records only counts and timings ("pasted 52 chars",
"release to text 2 ms"). Listed in docs/okfilow/OUTBOUND.md as a local path, with the one thing Filow
does not control: a third-party clipboard manager may still record the text for the moment of the paste.

## Tests and checks

- `apps/desktop/dictation-core.test.ts`: shortcut parsing and conflicts, settings, paste-or-copy per
  platform, the clipboard order (save, keys up, write with markers, paste, restore; user's newer copy
  kept; unreadable never overwritten; two dictations in a row), text clean-up in five languages.
- `apps/desktop/okfilow-gestures.test.ts` "dictation in toggle mode", and the double tap: starts
  hands-free dictation, one more press or Escape ends it, slow taps and shortcuts do not count.
- `apps/web/lib/dictation/handsfree.test.ts`: which phrases are typed and when (with the real pause
  detector); `apps/desktop/dictation-handsfree.test.ts`: phrase after phrase through the real insert
  and clipboard code (spaces, clipboard put back, history markers on every phrase, copy-only).
- `packages/stt/src/stop.seams.test.ts`: the silence before the end of a streaming take.
- `apps/desktop/dictation-target.test.ts`: password box, administrator window, terminal, no window,
  refused keys, and "the target is the window that has the keyboard when the keys are up" through the
  real insert; `apps/desktop/dictation-diag.test.ts`: the report section, the problem codes, and that the
  GitHub link never cuts the section; `okfilow-gestures.test.ts`: brief presses as real fingers make them.
- End to end (QA build): `FILOW_OKF_FAKE_MIC=<wav>` plays a recording as the microphone and
  `FILOW_OKF_QA_KEYS=1` lets the panel feed key presses to the real gestures code (for machines where
  Windows refuses the hook, such as a locked session). Both switches work only in a QA package.

## Report a problem

The report has a "Dictation and keys" section (`dictation-diag.js`, spec in `docs/dictation/SPEC.md`):
a problem code, the settings, the keyboard hook's state, the model, the microphone permission, the
platform's facts and the last five dictations stage by stage with times. Never the words.

## Not done yet

- macOS, Linux and Windows on ARM have no target helper: no password-box or administrator detection
  there, and whether the keys were accepted is not known (docs/dictation/SPEC.md says why).

- The first ~250 ms after pressing the keys are not recorded (the arm delay, plus the microphone
  start). Opening the microphone at the first key-down would catch them, at the cost of a brief
  microphone light on every Ctrl + Win shortcut: an owner decision.
- The microphone still runs on a ScriptProcessor node; the AudioWorklet version (commit 385021f, branch ux-fixes) is not merged or measured.
- The filler sounds follow the rehearsal report's list by hand (`dictation-core.js` SOUNDS); once both
  live where the desktop can import them, `setFillerHook` takes the shared list.
