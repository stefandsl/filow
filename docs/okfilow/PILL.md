# OK Filow: the pill's controls

The pill is the small bar at the top centre of the screen with the mouse. The same controls are on
the status row of the OK Filow panel. Everything here works by mouse and keyboard only: no spoken
or typed command opens or closes the eye, pauses, resumes or stops ("close your eye" is a question
like any other).

## What the controls do

| Control | Where | What it does |
| --- | --- | --- |
| Eye | pill, and the switch "Look at my screen" in the panel | One setting (`okFilow.seeScreen`). Open: the next question takes a picture of the screen with it. Closed: no picture of the screen is taken at all. The button shows the setting as it is now, as an icon and as a word (On / Off). |
| Pause | pill and panel, while an answer is in progress | The text stops appearing, the voice finishes what it cannot cut cleanly and then holds, the pointer and the pen freeze. Stop and Esc still work. |
| Resume | in place of Pause while paused; also after Stop | After a pause: carries on exactly where it paused. After Stop: see below. |
| Stop | pill and panel, while an answer is in progress | Ends the answer (the request to the model, the voice, the pointing). What was shown stays, marked "Stopped". |

Pill layout: answering `[eye] status [Pause] [Stop Esc]`, paused `[eye] Paused [Resume] [Stop Esc]`,
stopped `[eye] Stopped [Resume]` (it goes away with the bubble; Resume stays on the panel).
Pause and Resume are one button with room for both words, and the statuses of an answer share one
room, so the pill has the same width answering and paused.

The overlay window never takes the keyboard (it must not take it from the app in use), so the
keyboard reaches these controls through the panel's buttons and the two shortcuts.

## The eye: privacy rules

- Closed means zero screen captures, for answers on this PC and online. The panel asks for no
  picture, and the desktop shell itself refuses to call the screen capturer while the stored setting
  is "off" (`okfilow-stop.js` `screenSources`), whoever asks.
- A click while the setup still decides ("auto") makes the choice the user's own: "off" when it was
  looking, "on" when the setup had left it shut on a slow PC. An explicit "off" is never turned back
  by the setup; only the user changes it. It is stored in settings.json and survives a restart.
- Closing the eye during a question: a screenshot already taken but not yet sent is dropped and the
  question goes with the words only (`images: []`, `sees: false`). The second request that finds the
  point on screen is skipped. Nothing is claimed about a screenshot that had already been sent.
- Opening the eye during a question changes nothing for the question already asked.

## Pause, per voice

| Voice | Pause | Resume |
| --- | --- | --- |
| This PC's voice (speechSynthesis) | The answer is spoken one sentence per utterance. The sentence being spoken is finished, the next ones wait. | Speaks the first sentence not spoken yet. |
| Natural voice (pieces from tts.js) | The piece being heard (a sentence or a clause) plays to its end; the pieces not yet begun come off the schedule and are kept in order, with the ones that arrive meanwhile. | The kept pieces are scheduled again, in order. Nothing cut, nothing repeated. |
| Cloud voice (one recording) | Nobody knows where its sentences end: it pauses at once, with a fade of about 40 ms. | Plays on from the same position. No new request. |

The clock that gives up on speech that went missing stands still during a pause.

While paused the request to the model is still read, into a buffer: nothing upstream times out, a
local model simply finishes. If the request fails during the pause, the error is held and shown on
Resume, never as a bubble during the pause.

## Resume after Stop

| Stopped... | Resume does |
| --- | --- |
| while the text was arriving, with text shown | The text is cut back to its last whole sentence and the model is asked to carry on from it, in the same conversation (`resume: true`; the server adds one instruction after the conversation). Sentences the model says again are dropped. The eye as it is now decides whether a screenshot goes. The conversation keeps one question and one answer. |
| before any text (or before a whole sentence) | The same question is asked again. |
| while it was being spoken (the whole text was there) | The voice says the sentences it has not said, the pen draws the marks not begun. No request to the model. |

