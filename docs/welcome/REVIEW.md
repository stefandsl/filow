# Independent Welcome review — 2026-11-03

Review of the uncommitted implementation against SPEC.md. No commit made. Read AGENTS.md,
HANDOFF.md, the complete tracked implementation diff and new implementation/test files.
The implementer's IMPLEMENTATION.md was treated as a claim, not verification evidence.
An AGENTS.md memory block appeared during this review; it was read and left untouched.

**Result: two confirmed defects fixed. Automated verification passes; manual acceptance is
incomplete because Computer Use denied access to Electron. This is not release sign-off.**

## Confirmed defects and fixes

1. **Startup off could acknowledge an OS operation that did not remove the registration.**
   An externally disabled Windows entry has `enabled:false` while `openAtLogin:true`.
   Previously, if the OS setter left that entry unchanged, `update({runAtStartup:false})`
   returned success and persisted false, since readback tested only effective enablement.
   Reproduced with the real preference service and an injected no-op OS setter: the new
   assertion expected `ok:false` and received `ok:true`.
   Fixed at `apps/desktop/ui-preferences.js:20` and `:27`: explicit off also requires the
   registration to be absent. Regression tests at `apps/desktop/ui-preferences.test.ts:34`
   and `:45` cover failed removal and successful removal of an externally disabled entry.
   This is an adapter-level reproduction, not a reproduced failure of Windows itself.
   The distinction matches the installed Electron 45 typings and
   [Electron's login-item API](https://www.electronjs.org/docs/latest/api/app#appgetloginitemsettingsoptions-macos-windows).

2. **The normal root typecheck silently omitted Welcome's TypeScript.**
   Injecting `const reviewTypeError: number = "should fail"` into `welcome.ts` left
   `npm run typecheck` green (exit 0), while the desktop workspace check failed (exit 2).
   Fixed `package.json:20` to include the desktop check. Repeating the injection now makes
   the root command fail (exit 2). Restored the original source bytes after each mutation.

No other functional defect was confirmed by this review. This does not clear the blocked
manual/platform checks listed below.

## Requirement-by-requirement evidence

“Implemented” below means source inspection and, where stated, automated tests. It does not
mean the rendered behavior was observed by hand.

| Requirement | Code verdict and evidence | Verification limits |
|---|---|---|
| Show once per profile, including updates | Implemented. `apps/desktop/main.js:1575` tests literal `welcomeCompleted !== true`; `apps/desktop/ui-preferences.js:85` queues durable completion. No version or install-directory key. `main.js:1129` consumes installer choices without replacing UI language or completion. | Completion and lifecycle tests pass; persisting false instead of true makes the suite fail. No actual update/reinstall performed. Existing profiles without the flag deliberately see Welcome once. |
| Normal X/Get started; crash/quit handling | Implemented. `welcome.ts:44` invokes completion; `ui-preferences.js:129` intercepts normal close; `:145` closes only after successful completion. `main.js:1719` protects the handoff; `:1720` marks shutdown. Load/crash handlers at `main.js:295` fail startup. | Lifecycle adapter tests cover X, save failure, shutdown, crash/load failure and unexpected destruction. No native close/relaunch exercised by reviewer. |
| Reopen from menu, singleton, main remains usable | Implemented. `main.js:1479` adds the translated menu item; `ui-preferences.js:125` focuses an existing window; `main.js:283` uses a nonmodal parent. Menu code does not call `main()` or setup. | Singleton tests pass. Actual menu interaction, focus and take preservation unverified. |
| Automatic/English/Italiano | Implemented. `welcome.html:30` has the three choices; `welcome.ts:39` sends edits, `:17` translates live; `packages/core/src/ui-preferences.ts:31` resolves locale. `apps/web/lib/prefs.ts:13` mirrors Automatic by removing explicit browser language. | Locale, Automatic, migration and no-echo tests pass. Live EN/IT labels and native menus unverified. |
| Run at startup | Implemented with readback fix above. `ui-preferences.js:15` restricts support; `:18` uses matching executable/empty args; `:71` calls the setter only for explicit startup patches. `:28` retains macOS pending approval. | Unsupported/dev/portable, external disable, OS and disk failures tested with adapters. No installed Windows registration, sign-in, path-with-spaces install, or macOS login test. Source runs deliberately hide the control. |
| Follow system theme / explicit light and dark | Implemented. `welcome.ts:41` captures the current resolved theme on off via `core/src/ui-preferences.ts:33`; `welcome.ts:40` selects explicit theme; `ui-preferences.js:80` updates nativeTheme after save; `:105` listens to OS updates. | Pure capture/normalization and service tests pass. Actual OS switching and title-bar behavior unverified. |
| Follow system accent | Implemented. `welcome.ts:42` sends the boolean; `ui-preferences.js:40` queries color only when supported/on; `:106` and `:108` install OS listeners; focus refresh is wired in main and the controller. `core/src/ui-preferences.ts:42` parses RGBA. | Event deduplication, fallback and no sampled-color persistence tested. Actual two-color Windows notification/focus recovery unverified. |
| Persistence and cross-window synchronization | Implemented. `main.js:197` writes a sibling temporary file and renames before replacing memory. `ui-preferences.js:60` serializes edits; `:78` saves merged settings. `main.js:252` broadcasts bounded state. `prefs.ts:29` subscribes before fetching and rejects older snapshots. | Disk-failure, ordering, rollback/no-echo and unsubscribe tests pass. No reviewer-operated control-to-disk round trip. |
| Preload availability / initial hydration | No early-read defect found. `welcome-preload.js:2` exposes the bridge synchronously; `welcome.html:9` defers the page script; `welcome.ts:50` subscribes before initial get. Main-page bridge exposure is synchronous at `preload.js:6`; React reads it in the effect at `UiPreferencesProvider.tsx:13`, and withholds children until ready (`:33`). | Code inspection plus connection-order tests. No runtime console/render inspection. |
| EN/IT strings | Implemented. New keys exist in both `packages/core/src/i18n.ts:10` and `:445`; Welcome uses shared translator and textContent. Existing language/theme controls use shared labels in `LangSwitch.tsx:11` and `:20`. | Parity test passes; deleting the Italian welcome title makes it fail. No claim that all pre-existing app strings are translated. |
| Dark/light/system rendering and readable accent | Implemented pipeline: `applyUiPreferences.ts:4` sets language/theme/glass and adds/removes all accent properties; `core/src/ui-preferences.ts:67` derives foreground/text/focus colors; `theme-tokens.css:52` bounds glass opacity. Primary controls consume action tokens in `globals.css:83` and `welcome.css:40`. | Extreme-color and simulated compositing tests pass; forced black foreground makes 3 tests fail. Actual rendered contrast, hover, text over acrylic and accent on/off in both windows unverified. |
| Glass look and main maximize/fullscreen | Code preserves acrylic/vibrancy and avoids transparent:true: `main.js:274` for Welcome and `:1603` for main. `welcome.css:8` provides the two-pane layout, translucent surfaces and narrow-screen stack (`:44`). `main.js:1552` toggles fullscreen. | No screenshot obtained; appearance and maximize/fullscreen explicitly NOT verified. Reduced transparency/forced-colors rules exist but were not exercised. |
| Linux behavior | Implemented guards: `ui-preferences.js:15` excludes startup, `:16` excludes accent; `welcome.ts:25` and `:26` hide those rows. `main.js:275` excludes native glass; system theme remains available. | Linux adapter test confirms no startup setter call and fails when Linux is added to supported platforms. No Linux runtime tested. |
| Ordering with local-AI offer | Implemented. `main.js:1577` awaits Welcome before splash/server startup at `:1580`; local-AI offer remains later at `:1642`. Installer choices stay in the local `choices` variable, and an empty-model object is still truthy, suppressing another offer. Menu reopening only invokes the welcome controller. | Static call-order inspection. Unit controller tests do not prove the entire Electron startup sequence. No reviewer-observed AI dialog ordering. |
| IPC validation | New UI calls validate tracked main-frame identity and exact welcome URL/app origin in `ui-preferences.js:3`; handlers enforce it at `main.js:260`; patches are whitelisted in `core/src/ui-preferences.ts:34`. Welcome cannot invoke completion from main-page IPC. CSP and denied navigation/popups are at `welcome.html:6` / `main.js:293`. | Invalid sender/subframe/origin/field tests pass. This is a review of the new preference IPC, not a security audit of every pre-existing engine channel. |

## Commands and mutation results

- Baseline `npm.cmd run typecheck`: passed; baseline `npm.cmd test`: 164 passed, 1 skipped.
- `npm.cmd run build:welcome -w apps/desktop`: passed.
- `npm.cmd run build -w apps/web`: passed, including standalone preparation.
- Final `npm.cmd run typecheck`: passed, now including desktop.
- Final `npm.cmd test`: **166 passed, 1 skipped**, 20 test files passed, 1 skipped.
- `node --check apps/desktop/ui-preferences.js`: passed. `git diff --check`: passed.
- No full installer or cross-platform build was performed by this reviewer.

Mutation script: `tmp/review-mutations.cjs`. Each production-source mutation was applied alone,
the relevant tests were run, their assertion failures inspected, and the original bytes restored.

| Mutation | Observed result |
|---|---|
| Save completion as false | 1 failing desktop assertion |
| Allow Linux startup registration | 1 failing unsupported-platform assertion |
| Always use black action text | 3 failing contrast assertions |
| Reverse snapshot revision comparison | 3 failing core/web assertions |
| Remove Italian welcome title | 1 failing dictionary parity assertion |

Logs are in `tmp/review-{completion,linux-guard,accent-foreground,revision-order,italian-parity}.log`.
The root-check coverage reproduction/fix logs are `tmp/review-typecheck-{root,desktop,fixed}.log`.
These representative mutations demonstrate meaningful failures; they are not a complete mutation
score or proof that all integration wiring is covered. In particular, lifecycle mocks do not test
the actual native window, preload execution or main startup wiring.

## Exact runtime observations

C: free space was approximately 277 GiB, above the 20 GB stop threshold. TEMP/TMP and npm cache
were redirected to `G:\FILOW\tmp\review-temp` and `G:\FILOW\tmp\review-npm`.

Launched `npx.cmd --no-install electron .` from `apps/desktop` with:

```text
FILOW_USER_DATA_DIR=G:\FILOW\tmp\welcome-review-20261103
FILOW_PORT=4799
FILOW_SESSION_PORT=4800
FILOW_OFFLINE=1
NEXT_TELEMETRY_DISABLED=1
```

The command-sandbox attempt failed with Electron's AppContainer distribution ACL error. The
escalated launch succeeded without disabling Electron's sandbox. Window inventory returned
one Filow window owned by the repository's electron.exe (window ID 120068940).

Selecting that exact window returned **“Computer Use was not approved to use electron”**.
No screenshot or control interaction succeeded. Access was requested; no alternative automation
was used to bypass that denial. Consequently this reviewer has **no by-hand UI verification**.

The QA profile file was read on disk. At the first read it had Automatic language, system theme,
accent false, and no completion/startup-request key. Later reads showed dark theme and completion
true, plus setup flags. Those changes happened while reviewer UI access was unavailable; they
cannot be attributed to reviewer actions and are not counted as a verified control-to-disk test.
No credentials or unrelated profile fields are reproduced here. The QA process was left running
for permission handoff; a restart is needed to load the main-process readback fix.

## Remaining unverified

All reviewer-operated UI acceptance: every visible control, Get started and X/relaunch behavior,
menu singleton/focus/take preservation, native main maximize/fullscreen, live bidirectional
theme/language synchronization, accent apply/clear in both themes/windows, visible acrylic,
keyboard/Narrator/scaling and forced colors, save-failure UI, renderer-failure UI, actual
local-AI ordering, and actual update/reinstall retention.

Installed Windows startup registration/external-disable/sign-in/update/path-with-spaces needs
an isolated installed test account. Source mode intentionally hides startup and cannot verify it.
Windows 10 fallback, macOS login approval/vibrancy/accent and Linux native behavior remain
unverified. Unit and source evidence must not be presented as these manual results.
