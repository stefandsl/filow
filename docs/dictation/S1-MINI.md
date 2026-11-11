# S1-mini by Superwhisper in Filow's dictation (2026-11-11)

Owner: "install the superwhisper as default in our architecture ... so it comes baked in filow to clean
the transcribing locally". This file says what is built, what is decided and why, and what is still open.

## What it is, and the limit to know first

S1-mini by Superwhisper is not a speech model. It is a small text model (596M parameters, a fine-tune of
Qwen3-0.6B) that takes the recognizer's raw words and writes them as text: fillers out, false starts and
self-corrections resolved, numbers, dates, times, money and e-mail addresses written properly,
punctuation and capitals applied.

**It knows English only (release v1).** Filow dictates in English, Italian, Russian, Romanian and
Japanese. So only English dictations go through it. Every other language keeps Filow's own cleanup
(filler sounds) and is never shown to the model, which could damage or translate the words. The decision
uses the language chosen for dictation, or, when that is "Same as the speech language", the language the
recognizer listened in; when that is not known, the model is not used. Text with Cyrillic, Chinese or
Japanese letters is never sent even when the language says English.

Licence: Apache 2.0 plus one naming clause: wherever it is used it must be called "S1-mini" by
"Superwhisper", with that capitalization. Filow writes "S1-mini by Superwhisper" in Settings (the same in
all five languages), in the report and here; the licence and notice texts ship in
`apps/desktop/licenses/s1-mini/`.

## Decisions

### 1. Runtime: llama.cpp's own server program, started by Filow (chosen)

| Option | Licence | Size per platform | Fit | Verdict |
|---|---|---|---|---|
| (a) node-llama-cpp inside Filow's main process | MIT | about 34 MB per platform plus 41 MB core | ESM only (Filow's main process is CommonJS), cannot be cross-packaged, no CPU-only build for Apple silicon, a crash or a slow load happens inside Filow | not chosen |
| (b) `llama-server` from the official llama.cpp releases, as a child process | MIT | archive 25 MB Windows x64, 17 MB macOS arm64, 13 MB macOS x64, 23 MB Linux x64 | no tie to Electron's version, a crash cannot take Filow down, the same program on three systems, no AVX2 needed on Windows | **chosen** |
| (c) Ollama when it is already running | MIT | none | its Qwen3 template turns thinking on, which gives blank output unless a template is written for it | not built; could be added later, never required |

Facts read on 2026-11-11 from the npm registry, the llama.cpp release list and the server's README (a
research agent read them; no file was downloaded).

How Filow runs it (`apps/desktop/s1-runtime.js`): started at the first English dictation, on 127.0.0.1
only, on a port the system picks, with a key made for that run that every request must carry; flags as
the model card asks (`--jinja --chat-template-kwargs {"enable_thinking":false} --temp 0`); stopped when
Filow quits. The request is the model card's, word for word: its system prompt, the control line
`[Styling: ...] [Structure: ...] [Context: general]`, thinking off, temperature 0, the answer sized to
the input (`dictation-cleanup.js`).

To do before this can ship: the macOS binaries are not signed by their makers, so Filow's build must sign
them; the release to take must be pinned by tag and hash (the "latest" release has no binaries).

### 2. Delivery of the 462 MiB model: downloaded by the setup, on by default (built, see "The model in the setup")

The file is `s1-mini-q4_k_m.gguf`, 484,219,808 bytes, SHA-256
`3b41ebe2502cbd03e811d5d16b022f5ab551eda58d62597d152f89535003c634` (superwhisper/s1-mini-GGUF, revision
`34add00a`), pinned in `s1-runtime.js`. Recommendation: the small runtime goes inside the installer; the
model is fetched by the setup exactly like the speech models (pinned hash, resumable, real size shown on
the installer's components page, the welcome and the SetupPicker), ticked by default, so a fresh install
ends with it present. Inside the installer it would add 462 MiB to every download and to every copy made
by hand to the second update repository, for a feature only English dictation uses.

### 3. Where it runs

After recognition and before typing, for hold-to-talk and for every hands-free phrase, also in Filow's
own text fields. Never for the prompter's point tracking or the rehearsal report (they need the raw
words; they do not use this code path). Not for OK Filow's spoken questions: a question goes to a
language model that copes with raw speech, and a cleaner that resolves "self-corrections" could change
what was asked. Password boxes are refused before the model is asked. E-mail layout (`Context: email`) is
not used: Filow can tell a mail program, but not its message body from its subject or address line.