The voice after a Resume speaks only sentences it has not spoken. When the stop came before the
voice started, that is the whole answer: it had been shown, never spoken.

Resume is not offered when carrying on is impossible: a new question was asked since, the
conversation was cleared, the stopped answer was a drawing request, or it was an agent or
whiteboard job. A new question is always possible and withdraws the offer.

How far the voice got at a stop: exact for this PC's voice (a sentence cut by Stop counts as not
spoken); for the natural voice it is worked out from the words of the pieces already played, and
for the cloud voice from the share of the recording played, so the Resume may start one sentence
early or late with those two.

## Shortcuts

| Action | Default | Other choices | Setting |
| --- | --- | --- | --- |
| Open or close the eye | Ctrl + Alt + Shift + H | Ctrl + Alt + Shift + F7, none | `okFilow.eyeKey` |
| Pause / Resume | Ctrl + Alt + Shift + G | Ctrl + Alt + Shift + F8, none | `okFilow.pauseKey` |
| Stop | Esc | - | - |

The Pause / Resume key acts only while an answer runs (pause, resume) or can be carried on
(resume); otherwise it does nothing. The choices are in the panel, under the talk keys. They are
global shortcuts registered with Windows (through `shortcutsFor()` in `global-input.js`, so a test
run registers none). If Windows refuses one because another app has it, the panel says so next to
the choice. The talk keys keep their meaning during an answer.

### Collision check

Checked on 2026-11-11.

- Filow's own keys: talk chords Ctrl+Alt, Ctrl+Shift, Alt+Shift, Ctrl+Win (hold or double tap),
  dictation Ctrl+Win, double Ctrl (text box), Esc (stop, clear), the fallback Ctrl+Alt+O, the Screen
  Sense hotkey (set by the user). A three-modifier combination is never a two-modifier chord: an
  extra modifier or any other key cancels the chord (`okfilow-gestures.js`). Tested: Ctrl, Alt,
  Shift, H pressed in quick succession emits nothing, with every talk chord. One case to know: with
  Ctrl+Alt as the talk keys, holding Ctrl+Alt for longer than 250 ms before adding Shift starts a
  question and ends it at once when Shift goes down (`talk:start`, `talk:end`).
- Windows: there is no Ctrl+Alt+Shift+letter system shortcut. Ctrl+Alt+Del, Ctrl+Shift+Esc,
  Ctrl+Alt+Tab, Ctrl+Alt+arrows (Intel rotate), Alt+Shift and Ctrl+Shift (layout switch), Win+...
  and the Office key (needs Win) do not match.
- AltGr is Ctrl+Alt: AltGr+Shift+H and AltGr+Shift+G type nothing on the US-International, Italian,
  Romanian (standard and programmers), Polish, German, Russian and Japanese layouts. The letters
  E, P, Y, S, A, C, L, N, O, Q, T, U, I, Z are taken on some of them and were avoided.
- Other apps, checked from memory and not from their current documentation: Photoshop uses
  Ctrl+Alt+Shift+E/S/K/B/N, JetBrains IDEs J/V/K/S/T/N/L/C/U, Excel Ctrl+Alt+Shift+F9, VS Code none
  of H/G/F7/F8, browsers none, the NVIDIA and AMD overlays use Alt+F-keys and Alt+Z/R. Space is not
  used.

## Where it lives

- Rules: `apps/web/lib/buddy/pill.ts` (what the pill shows, the shortcuts), `turn.ts` (pause,
  Resume after Stop, joining a continuation), `voice.ts` (pause per voice), `sees.ts` (the eye),
  `motion.ts` (the clock of the flights and the pen), `apps/desktop/okfilow-stop.js` (the shell's
  side: capture gate, mouse rule, shortcuts).
- Route for every control: overlay -> `okfilow:control` -> main -> panel, which acts and tells main
  the pill's state (`okfilow:pill`: the eye now, paused, resumable); main tells every overlay.
- Test builds: `window.okFilow.qaKey("down", "eye" | "pause")` does what the two shortcuts do.
