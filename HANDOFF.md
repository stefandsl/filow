# Filow hand-off

Last updated 2026-11-02 by the Claude Code session that built versions 0.2 to 0.8.6. Written so that
another agent (Codex, Claude, a human) can continue without the chat history. Update this file at the
end of every working session: "Where it stands", "Pending" and "Known gaps" are the parts that rot.

## What Filow is

A live speaking companion, not a scrolling teleprompter: it listens while you present, ticks off your
talking points as you cover them and shows what you skipped. Tagline "Speak freely. Stay on point." /
"Parla liberamente. Resta sul punto." GPL-3.0-or-later since 0.9.18 (was proprietary), © VoidExploit (Stefan Butnaru). Surfaces: Windows /
macOS / Linux desktop app (Electron), phone mirror (QR pairing, Cloudflare quick tunnel for any
network), PowerPoint add-in, browser extension, Screen Sense (slide-aware cues from the screen),
slide-to-script generator, on-device Whisper, local decisions through Ollama (Clef), cloud through
OpenRouter with a PII guard (Rizzo-PII) in front.

## Where it stands (v0.9.23)

- Independent flat review (2026-11-04): restored two-click reporting and model unload even with
  saved resource-collapse preferences; constrained the Italian Screen Sense select to its rail;
  added missing ctl.mode bilingual test coverage. Full action inventory and file/line evidence:
  `docs/superpowers/plans/2026-11-04-flat-layout-redesign-review.md`. All three requested mutations
  fail their assertions and were restored; typecheck, 186 tests (1 skip) and web build pass.
  Static contrast passes in both themes; the detector's two accent-rule warnings match the spec.
  Browser theme/system/menu/point checks and mocked report/resources checks pass. Owner screenshot
  comparison and native/package acceptance remain pending; relay pairing requires a password.

- Unreleased flat prompter (2026-11-04): Tasks 1-5 of
  `docs/superpowers/plans/2026-11-04-flat-layout-redesign.md` implemented test-first in five commits.
  Shared component tree uses resolved-theme `data-layout`: dark tabs/right rail, light sidebar.
  Flat tokens replace glass; main and welcome native materials removed; mirror layout retained.
  Three point states preserve point size/weight, full text, double-click and keyboard toggles.
  All original callbacks retained, including pairing, import/editor, start/cancel/stop, screen
  controls, notes export, reset/reload, update, resources/unload and log/report.
  Final workspace typecheck, 186 tests (1 existing skip), web and welcome builds passed.
  Browser smoke verified theme switching and menu Escape/focus return without screenshots.
  Local relay pairing returned 401 (access password required), so pairing was source-checked only.
  Detector run once: two side-tab warnings for the specified sidebar/current-point accent rules;
  retained as intentional design. Task 6 screenshot comparison belongs to the owner and was not run.
  Retired glass-specific tests explain the changed test count from the 198-test baseline.

- Independent polish review (2026-11-03): fixed keyboard access/ring precedence, shared glyph
  fallback, state/action contrast, hover/selection pairing, native-control numeric typography,
  residual pairing label and unintended topbar wrapping. Both source mutations fail as expected;
  typecheck, 198 tests (1 existing skip), web and welcome builds pass. Baseline/final SSR fixtures
  preserve content element order in EN/IT and both themes; computed focus/spacing checks pass.
  Exact requested detector path is absent; installed `.agents` detector reports no findings.
  Evidence and owner-only native/visual limits: `docs/superpowers/plans/2026-11-03-liquid-glass-polish-review.md`.

- Operate polish (2026-11-03): plain EN/IT labels, shared SVG icons, consistent control states,
  fixed rem scale and tabular numerals, 4px spacing and token browser surfaces across prompter,
  settings, welcome and mirror/overlay. Point size/weight preserved. Typecheck, 196 tests
  (1 existing skip), web and welcome builds pass. Dark/light browser checks cover all surfaces;
  dock has no orphan at 1024/1280 in EN/IT. Detector returned no findings using the installed
  `.agents` copy because the requested `.claude` path is absent. Rule evidence and limitations:
  `docs/superpowers/plans/2026-11-03-liquid-glass-polish.md`. Native/package/FPS acceptance remains pending.

- Independent remaining-glass review (2026-11-03): fixed splash motion/opacity/token duplication and restored border space with padding. Both border mutations failed; typecheck, 193 tests and web/welcome builds passed. Isolated Electron welcome loaded without captured errors; review processes killed. See docs/superpowers/plans/2026-11-03-liquid-glass-rest-review.md. Native visual, layout and FPS acceptance remain pending.