### 4. Safety net (`dictation-cleanup.js` acceptCleaned, tests in `dictation-cleanup.test.ts`)

The model's answer replaces the raw words only if it is the same message, cleaned:

| Check | Refused when |
|---|---|
| empty | nothing came back although something was said |
| echo | the control line, the system prompt or template marks came back |
| too long | more than 1.25 times the input plus 16 characters |
| too short | under a fifth of the input (self-corrections and numbers shrink a text, not that far) |
| new words | more than 2 words, and more than a fifth of the output's words, were not said (numbers, e-mail addresses and register words such as "going to" for "gonna" excepted) |
| layout | line breaks although lists are off |

Time budget: 700 ms per dictation. Later than that, the request is aborted. In every refused or late
case the words go in with Filow's own cleanup, and the log and the report say `cleanup skipped (reason)`.
A runtime that is missing, fails to start or errors never stops a dictation.

### 5. Settings (five languages)

"Clean up what I say (English): S1-mini by Superwhisper, on this PC", on by default; a sentence that
says English only and that other languages never go through it; a notice when the model is not on the
computer yet; the style (casual, relaxed, standard written English, formal: the model's four registers);
"Turn three or more spoken items into a list".

### 6. Report a problem

The "Dictation and keys" section has a line for the cleanup (on or off, style, model on this computer
or not, runtime in this build or not, running, last error) and a stage per dictation: `cleanup used
(212 ms)` or `cleanup skipped (language it)`. Never the words.

### 8. Two dictations in a row were glued ("...alle 9.La riunione...")

Seen in Notepad with real keys. Rule: Filow cannot read another program's caret, but it knows where its
own last words went. When the next dictation goes into the same window and the user has neither pressed
a key nor clicked since (the keyboard hook sees both), the new words get a leading space where the
language writes one. After a key or a click, in another window, or in Japanese, nothing is added. Needs
the Windows helper to know the window; on macOS and Linux the behaviour is unchanged. Tests in
`dictation-target.test.ts`.

## Measurements (2026-11-11, this PC)

PC: Core i9-13900KF, 128 GB RAM, Windows 11, busy with other work (56 to 76 % CPU load during the runs).
Runtime: llama.cpp release b12284, the Windows CPU build (no GPU code in it), 4 threads, the Q4_K_M file.
Both downloads were approved by the owner; their hashes match the pinned ones.

| What | Value |
|---|---|
| Cold start of the runtime (program start to "ready", model loaded) | 1.16 s |
| Time added to a dictation, warm, 40 samples | median 162 ms, 90th percentile 223 ms, worst 474 ms (a 30-word sentence) |
| First request after the start | 310 ms |
| Memory of the runtime with the model loaded | 883 MB working set, 573 MB private |
| GPU | not measured: the bundled build is CPU only |
| Standard and Lite tiers (older hardware) | not measured: only this PC was available; 700 ms leaves a factor of about 3 over the 90th percentile here |

Quality on Filow's own 40 English samples (`tools/dictation/s1-samples.json`, semi-formal, prose):

| Verdict | Count | What |
|---|---|---|
| Exact | 31 | the text expected, character for character |
| Acceptable | 8 | same message, another valid form: "six" for "6", "the 12th of November" for "November 12", "quarter past five" kept in words, a leading "So" kept, "get_user_by_id" for "get user by id", one missing full stop |
| Harmful, caught | 1 | "it costs nineteen dollars and ninety nine cents" came back as "It costs $1.99." The figures check added after this run refuses it and the raw words are typed |
| Harmful, typed | 0 | |

By class: fillers 4 exact and 1 acceptable of 5; self-corrections 4 and 1; numbers 4 of 5 and the harmful
one; dates and times 3 exact and 2 acceptable; e-mail addresses 3 of 3; code-like words 3 exact and 1
acceptable (underscores added to a function name: a judgement call, kept); names 4 of 4; sentences that
must not change 3 exact and 1 acceptable; the question and the "ignore your instructions" sentence came
back as themselves; filler-only input came back empty. No Italian, Russian, Romanian or Japanese sample
was sent (the script fails if one is).

What the measurement changed in the code: the safety net now checks figures. Every run of digits in the
answer must be the value of a stretch of the number words that were said (or two stretches side by side,
as in years and times, or digits said one by one). The expectations were not changed.

## Memory and when the model is loaded

The runtime with the model holds about 0.9 GB. It is not loaded at start. It is loaded when the dictation
keys go down, and only when the dictation language is English (chosen, or the speech language when
dictation follows it): the person speaks for a second or more while the model loads (0.7 to 1.2 s here).
It stays loaded while dictation is in use and is stopped after ten minutes without a dictation
(`IDLE_UNLOAD_MS` in `s1-runtime.js`, tested with a fake clock); the next English dictation starts it
again. A dictation that ends before the model is ready is typed raw (`cleanup skipped (slower than 700 ms)`)
and the model is ready for the next one. Someone who dictates in another language never loads it.

A smaller PC, imitated: the same runs with 2 threads on this PC (an imitation: the cores here are much
faster than a Lite PC's) gave cold starts of 0.7 to 0.95 s, median 261 ms, 90th percentile 364 ms, worst
810 ms, the same 31 exact / 8 acceptable / 1 refused. No real Lite hardware was measured. So the cleanup
is on by default on every tier, with a guard instead of a guess: when three answers in a row are later
than the budget, the cleanup rests until Filow is started again (`resting: too slow on this computer` in
the report) and dictations stop waiting for it.

## Dates and times

Added after the figures check: a month, a weekday or "am"/"pm" in the answer must be one the speaker said
(a short form such as "sept" counts for its month; "morning", "afternoon", "evening" count for the half
of the day). With the figures check this pins day, month, year, hour and minute. Samples in
`dictation-cleanup.test.ts` ("dates and times").

## Packaged check (2026-11-11)

Installer built once with the runtime inside: 175.7 MB (0.9.32 was 161.7 MB). In the packaged QA build, with an English recording (Windows speech voice) as the microphone, the Parakeet recognizer and the model placed in the profile: the runtime started ahead of the first dictation in 0.9 s; each dictation logged `cleanup used (S1-mini, 145 to 336 ms)`; release to text was 299 to 633 ms. "...send the report by Friday, no wait, make that Thursday" was typed as "...send the report by Thursday." and "one thousand two hundred and fifty euros" as "€1,250", in hold and in hands-free. The recognizer misheard parts of the synthetic voice ("I need" as "you need", the e-mail address only half), which the cleanup cannot repair. The session had no foreground window, so the words were read from the clipboard path, not from Notepad; the in-app model download button was not run end to end (the file was copied into the profile).

### The in-app download, run in the packaged build

Started from the page (the same call the Settings button makes), with the model absent. The app was killed at 14 % (66.9 MB on disk); after a restart the download went on from 14 %, not from zero, and the part on disk was checked to be byte for byte the start of the real file. To spare the wait (the download ran at about 0.3 MB/s through Filow's downloader that evening, against about 2 MB/s with curl: not looked into), the part was then filled from the copy already on this PC up to 3 MB before the end; Filow fetched the last 3 MB, checked the SHA-256, gave the file its name and logged `model on this computer, hash checked`. A file with another hash is deleted and never loaded (unit test). Log: G:\FILOW\tmp\dict-logs\startup-s1-b-download.log.

## Platforms

- **Windows x64: built and run.** `npm run vendor` fetches the pinned archive
  (`llama-b12284-bin-win-cpu-x64.zip`, SHA-256 `6b3d2c70...defa9`), keeps the 23 files the server needs
  (45 MB unpacked) in `native/llama/win32-x64`, outside app.asar; `after-pack.js` fails the build when
  `llama-server.exe` is missing.
- **macOS (arm64, x64) and Linux x64: pinned, not shipped.** The archives and their hashes are in
  `native/llama/fetch.mjs` (`llama-b12284-bin-macos-arm64.tar.gz`, `-macos-x64.tar.gz`,
  `-ubuntu-x64.tar.gz`) but are fetched only when asked for by name, because nobody ran them: on those
  systems Filow says "this build has no runtime for S1-mini by Superwhisper" and dictation keeps the
  simple cleanup. What they need: a run on each system with the model; on macOS the server and its
  libraries must be signed with Filow's identity and notarized with the app (upstream ships them
  unsigned), with the hardened runtime; on Linux the archive is built on Ubuntu and must be tried on the
  oldest distribution Filow supports; then an after-pack check per platform like the Windows one.

## The model in the setup (2026-11-11, owner's decision: "Setup downloads it", ticked by default)

The same line, "S1-mini by Superwhisper" with its size (462 MB: 484,219,808 bytes), ticked on every
tier, in three places:

| Where | What the user sees | Code |
|---|---|---|
| Windows installer, components page | a ticked box in the "Local AI" group, in the Recommended and Full types, in the installer's twelve languages; "already installed" and unticked when the file is in the profile | `apps/desktop/build/installer.nsh` (`SecS1Mini`); the choice travels as `"s1-mini"` in `install-choices.json` |
| First-run welcome, "this computer" step | a ticked checkbox under "What gets installed"; unticking takes its share out of the size shown | `welcome-setup.js` (`withCleanup`, `setupOffer`, `setupChoice`), `welcome.ts`, `welcome.html` |
| Settings, "Setup for this computer" | a ticked checkbox next to "Download now"; the percent while it downloads; no line once the file is here | `apps/web/app/settings/local/SetupPicker.tsx`, `CLEANUP_MODEL` in `packages/core/src/profile.ts` |

One download path. All three, and the button in Settings > Dictation, end in `wantCleanupModel()` in
`main.js`, which calls `wantModel()` in `s1-runtime.js`, which calls `fetchModel()` (resumable, pinned
SHA-256, the file gets its name only after the check). No page downloads the file by itself.

Without a network during setup the item stays pending: the wish is written to `settings.json`
(`cleanupModelWanted`) and tried again at every start until the file is on the computer; Settings >
Dictation shows its button the whole time. A build without the runtime (macOS, Linux today) never offers
the line and never keeps the wish.

On an update the installer's components page is skipped, so the installer does not hand `"s1-mini"` to
the app then: a model the user unticked does not come back with every update.

Tests: `apps/desktop/s1-setup.test.ts` (one path, pending when offline, the size and the exact name in
every place, twelve installer labels, five languages), `apps/web/components/setupPicker.test.tsx`.

Not verified by a real install: the installer writes `install-choices.json` into the profile of the
installed Filow and registers under the same application id, so it cannot be run on this PC without
touching the owner's installation. The installer was compiled (NSIS turns every warning into an error)
and its strings and sizes are checked by tests.

## Download speed (2026-11-11)

The earlier note (0.3 MB/s through Filow, about 2 MB/s with curl) was looked into. Filow's downloader and
curl were run at the same moment against the pinned link, five rounds, the downloader inside Electron's
main process: 0.21 to 1.31 MB/s for Filow, 0.26 to 0.97 MB/s for curl, neither consistently ahead, with
and without a resumed (Range) request. In plain Node the downloader matched curl (0.9 MB/s both).
Against a local server it moves 563 MB/s. So the speed seen that evening was the line and the CDN at
that moment, not the code.

One real fault was found on the way and fixed: progress was reported for every 16 KB chunk, and for
speech models each report wrote a log line to disk and told every window (30,000 times for a 500 MB
model; it halved the local ceiling to 255 MB/s). Progress is now reported when the whole percent
changes (`stt-download.js`, test in `stt-download.test.ts`). This applies to every model download.

## Not built yet

- The cleanup for other languages (the owner named two more models): see `CLEANUP-MULTILINGUAL.md` when
  it is written.