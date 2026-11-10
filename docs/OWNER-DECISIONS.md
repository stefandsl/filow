# Owner decisions (held items)

One place for everything only the owner can decide. Agents add an item here instead of guessing
and keep working on what is not blocked. An item leaves this file when the owner answers; the
answer and its date go to docs/autoloop/JOURNAL.md.

Format: what is asked, the options, what waits on it. Opened 2026-11-09.

## Product

| id | question | options | waits on it |
|---|---|---|---|
| D1 | What is "microsoft tondo integration"? | Microsoft To Do (tasks from a talk), Teams (present and track inside a meeting), or another Microsoft 365 app | track T5 has not started |
| D3 | Phone mirror on the local network: the web server listens on every network card | token on every route plus a Host check (keeps the feature); off by default with a switch; remove | SEC-09 |
| D4 | Does the local voice sound natural enough? | listen to the samples track T7 produces | T7 acceptance (only the owner's ears count) |
| D5 | Licences of voices and speech models, if a track flags one that is not free for commercial use | accept, replace, or pay | T7, T8 |
| D23 | PERF-01 asks for the splash in 500 ms (our own budget). On this PC Chromium alone takes about 780 ms to paint a 3.8 KB page, so it cannot pass, even after D2. Measured on the package (branch splash-first-feedback, 6 launches each, alternated): showing the splash window at creation puts it on screen at about 0.33 s instead of about 1.1 s, at the price of about 0.15 s on the logo and on the main window (main window 2.6-2.9 s, still under 3 s) and, in the dark theme, a small change of shade before the page paints (Windows fills an unpainted window with #202020, the page is #121212) | take it and score PERF-01 on the window shown; take it and keep scoring the painted splash; leave the splash as it is | PERF-01, a score of 100 |
| D24 | Pairing over the public link still asks the phone "connect to <host>?" once, because the QR names two different trycloudflare hosts (page and relay). Over the LAN it no longer asks | let the desktop vouch for its relay in the QR (signed pairing link); keep the one question | how pairing over the internet feels |
| D25 | Installing the phone app (Android) needs a fixed https address; over the LAN it is only a home-screen shortcut | named Cloudflare tunnel on your domain; a trusted certificate for the LAN; stay with the shortcut | an installable phone app (docs/PLATFORMS.md, Phones) |
| D26 | On an 8 GB graphics card, "Best quality" (Clef Flash kept loaded, 5.2 of 8 GB) makes local picture answers wait 60-300 s (track T2) | Best quality steps aside while OK Filow answers about the screen; picture answers go to the cloud, with consent; offer Best quality only from 12 GB | the default profile T2 ships |
| D27 | First-run ideas from track T3 | drop or defer the OpenRouter key box; ask about PowerPoint on first use instead of in the welcome; start the servers while the welcome is open; skip the Cloud/Local question on the first take; practice script in the user's language. Take all, some or none | the next welcome iteration |
| D28 | The cloud tracking prompt (packages/core/src/prompt.ts) still uses the old wording; it can only be measured with paid calls | allow one capped paid run (for example 1 USD); leave it unmeasured | cloud tracking accuracy |
| D31 | The public link (phone mirror over the internet, through Cloudflare) is on by default and starts at launch without asking, so the script and the live transcript pass through Cloudflare's servers. This is the one path out of the PC that has neither the outbound notice nor the "going outside" signal (track T6, docs/okfilow/OUTBOUND.md) | make it opt-in (off until the user turns it on, with the notice; the phone still pairs on the same network without it); keep it on by default but show the notice once and the signal while it runs; leave it as it is | the "data leaves this PC" promise; the setup card's wording (T3 review) |
| D34 | Point 3 of the live take ("Everyone is copying it, so it must be good") now ticks within one loop in 4 of 5 live takes; in one it ticked a loop late (100 s). Live, the recogniser writes "The other companies are making...", and the local model's "same party" answer for it sits at 0.49 to 0.54 against the 0.5 line. Six other wordings and a lower line were measured and rejected: false points reach 0.46 (docs/gauntlet/BASELINE.md, trk-p3) | accept it as the local model's limit for now; try a second check before a "same party" veto (needs the full adversarial re-run) | TST-02 passing on every take, not most |
| D35 | A yes to sending data out given in the Filow window is asked again, once, in the PowerPoint add-in and in the browser extension, because the pane cannot reach the desktop's settings (track T6b, docs/okfilow/OUTBOUND.md) | keep the one extra question; let the desktop hand its consent to the pane over the local pairing | how often a user is asked |
| D36 | OpenRouter requests are pinned to the maker's own servers only for Google, OpenAI and Anthropic models. Mistral, DeepSeek, Cohere and others are not pinned yet, because a pinned request for a model the maker does not serve itself fails | pin each maker after checking its models (one line in `MAKER_HOSTS` each); leave them unpinned, with the signal naming OpenRouter | which company receives a cloud question |
| D37 | Japanese questions: SenseVoice is the most accurate (4.7 % CER and 163 MB, against 8.2 % and 713 MB for ReazonSpeech, which ships now) but carries the FunASR model licence (custom terms, a non-disparagement clause) (track T8, docs/stt/LANGUAGES.md) | use SenseVoice; keep ReazonSpeech (Apache-2.0) | Japanese accuracy, D5 |
| D38 | Romanian follows a talk phrase by phrase (Parakeet, 16.9 % WER) instead of word by word (Nemotron, 29.9 %) (track T8) | keep accuracy first; switch to word by word (one line in `CANDIDATES`) | how live Romanian tracking feels |
| D39 | When the presenter presses Next, the last 6 seconds of speech count for the new section (people often start talking before they press) (feat-prompter, `ANCHOR_RECENT_MS`) | keep 6 s; shorter; none | how a Next press feels in a live take |
| D40 | PageUp/PageDown (what most presentation clickers send) now move to the previous/next section instead of scrolling the script (feat-prompter) | keep; make it a setting; scroll as before | clicker users |
| D41 | Pairing codes are single use. The floating windows now get a fresh code each, but phones that pair automatically on the local network can still meet a spent code (feat-prompter) | show a fresh code on screen for them too (a session server change); leave it | phone pairing after a reconnect |
| D42 | Dictation does not record the first ~250 ms after Ctrl+Win is pressed (feat-dictation) | open the microphone at the first key-down (the microphone light then flashes on every Ctrl+Win shortcut); keep as is | first word of a quick dictation |
| D43 | When a dictation cannot be pasted, the words stay on the clipboard and the user's older clipboard content is lost (feat-dictation) | keep (what was said matters more); put the old clipboard back and drop the words | failed pastes |
| D44 | Handy's speech engine, transcribe.cpp (MIT), in place of sherpa-onnx (study: tmp/research/HANDY-STUDY.md) | evaluate it in a track (accuracy, size, latency on old hardware); stay with sherpa-onnx | speech engine choice |

## Release

| id | question | options | waits on it |
|---|---|---|---|
| D6 | Code signing for Windows | Azure Trusted Signing, OV or EV certificate | SIGN-01..04, SmartScreen-free install |
| D7 | Apple developer and Google Play accounts, a Mac, real phones | buy or lend | macOS and iOS checks, store listings |
| D32 | The app ID is still `com.intelliprompter.app` (apps/desktop/package.json, main.js AUMID). Settings do not move with it (the config folder follows the package name), but the Windows installer GUID, taskbar and notification identity, and on macOS the bundle ID (permissions, keychain, updater) do. Full table: docs/RELEASE-CHECKLIST.md | keep it for good; change it now, before signing and stores (pin `nsis.guid` to the old GUID, change the AUMID in the same release, test an upgrade); change it later (also costs every signed Mac user a reinstall, impossible after a store listing) | signed releases, any store listing |
| D45 | Installed apps update from stefandsl/filow-releases, but CI copies a release there only with a `RELEASES_TOKEN` secret, which is not set: 0.9.30 and 0.9.31 were copied by hand | add a token that can write to filow-releases as the `RELEASES_TOKEN` secret on stefandsl/filow; keep copying by hand after each release | automatic updates reaching users without a manual step |
| D33 | Who is the data controller in the privacy policy, and where do users send a problem report privately | give the legal name, postal address, privacy e-mail, how many months a report is kept and the supervisory authority (docs/PRIVACY.md, PRIVACY.it.md `[[...]]`); give a support e-mail or a form URL (`SUPPORT` in apps/desktop/about.js; the report window then shows a "Write an e-mail" or form button); have a legal adviser confirm the children and classroom section | publishing the privacy policy (stores, AppSource, GDPR); a private way for users to reach support |

## How agents work on this machine

| id | question | options | waits on it |
|---|---|---|---|
| D9 | A git hook that refuses push, tag and release unless the owner allowed it | install (core.hooksPath in this repo only); keep the written rule only | the push rule is a promise, not a lock |
| D10 | A pre-commit hook (lint, typecheck) and a commit-msg hook (no em dash, no co-author line) | install via /setup-pre-commit; keep the gates manual | errors are caught at merge instead of at commit |
| D11 | Where slices and their acceptance criteria live | GitHub Issues; files in the repo (Backlog.md or Beads) | the Align step writes briefs by hand until then |
| D12 | docs/CODING_STANDARDS.md, docs/GLOSSARY.md and docs/adr/ | let the orchestrator draft them from the code for review; skip | the standards review axis uses the Quality bar until then |
| D13 | The nightly filow-autoloop task now works in its own worktree and branch (autoloop/<date>), never on main | keep; revert | changed by the TRK-2 session on 2026-11-09 |
| D14 | Remove about 60 old release-* folders, the merged P1 worktree and the research clones in tmp/research | remove all; keep the last two releases; keep everything | disk on G: and a clear folder |
| D29 | Track T4 built Linux inside the Ubuntu WSL distro, whose disk lives on C: (against the C: rule): /root/filow-t4 (2.3 GB), /root/filow-t4-release (850 MB) and an installed filow 0.9.30 deb | remove them; move the distro to G: (wsl --export / --import); leave them | space on C: |

## Tools and skills that change the machine or fetch code

Scan reports: tmp/research/scans/. Rule: install on SAFE/LOW only; MEDIUM and above is the owner's call.

| id | item | scan | why it is held |
|---|---|---|---|
| D15 | tasks-axi skill (Kun) | 7/100 LOW | runs `npx -y tasks-axi` unpinned: code is fetched from npm at run time. Fine if pinned to a version. |
| D16 | axi skill (Kun) | 33/100 MEDIUM, CAUTION | a design guide for agent-friendly command-line tools; it tells an agent to add hooks to ~/.claude/settings.json and to use unpinned `npx`. Useful only if we build such a tool. |
| D17 | vision skill (Kun) | 24/100 MEDIUM, CAUTION | writes a project vision by review board; its HTML template carries instructions for the agent in a comment and opens with unpinned `npx -y lavish-axi` (telemetry on unless LAVISH_AXI_TELEMETRY=0). |
| D18 | gnhf 0.1.43 to 0.1.52 | not a skill | global tool the night runs depend on; update when no run is active. |
| D19 | treehouse (worktree pool) | not scanned | its installer edits the user PATH. Would replace the hand-made worktree lifecycle. |
| D20 | Matt Pocock skills as a plugin instead of 30 copied folders | all copies byte-identical to upstream 4ae2317 | a plugin updates itself; copies stay frozen until copied again. |
| D21 | Two additions to the global agent rules (B11, B12 in docs/research/kunchenguid-2026-11-09.md) | - | global rules are the owner's file. |
| D22 | The claude-mem observer (a bun worker plus the claude.exe it starts) held about 124 GB of committed memory on 2026-11-10, with 5 GB of RAM free and a 180 GB pagefile on C: | restart it; cap it; leave it | not started by this project, so no agent stops it. If memory runs out, the parallel tracks crash. |