- Remaining liquid-glass surfaces (2026-11-03): settings panels/resources/Automatic setup
  use raised layers, fields use sheets, model rows/keycaps use flat layers. Mirror pairing
  and overlay drag bar use sheets; the shared StageView preview uses the existing preview
  material. Full mirror rows after ten go flat; compact overlay rows retain the protected
  point material without extra page opacity. Welcome panes and controls now use the same
  tokens, with opaque fallbacks; splash badge uses the shared sheet tint. The welcome
  native acrylic/vibrancy condition was already present; its fallback background now
  exactly matches the main window. Shared splash tokens are bundled into vendor CSS.
  Verification: workspace typecheck, 192 tests passed / 1 skipped, welcome bundle and
  production web build passed. Browser screenshots in `output/playwright/` cover dark/light
  settings, model lists, paired phone, compact overlay, welcome and splash. Welcome used
  a test preferences bridge; mirror used a synthetic local session. Native material,
  window opacity, packaged launch and hardware FPS acceptance remain unverified.

- Independent liquid-glass review (2026-11-03): fixed literal border shorthand, accent text,
  exposed metadata/log text, sheet highlights/blur and excess blurred strips/modal layers;
  strengthened CSS and foreground-token tests. Independent contrast calculations and all three
  requested source mutations passed their gates. See
  `docs/superpowers/plans/2026-11-03-liquid-glass-ui-review.md` for rule-by-rule evidence.
  Owner-only on-screen, package and FPS acceptance remains pending (Task 4).

- Unreleased liquid-glass prompter Tasks 1-3 (2026-11-03): contrast-gated raised/sheet/flat
  tokens in both themes, borderless material layers, flat rows from index 10, and an in-flow
  controls dock with background-only sheen/refraction. Reduced motion disables the effects
  and pointer listener; raised/sheet surfaces retain opaque fallbacks. Automated checks:
  185 tests passed, 1 skipped; all workspace typechecks passed. Task 4 (visual, package,
  wallpaper and FPS acceptance) is explicitly reserved for the owner and was not run.

- Independent Welcome review (2026-11-03, no commit): fixed false success when Windows leaves
  an externally disabled startup entry registered after an off request; added the desktop check
  to root typecheck. Final checks: 166 tests passed, 1 skipped; typecheck and web build passed.
  Five representative source mutations made tests fail. Manual acceptance is still blocked by
  Electron computer-use access; see `docs/welcome/REVIEW.md` for evidence and limitations.

- Unreleased Welcome implementation (2026-11-03, Codex, no commit): local packaged two-pane
  onboarding now precedes splash/servers/setup, with Automatic/EN/IT, installed-build startup,
  system/explicit theme and optional OS accent. Durable key is `welcomeCompleted` (not
  `welcomeSeen`); normal X/Get started completes, menu reopen is nonmodal and cannot rerun setup.
  `ui-preferences.js` serializes profile changes, validates IPC senders and reads OS startup truth;
  shared core helpers/strings and root React subscription keep desktop windows synchronized.
  Welcome assets are generated by `npm run build:welcome -w apps/desktop`, automatically before
  desktop start/vendor/predist. CSS tokens are shared; add-in/extension theme-copy scripts inline
  the extracted tokens. Installer language no longer overrides Automatic or existing choices.
  `FILOW_USER_DATA_DIR` is an absolute-path QA override for userData/sessionData, with legacy
  profile import disabled under that override. Production paths are unchanged.
  Automated checks and runtime QA details: see `docs/welcome/IMPLEMENTATION.md`.

- Repos: source `stefandsl/filow` (PUBLIC since 2026-11-03: the owner made it public so CI runs on free Actions minutes after a billing block; never commit keys, `.env` stays ignored; branch `main`), update feed `stefandsl/filow-releases`
  (public releases only). Local checkout: `C:\Users\stefan.butnaru\Desktop\Intelliprompter`
  (folder still has the old name on purpose).
