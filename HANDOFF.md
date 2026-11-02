# Filow hand-off

Last updated 2026-11-02 by the Claude Code session that built versions 0.2 to 0.8.6. Written so that
another agent (Codex, Claude, a human) can continue without the chat history. Update this file at the
end of every working session: "Where it stands", "Pending" and "Known gaps" are the parts that rot.

## What Filow is

A live speaking companion, not a scrolling teleprompter: it listens while you present, ticks off your
talking points as you cover them and shows what you skipped. Tagline "Speak freely. Stay on point." /
"Parla liberamente. Resta sul punto." Proprietary, © VoidExploit (Stefan Butnaru). Surfaces: Windows /
macOS / Linux desktop app (Electron), phone mirror (QR pairing, Cloudflare quick tunnel for any
network), PowerPoint add-in, browser extension, Screen Sense (slide-aware cues from the screen),
slide-to-script generator, on-device Whisper, local decisions through Ollama (Clef), cloud through
OpenRouter with a PII guard (Rizzo-PII) in front.

## Where it stands (v0.9.0)

- Repos: source `stefandsl/filow` (private, branch `main`), update feed `stefandsl/filow-releases`
  (public releases only). Local checkout: `C:\Users\stefan.butnaru\Desktop\Intelliprompter`
  (folder still has the old name on purpose).
- v0.8.7 was tagged on 2026-11-02 (CI run 41458509342); 0.8.6 is in the public feed. The public
  v0.8.5 release was deleted (no Windows assets: its installer script failed on CI, which made
  installed apps show "Cannot find latest.yml ... 404"). Never publish a release to the feed
  without `latest.yml`, `latest-mac.yml` and `latest-linux.yml`.
