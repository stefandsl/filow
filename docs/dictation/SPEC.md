# Dictation: specification (2026-11-11)

Goal (owner): dictation as intuitive as Wispr Flow, with Handy as the open-source reference, proved in
real apps, and a "Report a problem" good enough to troubleshoot dictation on any system.
Research behind this: `docs/dictation/RESEARCH.md`. How the code works: `docs/okfilow/DICTATION.md`.

## What the owner reported (issue #7, Filow 0.9.32, his laptop)

"When I let go of Ctrl+Win the text is not written in other apps, and it does not stay listening in the
background until I have finished. Sometimes it is written, but only if I keep Ctrl+Win held."

What the log in the issue shows, and what it means:

| In the log | Meaning | Answer in this round |
|---|---|---|
| Five presses of 0.45 to 0.85 s (`dictate:start`, then `dictate:end` 0.2 to 0.6 s later), then `mode idle` two seconds later and nothing else | A press too short to say anything. Filow showed "Nothing was heard" for 2.5 s and logged nothing. The owner expected the press to start listening. | The bubble now says what to do ("Hold the keys while you speak, or press them twice briefly to keep listening") for 5 s, and the log and the report record it (code `FD-H1-SHORT`). |
| No `dictate:handsfree` anywhere | Hands-free needed two taps of under 0.25 s each. Two fingers on two keys take 0.4 to 0.8 s, so two presses were two empty dictations. | A press under 0.8 s counts as brief, also when it already started a dictation; the second brief press within 0.6 s keeps that dictation going with the keys up. |
| Two holds of about 2 s: `pasted 36 chars`, `release to text 664 ms`, `clipboard put back` | These two typed ("sometimes it is written, if I keep the keys held"). The log could not say into which window, or whether Windows took the keys. | The target window (program, window class), the method and whether Windows accepted the keys are logged and kept for the report. |
| `ScriptProcessorNode is deprecated` on every dictation | The microphone still runs on the old audio node. | Not changed in this round (see "Later"). |

## Must have

### 1. Listening that stays on until I finish

- **Hold to talk** (default): hold the keys, speak, let go. The words go in when the keys are up.
- **Hands-free**: press the keys twice briefly (or once in "press once" mode). Filow keeps listening with
  the keys up and types each phrase at a pause. One more press stops it and types the rest; Escape stops
  it and drops the rest; five minutes without a stop end it.
- **Indicator**: the "Dictating" pill and the bubble next to the pointer for as long as the microphone is
  open. The overlay window cannot take the keyboard (`focusable: false`, shown without activation).
- **One obvious way to stop**: the same keys. The bubble names them while hands-free runs.
- **A press that gave nothing** tells the user how the keys work, instead of only "Nothing was heard".

### 2. The text goes where I mean

- The target is the control that has the keyboard **when the words are ready and the user's keys are
  up**, read at that moment for every dictation and every hands-free phrase. Pressing the keys and then
  clicking a text box in another window sends the words to that box. A click never cancels a dictation.
- Method per target (`apps/desktop/dictation-target.js`):

  | Target | Method | What the user sees |
  |---|---|---|
  | One of Filow's own text fields | typed directly, clipboard untouched | nothing extra |
  | Ordinary window (native, browser, Electron, Office) | clipboard, Ctrl + V, clipboard put back after 1.5 s | nothing extra |
  | Terminal (conhost, Windows Terminal, mintty, PuTTY, ConEmu, WezTerm) | typed as Unicode characters, clipboard untouched, never Enter | nothing extra |
  | Password box | refused: nothing typed, nothing copied, nothing kept or logged | "This is a password box: nothing was typed and nothing was kept." |
  | Window of a program run as administrator (Filow is not) | copied only | "This window runs as administrator, so Filow cannot type in it. Copied: press Ctrl + V." |
  | No window has the keyboard (locked or disconnected session, remote desktop left minimized) | copied only | "No text box has the keyboard. Copied: click where the words should go and press Ctrl + V." |
  | Windows accepted none of the key events | copied only | "Windows did not accept the keys. Copied: press Ctrl + V." |

- Never silently: every fallback has its own sentence in the bubble and in the OK Filow panel, in five
  languages, and its own reason in the log and the report.