- v0.9.23 is the current public release (2026-11-03, CI run 41728198913, feed manifests say 0.9.23,
  packaged-build gate and icon count run before the tag). Before that: v0.9.22 (2026-11-03, CI run 41720898785, feed manifests say 0.9.22; packaged
  Windows build launched on a clean profile and icon groups counted before tagging). Before that: v0.9.21 (2026-11-03, CI run 41687452972, all three platforms green,
  feed manifests say 0.9.21). 0.9.19 and 0.9.20 were published to the feed the same day and superseded
  within hours (0.9.19 did not start when installed; 0.9.20 had no installer icon). v0.9.18 exists on the
  source repo only (no Linux assets). Before that: v0.8.7 was tagged on 2026-11-02 (CI run 41458509342); 0.8.6 was in the public feed. The public
  v0.8.5 release was deleted (no Windows assets: its installer script failed on CI, which made
  installed apps show "Cannot find latest.yml ... 404"). Never publish a release to the feed
  without `latest.yml`, `latest-mac.yml` and `latest-linux.yml`.
- Recent work, newest first:
  - unreleased (after 0.9.23), IN PROGRESS: flat layout redesign of the prompter to the owner's two
    mockups (`docs/superpowers/specs/mockups/2026-11-04-prompter-{dark,light}.webp`). Owner's calls:
    BOTH layouts, one per theme (dark = section tabs on top + right rail with next section and Screen
    Sense; light = left sidebar), and FLAT material (glass and window acrylic retired). Design
    `docs/superpowers/specs/2026-11-04-flat-layout-redesign-design.md`, plan
    `docs/superpowers/plans/2026-11-04-flat-layout-redesign.md`. Tasks 1-5 done by Codex
    (adc4cad..0801b69) + review fixes 2d8b764: 186 tests, every old action reachable in two clicks,
    contrast passes. Task 6 (screenshot comparison) is the NEXT STEP, see "Codex: next task" below.
  - 0.9.23: polish pass in "Operate" mode from the impeccable / ui-ux-pro-max /
    taste rules (Codex 9c123e6..c9eff8d + review 8e56101; 198 tests; detector clean). Decorative
    uppercase-tracked labels removed ("Section 1 of 4" plain, "Next: ..." plain), accent reserved for
    primary action and real state, unified hover/focus-visible/active/disabled states, SVG icon set in
    apps/web/components/icons.tsx replacing unicode glyphs, tabular numerals on live numbers,
    ::selection / caret / scrollbar per theme, EN+IT copy audited (no em dashes), no layout change.
    Checked in the browser (no native material) in dark and light at 1280 px; packaged Windows build
    launched on a clean profile and icon groups counted before the tag.
  - 0.9.22, glass on the rest: settings page, mirror/overlay, welcome window and
    splash on the same tokens (Codex 9878589, 03ec21e, 92aa91e + review 1004355; 193 tests); the welcome
    window gets the main window's acrylic/vibrancy options. Checked on screen in dark: prompter, settings,
    welcome. Open question: a fresh dev profile (FILOW_USER_DATA_DIR) ended with welcomeCompleted=true
    without the welcome being shown or clicked (startup.log has no welcome line); only
    ui-preferences.js complete() writes that flag and only the Start click calls it (no automatic path), so it was an interaction, not code. The "Run at startup" row is
    hidden in dev on purpose (startupSupported needs app.isPackaged). Still to do before a tag:
    wallpaper-matrix screenshots, fps check during a take, packaged build.
  - 0.9.22: liquid glass UI on the prompter page. Design
    `docs/superpowers/specs/2026-11-03-liquid-glass-ui-design.md`, plan and reviewer's evidence under
    `docs/superpowers/plans/`. Three depths (raised / sheet / flat) as tokens in `theme-tokens.css`,
    no borders on glass layers, the controls row is one pill dock with a pointer sheen and a light SVG
    refraction on `::before` only, rows from the eleventh go flat, reduced-motion turns sheen and
    refraction off. Readability gate: `apps/web/lib/glass-contrast.test.ts` reads the tokens and fails
    below 7:1 (text) / 4.5:1 (muted) over white and black; tints settled at alpha .90-.92 to pass it.
    Built by Codex from the plan (3 commits) + review fixes; checked on screen in dark and light over the
    owner's wallpaper. Settings pages, overlay, phone mirror, welcome and splash now share
    the tokens (see above). Still pending: native wallpaper-matrix screenshots, fps check,
    packaged build.
  - 0.9.21: the NSIS installer and the portable exe of 0.9.19/0.9.20 had NO icon resource (generic
    icon in the browser's download list and in Explorer; the installed Filow.exe was fine). The NSIS
    bundled with electron-builder 26 silently drops a PNG-compressed .ico entry, and build/icon.ico
    had its 256 px entry as PNG. `scripts/make-icon.js` now writes every entry as a DIB (381 KB
    .ico) and icon.ico is regenerated; checked with ExtractIconEx: installer, portable and app all
    report one icon group and the extracted icon is the mark. RULE (paid twice today): before tagging,
    build the Windows package locally (`electron-builder --win`), count icon groups and launch the
    packaged Filow.exe on a throwaway profile with welcomeCompleted=true; the dev launch proves nothing
    about packaging.
  - 0.9.20 (hotfix for 0.9.19, which did not start when installed: "Cannot find module 'next'"):
    electron-builder 26 drops a root `node_modules` folder from any `extraResources` source
    (app-builder-lib/out/util/filter.js line 43, unconditional), so the Next standalone shipped
    without its dependencies. The standalone's node_modules is now a second extraResources entry
    (`from ../web/.next/standalone/node_modules, to app/node_modules`); verified with
    `electron-builder --win --dir` (node_modules/next present) and a launch of the packaged
    Filow.exe on a throwaway profile. Also: the welcome window's "Run at startup" always failed
    ("Impossibile modificare l'avvio automatico") because Electron 45 on Windows reports
    `openAtLogin: false` even right after a successful registration under a custom name (probed);
    the readback now trusts the launch-item list and executableWillLaunchAtLogin.
  - 0.9.19: the acrylic window is back. On Electron 45 / Windows 11 26300 a
    `backgroundMaterial: "acrylic"` window with `backgroundColor: "#00000000"` maximizes and goes full
    screen (measured with a probe: only `transparent: true` windows cannot), so the 0.9.11 reason is
    gone; macOS gets `vibrancy: "under-window"`. The 0.9.9 CSS had a bug that made it invisible: the
    selector `:root[data-glass] html` never matches (html is :root), so the root kept painting
    `--bg` over the material; now `:root[data-glass], :root[data-glass] body` are transparent.
    Verified on screen in light, dark and system (the material follows nativeTheme, which the page
    sets through `ui:theme`). Also: `build.executableName: "Filow"` (electron-builder 26 derived
    `@filowdesktop` from the package name and refused the Linux AppImage: v0.9.18 has Windows and
    macOS assets only and was NOT copied to filow-releases; the next tag supersedes it), and the
    installer calls SHChangeNotify(SHCNE_ASSOCCHANGED) after install because the owner's desktop
    shortcut showed a blank icon after the 0.9.15 icon change (stale Explorer icon cache; the exe's
    icon extracts fine). Wanted next (owner): a ShareX-style first-run welcome window (language,
    run at Windows start, follow system theme, follow system accent colour), to be built by Codex.
  - 0.9.18, licence: relicensed from proprietary to GPL-3.0-or-later at the owner's request
    (LICENSE = SPDX text, package.json `license` fields, README badges, installer licence pages
    `apps/desktop/build/license_*.txt` = short notice + privacy paragraph + full GPL text).
  - 0.9.18, dependencies: `npm audit` went from 40 findings (4 critical) to 15
    moderate. Bumped next 15.3.3 → 15.5.28, vitest 3 → 5.1.0, electron 33.4.11 → 45.2.1 (also
    `build.electronVersion`), electron-builder 25 → 26.18.0, office-addin-manifest/dev-certs 1 → 3;
    root `overrides` pin sharp ^0.35.5 and postcss ^8.5.32 (next and transformers pulled vulnerable
    copies; sharp is now an optional dependency of apps/web so npm keeps it installed). Verified:
    110 tests, typecheck, web build, PowerPoint build + manifest validate, `desktop:build:win`
    (installer + portable + latest.yml) and a 25 s launch of the app on Electron 45 (no
    deprecation warnings). The 15 left are minimatch < 11 (globparts DoS) and rimraf/temp under
    electron-builder's own tree: minimatch 11 dropped the CommonJS default export that glob 7 and
    @electron/asar 3 call, and no release of those packages uses it yet, so they cannot be cleared
    without breaking the packager. Build tooling only, nothing shipped. Re-check after the next
    electron-builder release. The build rewrites `apps/powerpoint/manifest.xml` (new Id) and adds a
    BOM to `apps/desktop/build/license_*.txt`: revert those before committing.
  - 0.9.18: `PUT /api/script` and `POST /api/local/plan` now require the engine
    token while `ACCESS_PASSWORD` is set (first item of the bug-hunt handoff). Reproduced on the dev
    server first: an anonymous caller overwrote the script file and ran the plan with `apply`.
    The prompter's save and `fetchPlan` (prompter Auto start and Settings) now send the token;
    `PUT` also answers 400 instead of crashing on invalid JSON. Route tests added for both.
  - 0.9.17: "Translate to" in the points editor: `POST /api/script/translate` (engine token,
    OpenRouter, GENERATE model) rewrites the "# / -" script in en/it/ro/ru/de/fr/es keeping the
    structure; the editor shows the result and a status line (model, section/point count, mismatch
    warning); saving stays manual. Checked in the dev server: IT → EN, 4 sections, 15 points.
  - 0.9.16: 33 fixes from an external bug hunt (report and its handoff in `docs/bughunt/`), applied
    as one patch: PII map collision, PowerPoint pane recreating its engine, auto-start probe fooled by
    the "…" placeholder and leaking a mic/socket on timeout, ElevenLabs reconnect after stop,
    download hanging on a dropped connection, extension script skipping slides before the current one,
    `parseDecisions` accepting "false", list-marker stripping eating leading numbers, CARD regex,
    notes placeholders, gauntlet late flips, current-session origin check, and smaller ones. Typecheck
    and the 107 tests pass. Gauntlet metric: `correct`/recall now exclude late flips (new `late`
    field); delays still include them (my change on top of the hunt's). The hunt's 96 unverified
    suspicions are listed in `docs/bughunt/2026-11-03-handoff.md`; the ones worth doing first are the
    unauthenticated `PUT /api/script` and `POST /api/local/plan`, cancel during the mic probe, and
    the committed-segment join without a space in `engine.ts`.
  - 0.9.15: one icon everywhere: the compact "O + cradle" mark at every size (ico 16-256, icon.png 512
    for macOS/Linux, favicon, extension 48/128), owner's choice after two PCs showed different icons
    (the ico mixed the mark below 64 px with the full tile above). `node scripts/make-icon.js`
    (there is no `npm run icon` script despite AGENTS.md).
  - 0.9.14: diagnostics. Crashes (main uncaught/unhandled, renderer or child process gone) are written
    to `startup.log` with a CRASH marker. Help > "Report a problem…" (also a button on the take log)
    opens a prefilled issue on the PUBLIC repo stefandsl/filow-releases with version, OS, CPU/RAM/GPU,
    the take log (the page sends it to main over `diag:takeLog`) and the tail of startup.log; the
    user reviews and submits in the browser, nothing is sent automatically. Over ~7800 chars the
    body goes to the clipboard instead (browser URL limit). Not tested in a packaged build yet.
  - 0.9.13: ROLLBACK of the microphone capture to the 0.9.6 code (owner: "roll back to the last time
    it worked") and the Electron audio switch removed; everything else (gate, unload, ElevenLabs
    error reporting, glass CSS) stays. The 0.9.7–0.9.12 capture is in git history (`git show
    v0.9.12:packages/stt/src/mic.ts`). Open question: on the owner's PC the mic track ends 4 s after
    start in every backend; the capture code was identical from 0.9.1 (when it transcribed) to 0.9.6,
    so the cause may be on that PC (exclusive-mode app, driver, Windows privacy). Next step there:
    test with "Browser (Web Speech)" (no AudioContext) and check Windows Sound > mic > Advanced.
  - 0.9.12: owner's PC: capture starts after 14 s whatever the sample rate, then "no audio ... track
    ended" (also in local mode). Diagnosis: Chromium's out-of-process audio service hangs and restarts,
    ending every capture track. `main.js` now passes `--disable-features=AudioServiceOutOfProcess`;
    mic.ts logs the peak level after 3 s and reports a track "ended" event at once. To verify on that PC.
  - 0.9.11: the acrylic window of 0.9.9 removed (a transparent-background window cannot maximize or go
    full screen on Windows; the owner hit it). The glass look stays in CSS; `--filow-glass` is no
    longer passed, so `data-glass` is never set (the CSS rule is harmless and kept).
  - 0.9.10: the audio context opens at the device's own rate and the worklet resamples to 16 kHz
    (linear interpolation, checked in Node: 48 kHz → exactly 16000 samples/s, pitch kept). Asking
    Windows for a 16 kHz context on the owner's USB mic (C-Media 0d8c:016c, native 48 kHz) blocked
    the whole app for 14 s (take log 21:46). The desktop log file is `%APPDATA%\@filow\desktop\startup.log`.
  - 0.9.9: frosted-glass look. `globals.css`: glass tokens (`--glass*`, `--glow-*`), a soft brand glow
    on the page, translucent blurred panels/buttons/modals in both themes (`@supports backdrop-filter`).
    Desktop: Windows 11 (build >= 22000) gets `backgroundMaterial: "acrylic"`, macOS `vibrancy:
    "under-window"`; the page is told through `--filow-glass` (preload `glass`) and sets `data-glass`,
    which makes its background transparent. Checked in the browser (dark/light); the acrylic window
    itself is not verified on a Windows 11 PC yet (this laptop was not rebuilt): if it looks wrong, drop
    `backgroundMaterial` and the transparent backgroundColor in `apps/desktop/main.js`.
  - 0.9.8: the take hung in "Starting" after "transcription ready" on the owner's PC: the mic probe
    opened and closed the device, then the capture opened it again and that second open never
    returned. `preopenMic()` (packages/stt/src/mic.ts) opens once at the check and the capture reuses
    the stream; every step (open, audio context resume, worklet load) has a timeout with a message.
    Not reproduced here (no such driver); verify on the 3070 PC. The frosted-glass wish shipped in 0.9.9.
  - 0.9.7: "Unload from memory" for a loaded Ollama model (`/api/local/unload`, keep_alive 0) in
    Settings and as a cross on the dashboard chip (the owner's 3070 PC sat at 7.5/8 GB VRAM).
    ElevenLabs: every error/warning message (`message` field: auth_error, quota_exceeded_error,
    input_error, insufficient_audio_activity_error, ...) now reaches the take log; before, they were
    dropped and a take looked live with no transcript. Mic capture resumes a suspended AudioContext,
    logs device + setup time, and reports "no audio from the microphone" after 4 s without PCM.
    The owner's report (ElevenLabs live after 33 s, nothing transcribed) is not reproduced here:
    the next take log on that PC will say which of the two it was.
  - Step 3 + state validity (0.9.6): embedding gate `packages/core/src/gate.ts` (pattern from
    Priler/jarvis, no code copied; MiniLM multilingual through transformers.js: Node embedder
    `apps/web/lib/gate/embedder.ts` for the gauntlet, Web Worker `lib/gate/embed.worker.ts` +
    `lib/gate/client.ts` with a per-script vector cache in localStorage for the app). Settings
    "Pre-filter before the model", off by default; `useEngine` wraps the decide call when on.
    Gauntlet `GAUNTLET_GATE=1`; numbers in `docs/gauntlet/BASELINE.md` (3/17 calls skipped,
    recall equal or better, latency within cloud variance: measure with Clef on the 3070 PC
    before making it the default). Engine epoch guard: replies from before a script reload,
    section change, reset, manual mark or start/stop are dropped and the in-flight call aborted
    (`engine.ts`, six tests). `docs/gauntlet/REUSE.md`: licence/strategy table for the reference
    repos (Jarvis, VoiceCue (unlicensed), my-prompter, moves-cli, prompter, promptme-ai,
    SallyZhou9527/prompter, STT-Presentation-Review). The owner's two plan documents (Nov 2 2026)
    set the order: measures and state correctness → less redundant work → EN/IT quality → hardware
    profiles; ro/ru stay roadmap (the Spoken-language setting already lists them for the STT only).
  - 0.9.4–0.9.5: Windows .ico fix (DIB entries below 256 px), hotkey shown as key caps.
  - Model router (0.9.3): `apps/web/lib/router.ts` (pure, unit-tested) + `/api/local/plan` (inventory,
    hardware, one measured call per candidate) + `lib/plan.ts`. Start mode Auto runs it at every
    Start and starts with its picks (STT backend + decision provider; slide generation applied
    server-side via GENERATE_PROVIDER/GENERATE_LOCAL_MODEL env). Settings "Automatic setup" panel
    with reasons and "Measure now". Also: model extraction moved off the main thread (the app showed
    "not responding" while unpacking the 475 MB Nemotron archive), small icons (0.9.2), ElevenLabs
    language + reconnect and OpenRouter throughput routing (0.9.1).
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

- Flat redesign acceptance: owner to run Task 6 of
  `docs/superpowers/plans/2026-11-04-flat-layout-redesign.md` (mockup comparison and window-size
  screenshots). Independent review fixes and evidence are recorded in the sibling
  `2026-11-04-flat-layout-redesign-review.md`; no screenshot or packaged/native acceptance claims.

- Liquid-glass acceptance: owner to execute Task 4 of
  `docs/superpowers/plans/2026-11-03-liquid-glass-ui.md`; no on-screen or FPS claims yet.

- Welcome acceptance: Windows visual controls/maximize/acrylic QA is pending computer-access
  approval for Electron. Packaged Windows startup registration/sign-in/update/path-with-spaces,
  Windows 10 fallback/high contrast/scaling/Narrator and macOS/Linux device checks are unverified.
  No startup registration has been created by source QA. Keep these separate from unit-test claims.

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
7b. **Updates leave stale files on the owner's 3070 PC** (2026-11-02): a fresh 0.9.13 install works on
   another PC while the updated one hangs 14 s at take start and the mic track ends. Suspect: the
   per-user install dir `%LOCALAPPDATA%\Programs\Filow
esources` (app.asar + app.asar.unpacked with
   sherpa-onnx native modules) not fully replaced by the NSIS update. To do once confirmed: make the
   installer remove `$INSTDIR
esources` before extracting (electron-builder hook order must be checked
   with a makensis harness, see above), and have the app log the versions of app.asar and the unpacked
   sherpa module at startup so a mismatch is visible in startup.log.
8. **Plan steps not done yet** (owner's "piano operativo", in its order): pipeline timing marks at
   each boundary (audio → text → engine wait → model → UI) with one shared id; a corpus with real
   recordings (demo-it is synthetic); segments with ids/revisions so an STT correction can retract a
   provisional mark (VoiceCue's partial-vs-final pattern, see REUSE.md); a provisional ("possible
   match") state in the UI before the confirmed tick; measuring the 4-question rotation delay.
   From Priler's two Jarvis videos (`docs/gauntlet/VIDEO-NOTES.md`): per-point alias lists for names,
   acronyms and loanwords generated at prep time and scored lexically next to the embedding; a short
   follow-up window after a hit that keeps the next point in every call.
   Then the gate vs direct comparison with Clef on the RTX 3070 PC
   (`GAUNTLET=1 GAUNTLET_GATE=1 GAUNTLET_PROVIDERS=clef-local npx vitest run apps/web/lib/gauntlet`).

## Known gaps and traps

- The flat redesign has automated and browser interaction checks; screenshot comparison remains
  pending. The local browser smoke session could not pair with the existing password-protected relay.

- `npm run desktop:build:win` on the owner's PC fails in electron-builder's winCodeSign extraction
  (symbolic links need Developer Mode); CI is the way to build installers.
- `next dev` and `next build` must not run at the same time in `apps/web` (shared `.next`):
  "Cannot find module for page: /_document".
- Port 4747 is usually taken by the installed app; use 4799 for a dev server, and kill stale ones by
  PID (`netstat -ano | findstr :4799`).
- `APPDATA` alone does not isolate Electron's `userData`; use the new absolute
  `FILOW_USER_DATA_DIR` override for QA (also relocates sessionData). Without it, source runs share
  the real profile (`%APPDATA%\@filow\desktop`). `install-choices.json` there triggers the first-start
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

## Continuing with Codex (owner's OpenAI subscription)

From 2026-11-04 the owner's Claude credits are low: Codex does the work. Start every Codex session
with: "Read AGENTS.md and HANDOFF.md, then do 'Codex: next task'." Answer the owner in the language
they wrote (usually Italian), outcome first, short.

### How Codex is run on this PC

- Binary `~/.local/bin/codex.exe` (codex-cli 0.156.1, ChatGPT account). Model `gpt-6-astra` (from
  `~/.codex/config.toml`). The Miniconda `codex` on PATH is the wrong one.
- Non-interactive run that works (prompt from a file on stdin, workspace-write sandbox with automatic
  approval review, final message to a file):
  `~/.local/bin/codex.exe exec -m gpt-6-astra --approve-for-me -C G:/FILOW --output-last-message G:/FILOW/tmp/codex/run-N-last.md - < G:/FILOW/tmp/codex/brief-N.md`
  `--full-auto` and `-s workspace-write --approve-for-me` together are rejected by this version.
- One run at a time (parallel runs hit 429). Pattern that worked all day: brief -> implement agent ->
  independent review agent that re-checks and fixes -> a human look at the screen.
- Every Codex run appends a `claude-mem` block to `AGENTS.md`: always `git checkout -- AGENTS.md`
  after a run and never commit that file's change.
- Briefs and logs live in `G:/FILOW/tmp/codex/` (gitignored). Disk policy: nothing on C:, temp files
  under `G:/FILOW/tmp`, npm cache `--cache G:/caches/npm`.

### Codex: next task (finish the flat redesign, plan Task 6)

1. `npm run build -w apps/web`, then launch the desktop app on a throwaway profile:
   `cd apps/desktop && FILOW_USER_DATA_DIR='G:\FILOW	mp\pkg-qa' FILOW_PORT=4797 FILOW_SESSION_PORT=4798 FILOW_OFFLINE=1 npx electron .`
   (that profile has `welcomeCompleted: true`). Or serve the web build alone:
   `set PORT=4790&& set FILOW_SCRIPT=G:\FILOW	mp\pkg-qa\script.md&& node apps\web\.next\standalonepps\web\server.js`
2. Compare 1280 x 820 captures with the two mockups and fix. Differences already seen in the DARK
   layout on 2026-11-04 (fix these first):
   - the overflow "..." button at the right of the action bar renders EMPTY (icon missing);
   - the Screen Sense mode select in the right rail is clipped ("Bilanciato (cambio slide + frasi...")
     and the action-bar "Modalita" select is truncated ("Automatico (il piu ve"): show the short
     label (e.g. "Bilanciato", "Automatico") in the control, full description in the option list or
     a tooltip;
   - the transcript toggle reads "Trascrizione /" with a stray slash;
   - section tabs wrap long titles onto two lines; the mockup shows one line per tab: one line with
     ellipsis on the TAB only (never on points), full title in `title`;
   - the top bar shows a "mirror spento" chip where the mockup has an "Abbina dispositivo" button
     with a monitor icon; the theme control is three buttons where the mockup has one sun/moon
     toggle; keep every function, match the mockup's form.
3. The LIGHT layout was NOT verified: the page's saved theme preference ("dark") overrides the
   browser's colour-scheme emulation. Switch with the in-app theme control (or clear localStorage
   key used by `getThemePref` in `apps/web/lib/prefs.ts`) and compare with the light mockup: left
   sidebar 260 px with "Il copione / 4 sezioni", current section on a tinted row with a 3 px accent
   rule, Importa documento and Ricarica copione at the bottom of the sidebar, next-section card under
   the points (two columns above 1100 px), Screen Sense as one row above the action bar.
4. Also capture 760 x 540 and 1920 x 1080 in both themes: nothing clipped, no truncated points, all
   actions reachable. Capture the three point states (waiting, active, done).
5. Write `docs/superpowers/plans/2026-11-04-flat-layout-redesign-evidence.md` (captures + remaining
   differences), commit. Keep: typecheck, `npx vitest run --root G:/FILOW`, web build green.
6. Release only when the owner says so, with the gate below.

### Release gate (paid for twice on 2026-11-03: never skip)

1. `npm run build`, then `cd apps/desktop && npx electron-builder --win`.
2. Launch `release/win-unpacked/Filow.exe` on the throwaway profile; `startup.log` in that profile
   must reach "main window shown"; `release/win-unpacked/resources/app/node_modules/next` must exist.
3. Count icon groups (PowerShell `ExtractIconEx(path, -1, ...)`) on the installer and the portable:
   both must be 1.
4. Revert build side effects: `git checkout -- apps/desktop/build/license_en.txt apps/desktop/build/license_it.txt apps/powerpoint/manifest.xml`.
5. Bump every `package.json` + `apps/browser/manifest.json`, `npm install --package-lock-only --ignore-scripts`,
   commit, `git tag vX.Y.Z`, `git push origin main vX.Y.Z`, wait for CI (all three platforms).
6. `gh release download vX.Y.Z --repo stefandsl/filow -D tmp/assets`, delete `builder-debug.yml`,
   count icons again on the CI files, then `gh release create vX.Y.Z --repo stefandsl/filow-releases ...`
   and check that `latest.yml`, `latest-mac.yml`, `latest-linux.yml` on the feed say the new version.

### Other open items

- Code signing (SmartScreen / Gatekeeper warnings): needs an Azure Trusted Signing account or a
  certificate from the owner; then add signing to `.github/workflows/desktop.yml` gated on secrets.
- 15 moderate npm audit findings inside electron-builder's own tree (minimatch < 11): re-check at the
  next electron-builder release.
- Before ending a session, update "Where it stands" and this section, and commit HANDOFF.md.
