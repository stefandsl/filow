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

### 2. Delivery of the 462 MiB model: downloaded by the setup, on by default (recommended)

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

## Measurements: NOT DONE

Nothing was measured: neither the model file nor the server program is on this PC. Downloading them was
asked for by the coordinating agent, but a download and the running of a downloaded program need the
owner's own go-ahead, which this session did not have. Ready to run as soon as both are there:

- `tools/dictation/s1-samples.json`: 40 English samples with exact expected text (fillers,
  self-corrections, numbers, dates, times, e-mail addresses, code-like words, names, sentences that must
  not change, a filler-only one), 10 Italian and two each in Russian, Romanian and Japanese.
- `tools/dictation/s1-measure.mjs <server url>`: sends the English ones through Filow's own request
  builder and safety net and prints exact / acceptable / changed / refused with times (median, 90th
  percentile, worst); fails if any sample in another language was sent.

What the tests already show without the model: no Italian, Russian, Romanian or Japanese sample is sent
under any language setting; all 40 expected English outputs pass the safety net; the model card's own six
examples pass it.

Still to measure: time added from release to text on CPU only and with the GPU, memory, cold start of
the runtime, the quality table, and whether 700 ms holds on the Standard and Lite tiers (if not, the
feature must be off by default there).

## Not built yet

- The runtime binaries in the package (download at build time by pinned tag and hash, `asarUnpack`, the
  after-pack check, signing on macOS). Until then `ready()` answers "runtime not in this build", the step
  is skipped and dictation behaves as before.
- The model download in the setup, the installer's components page, the welcome and the SetupPicker.
- The entry in THIRD_PARTY_NOTICES.md (that file is generated) and a line in About.
- Warm start (the first English dictation pays the model load; `warm()` exists and is not called yet).
- The packaged end-to-end check with an English recording.