- Platforms: the target facts need a helper of our own on Windows x64 (`apps/desktop/native/target`).
  On macOS, Linux and Windows on ARM the target is "unknown": the paste goes through the keyboard hook as
  in 0.9.32, with the existing notices (Wayland: copy only; macOS without Accessibility: copy only).
  **Not done there, and why:** password boxes are not detected (macOS needs the Accessibility API's
  `AXSecureTextField` role and a signed build to test; X11 has no reliable flag; Wayland cannot type at
  all), administrator windows are a Windows concept, and whether the keys were accepted cannot be read
  back from CGEvent or XTest.

### 3. On this PC by default, five languages

Unchanged: the speech models run on this computer, dictation has no cloud path, the interface texts
exist in en, it, ru, ro, ja (parity tests), and the new sentences of this round were written in all five.

### 4. Latency

Measured value in the owner's log (Core Ultra 7 155H, streaming model): 664 and 674 ms from release to
text. Per setup tier it is to be measured with `dictation: release to text N ms` from the log; the
report now carries the same times per stage, so every issue is a measurement. See "Proof" in
`docs/okfilow/DICTATION.md` for what was measured on the development PC and what could not be.

## Troubleshooting report

"Report a problem" has a section **Dictation and keys** (`apps/desktop/dictation-diag.js`), first after
the system line and never cut from the GitHub link:

- a problem code the owner can quote (`FD-H1-SHORT`, `FD-H0-NONE`, `FD-H1-COPY-ELEVATED`, `FD-H1-PW`,
  `FD-H1-KEYS`, `FD-H1-NOTEXT`, `FD-H1-OK`, ...): hook state, then what became of the last dictation;
- the settings (keys, mode, where the words go, language);
- the keyboard hook: registered or not, the error, failed tries, time of the last try;
- the speech model for the dictation language: on this computer or not;
- the microphone permission as the system reports it;
- the platform's own facts: Windows (remote desktop session, administrator), macOS (Accessibility and
  keyboard permissions), Linux (Wayland or X11, desktop);
- the last five dictations, stage by stage with times from key-down: microphone asked, first sound,
  keys up, characters recognised (a count), target program and window class, method, done, clipboard
  put back.

Never in it: the dictated words, a window title, a file path of the target program. The section goes
through the same masking as the logs. The window says before the click that the report becomes public
and that the section names the program dictated into. "Copy the full report" and "Save" (which shows the
saved path) are next to the GitHub button; nothing is sent automatically.

## Wispr-style features, in priority order

| Feature | Round | Why |
|---|---|---|
| Brief presses forgiven, hold goes on hands-free | this round | the owner's report |
| Target at the time the words are ready, password and administrator handling, visible fallbacks | this round | "text goes where I mean" |
| Stages in the report | this round | troubleshooting on other systems |
| Paste last dictation again (a shortcut or a button), short history kept in memory | next | the top gap in the research: words are lost when a paste fails silently in an app we cannot read |
| Personal dictionary (words and correction pairs applied after recognition) | next | small, local, high value for names; needs a settings screen in five languages |
| Spoken punctuation and "new line" | next | per-language word lists, with tests per language |
| Snippets (spoken trigger to saved text) | later | builds on the dictionary |
| Voice commands for editing selected text | later | needs a local language model in the loop and the selection reader; latency on old hardware must be measured first |
| Per-app style | later | needs the target facts of this round plus a language model; the owner should decide whether it may ever use a cloud model |
| Indicator with stop and cancel buttons, idle "ready" state | owner decision | a clickable always-on-top element must never take the keyboard; possible, but it changes how the screen looks at all times |
| Microphone on an AudioWorklet (commit 385021f on ux-fixes, unverified) | later | no evidence in issue #7 that first words are lost; needs its own measurement on a build |

## Owner decisions this round leaves open

1. A single brief press could start hands-free by itself (now: two). Fewer steps, more accidental starts.
2. Opening the microphone at the first key-down would save the first 250 ms of speech at the cost of a
   microphone light on every Ctrl + Win shortcut (already listed in DICTATION.md).
3. Closed source or GPL: Handy is MIT, so nothing here depends on it; see the licence table in RESEARCH.md.
