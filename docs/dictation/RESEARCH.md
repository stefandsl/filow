# Dictation research: Handy, Wispr Flow and similar projects

Scope: what Handy does and what Filow may take from it, how Wispr Flow behaves (behaviour only), and
which other open projects exist. This is research, not legal advice. Licence questions that decide
whether Filow can be sold closed source should be confirmed by a lawyer before release.

## Sources and date

Research date: 2026-11-11. Everything below was read on that day. "Verified" means the file or page
itself was fetched; "inferred" means a conclusion drawn from what was read; "unverified" means not read.

Handy (code and licence)
- Repository: https://github.com/cjpais/Handy (confirmed canonical; no redirect; sidebar says MIT; about 38.4k stars)
- Licence file: https://raw.githubusercontent.com/cjpais/Handy/main/LICENSE
- README: https://raw.githubusercontent.com/cjpais/Handy/main/README.md
- Head commit read: f248301 (2026-11-11). Latest release: v0.10.0 (2026-11-02), https://api.github.com/repos/cjpais/Handy/releases/latest
- Source files read (all under https://raw.githubusercontent.com/cjpais/Handy/main/src-tauri/):
  `Cargo.toml`, `src/clipboard.rs`, `src/input.rs`, `src/settings.rs`, `src/transcription_coordinator.rs`,
  `src/managers/audio.rs`, `src/audio_toolkit/vad/mod.rs`, `src/audio_toolkit/text.rs`, `src/overlay.rs`,
  `src/shortcut/handy_keys.rs`, `src/managers/transcription/live.rs`, `src/paste_tx/mod.rs`, `src/catalog/mod.rs`
- File tree: https://api.github.com/repos/cjpais/Handy/git/trees/main?recursive=1

Handy dependencies (licence files)
- https://raw.githubusercontent.com/enigo-rs/enigo/main/LICENSE
- https://raw.githubusercontent.com/rustdesk-org/rdev/master/LICENSE
- https://raw.githubusercontent.com/handy-computer/handy-keys/main/LICENSE
- https://raw.githubusercontent.com/handy-computer/transcribe.cpp/main/LICENSE
- https://github.com/handy-computer/handy-recorder
- https://raw.githubusercontent.com/cjpais/transcribe-rs/main/LICENSE
- https://github.com/tazz4843/whisper-rs
- https://crates.io/api/v1/crates/earshot
- https://raw.githubusercontent.com/snakers4/silero-vad/master/LICENSE
- https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3
- https://raw.githubusercontent.com/openai/whisper/main/LICENSE

Wispr Flow (public help centre and site; behaviour only)
- W1 https://docs.wisprflow.ai/articles/6391241694-use-flow-hands-free
- W2 https://docs.wisprflow.ai/articles/7971211038-fix-text-not-pasting-after-dictation
- W3 https://docs.wisprflow.ai/articles/4816967992-how-to-use-command-mode
- W4 https://docs.wisprflow.ai/articles/2612050838-supported-unsupported-keyboard-hotkey-shortcuts
- W5 https://docs.wisprflow.ai/articles/5373093536-how-do-i-use-smart-formatting-and-backtrack
- W6 https://docs.wisprflow.ai/articles/2368263928-how-to-setup-flow-styles
- W7 https://docs.wisprflow.ai/articles/9639977157-view-shared-dictionary-words-and-snippets-in-the-admin-portal
- W8 https://docs.wisprflow.ai/articles/2772472373-what-is-flow
- W9 https://docs.wisprflow.ai/articles/4048537120-what-to-expect-from-flow-accuracy-and-known-limitations
- W10 https://docs.wisprflow.ai/articles/6478598909-using-flow-with-linux-wsl-and-terminal-applications
- W11 https://docs.wisprflow.ai/articles/5002934560-why-is-the-wispr-bar-is-not-appearing-or-disappearing
- W12 https://docs.wisprflow.ai/articles/1790396454-move-and-dock-the-flow-bar-on-desktop (search result summary only, page not opened)
- W13 https://docs.wisprflow.ai/articles/3191899797-use-flow-with-multiple-languages (search result summary only)
- W14 https://wisprflow.ai/whats-new
- W15 https://wisprflow.ai/workflow/whispering-in-an-open-office (search result summary only; marketing page)
- W16 https://docs.wisprflow.ai/articles/5096240724-navigating-the-wispr-flow-app-desktop-ios-and-android

Similar projects
- https://github.com/OpenWhispr/openwhispr , https://raw.githubusercontent.com/OpenWhispr/openwhispr/main/LICENSE ,
  https://raw.githubusercontent.com/OpenWhispr/openwhispr/main/src/helpers/clipboard.js
- https://github.com/EpicenterHQ/epicenter , https://raw.githubusercontent.com/EpicenterHQ/epicenter/main/apps/whispering/README.md
- https://github.com/Beingpax/VoiceInk
- https://github.com/ideasman42/nerd-dictation
- https://github.com/chidiwilliams/buzz
- https://github.com/savbell/whisper-writer
- https://github.com/thewh1teagle/vibe

Filow
- `docs/okfilow/DICTATION.md` in this worktree (what Filow does today).
- The earlier study `HANDY-STUDY.md` (commit 73cc857, 6 Nov 2026). Checked against today's code: see
  "Earlier study: what held up" at the end of the Handy section.
- https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/master/LICENSE , https://raw.githubusercontent.com/SnosMe/uiohook-napi/master/LICENSE

## Handy

### Licence (exact quote)

The LICENSE file at the repository root begins:

> MIT License
>
> Copyright (c) 2025 CJ Pais

The rest is the standard MIT text. The one condition is: "The above copyright notice and this
permission notice shall be included in all copies or substantial portions of the Software."
`src-tauri/Cargo.toml` also says `license = "MIT"`.

One limit outside the MIT text: the README says the Handy name, logo, icon and brand assets are not
open source, and forks must use their own branding and not imply endorsement.

### Features (README and settings.rs)

- Local speech to text on Windows, macOS and Linux. Version 0.10.0. Tauri 2 (Rust core, web UI).
- Start and stop: hold the shortcut and release, or tap to lock on and tap again to stop. Hold-only and
  toggle-only modes exist. Escape cancels.
- Default shortcuts: Ctrl+Space (Windows), Option+Space (macOS), Ctrl+Alt+Space (Linux).
- Silence filtering with a voice detector (Silero by default, Earshot as an experimental option).
- Many models through one engine (Whisper sizes, Parakeet, Canary, Nemotron streaming and others).
- Live preview: with a streaming model the overlay shows text while the user speaks.
- Filler removal, a custom word list with fuzzy matching, removal of triple word repeats.
- Optional post-processing by a language model (OpenAI, Anthropic, Groq, OpenRouter, Cerebras, Z.AI,
  AWS Bedrock, Apple Intelligence, or a custom endpoint, default `http://localhost:11434/v1`). Off by default.
  This is the one path where text can leave the PC.
- A user script hook on macOS and Linux that receives the text and returns the text to paste.
- History (default limit 5 recordings), start and stop sounds (off by default), optional mute of the
  speakers while recording, optional always-on microphone, auto-submit (Enter after paste), trailing space.
- Command line control: `--toggle-transcription`, `--toggle-post-process`, `--cancel`, and signal SIGUSR2 on Unix.

### Architecture by stage

**1. Hotkey.** `shortcut/handy_keys.rs` uses the `handy-keys` crate (`HotkeyManager::new_with_blocking()`).
Its README says it uses low-level keyboard hooks on Windows, needs Accessibility on macOS, and reads
evdev devices on Linux. It can block the hotkey from reaching other apps. It allows modifier-only
shortcuts and the fn key. Windows and macOS default to handy-keys; Linux defaults to Tauri's global
shortcut plugin. A third option, `None`, means the desktop environment triggers Handy by command line
or signal (the README's route for Wayland). On macOS, recording is refused while Secure Input is active.

**2. Press logic.** `transcription_coordinator.rs` is a pure state machine: Idle, Recording, Processing.
Modes: PushToTalk, Toggle, HoldOrToggle (default). In HoldOrToggle a hold of at least 300 ms
(`hold_threshold`, settings default) stops on release; a shorter tap locks recording until the next press.
`DEBOUNCE` is 30 ms. `RELEASE_GRACE` is 50 ms and absorbs X11 key auto-repeat. One press made during
processing is remembered and starts when processing ends. Cancel clears everything and nothing is pasted.

**3. Audio capture.** `managers/audio.rs` uses the `handy-recorder` crate at 16 kHz mono. The stream opens
on demand, or stays open (always-on). With lazy close it shuts 30 s after the last recording
(`STREAM_IDLE_TIMEOUT`). Recordings under 1 s are padded with silence to 1.25 s. Cancel discards the samples.

**4. Voice detection.** Silero v6.2 (threshold 0.3, 32 ms frames, model file bundled as
`silero-vad-v6.2-F32.gguf`) or Earshot (threshold 0.5, 16 ms frames). Both are wrapped by a smoother:
pre-roll 450 ms, onset 60 ms, hangover 450 ms offline and 1650 ms when streaming (`audio_toolkit/vad/mod.rs`).

**5. Models.** The engine is `transcribe-cpp` 0.4.0 (Rust binding of transcribe.cpp, GGUF files on ggml,
GPU where available). Today's `Cargo.toml` has no `whisper-rs` and no `transcribe-rs`; older Handy
versions used them. `catalog/mod.rs` ranks models: Parakeet Unified EN 0.6B, Nemotron streaming 0.6B,
Canary 180M flash, Cohere Transcribe, Whisper medium, then Voxtral Mini realtime, Parakeet TDT v3 and v2,
Qwen3-ASR 0.6B, Fun-ASR. Downloads are pinned to a revision, checked by SHA-256, with a mirror at
`blob.handy.computer`. `managers/transcription/live.rs` decodes while recording (streaming or in chunks)
and falls back to a batch decode when the live result is empty or fails.

**6. Text cleanup.** `audio_toolkit/text.rs`: custom words (Levenshtein distance on 1 to 3 word groups,
Soundex boost, default threshold 0.18, ASCII terms only), filler removal (a universal list such as
"uh", "uhm", "hmm", "хм", plus per-language words for English, German and French only; a removed filler
hands its capital to the next word), collapse of three or more repeated words, whitespace cleanup.

**7. Putting the text in place.** `clipboard.rs` `paste`, with a global `PASTE_LOCK`. Methods (`PasteMethod`):

| Method | What it does | Default on |
|---|---|---|
| CtrlV | save clipboard, write text, wait 60 ms, send Ctrl+V (Command+V on macOS), wait 60 ms, restore | Windows, macOS |
| CtrlShiftV | same, with Ctrl+Shift+V (terminals) | - |
| ShiftInsert | same, with Shift+Insert | - |
| Direct | types the text as Unicode (`enigo.text`), clipboard untouched | Linux |
| ExternalScript | runs the user's script with the text as argument | - |
| None | no insertion (history only) | - |

- Keys are sent with `enigo` (`input.rs`), with the modifier held 100 ms. Windows uses fixed virtual keys
  (V = 0x56, Insert = 0x2D). macOS finds the key that produces "v" in the current layout.
- The standard path saves only text, or an image when there is no text. It restores after a fixed delay,
  even when the key press failed. If nothing was saved it clears the clipboard.
- "Reliable paste" (beta, Windows and macOS, `paste_tx/`): the text is offered by delayed rendering, the
  clipboard is restored 200 ms after the target app has read it, at most 8 s later (0.5 s if the key press
  failed), and not at all when someone else took the clipboard.
- Linux X11: `xdotool` (`--clearmodifiers`), then `ydotool`, then enigo.
- Linux Wayland: for key combos `wtype` (not on KDE or GNOME), then `dotool`, then `ydotool`; for typing
  `kwtype` on KDE first. Clipboard through `wl-copy` when present. The README calls Wayland support
  limited and says Ubuntu 26.04 needs `ydotool`. The overlay is off by default on Linux because it can
  take the focus and break the paste.
- Options: trailing space, auto-submit (Enter, Ctrl+Enter or Cmd+Enter, 50 ms after the paste), leave the
  transcript on the clipboard (`ClipboardHandling::CopyToClipboard`).
- Handy does not record which window had focus when recording started. The text goes to whatever has
  focus when the paste is sent (inferred from clipboard.rs: no window handle is saved or restored).
- Nothing in the files read handles elevated (administrator) windows on Windows.

**8. Overlay.** `overlay.rs`: a transparent window that cannot take focus, on the monitor with the mouse
pointer, centred, top or bottom (default bottom). 266 x 50 for recording, transcribing and processing;
400 x 120 for live text. Level bars update about 30 times a second (33 ms throttle). Notices stay 4 s.
macOS uses a non-activating NSPanel; Linux uses gtk-layer-shell; Windows forces topmost without activation.

### What Filow can take

Filow copies ideas and small algorithms from Handy, rewritten in JavaScript. Ideas, behaviour, timing
values and file formats are not protected by copyright. The rules below matter only when actual Handy
code (or a close translation of it) or Handy files end up in Filow.

| | Filow stays GPL-3.0-or-later | Filow goes closed source and is sold |
|---|---|---|
| Use Handy code (ported or copied) | Allowed. MIT is compatible with GPL-3.0. The combined work is distributed under the GPL. | Allowed. MIT permits use, change, sale and sublicensing in a closed product. |
| What must be kept | The MIT copyright line and permission notice for the Handy parts, in the source file or in THIRD_PARTY_NOTICES. | The same notice, shipped with the product (a notices file or an "open source licences" screen is the usual way). |
| Source disclosure | Filow's own source is published anyway, under the GPL. | None. MIT does not require publishing source or changes. |
| Selling | Allowed under the GPL too, but buyers get the GPL rights, including the source. | Allowed. |
| Name, logo, icon, brand assets | Not usable (README: not open source). | Not usable. |
| Sound files, tray images in `src-tauri/resources` | Avoid. Their origin and terms were not checked; Filow has its own tones. | Avoid, same reason. |
| Model files | Each model has its own licence (see the licence table). Not covered by Handy's MIT. | Same. Attribution duties (CC-BY-4.0) apply in a paid product too. |

Notes for the owner's open decision:
- Nothing taken from Handy blocks either choice. MIT works with both.
- What does block a closed release is GPL or AGPL code from other projects (VoiceInk, whisper-writer,
  nerd-dictation are GPL-3.0; Whispering is AGPL-3.0). Do not copy code from those into Filow if the
  closed option is to stay open. Reading them for ideas is fine.
- Going closed also needs every copyright holder of Filow's own GPL code to agree (the owner, plus any
  outside contributors). Versions already published under the GPL stay under the GPL.
- Today Filow says no Handy code or asset is copied, so no notice is owed. If a future port is close to
  a translation of a Handy function, add the MIT notice then; it costs nothing and covers both choices.

### Earlier study: what held up

Checked `HANDY-STUDY.md` against today's code (head f248301, five days newer than the study).
- Confirmed: the three modes and the 300 ms, 30 ms, 50 ms values; VAD thresholds and the 450/60/450/1650 ms
  values; paste methods and per-platform defaults; 60 ms delays and the 100 ms modifier hold; `PASTE_LOCK`;
  the Linux tool order; overlay sizes and 30 fps; the custom word threshold 0.18; the model ranking
  (it now has ten entries, the study listed five); mirror host and hash check; reliable paste timings
  (200 ms, 8 s, 0.5 s); all licences it lists.
- Not rechecked today: the count of 76 models, `paste_tx/windows.rs` (the clipboard history opt-out
  formats), `secure_input.rs` details, the download code, update checks.
- Small correction: handy-keys' LICENSE says "Copyright (c) 2026 handy-computer".

## Wispr Flow: behaviour that makes it feel intuitive

Wispr Flow is proprietary. Everything here is behaviour described in its public help pages, in our own
words. No code, assets or wording are taken. Source tags refer to the list at the top.

**Starting and stopping**
- Push to talk: hold the shortcut, speak, release. The default on Windows is Ctrl+Win (or Caps Lock,
  chosen at setup); on Mac it is Fn. (W1)
- Hands-free: a separate shortcut (Ctrl+Win+Space on Windows, Fn+Space on Mac) or two quick presses of
  the push-to-talk key within half a second. Pressing again, or clicking the stop button on the bar,
  ends it and inserts the text. (W1)
- Clicking the on-screen bar also starts a dictation, so the mouse alone is enough. (W1)
- Cancel: Escape (can be remapped) or the X on the bar. Nothing is inserted. (W1, W4)
- A start that is ended within half a second counts as a cancel, not as an empty dictation. A notice then
  offers Undo, which inserts the last transcript again. (W1)
- Hands-free warns at 19 minutes and stops at 20; the audio so far is transcribed, not thrown away. (W1)
- A new dictation can start while the previous one is still processing; it waits its turn. Escape on a
  waiting dictation discards it. (W9)
- Up to four shortcuts per action. Mouse buttons (middle, 4, 5) can be shortcuts and are then hidden from
  other apps. A hands-free shortcut that overlaps the push-to-talk one is saved with a warning. (W4)

**The on-screen indicator**
- A small bar is always on screen by default ("Show Flow Bar at all times"), so the user sees that the
  app is ready before speaking. It can be hidden for an hour from its right-click menu, or switched off. (W11)
- While recording it shows a live waveform with stop and cancel buttons. (W1, W12)
- It can be dragged to the bottom, left or right edge and remembers the place; at the sides it turns
  vertical. The top edge is not offered. (W12, W14)
- It carries a language picker and a microphone picker. (W14)
- A start sound plays before the user should speak. (W1)
- Its exact look in the "processing" state is not described in the pages read (unverified).

**Where the text lands**
- Into the text field that has focus when the dictation ends, by a paste through the clipboard. On desktop
  the text appears after the user stops, not while speaking. (W1, W2, W8)
- Hands-free inserts the whole text once at the end (W1). This differs from Filow, which types phrase by phrase.
- No focused field: nothing is inserted. A notice shows the transcript with a Copy button and asks the
  user to select a text box first (documented for Windows). (W1, W2)
- "Paste last transcript" (Alt+Shift+Z on Windows, Ctrl+Cmd+V on Mac) and "Copy last transcript"
  (Alt+Shift+X, Ctrl+Cmd+C) recover text that went nowhere. Both are also in the tray menu and the bar's
  menu. A history in the app keeps earlier dictations. (W2, W9, W10)
- Focus change between start and stop: not documented for desktop. Inferred: the text goes to whatever
  has focus at paste time, and the recovery shortcuts are the answer when that is the wrong place.
- The same paste goes to every app; there is no special handling for terminals. If the terminal does not
  accept it, the paste fails without a warning, and the user falls back to "Paste last transcript".
  WSL windows, Linux virtual machines and SSH sessions need that fallback. No native Linux app. (W10)
- No setting for another paste key (Shift+Insert, Ctrl+Shift+V) or for typing the text key by key is
  described (W2, W10). Inferred: Ctrl+V and Command+V only.

**Clipboard behaviour**
- The earlier clipboard content is put back after a successful insert; something the user copied in the
  meantime is kept. Windows restores about half a second after the paste. Mac restores once the app has
  read the paste, which can take several seconds in some apps. (W2, W9)
- Not every format is restored (on Windows: text, HTML and common images are; files, PDF, RTF, audio are not). (W2)
- After a failed insert the dictated text may stay on the clipboard. (W2)
- Clipboard managers and Windows clipboard history are asked to ignore the dictated text. (W2)
- Windows: when the target app runs as administrator the insert can be blocked; a notice explains the
  privilege difference and suggests running the app as administrator. (W2)
- Remote desktop: run it on the local PC and allow clipboard sharing. (W2)
- Password fields: on Android the control is hidden in password and similar fields. Nothing is documented
  for desktop password fields (unverified). (W2, W8)

**Corrections while speaking ("backtrack")**
- A spoken self-correction replaces what came before: a signal word or a plain restatement removes the
  abandoned phrase, not only one word. The same words used in their normal sense are kept. (W5)
- Cleanup levels on desktop: none (exact words), light (fillers and grammar), medium (also shorter and
  clearer). The cleaned text can be reverted to the raw version from the history. (W5, W14)

**Formatting**
- Punctuation and capitals are added; paragraphs start at topic changes; sequence words turn into a list. (W5)
- Spoken punctuation and layout words (comma, question mark, new line, new paragraph and so on) are
  obeyed, even with formatting off. (W5)

**Personal dictionary and snippets**
- Dictionary: words added by hand, imported from a file, or learned automatically from the user's
  corrections and context (learned words are marked). A correction pair maps a wrong spelling to the right one. (W7)
- Snippets: a spoken trigger is replaced by a saved text of up to 4,000 characters, rich text on desktop.
  Matching ignores capitals. (W7, W14)
- Both sync across the user's devices and can be shared with a team. (W7)

**Per-app style**
- The target app is put in one of four groups (personal messaging, work messaging, email, other). Each
  group has a style that changes capitals and punctuation, for example dropping the final period in chat
  apps. English only. (W6)

**Voice editing ("command mode")**
- A second shortcut (Ctrl+Win+Alt on Windows): hold, say an instruction, release. The field's text and the
  selection are sent with the instruction. It can rewrite the selection, draft text, or open a web search.
  Two quick presses lock it hands-free. (W3)
- With no text and no selection an edit command does nothing. With no editable field in focus the result
  is shown in a notification. Off by default (experimental) and limited to paid plans. (W3)

**Languages, cloud, whisper**
- More than 100 languages; automatic detection on desktop, or a chosen set (fewer languages gives better
  accuracy). A language picker sits on the bar. (W8, W13, W14)
- Transcription happens in the cloud; there is no offline mode. Long dictations are processed in parts.
  A short connection loss is retried, and failed audio can be retried later. (W8, W9)
- Whispered speech: the site promotes dictating very quietly close to the microphone (W15, marketing
  page). The release notes read today describe the speech model as tested on whispered audio, not a
  separate mode switch (W14). Whether a "whisper mode" setting exists today is unverified.

**Why it feels simple (our reading, inferred)**
1. The app is always visibly ready (the bar), and a sound says when to speak.
2. One gesture has three natural outcomes: hold, double tap to lock, Escape to drop.
3. Text is never lost: failure notice with Copy, a paste-last shortcut, a history, Undo after an accidental cancel.
4. The user's clipboard is treated as theirs: restored, kept out of history tools.
5. Mistakes are fixed by speaking (self-correction, spoken punctuation), not by going back to the keyboard.
6. It explains itself when the system blocks it (administrator windows, no text box).

## Similar open projects

| Name | Licence (how verified) | Platform | Text injection method | Note |
|---|---|---|---|---|
| Handy | MIT (LICENSE file) | Windows, macOS, Linux | Clipboard + Ctrl+V; Shift+Insert; Ctrl+Shift+V; direct typing; external tools on Linux | Tauri/Rust. The reference for Filow. |
| OpenWhispr | MIT, "Copyright (c) 2024 OpenWhispr Team" (LICENSE file) | Windows, macOS, Linux | Clipboard + paste key sent by small native helpers; picks Ctrl+V, Ctrl+Shift+V or Shift+Insert by target window on Linux; on Windows the helper can refocus the window that was active when recording started | Electron, whisper.cpp and sherpa-onnx: closest stack to Filow. Local and cloud models. |
| Whispering (Epicenter) | AGPL-3.0-or-later (repo README) | Browser and Tauri desktop | The app README read today says copy buttons are the only way text leaves the app | AGPL: do not copy code if Filow may go closed. Earlier versions were reported to paste at the cursor (unverified). |
| VoiceInk | GPL-3.0 (README and sidebar) | macOS 15+ only | Not stated in README (unverified) | Swift. Paid builds of GPL code: a working example of selling GPL software. |
| nerd-dictation | GPL-3.0 (sidebar) | Linux | Simulated typing with xdotool, ydotool, dotool or wtype; or stdout | Python script, VOSK engine. |
| whisper-writer | GPL-3.0 (README and sidebar) | Windows, Linux, macOS | Simulated key presses with pynput | Python, faster-whisper. Four recording modes incl. voice activity. |
| Buzz | MIT (README and sidebar) | Windows, macOS, Linux | None: transcribes files and live audio in its own window | Not a dictation tool. |
| Vibe | MIT (README and sidebar) | Windows, macOS, Linux | None: file and batch transcription | Not a dictation tool. |
| superwhisper | Proprietary (not checked in detail) | macOS, Windows, iOS | Not researched | Commercial competitor, listed for context only. |
| Talon | Proprietary, closed (not checked in detail) | Windows, macOS, Linux | Not researched | Voice control tool, skipped. |

## Feature table

"Filow today" comes from `docs/okfilow/DICTATION.md`. "-" means not present or not documented.

| Feature | Handy | Wispr Flow | Filow today | Gap for Filow |
|---|---|---|---|---|
| Start/stop | Hold, or tap to lock; hold-only and toggle-only modes; Escape cancels; CLI and signal | Hold; Escape cancels; click on the bar; start under 0.5 s counts as cancel, with Undo | Hold Ctrl+Win (arms after 250 ms) or press once / press again | No click-to-start. No Undo after an accidental cancel. First 250 ms not recorded. |
| Hands-free | Short tap locks until next press | Own shortcut or double press; stop button on the bar; 20 min limit with warning; whole text inserted at the end | Double tap; phrases typed at each pause; Escape drops only the last phrase; 5 min limit | No warning before the limit. No stop button. Phrase-by-phrase typing is a Filow strength. |
| Indicator | Overlay pill at top or bottom with level bars; live text with streaming models; tray icon states; optional sounds | Always-visible bar, waveform, stop and cancel buttons, language and microphone pickers, movable; start sound | "Dictating" pill at the top, bubble with level at the pointer, tones on by default, screen reader status | Indicator has no buttons and no idle "ready" state. No live text preview. |
| Where text lands | Focused field at paste time | Focused field at the end of dictation | Focused field; Filow's own fields get direct insert without the clipboard | None. |
| Focus change during dictation | Not handled; goes to the new focus (inferred) | Not documented; recovery by "paste last transcript" (inferred) | Not handled; goes to the new focus (inferred from the doc) | No way to get the text back if it went to the wrong place. OpenWhispr refocuses the original window on Windows. |
| Fallback when typing is blocked | Linux tool chain; "leave on clipboard" option; reliable paste falls back to standard paste | Notice with the transcript and a Copy button; paste-last and copy-last shortcuts; history; text may stay on clipboard | Copies and says "Copied. Press Ctrl + V"; a table of cases incl. Wayland and macOS permission | No paste-last shortcut, no history. No detection of a missing text box in other apps. No notice for administrator windows on Windows. |
| Password fields | macOS: refuses to record while Secure Input is active. Windows: nothing | Android: hidden in password fields. Desktop: not documented | Not described | Decide and document. The clipboard history markers already limit exposure. |
| Corrections | Triple repeats collapsed; optional language model post-processing | Spoken self-correction removes the abandoned phrase; cleanup levels; revert to raw | - | No self-correction handling. |
| Personal dictionary | Custom words, fuzzy match | Manual, imported and auto-learned words; correction pairs; sync | - | Missing. Handy's matcher is ASCII only, so ru and ja need another approach. |
| Snippets | - | Spoken trigger expands to saved text | - | Missing. |
| Filler/punctuation cleanup | Fillers (en, de, fr gated lists plus universal sounds); punctuation from the model | Fillers, grammar, lists, paragraphs; spoken punctuation and "new line" | Filler sounds in five languages with capital handover; punctuation from the model (inferred) | No spoken "new line" / punctuation words. No list or paragraph formatting. |
| Voice editing commands | - (post-process shortcut applies a fixed prompt) | Command mode on the selection or the field | - (OK Filow questions are a separate feature) | Missing as a dictation feature. |
| Per-app style | - | Four app groups, style per group, English only | - | Missing. Low priority for five languages. |
| Languages | Depends on model; Whisper covers about 100; language detection option | 100+, auto-detect, picker on the bar | en, it, ru, ro, ja; "Automatic" with one streaming model | Fewer languages by design. No quick language switch on the indicator. |
| Local vs cloud | Local; optional cloud post-processing | Cloud only; needs internet | Local only; no cloud path | None. This is Filow's main advantage. |
| Latency notes | Text after release; live preview with streaming models; model stays loaded 5 min by default | Text after stop; network wait; long takes in parts; languages can add about a second | Log shows a few ms from release to text with a streaming model; audio buffered while the model loads | None measured against the others. Worth one timed comparison on a low-spec PC. |

## Licence table

"OK in closed-source Filow" assumes the component is shipped or its code is ported. Reading for ideas needs no licence.

| Component | Licence | Verified how | OK in GPL Filow? | OK in closed-source Filow? | Obligations |
|---|---|---|---|---|---|
| Handy (code) | MIT, "Copyright (c) 2025 CJ Pais" | LICENSE file, https://raw.githubusercontent.com/cjpais/Handy/main/LICENSE | Yes | Yes | Keep copyright and permission notice with copied or ported code. No use of name, logo, icon. |
| handy-keys | MIT, "Copyright (c) 2026 handy-computer" | LICENSE file | Yes | Yes | Notice |
| handy-recorder | MIT | Repo page (licence text not opened) | Yes | Yes | Notice |
| transcribe.cpp / transcribe-cpp | MIT, "Copyright (c) 2026 The transcribe.cpp authors" | LICENSE file | Yes | Yes | Notice. Bundled ggml and other parts: unverified. |
| transcribe-rs (older Handy engine) | MIT, "Copyright (c) 2025 Ilya Stupakov" | LICENSE file | Yes | Yes | Notice. Not used by Handy 0.10.0. |
| whisper-rs (older Handy engine) | Unlicense (public domain) | GitHub repo page; repo archived, moved to Codeberg | Yes | Yes | None. Not used by Handy 0.10.0. |
| enigo | MIT, "Copyright (c) 2017 pythoneer", "Copyright (c) 2023-2025 Robin Grell" | LICENSE file | Yes | Yes | Notice |
| rdev (rustdesk-org fork) | MIT, "Copyright (c) 2020 Nicolas Patry" | LICENSE file | Yes | Yes | Notice |
| earshot (VAD) | MIT OR Apache-2.0 | crates.io API, version 1.2.2 | Yes | Yes | Notice |
| Silero VAD (model and code) | MIT, "Copyright (c) 2020-present Silero Team" | LICENSE file of snakers4/silero-vad | Yes | Yes | Notice. Handy's GGUF conversion of the model: terms unverified. |
| Parakeet TDT 0.6B v3 (model) | CC-BY-4.0 | Hugging Face model card | Yes (shipped as a separate data file) | Yes | Credit NVIDIA, name the licence, link to it, say if changed. |
| Whisper (models and code) | MIT, "Copyright (c) 2022 OpenAI" | LICENSE file of openai/whisper | Yes | Yes | Notice |
| Nemotron streaming (model) | Unverified | Not checked | Unverified | Unverified | Check the model card before shipping in a paid product. |
| ReazonSpeech (model) | Unverified (believed Apache-2.0) | Not checked | Unverified | Unverified | Check the model card. |
| sherpa-onnx (Filow's engine) | Apache-2.0 | LICENSE file | Yes (Apache-2.0 is compatible with GPL-3.0) | Yes | Notice, keep NOTICE file content if any, state changes. |
| uiohook-napi (Filow's hook) | MIT, "Copyright (c) 2020 Alexander Drozdov" | LICENSE file | Yes | Yes | Notice. The bundled libuiohook C library: licence unverified, check before a closed release. |
| OpenWhispr | MIT, "Copyright (c) 2024 OpenWhispr Team" | LICENSE file | Yes | Yes | Notice |
| Whispering (Epicenter) | AGPL-3.0-or-later | Repo README | Only if Filow moves to AGPL-compatible terms; avoid | No | Do not copy code. |
| VoiceInk, whisper-writer, nerd-dictation | GPL-3.0 | Repo pages | Yes (GPL-3.0 code in a GPL-3.0-or-later work) | No | Copying any code keeps Filow under the GPL. |
| Buzz, Vibe | MIT | Repo pages | Yes | Yes | Notice |
| Wispr Flow, superwhisper, Talon | Proprietary | Vendor sites | No code, assets or wording may be used | No code, assets or wording may be used | Behaviour may be studied and re-implemented independently. Do not use their names in a way that suggests a link. |

## What I could not verify

- Handy: the number of models in `catalog.json`; `paste_tx/windows.rs` and `paste_tx/macos.rs` (snapshot
  and history opt-out formats); `secure_input.rs`; whether update checks are on by default; the origin and
  licence of the sound files and images in `src-tauri/resources`; the licence of Handy's GGUF copies of
  models; where the Escape shortcut is registered and for how long.
- handy-recorder: the licence text itself (the repo page says MIT).
- Licences of the Nemotron streaming and ReazonSpeech models, and of libuiohook inside uiohook-napi.
- Wispr Flow: what happens on desktop when focus changes during a dictation; behaviour in desktop
  password fields; the look of the bar while processing; whether desktop start and stop sounds can be
  switched off; whether a separate "whisper mode" setting exists today; the exact count of languages
  (pages say "more than 100" and "99"); real latency. Pages W12, W13 and W15 were read only as search
  summaries. The getting-started page and the docs overview returned "not found".
- Wispr Flow's paste mechanism on Windows beyond "clipboard and paste": the key it sends is inferred.
- Similar projects: VoiceInk's insertion method; Whispering's earlier paste-at-cursor behaviour;
  superwhisper and Talon terms. Licences of OpenWhispr's native helper binaries.
- No app was installed or run. All behaviour claims come from source code or public pages, not from tests.