- Recent work, newest first:
  - Step 2 (0.9.0): streaming STT in the desktop app. `apps/desktop/stt.js` downloads the Nemotron
    3.5 streaming int8 archive (475 MB, GitHub k2-fsa/sherpa-onnx "asr-models") into
    userData/models and runs it with `sherpa-onnx-node` in a worker thread (`stt-worker.js`,
    unpacked from asar). `packages/stt/src/sherpa.ts` is the page-side backend ("sherpa"): mic PCM
    over IPC, partials + committed sentences back. Local mode prefers it when the model is present.
    New "Spoken language" setting (auto/en/it/ro/ru). Measured 105 ms per 560 ms chunk on this
    laptop's CPU. Target languages are now en, it, ro, ru (brief updated). Not yet: installer page
    checkbox for the model (first-start auto list handles "nemotron-streaming"), Intel-Mac addon in the
    x64 dmg built on an arm64 runner (falls back to Whisper), a real-speech English check.
  - Step 1 + confirm rule (0.8.17/0.8.18): see BASELINE.md.
  - Gauntlet Step 0 and Step 1 done (0.8.17): replay harness (`packages/core/src/gauntlet.ts`, runner
    `apps/web/lib/gauntlet/run.test.ts`, seed corpus `docs/gauntlet/corpus/demo-it`, first baseline in
    `docs/gauntlet/BASELINE.md`: OpenRouter p50 1.5 s/call, precision 1.0, recall 0.78, median delay
    7 s = the two-call confirm rule). Engine: aborts slow calls and reports "slow model" instead of an
    error, paces to the model's speed, max 4 questions per call; Clef warm-up with keep_alive -1;
    Whisper language hint and whisper-tiny. Also fixed: OpenRouter 400 (models list capped at 3).
  - Phone on the Wi-Fi: fixed and confirmed by the owner (0.8.14, Windows only): the QR used a VirtualBox adapter;
    interfaces are now ranked (default route first, virtual ones last), Windows Firewall rule offered
    at first start and from the pairing dialog, adapter picker there too.
  - Local-mode latency: gauntlet brief v2 (`docs/local-latency-gauntlet.md`, after an EGM review) and
    the lap-1 council report (`docs/gauntlet/REPORT-lap1.md`). Finding: the 4 s Whisper windows and the
    two-call confirm rule dominate latency (9–12 s mouth-to-tick), not the model. Recommended stack
    for low-spec: Nemotron 3.5 streaming STT via sherpa-onnx + MiniLM embedding gate + NLI verifier;
    nothing implemented yet. Next: Step 0 (test corpus + benchmark harness) and Step 1 (hygiene:
    keep_alive, non-blocking decision calls, question cap, catalogue sizes).
  - Settings: explicit memory per model (download, VRAM, RAM, measured when loaded); Clef Flash is
    11 GB. Dashboard also on the prompter page. Cancel button on pulls. Liquid model is lfm3-vl.
  - Settings dashboard (`/api/local/resources`, `apps/web/lib/sysinfo.ts`): live CPU, RAM, GPU
    memory/load (nvidia-smi, Windows GPU counters, Apple unified), which Ollama models are loaded and
    whether they sit on the GPU or in RAM (`/api/ps` size_vram), best-option advice. Start mode
    "auto" picks local when the models are there and the GPU (6 GB VRAM) or RAM (16 GB) can hold them,
    else cloud; the start dialog shows the pick and why.
  - Screen Sense: REC chip + Stop button in the top bar, system notifications on start/stop.
  - Region picker rewritten in the style of classic screenshot tools (Greenshot is GPL-3.0, so no
    code was taken): the display is grabbed first, shown frozen and dimmed, full-screen crosshair,
    4x magnifier with pixel grid and coordinates, size label, Enter = whole screen, Esc / right
    click cancel. The crop comes from the same frozen frame (`apps/desktop/picker.html`,
    `pickRegion` / `captureRegion` in `main.js`).
  - Cancel button on a running pull; Liquid vision model renamed to `lfm3-vl`; Ollama pull errors
    shown as they are.
  - Installer page: intro gets three lines (it overlapped the list), detects an existing Ollama
    (`%LOCALAPPDATA%\Programs\Ollama`, Program Files) and already-pulled models
    (`~/.ollama/models/manifests/.../library/<model>/<tag>`): those lines say "already installed",
    are unticked, and the Ollama box is greyed out with a "nothing to download" label.
  - Installer custom pages in all 11 installer languages (auto-detected from Windows, no chooser),
    a reason on every model line (recommended / RAM / disk / GPU), cumulative disk rule.
  - Local AI chosen from the hardware: NSIS page scans RAM / GPU / free disk and preselects models,
    `apps/desktop/localai.js` scans + recommends + installs Ollama unattended (Windows silent
    `OllamaSetup.exe`, macOS `Ollama.app`), first-start dialog on macOS/Linux/portable, Settings page
    shows the phases and pulls the models (`?auto=...&ollama=1`).
  - Settings page gets an engine token itself (`ensureEngineToken`), so Pull / Delete / Test work in
    the desktop app (before: "engine token required (ACCESS_PASSWORD is set)").
  - OpenRouter fallback list + 429 retry in `apps/web/lib/openrouter.ts` (Google free-tier models get
    rate-limited upstream at busy hours).
  - Brand kit applied everywhere (`brand/`, `npm run icon`, `Wordmark` component, palette in
    `apps/web/app/globals.css`, splash, README header). Italian README (`README.it.md`).
  - Start take asks Cloud or Local with readiness checks (`StartModeDialog` in `Teleprompter.tsx`,
    pref `prefs:startMode`).
  - Visible update flow (electron-updater, chips/banner, system notification, menu "Check for
    updates", `startup.log` in the profile folder).
  - CI attaches installers straight to the release from each OS job (artifact storage quota hit
    twice before); artifacts only for manual runs.

## Field-tested so far: Windows only

Every real-machine test to date (Wi-Fi pairing, installer, Ollama install, PowerPoint add-in, updates)
was done on Windows. macOS and Linux builds exist and pass CI but nobody has run them end to end:
the first-start local-AI dialog, the Ollama.app unzip, the adapter ranking (`route -n get default`),
notifications and the region picker on those platforms are unverified.

## Pending (ask the owner before starting the big ones)

1. **Verify on real machines**: the installer page with the hardware scan (compiled and the values
   were checked with a standalone makensis build, the page itself was not opened); Ollama silent
   install on a PC without Ollama; the macOS first-start dialog and `Ollama.app` unzip; the
   presenter overlay and slideshow follow; the browser extension against a reveal.js deck.
2. **`RELEASES_TOKEN` secret** on `stefandsl/filow` (a PAT with `contents: write` on
   `filow-releases`) so CI publishes to the public feed by itself. Owner's task.
3. **Code signing**: SmartScreen warns on every install. Secrets `WIN_CSC_LINK` (base64 .pfx) and
   `WIN_CSC_KEY_PASSWORD` are wired in `.github/workflows/desktop.yml`; the certificate has to be
   bought. macOS builds are unsigned (README tells users the `xattr` command).
4. **Screen Sense on a local vision model** (`qwen3-vl` is listed as "planned" in
   `apps/web/lib/localModels.ts`): today frames go to the OpenRouter vision model only.
5. **Public link default**: tunnels are on by default in code (`settings.remoteShare`), the owner's
   own settings have it off. Decide the product default.
6. **Mascot icon**: a mascot variant was explored (`design/`, git-ignored); the brand kit icon won.
   Nothing to do unless the owner asks.
7. **Ollama on Linux** is manual (the official script needs sudo); fine for now.

## Known gaps and traps

- `npm run desktop:build:win` on the owner's PC fails in electron-builder's winCodeSign extraction
  (symbolic links need Developer Mode); CI is the way to build installers.
- `next dev` and `next build` must not run at the same time in `apps/web` (shared `.next`):
  "Cannot find module for page: /_document".
- Port 4747 is usually taken by the installed app; use 4799 for a dev server, and kill stale ones by
  PID (`netstat -ano | findstr :4799`).
- `APPDATA` override does not isolate Electron's `userData`; running the app from source shares the
  real profile (`%APPDATA%\@filow\desktop`). `install-choices.json` there triggers the first-start
  model downloads and is deleted after reading.
- Bash heredocs in the Claude Code shell mangled JS/NSIS quoting more than once; writing patch
  scripts to a file (Python) and running them was reliable.
- NSIS: define page functions inside `customPageAfterChangeDir`, finish-page functions inside
  `customFinishPage`, variables inside `!ifndef BUILD_UNINSTALLER`; `${Using:StrFunc}` is not
  accepted by the NSIS 3.0.4 that electron-builder uses (hence `FilowContains`). The System plugin
  silently returns nothing in an ANSI build, so a test harness needs `Unicode true`.
- Office caches add-in manifests; after changing `manifest.xml`, clear
  `%LOCALAPPDATA%\Microsoft\Office\16.0\Wef\` or bump the manifest version.
- Tests: `apps/web/lib/pii/*.test.ts` pin `PII_SERVER_URL` to an unused port because Rizzo-PII really
  runs on the owner's PC.

## How to syntax-check the installer page locally

```
Unicode true
!include MUI2.nsh
!macro StdUtils.ExecShellAsUser a b c d
!macroend
!define StdUtils.ExecShellAsUser "!insertmacro StdUtils.ExecShellAsUser"
!define SHORTCUT_NAME "Filow"
!define APP_EXECUTABLE_FILENAME "Filow.exe"
Var launchLink
OutFile "C:\Temp\nsis-check.exe"
!include "<repo>\apps\desktop\build\installer.nsh"
Function .onInit
  !insertmacro customInit
FunctionEnd
!insertmacro customWelcomePage
!insertmacro customPageAfterChangeDir
!insertmacro MUI_PAGE_INSTFILES
!insertmacro customFinishPage
!insertmacro MUI_LANGUAGE "English"
Section
  !insertmacro customInstall
SectionEnd
```

```bash
N=%LOCALAPPDATA%/electron-builder/Cache/nsis/nsis-3.0.4.1
"$N/Bin/makensis.exe" //NOCD "//X!addincludedir $N\Include" "//X!addplugindir $N\Plugins\x86-unicode" C:/Temp/nsis-check.nsi
```

## Continuing with Codex (OpenAI subscription) instead of Claude

1. Install the CLI: `npm i -g @openai/codex`, then `codex login` (uses the ChatGPT subscription; no
   API credits needed).
2. In the repo folder run `codex` and start with:
   "Read AGENTS.md and HANDOFF.md, then tell me where the project stands and what is pending."
   Codex reads `AGENTS.md` automatically; `HANDOFF.md` is the state.
3. Keep the same loop: change, `npm run typecheck && npm test`, look at the page, commit with a
   descriptive message, tag + push when the owner says "tag vX.Y.Z", copy the release to
   `filow-releases` (see `AGENTS.md`), check `latest.yml`.
4. The owner writes in Italian or English, short messages, often a screenshot of the problem; answer
   in the language they used, give the outcome first, keep the Italian UI strings natural.
5. Before ending a session, update "Where it stands" and "Pending" above and commit the file.

The same two files work for Claude Code (`CLAUDE.md` is not needed; it reads `AGENTS.md` too when
asked) and for any other agent.
