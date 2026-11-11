# Filow's dictation helper for Windows

`prebuilds/win32-x64/filow-target.node` is a small program of our own (source: `src/target.cc`, about 180
lines, N-API, no dependencies). `apps/desktop/dictation-target.js` loads it on Windows x64; on macOS,
Linux and Windows on ARM there is none and dictation works as before through the keyboard hook.

## What it does

- `info()`: facts about the window that has the keyboard at this moment: the program's file name, the
  window class, the class of the focused control, whether the program runs as administrator, whether the
  focused control is a password box (the classic `ES_PASSWORD` style, or UI Automation's `IsPassword` for
  browsers, Electron apps and modern Windows apps), whether this is a remote desktop session.
  It never reads a window title, the text of a control or anything typed.
- `sendPaste()`: presses Ctrl + V with `SendInput` and returns how many of the four key events Windows
  accepted. Windows drops keys sent to an administrator window by a program that is not one, and to a
  session with no input (a remote desktop left minimized); the stock path could not tell.
- `typeText(text)`: types the text as Unicode characters with `SendInput` (terminals, where Ctrl + V is not
  always paste). Enter and Tab are never sent.

## Why (issue #7)

Dictation logged "pasted 36 chars" without knowing where the keys went or whether Windows took them, and
it would have pasted into a password box. The decisions made from these facts are in
`dictation-target.js` (`chooseMethod`) and are tested in `dictation-target.test.ts`.

## Rebuild

On Windows with the Visual Studio C++ build tools and Python:

    node apps/desktop/native/target/build.mjs --arch x64

Commit the new binary together with the source: `dictation-target.test.ts` compares the hash of
`src/target.cc` with `prebuilds/win32-x64/BUILT-FROM.txt` and fails when they differ.
